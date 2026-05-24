import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'net';
import { createForwarder, ForwarderHandle } from './forwarder';

// Helper: start a simple echo server on a random port
function startEchoServer(): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      sock.pipe(sock);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      resolve({ server, port });
    });
  });
}

// Helper: open a TCP connection and send data, collect response
function tcpRoundTrip(
  port: number,
  data: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ host: '127.0.0.1', port });
    let received = '';
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error('tcpRoundTrip timeout'));
    }, 3000);
    client.once('connect', () => { client.write(data); });
    client.on('data', (chunk: Buffer) => {
      received += chunk.toString();
      if (received.length >= data.length) {
        clearTimeout(timer);
        client.destroy();
        resolve(received);
      }
    });
    client.once('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

// Helper: open a raw connection and keep it open until returned close() is called
function openConnection(port: number): Promise<{ close: () => void }> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ host: '127.0.0.1', port });
    const timer = setTimeout(() => { client.destroy(); reject(new Error('connect timeout')); }, 2000);
    client.once('connect', () => { clearTimeout(timer); resolve({ close: () => client.destroy() }); });
    client.once('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

const handles: ForwarderHandle[] = [];
const echoServers: net.Server[] = [];

afterEach(async () => {
  for (const h of handles.splice(0)) {
    await h.stop().catch(() => undefined);
  }
  await Promise.all(
    echoServers.splice(0).map(
      (s) => new Promise<void>((r) => s.close(() => r())),
    ),
  );
});

describe('createForwarder', () => {
  it('forwards data to target and back (echo)', async () => {
    const { server: echo, port: echoPort } = await startEchoServer();
    echoServers.push(echo);

    const fwd = createForwarder({
      sourcePort: 0,
      targetHost: '127.0.0.1',
      targetPort: echoPort,
    });
    handles.push(fwd);
    await fwd.start();

    const reply = await tcpRoundTrip(fwd.boundPort, 'hello');
    expect(reply).toBe('hello');
  });

  it('tracks stats across a connection', async () => {
    const { server: echo, port: echoPort } = await startEchoServer();
    echoServers.push(echo);

    const fwd = createForwarder({
      sourcePort: 0,
      targetHost: '127.0.0.1',
      targetPort: echoPort,
    });
    handles.push(fwd);
    await fwd.start();

    expect(fwd.stats().totalConnections).toBe(0);
    await tcpRoundTrip(fwd.boundPort, 'ping');

    const s = fwd.stats();
    expect(s.totalConnections).toBe(1);
    expect(s.bytesIn).toBeGreaterThan(0);
    expect(s.bytesOut).toBeGreaterThan(0);
  });

  it('tracks openConnections correctly with concurrent connections', async () => {
    const { server: echo, port: echoPort } = await startEchoServer();
    echoServers.push(echo);

    const fwd = createForwarder({
      sourcePort: 0,
      targetHost: '127.0.0.1',
      targetPort: echoPort,
    });
    handles.push(fwd);
    await fwd.start();

    const c1 = await openConnection(fwd.boundPort);
    const c2 = await openConnection(fwd.boundPort);

    // Give sockets time to be registered
    await new Promise((r) => setTimeout(r, 50));
    expect(fwd.stats().openConnections).toBe(2);
    expect(fwd.stats().totalConnections).toBe(2);

    c1.close();
    c2.close();

    // Wait for cleanup
    await new Promise((r) => setTimeout(r, 100));
    expect(fwd.stats().openConnections).toBe(0);
    expect(fwd.stats().totalConnections).toBe(2);
  });

  it('stop() drains gracefully (closes after active connections finish)', async () => {
    const { server: echo, port: echoPort } = await startEchoServer();
    echoServers.push(echo);

    const fwd = createForwarder({
      sourcePort: 0,
      targetHost: '127.0.0.1',
      targetPort: echoPort,
      drainTimeoutMs: 2000,
    });
    handles.push(fwd);
    await fwd.start();

    const conn = await openConnection(fwd.boundPort);

    // Close connection after a short delay, then drain should resolve
    setTimeout(() => conn.close(), 100);

    const stopStart = Date.now();
    await fwd.stop();
    const elapsed = Date.now() - stopStart;

    // Should have waited for drain but not for the full 2s timeout
    expect(elapsed).toBeGreaterThan(50);
    expect(elapsed).toBeLessThan(1500);
  });

  it('stop() force-closes connections that exceed drainTimeoutMs', async () => {
    const { server: echo, port: echoPort } = await startEchoServer();
    echoServers.push(echo);

    const fwd = createForwarder({
      sourcePort: 0,
      targetHost: '127.0.0.1',
      targetPort: echoPort,
      drainTimeoutMs: 100,
    });
    handles.push(fwd);
    await fwd.start();

    await openConnection(fwd.boundPort);
    // Don't close the connection — forwarder must force-close after 100ms

    const t0 = Date.now();
    await fwd.stop();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(90);
    expect(fwd.stats().openConnections).toBe(0);
  });

  it('throws on EADDRINUSE when source port is already bound', async () => {
    // Bind a server on a specific port first
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    const blockedPort = (blocker.address() as net.AddressInfo).port;

    const fwd = createForwarder({
      sourcePort: blockedPort,
      targetHost: '127.0.0.1',
      targetPort: 9999,
    });
    handles.push(fwd);

    await expect(fwd.start()).rejects.toMatchObject({ code: 'EADDRINUSE' });

    await new Promise<void>((r) => blocker.close(() => r()));
  });

  it('emits connection events via events emitter', async () => {
    const { server: echo, port: echoPort } = await startEchoServer();
    echoServers.push(echo);

    const fwd = createForwarder({
      sourcePort: 0,
      targetHost: '127.0.0.1',
      targetPort: echoPort,
    });
    handles.push(fwd);
    await fwd.start();

    const events: Array<{ type: string }> = [];
    fwd.events.on('event', (e: { type: string }) => events.push(e));

    await tcpRoundTrip(fwd.boundPort, 'test');
    await new Promise((r) => setTimeout(r, 50));

    const types = events.map((e) => e.type);
    expect(types).toContain('connection');
    expect(types).toContain('connection.closed');
  });
});
