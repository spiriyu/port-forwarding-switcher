import { describe, it, expect } from 'vitest';
import { MappingConfigSchema, parseMappingConfig, parsePortswitchConfig } from './config.schema';
import {
  HealthResponseSchema,
  MappingStatsSchema,
  parseCreateMappingRequest,
  parsePatchMappingRequest,
  parseBulkRequest,
} from './api.schema';
import { LogEntrySchema, parseLogEntry } from './logging.schema';

// ── helpers ───────────────────────────────────────────────────────────────────

const validMapping = {
  id: '01HX4Z9ABCDE',
  name: 'api dev',
  sourceHost: '127.0.0.1',
  sourcePort: 8080,
  targetHost: '127.0.0.1',
  targetPort: 3000,
  enabled: true,
  drainTimeoutMs: 30000,
  createdAt: '2026-05-21T10:00:00.000Z',
  updatedAt: '2026-05-21T10:34:12.512Z',
};

const validConfig = {
  schemaVersion: 1,
  daemon: { port: 47600, logRetention: { maxFiles: 10, maxFileBytes: 5242880 } },
  mappings: [validMapping],
};

// ── MappingConfigSchema ───────────────────────────────────────────────────────

describe('MappingConfigSchema', () => {
  it('parses a valid mapping', () => {
    expect(() => parseMappingConfig(validMapping)).not.toThrow();
  });

  it('rejects port 0', () => {
    expect(() => parseMappingConfig({ ...validMapping, sourcePort: 0 })).toThrow();
  });

  it('rejects port 65536', () => {
    expect(() => parseMappingConfig({ ...validMapping, targetPort: 65536 })).toThrow();
  });

  it('rejects missing id', () => {
    const { id, ...rest } = validMapping;
    void id;
    expect(() => MappingConfigSchema.parse(rest)).toThrow();
  });

  it('rejects empty sourceHost', () => {
    expect(() => parseMappingConfig({ ...validMapping, sourceHost: '' })).toThrow();
  });

  it('rejects non-boolean enabled', () => {
    expect(() => parseMappingConfig({ ...validMapping, enabled: 'yes' })).toThrow();
  });

  it('rejects invalid datetime format', () => {
    expect(() => parseMappingConfig({ ...validMapping, createdAt: '2026-05-21' })).toThrow();
  });

  it('rejects negative drainTimeoutMs', () => {
    expect(() => parseMappingConfig({ ...validMapping, drainTimeoutMs: -1 })).toThrow();
  });
});

// ── PortswitchConfigSchema ────────────────────────────────────────────────────

describe('PortswitchConfigSchema', () => {
  it('parses a valid config', () => {
    expect(() => parsePortswitchConfig(validConfig)).not.toThrow();
  });

  it('parses config with empty mappings array', () => {
    const result = parsePortswitchConfig({ ...validConfig, mappings: [] });
    expect(result.mappings).toHaveLength(0);
  });

  it('rejects schemaVersion 0', () => {
    expect(() => parsePortswitchConfig({ ...validConfig, schemaVersion: 0 })).toThrow();
  });

  it('rejects invalid daemon port', () => {
    expect(() =>
      parsePortswitchConfig({ ...validConfig, daemon: { ...validConfig.daemon, port: 0 } }),
    ).toThrow();
  });

  it('rejects negative maxFiles', () => {
    expect(() =>
      parsePortswitchConfig({
        ...validConfig,
        daemon: { ...validConfig.daemon, logRetention: { maxFiles: -1, maxFileBytes: 1024 } },
      }),
    ).toThrow();
  });

  it('rejects invalid mapping inside mappings array', () => {
    expect(() =>
      parsePortswitchConfig({ ...validConfig, mappings: [{ ...validMapping, sourcePort: 0 }] }),
    ).toThrow();
  });
});

// ── CreateMappingRequestSchema ────────────────────────────────────────────────

describe('CreateMappingRequestSchema', () => {
  it('parses required fields only', () => {
    expect(() =>
      parseCreateMappingRequest({ sourcePort: 8080, targetHost: 'localhost', targetPort: 3000 }),
    ).not.toThrow();
  });

  it('parses all optional fields', () => {
    expect(() =>
      parseCreateMappingRequest({
        name: 'test',
        sourceHost: '127.0.0.1',
        sourcePort: 8080,
        targetHost: 'localhost',
        targetPort: 3000,
        enabled: false,
      }),
    ).not.toThrow();
  });

  it('rejects missing sourcePort', () => {
    expect(() =>
      parseCreateMappingRequest({ targetHost: 'localhost', targetPort: 3000 }),
    ).toThrow();
  });

  it('rejects missing targetHost', () => {
    expect(() => parseCreateMappingRequest({ sourcePort: 8080, targetPort: 3000 })).toThrow();
  });

  it('rejects empty targetHost', () => {
    expect(() =>
      parseCreateMappingRequest({ sourcePort: 8080, targetHost: '', targetPort: 3000 }),
    ).toThrow();
  });

  it('rejects out-of-range port', () => {
    expect(() =>
      parseCreateMappingRequest({ sourcePort: 99999, targetHost: 'localhost', targetPort: 3000 }),
    ).toThrow();
  });
});

