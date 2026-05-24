import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryGroupStore } from './group-store';

function makeGroup(overrides: Partial<{ id: string; name: string }> = {}) {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? 'GRP01',
    name: overrides.name ?? 'Dev',
    createdAt: now,
    updatedAt: now,
  };
}

describe('InMemoryGroupStore', () => {
  let store: InMemoryGroupStore;

  beforeEach(() => {
    store = new InMemoryGroupStore();
  });

  it('starts empty', () => {
    expect(store.list()).toHaveLength(0);
  });

  it('hydrates from configs', () => {
    store.hydrate([makeGroup({ id: 'GRP01', name: 'Dev' }), makeGroup({ id: 'GRP02', name: 'Staging' })]);
    expect(store.list()).toHaveLength(2);
  });

  it('creates a group', () => {
    const group = store.create({ name: 'Prod' });
    expect(group.name).toBe('Prod');
    expect(group.id).toBeTruthy();
    expect(group.mappingCount).toBe(0);
    expect(group.activeCount).toBe(0);
  });

  it('rejects duplicate group names (case-insensitive)', () => {
    store.create({ name: 'Dev' });
    expect(() => store.create({ name: 'dev' })).toThrow();
  });

  it('gets a group by id', () => {
    store.hydrate([makeGroup({ id: 'GRP01', name: 'Dev' })]);
    const g = store.get('GRP01');
    expect(g?.name).toBe('Dev');
  });

  it('returns undefined for unknown id', () => {
    expect(store.get('NOTEXIST')).toBeUndefined();
  });

  it('updates a group name', () => {
    store.hydrate([makeGroup({ id: 'GRP01', name: 'Dev' })]);
    const updated = store.update('GRP01', { name: 'Development' });
    expect(updated.name).toBe('Development');
  });

  it('throws NOT_FOUND when updating unknown group', () => {
    expect(() => store.update('NOPE', { name: 'X' })).toThrow();
  });

  it('rejects renaming to an existing group name (case-insensitive)', () => {
    store.hydrate([
      makeGroup({ id: 'GRP01', name: 'Dev' }),
      makeGroup({ id: 'GRP02', name: 'Staging' }),
    ]);
    expect(() => store.update('GRP01', { name: 'staging' })).toThrow();
  });

  it('deletes a group', () => {
    store.hydrate([makeGroup({ id: 'GRP01', name: 'Dev' })]);
    store.delete('GRP01');
    expect(store.list()).toHaveLength(0);
  });

  it('throws NOT_FOUND when deleting unknown group', () => {
    expect(() => store.delete('NOPE')).toThrow();
  });

  it('updateCounts reflects mapping stats', () => {
    store.hydrate([makeGroup({ id: 'GRP01', name: 'Dev' })]);
    store.updateCounts('GRP01', { mappingCount: 3, activeCount: 2 });
    const g = store.get('GRP01');
    expect(g?.mappingCount).toBe(3);
    expect(g?.activeCount).toBe(2);
  });

  it('toConfigs round-trips through hydrate', () => {
    store.hydrate([makeGroup({ id: 'GRP01', name: 'Dev' })]);
    const configs = store.toConfigs();
    const store2 = new InMemoryGroupStore();
    store2.hydrate(configs);
    expect(store2.list()).toHaveLength(1);
    expect(store2.get('GRP01')?.name).toBe('Dev');
  });

  describe('generateDuplicateName', () => {
    it('returns <name>_dup_1 when no dups exist', () => {
      store.create({ name: 'Dev' });
      expect(store.generateDuplicateName('Dev')).toBe('Dev_dup_1');
    });

    it('returns <name>_dup_2 when _dup_1 exists', () => {
      store.create({ name: 'Dev' });
      store.create({ name: 'Dev_dup_1' });
      expect(store.generateDuplicateName('Dev')).toBe('Dev_dup_2');
    });

    it('returns max+1 (not gap-fill) when only _dup_2 exists', () => {
      store.create({ name: 'Dev' });
      store.create({ name: 'Dev_dup_2' });
      expect(store.generateDuplicateName('Dev')).toBe('Dev_dup_3');
    });

    it('works on a source name that has no existing groups', () => {
      expect(store.generateDuplicateName('Prod')).toBe('Prod_dup_1');
    });
  });
});
