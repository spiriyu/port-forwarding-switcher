import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryMappingStore } from './mapping-store';

const BASE = { sourcePort: 8080, targetHost: '127.0.0.1', targetPort: 3000 };

describe('InMemoryMappingStore', () => {
  let store: InMemoryMappingStore;

  beforeEach(() => {
    store = new InMemoryMappingStore();
  });

  it('starts empty', () => {
    expect(store.list()).toHaveLength(0);
  });

  it('creates a mapping with defaults', () => {
    const m = store.create(BASE);
    expect(m.id).toBeTruthy();
    expect(m.name).toBe('');
    expect(m.sourceHost).toBe('127.0.0.1');
    expect(m.enabled).toBe(false);
    expect(m.status).toBe('disabled');
    expect(m.stats.openConnections).toBe(0);
  });

  it('enabled:true still starts with status disabled (forwarder controls status)', () => {
    const m = store.create({ ...BASE, enabled: true });
    expect(m.status).toBe('disabled');
  });

  it('get returns the mapping', () => {
    const created = store.create(BASE);
    expect(store.get(created.id)).toMatchObject({ id: created.id });
  });

  it('get returns undefined for unknown id', () => {
    expect(store.get('nonexistent')).toBeUndefined();
  });

  it('list returns all mappings', () => {
    store.create(BASE);
    store.create({ ...BASE, sourcePort: 9090 });
    expect(store.list()).toHaveLength(2);
  });

  it('update patches individual fields', () => {
    const m = store.create(BASE);
    const updated = store.update(m.id, { name: 'renamed', enabled: true });
    expect(updated.name).toBe('renamed');
    expect(updated.enabled).toBe(true);
    expect(updated.status).toBe('disabled'); // forwarder sets listening
    expect(updated.sourcePort).toBe(8080);
  });

  it('update throws NOT_FOUND for unknown id', () => {
    expect(() => store.update('missing', { name: 'x' })).toThrow('not found');
  });

  it('delete removes the mapping', () => {
    const m = store.create(BASE);
    store.delete(m.id);
    expect(store.get(m.id)).toBeUndefined();
  });

  it('delete throws NOT_FOUND for unknown id', () => {
    expect(() => store.delete('missing')).toThrow('not found');
  });

  it('toggle flips enabled', () => {
    const m = store.create({ ...BASE, enabled: false });
    const toggled = store.toggle(m.id);
    expect(toggled.enabled).toBe(true);
    const toggled2 = store.toggle(m.id);
    expect(toggled2.enabled).toBe(false);
  });

  it('create rejects conflicting sourceHost:sourcePort', () => {
    store.create(BASE);
    expect(() => store.create(BASE)).toThrow();
  });

  it('update rejects conflicting sourcePort change', () => {
    store.create(BASE);
    const m2 = store.create({ ...BASE, sourcePort: 9090 });
    expect(() => store.update(m2.id, { sourcePort: 8080 })).toThrow();
  });

  it('update allows same port on same mapping (no self-conflict)', () => {
    const m = store.create(BASE);
    expect(() => store.update(m.id, { sourcePort: 8080 })).not.toThrow();
  });

  it('bulk executes mixed operations', () => {
    const results = store.bulk([
      { op: 'create', mapping: BASE },
      { op: 'create', mapping: { ...BASE, sourcePort: 9090 } },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.ok).toBe(true);
    expect(store.list()).toHaveLength(2);
  });

  it('bulk records error for failed operations without aborting others', () => {
    store.create(BASE);
    const results = store.bulk([
      { op: 'create', mapping: BASE }, // conflict
      { op: 'create', mapping: { ...BASE, sourcePort: 9090 } }, // ok
    ]);
    expect(results[0]?.ok).toBe(false);
    expect(results[1]?.ok).toBe(true);
    expect(store.list()).toHaveLength(2);
  });

  it('hydrate restores state from configs', () => {
    const now = new Date().toISOString();
    store.hydrate([
      {
        id: 'abc',
        name: 'restored',
        sourceHost: '127.0.0.1',
        sourcePort: 8080,
        targetHost: '127.0.0.1',
        targetPort: 3000,
        enabled: true,
        drainTimeoutMs: 30000,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    expect(store.list()).toHaveLength(1);
    expect(store.get('abc')?.name).toBe('restored');
    expect(store.get('abc')?.status).toBe('disabled'); // forwarder sets listening on start
  });

  it('toConfigs round-trips through hydrate', () => {
    store.create({ ...BASE, name: 'test' });
    const configs = store.toConfigs();
    const store2 = new InMemoryMappingStore();
    store2.hydrate(configs);
    expect(store2.list()).toHaveLength(1);
    expect(store2.list()[0]?.name).toBe('test');
  });
});
