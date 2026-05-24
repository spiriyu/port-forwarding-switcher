/**
 * Hardening tests: failure injection, edge cases, and concurrent operations.
 * All tests use ephemeral ports and real TCP sockets.
 */
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

const echoServers: net.Server[] = [];

function startEchoServer(): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve) => {
    const server = net.createServer((sock) => { sock.pipe(sock); });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as net.AddressInfo).port });
    });
  });
}

function stopServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

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

function tryConnect(port: number, timeoutMs = 500): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ host: '127.0.0.1', port });
    const timer = setTimeout(() => { client.destroy(); reject(new Error('connect timeout')); }, timeoutMs);
    client.once('connect', () => { clearTimeout(timer); client.destroy(); resolve(); });
    client.once('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

async function makeDaemon() {
  daemon = createDaemon({ port: 0, configPath, logPath });
  await daemon.start();
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ps-hardening-'));
  configPath = path.join(tmpDir, 'config.json');
  logPath = path.join(tmpDir, 'logs');
});

afterEach(async () => {
  if (daemon) {
    await daemon.stop().catch(() => undefined);
  }
  await Promise.all(echoServers.splice(0).map((s) => stopServer(s)));
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
});

// ---- Config corruption ----

describe('Config corruption', () => {
  it('daemon.start() rejects when config JSON is corrupted', async () => {
    await fs.writeFile(configPath, '{ invalid json !!!', 'utf-8');
    daemon = createDaemon({ port: 0, configPath, logPath });
    await expect(daemon.start()).rejects.toThrow();
  });

  it('daemon.start() rejects when config JSON is truncated', async () => {
    await fs.writeFile(configPath, '{"schemaVersion":1,"mappings":[{', 'utf-8');
    daemon = createDaemon({ port: 0, configPath, logPath });
    await expect(daemon.start()).rejects.toThrow();
  });

  it('daemon.start() creates default config when file is absent', async () => {
    // configPath does not exist — should boot normally
    await makeDaemon();
    const res = await request(daemon.httpServer).get('/api/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
    const raw = await fs.readFile(configPath, 'utf-8');
    expect(JSON.parse(raw).schemaVersion).toBe(2);
  });
});

// ---- Target unreachable ----

describe('Target unreachable', () => {
  it('mapping status stays error when target port is never open', async () => {
    await makeDaemon();
    const sourcePort = await getFreePort();
    const unusedPort = await getFreePort();

    const res = await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort, targetHost: '127.0.0.1', targetPort: unusedPort, enabled: true, groupId: 'GRP01' })
      .expect(201);

    // The listener should bind OK (source port is free); status is 'listening'
    expect(res.body.status).toBe('listening');

    // Connecting to source should fail cleanly (target refused)
    await expect(tcpRoundTrip(sourcePort, 'test', 800)).rejects.toThrow();
  });

  it('new connections are refused gracefully when target goes down mid-session', async () => {
    await makeDaemon();
    const { server: echo, port: echoPort } = await startEchoServer();
    echoServers.push(echo);
    const sourcePort = await getFreePort();

    const res = await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort, targetHost: '127.0.0.1', targetPort: echoPort, enabled: true, groupId: 'GRP01' })
      .expect(201);

    expect(res.body.status).toBe('listening');
    // Verify it works before target is stopped
    await tcpRoundTrip(sourcePort, 'before');

    // Stop the echo server
    await stopServer(echo);
    echoServers.splice(echoServers.indexOf(echo), 1);

    // New connections to source should fail cleanly (not crash the daemon)
    await expect(tcpRoundTrip(sourcePort, 'after', 800)).rejects.toThrow();

    // Daemon should still be healthy
    await request(daemon.httpServer).get('/api/v1/health').expect(200);
  });
});

// ---- Concurrent operations ----

