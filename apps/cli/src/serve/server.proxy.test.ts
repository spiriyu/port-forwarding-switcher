import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import * as net from 'net';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createDaemon, DaemonHandle } from './server';

let daemon: DaemonHandle;
let tmpDir: string;
let configPath: string;
let logPath: string;

function startEchoServer(): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve) => {
    const server = net.createServer((sock) => { sock.pipe(sock); });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as net.AddressInfo).port });
    });
  });
}

// Grab a free port by briefly binding then releasing it.
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function tcpRoundTrip(port: number, data: string, timeoutMs = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ host: '127.0.0.1', port });
    let received = '';
    const timer = setTimeout(() => { client.destroy(); reject(new Error('tcpRoundTrip timeout')); }, timeoutMs);
    client.once('connect', () => { client.write(data); });
    client.on('data', (chunk: Buffer) => {
      received += chunk.toString();
      if (received.length >= data.length) { clearTimeout(timer); client.destroy(); resolve(received); }
    });
    client.once('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

const echoServers: net.Server[] = [];

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ps-proxy-test-'));
  configPath = path.join(tmpDir, 'config.json');
  logPath = path.join(tmpDir, 'logs');
  daemon = createDaemon({ port: 0, configPath, logPath });
  await daemon.start();
});

afterEach(async () => {
  await daemon.stop();
  await Promise.all(echoServers.splice(0).map(
    (s) => new Promise<void>((r) => s.close(() => r())),
  ));
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
});

describe('TCP forwarding end-to-end', () => {
  it('forwards data through an enabled mapping', async () => {
    const { server: echo, port: echoPort } = await startEchoServer();
    echoServers.push(echo);
    const sourcePort = await getFreePort();

    const res = await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort, targetHost: '127.0.0.1', targetPort: echoPort, enabled: true })
      .expect(201);

    expect(res.body.status).toBe('listening');
    const reply = await tcpRoundTrip(sourcePort, 'hello proxy');
    expect(reply).toBe('hello proxy');
  });

  it('status is disabled when enabled is false', async () => {
    const { server: echo, port: echoPort } = await startEchoServer();
    echoServers.push(echo);
    const sourcePort = await getFreePort();

    const res = await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort, targetHost: '127.0.0.1', targetPort: echoPort, enabled: false })
      .expect(201);

    expect(res.body.status).toBe('disabled');
  });

  it('PATCH enabled:true starts forwarding', async () => {
    const { server: echo, port: echoPort } = await startEchoServer();
    echoServers.push(echo);
    const sourcePort = await getFreePort();

    const created = await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort, targetHost: '127.0.0.1', targetPort: echoPort })
      .expect(201);

    expect(created.body.status).toBe('disabled');

    const patched = await request(daemon.httpServer)
      .patch(`/api/v1/mappings/${created.body.id}`)
      .send({ enabled: true })
      .expect(200);

    expect(patched.body.status).toBe('listening');
    const reply = await tcpRoundTrip(sourcePort, 'after patch');
    expect(reply).toBe('after patch');
  });

  it('PATCH enabled:false stops forwarding', async () => {
    const { server: echo, port: echoPort } = await startEchoServer();
    echoServers.push(echo);
    const sourcePort = await getFreePort();

    const created = await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort, targetHost: '127.0.0.1', targetPort: echoPort, enabled: true })
      .expect(201);

    await tcpRoundTrip(sourcePort, 'before disable');

    const patched = await request(daemon.httpServer)
      .patch(`/api/v1/mappings/${created.body.id}`)
      .send({ enabled: false })
      .expect(200);

    expect(patched.body.status).toBe('disabled');
    await expect(tcpRoundTrip(sourcePort, 'after disable', 500)).rejects.toThrow();
  });

  it('toggle enables then disables forwarding', async () => {
    const { server: echo, port: echoPort } = await startEchoServer();
    echoServers.push(echo);
    const sourcePort = await getFreePort();

    const created = await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort, targetHost: '127.0.0.1', targetPort: echoPort })
      .expect(201);

    const id = created.body.id as string;

    const enabled = await request(daemon.httpServer).post(`/api/v1/mappings/${id}/toggle`).expect(200);
    expect(enabled.body.status).toBe('listening');
    await tcpRoundTrip(sourcePort, 'on');

    const disabled = await request(daemon.httpServer).post(`/api/v1/mappings/${id}/toggle`).expect(200);
    expect(disabled.body.status).toBe('disabled');
    await expect(tcpRoundTrip(sourcePort, 'off', 500)).rejects.toThrow();
  });

  it('reports EADDRINUSE status when port is already bound', async () => {
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    const blockedPort = (blocker.address() as net.AddressInfo).port;

    try {
      const res = await request(daemon.httpServer)
        .post('/api/v1/mappings')
        .send({ sourcePort: blockedPort, targetHost: '127.0.0.1', targetPort: 9999, enabled: true })
        .expect(201);

      expect(res.body.status).toBe('error');
      expect(res.body.error?.code).toBe('EADDRINUSE');
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  });

  it('DELETE tears down the forwarder', async () => {
    const { server: echo, port: echoPort } = await startEchoServer();
    echoServers.push(echo);
    const sourcePort = await getFreePort();

    const created = await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort, targetHost: '127.0.0.1', targetPort: echoPort, enabled: true })
      .expect(201);

    await tcpRoundTrip(sourcePort, 'before delete');

    await request(daemon.httpServer).delete(`/api/v1/mappings/${created.body.id}`).expect(204);

    await expect(tcpRoundTrip(sourcePort, 'after delete', 500)).rejects.toThrow();
  });

  it('hot-rebind: change targetPort while enabled, new target gets traffic', async () => {
    const { server: echo1, port: echoPort1 } = await startEchoServer();
    const { server: echo2, port: echoPort2 } = await startEchoServer();
    echoServers.push(echo1, echo2);
    const sourcePort = await getFreePort();

    const created = await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort, targetHost: '127.0.0.1', targetPort: echoPort1, enabled: true })
      .expect(201);

    const id = created.body.id as string;
    const echo1Reply = await tcpRoundTrip(sourcePort, 'v1');
    expect(echo1Reply).toBe('v1');

    await request(daemon.httpServer)
      .patch(`/api/v1/mappings/${id}`)
      .send({ targetPort: echoPort2 })
      .expect(200);

    const echo2Reply = await tcpRoundTrip(sourcePort, 'v2');
    expect(echo2Reply).toBe('v2');
  });

  it('stats reflect bytes transferred', async () => {
    const { server: echo, port: echoPort } = await startEchoServer();
    echoServers.push(echo);
    const sourcePort = await getFreePort();

    const res = await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort, targetHost: '127.0.0.1', targetPort: echoPort, enabled: true })
      .expect(201);

    const id = res.body.id as string;
    await tcpRoundTrip(sourcePort, 'measure me');

    await new Promise((r) => setTimeout(r, 50));

    const mapping = await request(daemon.httpServer).get(`/api/v1/mappings/${id}`).expect(200);
    expect(mapping.body.stats.totalConnections).toBeGreaterThanOrEqual(1);
    expect(mapping.body.stats.bytesIn).toBeGreaterThan(0);
  });
});
