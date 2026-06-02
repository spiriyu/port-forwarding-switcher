import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryMappingStore } from './mapping-store';
import { CreateMappingRequest } from '@spiriyu/shared';

const BASE: CreateMappingRequest = {
  sourcePort: 8080,
  targetHost: '127.0.0.1',
  targetPort: 3000,
  groupId: 'GRP01',
};

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
      { op: 'create', mapping: { ...BASE } },
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
      { op: 'create', mapping: { ...BASE } }, // conflict
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
        groupId: 'GRP01',
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

describe('cross-group conflict rules', () => {
  let store: InMemoryMappingStore;

  beforeEach(() => {
    store = new InMemoryMappingStore();
  });

  it('allows two mappings with the same source port in different groups', () => {
    store.create({ sourcePort: 3000, targetHost: '127.0.0.1', targetPort: 8080, groupId: 'GRP01' });
    expect(() =>
      store.create({ sourcePort: 3000, targetHost: '127.0.0.1', targetPort: 9090, groupId: 'GRP02' }),
    ).not.toThrow();
  });

  it('rejects two mappings with the same source port in the same group', () => {
    store.create({ sourcePort: 3000, targetHost: '127.0.0.1', targetPort: 8080, groupId: 'GRP01' });
    expect(() =>
      store.create({ sourcePort: 3000, targetHost: '127.0.0.1', targetPort: 9090, groupId: 'GRP01' }),
    ).toThrow();
  });
});

describe('groupId on MappingResponse', () => {
  let store: InMemoryMappingStore;

  beforeEach(() => {
    store = new InMemoryMappingStore();
  });

  it('includes groupId in the response', () => {
    const m = store.create({ sourcePort: 3000, targetHost: '127.0.0.1', targetPort: 8080, groupId: 'GRP01' });
    expect(m.groupId).toBe('GRP01');
  });
});

describe('findActiveConflicts', () => {
  let store: InMemoryMappingStore;

  beforeEach(() => {
    store = new InMemoryMappingStore();
  });

  it('returns conflicting enabled mapping ids from other groups', () => {
    // Create enabled mapping in GRP01
    store.create({ sourcePort: 3000, targetHost: '127.0.0.1', targetPort: 8080, groupId: 'GRP01', enabled: true });

    // Create enabled mapping in GRP02 that conflicts on same source port
    store.create({ sourcePort: 3000, targetHost: '127.0.0.1', targetPort: 9090, groupId: 'GRP02', enabled: true });

    // findActiveConflicts for GRP02 should find the GRP01 mapping
    const conflicts = store.findActiveConflicts('GRP02');
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it('returns empty array when no conflicts', () => {
    store.create({ sourcePort: 3000, targetHost: '127.0.0.1', targetPort: 8080, groupId: 'GRP01', enabled: true });
    store.create({ sourcePort: 4000, targetHost: '127.0.0.1', targetPort: 9090, groupId: 'GRP02', enabled: true });

    const conflicts = store.findActiveConflicts('GRP02');
    expect(conflicts).toHaveLength(0);
  });

  it('ignores disabled mappings when checking conflicts', () => {
    // GRP01 has a disabled mapping on port 3000
    store.create({ sourcePort: 3000, targetHost: '127.0.0.1', targetPort: 8080, groupId: 'GRP01', enabled: false });
    // GRP02 has an enabled mapping on port 3000
    store.create({ sourcePort: 3000, targetHost: '127.0.0.1', targetPort: 9090, groupId: 'GRP02', enabled: true });

    // No conflict because GRP01 mapping is disabled
    const conflicts = store.findActiveConflicts('GRP02');
    expect(conflicts).toHaveLength(0);
  });

  it('ignores conflicts within the same group', () => {
    store.create({ sourcePort: 3000, targetHost: '127.0.0.1', targetPort: 8080, groupId: 'GRP01', enabled: true });
    store.create({ sourcePort: 4000, targetHost: '127.0.0.1', targetPort: 9090, groupId: 'GRP01', enabled: true });

    // No cross-group conflicts for GRP01 (no other groups)
    const conflicts = store.findActiveConflicts('GRP01');
    expect(conflicts).toHaveLength(0);
  });
});

describe('findConflictsIfEnabled', () => {
  let store: InMemoryMappingStore;

  beforeEach(() => {
    store = new InMemoryMappingStore();
  });

  it('returns conflicting mapping ids even when group members are not yet enabled', () => {
    // GRP01 mapping is NOT enabled yet
    store.create({ sourcePort: 3000, targetHost: '127.0.0.1', targetPort: 8080, groupId: 'GRP01', enabled: false });
    // GRP02 mapping IS enabled and conflicts
    store.create({ sourcePort: 3000, targetHost: '127.0.0.1', targetPort: 9090, groupId: 'GRP02', enabled: true });

    const conflicts = store.findConflictsIfEnabled('GRP01');
    expect(conflicts.length).toBe(1);
  });

  it('returns empty array when no conflicts exist', () => {
    store.create({ sourcePort: 3000, targetHost: '127.0.0.1', targetPort: 8080, groupId: 'GRP01', enabled: false });
    store.create({ sourcePort: 4000, targetHost: '127.0.0.1', targetPort: 9090, groupId: 'GRP02', enabled: true });

    const conflicts = store.findConflictsIfEnabled('GRP01');
    expect(conflicts).toHaveLength(0);
  });
});

describe('listByGroup', () => {
  let store: InMemoryMappingStore;

  beforeEach(() => {
    store = new InMemoryMappingStore();
  });

  it('returns only mappings belonging to the specified group', () => {
    store.create({ sourcePort: 3000, targetHost: '127.0.0.1', targetPort: 8080, groupId: 'GRP01' });
    store.create({ sourcePort: 4000, targetHost: '127.0.0.1', targetPort: 9090, groupId: 'GRP02' });

    const grp1Mappings = store.listByGroup('GRP01');
    expect(grp1Mappings).toHaveLength(1);
    expect(grp1Mappings[0]!.groupId).toBe('GRP01');
  });

  it('returns empty array for a group with no mappings', () => {
    store.create({ sourcePort: 3000, targetHost: '127.0.0.1', targetPort: 8080, groupId: 'GRP01' });

    const grp2Mappings = store.listByGroup('GRP02');
    expect(grp2Mappings).toHaveLength(0);
  });

  it('returns all mappings for a group with multiple mappings', () => {
    store.create({ sourcePort: 3000, targetHost: '127.0.0.1', targetPort: 8080, groupId: 'GRP01' });
    store.create({ sourcePort: 4000, targetHost: '127.0.0.1', targetPort: 9090, groupId: 'GRP01' });
    store.create({ sourcePort: 5000, targetHost: '127.0.0.1', targetPort: 7000, groupId: 'GRP02' });

    const grp1Mappings = store.listByGroup('GRP01');
    expect(grp1Mappings).toHaveLength(2);
    expect(grp1Mappings.every((m) => m.groupId === 'GRP01')).toBe(true);
  });
});
