import { describe, it, expect } from 'vitest';
import { runMigrations } from './index';
import { parsePortswitchConfig } from '../../schemas/config.schema';
import { DEFAULT_CONFIG } from '../defaults';

describe('runMigrations', () => {
  it('returns input unchanged when no migrations are registered', () => {
    const input = { schemaVersion: 1, daemon: { port: 65432 }, mappings: [] };
    expect(runMigrations(input)).toStrictEqual(input);
  });

  it('handles missing schemaVersion (treats as v0)', () => {
    const input = { daemon: { port: 65432 }, mappings: [] };
    const result = runMigrations(input);
    expect(result).toStrictEqual(input);
  });

  it('default config survives round-trip through runMigrations + parse', () => {
    const migrated = runMigrations(DEFAULT_CONFIG);
    const parsed = parsePortswitchConfig(migrated);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.mappings).toHaveLength(0);
    expect(parsed.daemon.port).toBe(65432);
  });
});