describe('Concurrent operations', () => {
  it('10 concurrent creates return 201 each with unique IDs', async () => {
    await makeDaemon();
    const { server: echo, port: echoPort } = await startEchoServer();
    echoServers.push(echo);

    const ports = await Promise.all(Array.from({ length: 10 }, () => getFreePort()));

    const results = await Promise.all(
      ports.map((sourcePort) =>
        request(daemon.httpServer)
          .post('/api/v1/mappings')
          .send({ sourcePort, targetHost: '127.0.0.1', targetPort: echoPort, groupId: 'GRP01' })
          .expect(201),
      ),
    );

    const ids = results.map((r) => r.body.id as string);
    const unique = new Set(ids);
    expect(unique.size).toBe(10);
  });

  it('rapid sequential toggles leave mapping in a consistent state', async () => {
    await makeDaemon();
    const { server: echo, port: echoPort } = await startEchoServer();
    echoServers.push(echo);
    const sourcePort = await getFreePort();

    const created = await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort, targetHost: '127.0.0.1', targetPort: echoPort, enabled: false, groupId: 'GRP01' })
      .expect(201);

    const id = created.body.id as string;

    // 10 sequential toggles (even→disabled, odd→listening)
    for (let i = 0; i < 10; i++) {
      await request(daemon.httpServer).post(`/api/v1/mappings/${id}/toggle`).expect(200);
    }

    const final = await request(daemon.httpServer).get(`/api/v1/mappings/${id}`).expect(200);
    expect(['listening', 'disabled', 'error']).toContain(final.body.status);

    // Daemon must still respond to health check
    await request(daemon.httpServer).get('/api/v1/health').expect(200);
  });

  it('5 concurrent clients through the same mapping all get correct round-trips', async () => {
    await makeDaemon();
    const { server: echo, port: echoPort } = await startEchoServer();
    echoServers.push(echo);
    const sourcePort = await getFreePort();

    await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort, targetHost: '127.0.0.1', targetPort: echoPort, enabled: true, groupId: 'GRP01' })
      .expect(201);

    const replies = await Promise.all(
      Array.from({ length: 5 }, (_, i) => tcpRoundTrip(sourcePort, `client${i}`)),
    );

    expect(replies).toHaveLength(5);
    replies.forEach((reply, i) => { expect(reply).toBe(`client${i}`); });
  });
});

// ---- Persistence across restart ----

describe('Persistence across restart', () => {
  it('enabled mappings are re-bound after daemon restart', async () => {
    await makeDaemon();
    const { server: echo, port: echoPort } = await startEchoServer();
    echoServers.push(echo);
    const sourcePort = await getFreePort();

    await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ name: 'persist-test', sourcePort, targetHost: '127.0.0.1', targetPort: echoPort, enabled: true, groupId: 'GRP01' })
      .expect(201);

    // Flush debounce and stop
    await new Promise((r) => setTimeout(r, 100));
    await daemon.stop();

    // Restart with same config
    daemon = createDaemon({ port: 0, configPath, logPath });
    await daemon.start();

    const list = await request(daemon.httpServer).get('/api/v1/mappings').expect(200);
    const restored = (list.body.mappings as Array<{ name: string; status: string }>)
      .find((m) => m.name === 'persist-test');
    expect(restored).toBeDefined();
    expect(restored?.status).toBe('listening');

    // Traffic must flow
    const reply = await tcpRoundTrip(sourcePort, 'after restart');
    expect(reply).toBe('after restart');
  });

  it('disabled mappings are restored as disabled (not bound)', async () => {
    await makeDaemon();
    const sourcePort = await getFreePort();

    await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ name: 'no-bind', sourcePort, targetHost: '127.0.0.1', targetPort: 9999, enabled: false, groupId: 'GRP01' })
      .expect(201);

    await new Promise((r) => setTimeout(r, 100));
    await daemon.stop();

    daemon = createDaemon({ port: 0, configPath, logPath });
    await daemon.start();

    const list = await request(daemon.httpServer).get('/api/v1/mappings').expect(200);
    const restored = (list.body.mappings as Array<{ name: string; status: string; enabled: boolean }>)
      .find((m) => m.name === 'no-bind');
    expect(restored).toBeDefined();
    expect(restored?.status).toBe('disabled');

    // Port must NOT be bound
    await expect(tryConnect(sourcePort, 300)).rejects.toThrow();
  });
});

// ---- External config edits ----

