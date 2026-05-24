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

async function makeTmpConfig(): Promise<string> {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'portswitch-srv-test-'));
  logPath = path.join(tmpDir, 'logs');
  return path.join(tmpDir, 'config.json');
}

// Waits for the first message (hello) before resolving, avoiding the race where
// hello arrives before the caller attaches a message listener.
function wsConnectAndHello(port: number): Promise<{ ws: WebSocket; hello: ServerMessage }> {
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

function nextMessage(ws: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS message timeout')), 3000);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()) as ServerMessage);
    });
  });
}

function waitForEvent(ws: WebSocket, type: string): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for WS event: ${type}`)), 3000);
    const handler = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

beforeEach(async () => {
  configPath = await makeTmpConfig();
  daemon = createDaemon({ port: 0, configPath, logPath });
  await daemon.start();
});

afterEach(async () => {
  await daemon.stop();
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
});

// ── Health ────────────────────────────────────────────────────────────────────

describe('GET /v1/health', () => {
  it('returns status ok with version and uptimeMs', async () => {
    const res = await request(daemon.httpServer).get('/api/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.version).toBe('string');
    expect(typeof res.body.uptimeMs).toBe('number');
  });
});

// ── Diagnostics ───────────────────────────────────────────────────────────────

describe('GET /v1/diagnostics', () => {
  it('returns daemon metadata', async () => {
    const res = await request(daemon.httpServer).get('/api/v1/diagnostics').expect(200);
    expect(res.body.pid).toBe(process.pid);
    expect(res.body.configFilePath).toBe(configPath);
    expect(typeof res.body.uptimeMs).toBe('number');
  });
});

// ── Mappings CRUD ─────────────────────────────────────────────────────────────

describe('GET /v1/mappings', () => {
  it('returns empty array initially', async () => {
    const res = await request(daemon.httpServer).get('/api/v1/mappings').expect(200);
    expect(res.body.mappings).toEqual([]);
  });
});

describe('POST /v1/mappings', () => {
  it('creates a mapping and returns 201', async () => {
    const res = await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort: 8080, targetHost: '127.0.0.1', targetPort: 3000, name: 'api' })
      .expect(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.name).toBe('api');
    expect(res.body.sourcePort).toBe(8080);
    expect(res.body.status).toBe('disabled');
  });

  it('returns 400 for missing required fields', async () => {
    await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ targetHost: '127.0.0.1' })
      .expect(400);
  });

  it('returns 409 for conflicting sourceHost:sourcePort', async () => {
    await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort: 8080, targetHost: '127.0.0.1', targetPort: 3000 })
      .expect(201);
    await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort: 8080, targetHost: '127.0.0.1', targetPort: 4000 })
      .expect(409);
  });

  it('returns 400 for invalid JSON', async () => {
    await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .set('Content-Type', 'application/json')
      .send('not json')
      .expect(400);
  });
});

describe('GET /v1/mappings/:id', () => {
  it('returns the mapping by id', async () => {
    const create = await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort: 8080, targetHost: '127.0.0.1', targetPort: 3000 })
      .expect(201);
    const res = await request(daemon.httpServer)
      .get(`/api/v1/mappings/${create.body.id}`)
      .expect(200);
    expect(res.body.id).toBe(create.body.id);
  });

  it('returns 404 for unknown id', async () => {
    await request(daemon.httpServer).get('/api/v1/mappings/nonexistent').expect(404);
  });
});

describe('PATCH /v1/mappings/:id', () => {
  it('updates fields and returns updated mapping', async () => {
    const created = await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort: 8080, targetHost: '127.0.0.1', targetPort: 3000 })
      .expect(201);
    const res = await request(daemon.httpServer)
      .patch(`/api/v1/mappings/${created.body.id}`)
      .send({ name: 'renamed', enabled: true })
      .expect(200);
    expect(res.body.name).toBe('renamed');
    expect(res.body.enabled).toBe(true);
    expect(res.body.status).toBe('listening');
  });

  it('returns 404 for unknown id', async () => {
    await request(daemon.httpServer).patch('/api/v1/mappings/bad').send({ name: 'x' }).expect(404);
  });
});

describe('DELETE /v1/mappings/:id', () => {
  it('deletes the mapping and returns 204', async () => {
    const created = await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort: 8080, targetHost: '127.0.0.1', targetPort: 3000 })
      .expect(201);
    await request(daemon.httpServer).delete(`/api/v1/mappings/${created.body.id}`).expect(204);
    await request(daemon.httpServer).get(`/api/v1/mappings/${created.body.id}`).expect(404);
  });

  it('returns 404 for unknown id', async () => {
    await request(daemon.httpServer).delete('/api/v1/mappings/bad').expect(404);
  });
});

describe('POST /v1/mappings/:id/toggle', () => {
  it('flips enabled state', async () => {
    const created = await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort: 8080, targetHost: '127.0.0.1', targetPort: 3000, enabled: false })
      .expect(201);
    const toggled = await request(daemon.httpServer)
      .post(`/api/v1/mappings/${created.body.id}/toggle`)
      .expect(200);
    expect(toggled.body.enabled).toBe(true);
    const toggled2 = await request(daemon.httpServer)
      .post(`/api/v1/mappings/${created.body.id}/toggle`)
      .expect(200);
    expect(toggled2.body.enabled).toBe(false);
  });
});

describe('POST /v1/mappings/bulk', () => {
  it('executes mixed operations and returns results', async () => {
    const res = await request(daemon.httpServer)
      .post('/api/v1/mappings/bulk')
      .send({
        operations: [
          { op: 'create', mapping: { sourcePort: 8080, targetHost: '127.0.0.1', targetPort: 3000 } },
          { op: 'create', mapping: { sourcePort: 9090, targetHost: '127.0.0.1', targetPort: 4000 } },
        ],
      })
      .expect(200);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[0].ok).toBe(true);
    expect(res.body.results[1].ok).toBe(true);
    const list = await request(daemon.httpServer).get('/api/v1/mappings').expect(200);
    expect(list.body.mappings).toHaveLength(2);
  });

  it('returns 400 for empty operations array', async () => {
    await request(daemon.httpServer)
      .post('/api/v1/mappings/bulk')
      .send({ operations: [] })
      .expect(400);
  });
});

describe('GET /v1/logs', () => {
  it('returns an array of log entries written since startup', async () => {
    // Wait for the async logger flush
    await new Promise((r) => setTimeout(r, 50));
    const res = await request(daemon.httpServer).get('/api/v1/logs').expect(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.entries.length).toBeGreaterThan(0);
    const entry = res.body.entries[0];
    expect(entry).toHaveProperty('ts');
    expect(entry).toHaveProperty('level');
    expect(entry).toHaveProperty('category');
    expect(entry).toHaveProperty('msg');
  });

  it('filters by mappingId', async () => {
    await new Promise((r) => setTimeout(r, 50));
    const res = await request(daemon.httpServer)
      .get('/api/v1/logs?mappingId=nonexistent')
      .expect(200);
    expect(res.body.entries).toEqual([]);
  });
});

// ── WebSocket events ──────────────────────────────────────────────────────────

describe('WebSocket /api/v1/events', () => {
  it('sends hello event with snapshot on connect', async () => {
    const { ws, hello } = await wsConnectAndHello(daemon.port);
    expect(hello.type).toBe('hello');
    if (hello.type === 'hello') {
      expect(Array.isArray(hello.payload.snapshot.mappings)).toBe(true);
    }
    ws.terminate();
  });

  it('responds to ping with pong', async () => {
    const { ws } = await wsConnectAndHello(daemon.port);
    ws.send(JSON.stringify({ type: 'ping' }));
    const pong = await nextMessage(ws);
    expect(pong.type).toBe('pong');
    ws.terminate();
  });

  it('broadcasts mapping.created when mapping is created', async () => {
    const { ws } = await wsConnectAndHello(daemon.port);

    const eventPromise = waitForEvent(ws, 'mapping.created');
    await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort: 8080, targetHost: '127.0.0.1', targetPort: 3000 })
      .expect(201);
    const event = await eventPromise;
    expect(event.type).toBe('mapping.created');
    if (event.type === 'mapping.created') {
      expect(event.payload.mapping.sourcePort).toBe(8080);
    }
    ws.terminate();
  });

  it('broadcasts mapping.updated on toggle', async () => {
    const created = await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort: 8080, targetHost: '127.0.0.1', targetPort: 3000 })
      .expect(201);

    const { ws } = await wsConnectAndHello(daemon.port);
    const eventPromise = waitForEvent(ws, 'mapping.updated');
    await request(daemon.httpServer)
      .post(`/api/v1/mappings/${created.body.id}/toggle`)
      .expect(200);
    const event = await eventPromise;
    expect(event.type).toBe('mapping.updated');
    ws.terminate();
  });

  it('broadcasts mapping.deleted on delete', async () => {
    const created = await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort: 8080, targetHost: '127.0.0.1', targetPort: 3000 })
      .expect(201);

    const { ws } = await wsConnectAndHello(daemon.port);
    const eventPromise = waitForEvent(ws, 'mapping.deleted');
    await request(daemon.httpServer)
      .delete(`/api/v1/mappings/${created.body.id}`)
      .expect(204);
    const event = await eventPromise;
    expect(event.type).toBe('mapping.deleted');
    if (event.type === 'mapping.deleted') {
      expect(event.payload.id).toBe(created.body.id);
    }
    ws.terminate();
  });
});

// ── Restart / persistence ─────────────────────────────────────────────────────

describe('config persistence', () => {
  it('restores mappings from config file after restart', async () => {
    const res = await request(daemon.httpServer)
      .post('/api/v1/mappings')
      .send({ sourcePort: 8080, targetHost: '127.0.0.1', targetPort: 3000, name: 'persist-me' })
      .expect(201);
    const id = res.body.id as string;

    // Wait for debounced persist to flush (50ms debounce + buffer)
    await new Promise((r) => setTimeout(r, 200));

    await daemon.stop();

    const daemon2 = createDaemon({ port: 0, configPath, logPath });
    await daemon2.start();

    try {
      const list = await request(daemon2.httpServer).get('/api/v1/mappings').expect(200);
      const found = list.body.mappings.find((m: { id: string }) => m.id === id);
      expect(found).toBeDefined();
      expect(found?.name).toBe('persist-me');
    } finally {
      await daemon2.stop();
    }
  });
});
