import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDaemon, DaemonHandle } from './server';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

let daemon: DaemonHandle;

function url(p: string) { return `http://127.0.0.1:${daemon.port}${p}`; }

async function req<T>(method: string, p: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(url(p), {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const b = res.status === 204 ? undefined : await res.json();
  return { status: res.status, body: b as T };
}

beforeEach(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portswitch-grp-'));
  daemon = createDaemon({ port: 0, configPath: path.join(tmp, 'config.json'), logPath: path.join(tmp, 'logs') });
  await daemon.start();
});

afterEach(async () => { await daemon.stop(); });

describe('GET /api/v1/groups', () => {
  it('returns empty array on fresh start', async () => {
    const r = await req<{ groups: unknown[] }>('GET', '/api/v1/groups');
    expect(r.status).toBe(200);
    expect(r.body.groups).toHaveLength(0);
  });
});

describe('POST /api/v1/groups', () => {
  it('creates a group', async () => {
    const r = await req<{ id: string; name: string }>('POST', '/api/v1/groups', { name: 'Dev' });
    expect(r.status).toBe(201);
    expect(r.body.name).toBe('Dev');
    expect(r.body.id).toBeTruthy();
  });

  it('rejects missing name', async () => {
    const r = await req<{ error: unknown }>('POST', '/api/v1/groups', {});
    expect(r.status).toBe(400);
  });

  it('rejects duplicate group name', async () => {
    await req('POST', '/api/v1/groups', { name: 'Dev' });
    const r = await req<{ error: unknown }>('POST', '/api/v1/groups', { name: 'Dev' });
    expect(r.status).toBe(409);
  });
});

describe('PATCH /api/v1/groups/:id', () => {
  it('renames a group', async () => {
    const created = await req<{ id: string }>('POST', '/api/v1/groups', { name: 'Dev' });
    const r = await req<{ name: string }>('PATCH', `/api/v1/groups/${created.body.id}`, { name: 'Development' });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('Development');
  });

  it('returns 404 for unknown id', async () => {
    const r = await req('PATCH', '/api/v1/groups/NOPE', { name: 'X' });
    expect(r.status).toBe(404);
  });
});

describe('DELETE /api/v1/groups/:id', () => {
  it('deletes a group and its mappings', async () => {
    const g = await req<{ id: string }>('POST', '/api/v1/groups', { name: 'Dev' });
    const groupId = g.body.id;
    await req('POST', '/api/v1/mappings', { sourcePort: 19700, targetHost: '127.0.0.1', targetPort: 19701, groupId });
    const del = await req('DELETE', `/api/v1/groups/${groupId}`);
    expect(del.status).toBe(204);
    const list = await req<{ groups: unknown[] }>('GET', '/api/v1/groups');
    expect(list.body.groups).toHaveLength(0);
    const mappings = await req<{ mappings: unknown[] }>('GET', '/api/v1/mappings');
    expect(mappings.body.mappings).toHaveLength(0);
  });
});

describe('POST /api/v1/groups/:id/enable', () => {
  it('enables all mappings in the group', async () => {
    const g = await req<{ id: string }>('POST', '/api/v1/groups', { name: 'Dev' });
    const groupId = g.body.id;
    await req('POST', '/api/v1/mappings', { sourcePort: 19800, targetHost: '127.0.0.1', targetPort: 19801, groupId });
    const r = await req<{ group: { activeCount: number } }>('POST', `/api/v1/groups/${groupId}/enable`);
    expect(r.status).toBe(200);
  });

  it('rejects enable when a port conflicts with another active group', async () => {
    const g1 = await req<{ id: string }>('POST', '/api/v1/groups', { name: 'Dev' });
    const g2 = await req<{ id: string }>('POST', '/api/v1/groups', { name: 'Staging' });
    const port = 19876;
    await req('POST', '/api/v1/mappings', { sourcePort: port, targetHost: '127.0.0.1', targetPort: port + 100, groupId: g1.body.id });
    await req('POST', '/api/v1/mappings', { sourcePort: port, targetHost: '127.0.0.1', targetPort: port + 200, groupId: g2.body.id });
    await req('POST', `/api/v1/groups/${g1.body.id}/enable`);
    const r = await req('POST', `/api/v1/groups/${g2.body.id}/enable`);
    expect(r.status).toBe(409);
  });
});

describe('POST /api/v1/groups/:id/disable', () => {
  it('disables all mappings in the group', async () => {
    const g = await req<{ id: string }>('POST', '/api/v1/groups', { name: 'Dev' });
    const groupId = g.body.id;
    const r = await req<{ group: { activeCount: number }; mappings: Array<{ enabled: boolean }> }>('POST', `/api/v1/groups/${groupId}/disable`);
    expect(r.status).toBe(200);
    expect(r.body.mappings.every((m) => !m.enabled)).toBe(true);
  });
});

describe('POST /api/v1/groups/:id/duplicate', () => {
  it('creates a new group with _dup_1 suffix', async () => {
    const g = await req<{ id: string; name: string }>('POST', '/api/v1/groups', { name: 'Dev' });
    const r = await req<{ group: { name: string }; mappings: unknown[] }>('POST', `/api/v1/groups/${g.body.id}/duplicate`);
    expect(r.status).toBe(201);
    expect(r.body.group.name).toBe('Dev_dup_1');
  });

  it('copies all mappings into the new group with enabled: false', async () => {
    const g = await req<{ id: string }>('POST', '/api/v1/groups', { name: 'Dev' });
    await req('POST', '/api/v1/mappings', { sourcePort: 19900, targetHost: '127.0.0.1', targetPort: 19901, groupId: g.body.id });
    await req('POST', '/api/v1/mappings', { sourcePort: 19902, targetHost: '127.0.0.1', targetPort: 19903, groupId: g.body.id });
    const r = await req<{ group: { id: string; mappingCount: number }; mappings: Array<{ enabled: boolean; groupId: string }> }>('POST', `/api/v1/groups/${g.body.id}/duplicate`);
    expect(r.status).toBe(201);
    expect(r.body.mappings).toHaveLength(2);
    expect(r.body.mappings.every((m) => !m.enabled)).toBe(true);
    expect(r.body.mappings.every((m) => m.groupId === r.body.group.id)).toBe(true);
    expect(r.body.group.mappingCount).toBe(2);
  });

  it('second duplicate gets _dup_2', async () => {
    const g = await req<{ id: string }>('POST', '/api/v1/groups', { name: 'Dev' });
    await req('POST', `/api/v1/groups/${g.body.id}/duplicate`);
    const r2 = await req<{ group: { name: string } }>('POST', `/api/v1/groups/${g.body.id}/duplicate`);
    expect(r2.status).toBe(201);
    expect(r2.body.group.name).toBe('Dev_dup_2');
  });

  it('duplicates an empty group (no mappings)', async () => {
    const g = await req<{ id: string }>('POST', '/api/v1/groups', { name: 'Empty' });
    const r = await req<{ group: { name: string }; mappings: unknown[] }>('POST', `/api/v1/groups/${g.body.id}/duplicate`);
    expect(r.status).toBe(201);
    expect(r.body.group.name).toBe('Empty_dup_1');
    expect(r.body.mappings).toHaveLength(0);
  });

  it('returns 404 for unknown group id', async () => {
    const r = await req('POST', '/api/v1/groups/NOPE/duplicate');
    expect(r.status).toBe(404);
  });
});