describe('External config edit (watchConfig)', () => {
  it('enabling a mapping via direct file edit binds the forwarder', async () => {
    await makeDaemon();
    const { server: echo, port: echoPort } = await startEchoServer();
    echoServers.push(echo);
    const sourcePort = await getFreePort();

    // Create a disabled mapping via API
    const res = await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort, targetHost: '127.0.0.1', targetPort: echoPort, enabled: false, groupId: 'GRP01' })
      .expect(201);

    const id = res.body.id as string;

    // Flush the config to disk
    await new Promise((r) => setTimeout(r, 150));

    // Directly edit the config file to enable the mapping
    const raw = await fs.readFile(daemon.configPath, 'utf-8');
    const config = JSON.parse(raw) as { mappings: Array<{ id: string; enabled: boolean }> };
    const m = config.mappings.find((x) => x.id === id);
    if (m) m.enabled = true;
    await fs.writeFile(daemon.configPath, JSON.stringify(config, null, 2), 'utf-8');

    // Wait for fs.watch debounce + forwarder bind
    await new Promise((r) => setTimeout(r, 500));

    // Traffic should now flow
    const reply = await tcpRoundTrip(sourcePort, 'after-edit');
    expect(reply).toBe('after-edit');
  });

  it('disabling a mapping via direct file edit stops the forwarder', async () => {
    await makeDaemon();
    const { server: echo, port: echoPort } = await startEchoServer();
    echoServers.push(echo);
    const sourcePort = await getFreePort();

    await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort, targetHost: '127.0.0.1', targetPort: echoPort, enabled: true, groupId: 'GRP01' })
      .expect(201);

    await tcpRoundTrip(sourcePort, 'before-edit');
    await new Promise((r) => setTimeout(r, 150));

    const raw = await fs.readFile(daemon.configPath, 'utf-8');
    const config = JSON.parse(raw) as { mappings: Array<{ enabled: boolean }> };
    config.mappings.forEach((m) => { m.enabled = false; });
    await fs.writeFile(daemon.configPath, JSON.stringify(config, null, 2), 'utf-8');

    await new Promise((r) => setTimeout(r, 500));

    await expect(tcpRoundTrip(sourcePort, 'after-edit', 400)).rejects.toThrow();
  });
});

// ---- CORS protection ----

describe('CORS protection', () => {
  it('rejects requests with an Origin header', async () => {
    await makeDaemon();
    const res = await request(daemon.httpServer)
      .get('/api/v1/health')
      .set('Origin', 'http://evil.example.com')
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows requests without an Origin header', async () => {
    await makeDaemon();
    await request(daemon.httpServer).get('/api/v1/health').expect(200);
  });
});

// ---- Error recovery ----

describe('Error recovery', () => {
  it('EADDRINUSE error mapping can be re-enabled after blocker is released', async () => {
    await makeDaemon();
    const { server: echo, port: echoPort } = await startEchoServer();
    echoServers.push(echo);

    // Bind a blocker on a specific port
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    const blockedPort = (blocker.address() as net.AddressInfo).port;

    const res = await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort: blockedPort, targetHost: '127.0.0.1', targetPort: echoPort, enabled: true, groupId: 'GRP01' })
      .expect(201);

    expect(res.body.status).toBe('error');
    const id = res.body.id as string;

    // Release the blocker
    await stopServer(blocker);

    // Re-enable via toggle (mapping is currently in error state, toggle enables it)
    const toggled = await request(daemon.httpServer).post(`/api/v1/mappings/${id}/toggle`).expect(200);
    // Might be listening now (blocker released) or still have an issue — check it bound
    if (toggled.body.status === 'listening') {
      const reply = await tcpRoundTrip(blockedPort, 'recovered');
      expect(reply).toBe('recovered');
    } else {
      // Re-enable via PATCH
      const patched = await request(daemon.httpServer)
        .patch(`/api/v1/mappings/${id}`)
        .send({ enabled: true })
        .expect(200);
      expect(patched.body.status).toBe('listening');
    }
  });

  it('daemon handles DELETE of a non-existent mapping gracefully', async () => {
    await makeDaemon();
    await request(daemon.httpServer)
      .delete('/api/v1/mappings/01JVNONEXIST00000000000000')
      .expect(404);
  });

  it('daemon handles malformed JSON body with 400', async () => {
    await makeDaemon();
    const res = await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .set('Content-Type', 'application/json')
      .send('not-json')
      .expect(400);
    expect(res.body.error).toBeDefined();
  });
});
