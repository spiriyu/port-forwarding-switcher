import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import WebSocket from 'ws';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createDaemon, DaemonHandle } from './server';
import { ServerMessage } from '@portswitch/shared';

let daemon: DaemonHandle;
let tmpDir: string;
let configPath: string;
let logPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ps-logs-test-'));
  configPath = path.join(tmpDir, 'config.json');
  logPath = path.join(tmpDir, 'logs');
  daemon = createDaemon({ port: 0, configPath, logPath });
  await daemon.start();
});

afterEach(async () => {
  await daemon.stop();
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
});

function wsConnect(port: number): Promise<{ ws: WebSocket; hello: ServerMessage }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/events`);
    const timer = setTimeout(() => reject(new Error('WS hello timeout')), 3000);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve({ ws, hello: JSON.parse(data.toString()) as ServerMessage });
    });
    ws.once('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

function waitForMessage(ws: WebSocket, predicate: (m: ServerMessage) => boolean, timeoutMs = 3000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS message timeout')), timeoutMs);
    const handler = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

describe('GET /v1/logs', () => {
  it('returns log entries written since daemon startup', async () => {
    await new Promise((r) => setTimeout(r, 50));
    const res = await request(daemon.httpServer).get('/api/v1/logs').expect(200);

    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.entries.length).toBeGreaterThan(0);

    const startup = res.body.entries.find(
      (e: { msg: string }) => e.msg === 'startup',
    );
    expect(startup).toBeDefined();
    expect(startup.category).toBe('daemon');
  });

  it('respects the limit parameter', async () => {
    await new Promise((r) => setTimeout(r, 50));
    const res = await request(daemon.httpServer)
      .get('/api/v1/logs?limit=1')
      .expect(200);
    expect(res.body.entries.length).toBeLessThanOrEqual(1);
  });

  it('filters by mappingId', async () => {
    await new Promise((r) => setTimeout(r, 50));
    const res = await request(daemon.httpServer)
      .get('/api/v1/logs?mappingId=nonexistent-id')
      .expect(200);
    expect(res.body.entries).toEqual([]);
  });

  it('filters by from timestamp', async () => {
    const future = new Date(Date.now() + 60000).toISOString();
    const res = await request(daemon.httpServer)
      .get(`/api/v1/logs?from=${future}`)
      .expect(200);
    expect(res.body.entries).toEqual([]);
  });
});

describe('WebSocket log streaming', () => {
  it('receives log entries after subscribing', async () => {
    const { ws } = await wsConnect(daemon.port);

    // Subscribe to all daemon-category logs
    ws.send(JSON.stringify({ type: 'log.subscribe', payload: { categories: ['daemon'] } }));

    // Trigger a log entry by making an API call that causes daemon activity
    // The daemon logs 'shutdown' on stop — but we can't stop during the test.
    // Instead, write a mapping (triggers config:saved log).
    // Actually, we need a daemon-category entry. Let's subscribe to mapping-category
    // and create a mapping with enabled:true so we get listenerBound.
    ws.send(JSON.stringify({ type: 'log.subscribe', payload: { categories: ['mapping'] } }));

    const logPromise = waitForMessage(ws, (m) => m.type === 'log');

    await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort: 47600, targetHost: '127.0.0.1', targetPort: 3000, enabled: true });

    const logMsg = await logPromise;
    expect(logMsg.type).toBe('log');
    if (logMsg.type === 'log') {
      expect(logMsg.payload.entry.category).toBe('mapping');
      expect(logMsg.payload.entry.msg).toMatch(/listener/);
    }

    ws.terminate();
  });

  it('stops receiving log entries after unsubscribing', async () => {
    const { ws } = await wsConnect(daemon.port);

    ws.send(JSON.stringify({ type: 'log.subscribe', payload: {} }));
    ws.send(JSON.stringify({ type: 'log.unsubscribe' }));

    // After unsubscribe, no log entries should arrive
    const messages: ServerMessage[] = [];
    ws.on('message', (data) => {
      const m = JSON.parse(data.toString()) as ServerMessage;
      if (m.type === 'log') messages.push(m);
    });

    await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort: 47601, targetHost: '127.0.0.1', targetPort: 3000, enabled: true });

    await new Promise((r) => setTimeout(r, 100));
    expect(messages).toHaveLength(0);

    ws.terminate();
  });

  it('filters log entries by level', async () => {
    const { ws } = await wsConnect(daemon.port);

    // Subscribe to error-level only
    ws.send(JSON.stringify({ type: 'log.subscribe', payload: { levels: ['error'] } }));

    const received: ServerMessage[] = [];
    ws.on('message', (data) => {
      const m = JSON.parse(data.toString()) as ServerMessage;
      if (m.type === 'log') received.push(m);
    });

    // Make a request that produces info-level logs (not error)
    await request(daemon.httpServer).get('/api/v1/health');
    await new Promise((r) => setTimeout(r, 100));

    // No error-level entries should have arrived (health check produces info/debug)
    expect(received.filter((m) => m.type === 'log')).toHaveLength(0);

    ws.terminate();
  });
});