// ── PatchMappingRequestSchema ─────────────────────────────────────────────────

describe('PatchMappingRequestSchema', () => {
  it('accepts empty patch object', () => {
    expect(() => parsePatchMappingRequest({})).not.toThrow();
  });

  it('accepts partial patch with only name', () => {
    expect(() => parsePatchMappingRequest({ name: 'renamed' })).not.toThrow();
  });

  it('accepts partial patch with only enabled', () => {
    expect(() => parsePatchMappingRequest({ enabled: false })).not.toThrow();
  });

  it('rejects invalid port in patch', () => {
    expect(() => parsePatchMappingRequest({ sourcePort: 0 })).toThrow();
  });
});

// ── BulkRequestSchema ─────────────────────────────────────────────────────────

describe('BulkRequestSchema', () => {
  it('parses a valid bulk create', () => {
    expect(() =>
      parseBulkRequest({
        operations: [
          { op: 'create', mapping: { sourcePort: 8080, targetHost: 'localhost', targetPort: 3000 } },
        ],
      }),
    ).not.toThrow();
  });

  it('parses mixed operations', () => {
    expect(() =>
      parseBulkRequest({
        operations: [
          { op: 'create', mapping: { sourcePort: 8080, targetHost: 'localhost', targetPort: 3000 } },
          { op: 'update', id: 'abc', patch: { enabled: false } },
          { op: 'delete', id: 'xyz' },
        ],
      }),
    ).not.toThrow();
  });

  it('rejects empty operations array', () => {
    expect(() => parseBulkRequest({ operations: [] })).toThrow();
  });

  it('rejects unknown op value', () => {
    expect(() =>
      parseBulkRequest({ operations: [{ op: 'replace', id: 'abc' }] }),
    ).toThrow();
  });
});

// ── MappingStatsSchema ────────────────────────────────────────────────────────

describe('MappingStatsSchema', () => {
  it('parses valid stats', () => {
    expect(() =>
      MappingStatsSchema.parse({ openConnections: 2, totalConnections: 10, bytesIn: 100, bytesOut: 200 }),
    ).not.toThrow();
  });

  it('rejects negative values', () => {
    expect(() =>
      MappingStatsSchema.parse({ openConnections: -1, totalConnections: 0, bytesIn: 0, bytesOut: 0 }),
    ).toThrow();
  });
});

// ── HealthResponseSchema ──────────────────────────────────────────────────────

describe('HealthResponseSchema', () => {
  it('parses valid health response', () => {
    expect(() =>
      HealthResponseSchema.parse({ status: 'ok', version: '1.0.0', uptimeMs: 12345 }),
    ).not.toThrow();
  });

  it('rejects wrong status value', () => {
    expect(() =>
      HealthResponseSchema.parse({ status: 'degraded', version: '1.0.0', uptimeMs: 0 }),
    ).toThrow();
  });
});

// ── LogEntrySchema ────────────────────────────────────────────────────────────

describe('LogEntrySchema', () => {
  it('parses minimal valid log entry', () => {
    expect(() =>
      parseLogEntry({ ts: '2026-05-21T10:00:00.000Z', level: 'info', category: 'daemon', msg: 'startup' }),
    ).not.toThrow();
  });

  it('parses log entry with all optional fields', () => {
    expect(() =>
      parseLogEntry({
        ts: '2026-05-21T10:00:00.000Z',
        level: 'error',
        category: 'mapping',
        mappingId: 'abc123',
        msg: 'bind failed',
        ctx: { port: 8080 },
        err: { code: 'EACCES', message: 'Permission denied' },
      }),
    ).not.toThrow();
  });

  it('rejects invalid log level', () => {
    expect(() =>
      LogEntrySchema.parse({ ts: '2026-05-21T10:00:00.000Z', level: 'verbose', category: 'daemon', msg: 'x' }),
    ).toThrow();
  });

  it('rejects invalid category', () => {
    expect(() =>
      LogEntrySchema.parse({ ts: '2026-05-21T10:00:00.000Z', level: 'info', category: 'network', msg: 'x' }),
    ).toThrow();
  });

  it('rejects non-UTC datetime', () => {
    expect(() =>
      LogEntrySchema.parse({ ts: '2026-05-21T10:00:00', level: 'info', category: 'daemon', msg: 'x' }),
    ).toThrow();
  });
});
