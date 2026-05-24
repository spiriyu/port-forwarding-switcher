import { describe, it, expect } from 'vitest';
import { runMigrations } from './index';
import { parsePortswitchConfig } from '../../schemas/config.schema';
import { DEFAULT_CONFIG } from '../defaults';

describe('runMigrations', () => {
  it('v1 config is migrated to v2 with Default group', () => {
    const input = { schemaVersion: 1, daemon: { port: 65432 }, mappings: [] };
    const result = runMigrations(input) as Record<string, unknown>;
    expect(result['schemaVersion']).toBe(2);
    expect((result['groups'] as Array<unknown>).length).toBeGreaterThan(0);
  });

  it('handles missing schemaVersion (treats as v0)', () => {
    const input = { daemon: { port: 65432 }, mappings: [] };
    const result = runMigrations(input);
    expect(result).toStrictEqual(input);
  });

  it('default config survives round-trip through runMigrations + parse', () => {
    const migrated = runMigrations(DEFAULT_CONFIG);
    const parsed = parsePortswitchConfig(migrated);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.mappings).toHaveLength(0);
    expect(parsed.daemon.port).toBe(65432);
  });
});

describe('runMigrations v1 → v2', () => {
  it('creates a Default group and assigns groupId to all mappings', () => {
    const v1Config = {
      schemaVersion: 1,
      daemon: { port: 65432, logRetention: { maxFiles: 10, maxFileBytes: 5242880 } },
      mappings: [
        {
          id: 'MAP01',
          name: 'test',
          sourceHost: '127.0.0.1',
          sourcePort: 3000,
          targetHost: '127.0.0.1',
          targetPort: 8080,
          enabled: false,
          drainTimeoutMs: 30000,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
    };

    const result = runMigrations(v1Config) as Record<string, unknown>;

    expect(result['schemaVersion']).toBe(2);

    const groups = result['groups'] as Array<Record<string, unknown>>;
    expect(groups).toHaveLength(1);
    expect(groups[0]!['name']).toBe('Default');
    const groupId = groups[0]!['id'] as string;
    expect(typeof groupId).toBe('string');
    expect(groupId.length).toBeGreaterThan(0);

    const mappings = result['mappings'] as Array<Record<string, unknown>>;
    expect(mappings).toHaveLength(1);
    expect(mappings[0]!['groupId']).toBe(groupId);
  });

  it('handles an empty mappings array gracefully', () => {
    const v1Config = {
      schemaVersion: 1,
      daemon: { port: 65432, logRetention: { maxFiles: 10, maxFileBytes: 5242880 } },
      mappings: [],
    };

    const result = runMigrations(v1Config) as Record<string, unknown>;

    expect(result['schemaVersion']).toBe(2);
    const groups = result['groups'] as Array<unknown>;
    expect(groups).toHaveLength(1);
    const mappings = result['mappings'] as Array<unknown>;
    expect(mappings).toHaveLength(0);
  });

  it('is idempotent — v2 config passes through unchanged', () => {
    const v2Config = {
      schemaVersion: 2,
      daemon: { port: 65432, logRetention: { maxFiles: 10, maxFileBytes: 5242880 } },
      groups: [{ id: 'GRP01', name: 'Existing', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' }],
      mappings: [],
    };

    const result = runMigrations(v2Config) as Record<string, unknown>;
    expect(result['schemaVersion']).toBe(2);
    const groups = result['groups'] as Array<unknown>;
    expect(groups).toHaveLength(1);
  });
});
