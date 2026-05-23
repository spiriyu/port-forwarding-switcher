import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DaemonClient, DaemonUnreachableError, DaemonApiError } from './client';
import { resolveId } from './resolve';
import { formatMappingsTable, formatLogEntry, toJson } from './output';
import { parseAddress, createProgram } from './main';
import { ErrorCode, type MappingResponse, type LogEntry } from '@portswitch/shared';

// ── parseAddress ─────────────────────────────────────────────────────────────

describe('parseAddress', () => {
  it('parses bare port', () => {
    expect(parseAddress('8080')).toEqual({ host: '127.0.0.1', port: 8080 });
  });

  it('parses host:port', () => {
    expect(parseAddress('0.0.0.0:3000')).toEqual({ host: '0.0.0.0', port: 3000 });
  });

  it('parses IPv6-style address (last colon wins)', () => {
    expect(parseAddress('localhost:9000')).toEqual({ host: 'localhost', port: 9000 });
  });
});

// ── resolveId ────────────────────────────────────────────────────────────────

const mockMapping: MappingResponse = {
  id: '01ARYZ6S41TPTWG1FKVSRFN1Q0',
  name: 'my-api',
  sourceHost: '127.0.0.1',
  sourcePort: 8080,
  targetHost: 'localhost',
  targetPort: 3000,
  enabled: true,
  status: 'listening',
  stats: { openConnections: 0, totalConnections: 0, bytesIn: 0, bytesOut: 0 },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('resolveId', () => {
  const mockClient = {
    listMappings: vi.fn().mockResolvedValue({ mappings: [mockMapping] }),
  } as unknown as DaemonClient;

  it('returns ULID-shaped id unchanged without fetching', async () => {
    const spy = vi.spyOn(mockClient, 'listMappings');
    const id = await resolveId(mockClient, '01ARYZ6S41TPTWG1FKVSRFN1Q0');
    expect(id).toBe('01ARYZ6S41TPTWG1FKVSRFN1Q0');
    expect(spy).not.toHaveBeenCalled();
  });

  it('resolves by exact name', async () => {
    const id = await resolveId(mockClient, 'my-api');
    expect(id).toBe(mockMapping.id);
  });

  it('resolves by partial name', async () => {
    const id = await resolveId(mockClient, 'api');
    expect(id).toBe(mockMapping.id);
  });

  it('throws when name not found', async () => {
    await expect(resolveId(mockClient, 'no-such-thing')).rejects.toThrow('No mapping found');
  });
});

// ── DaemonClient ─────────────────────────────────────────────────────────────

describe('DaemonClient', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws DaemonUnreachableError on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const client = new DaemonClient('http://127.0.0.1:65432/api');
    await expect(client.listMappings()).rejects.toBeInstanceOf(DaemonUnreachableError);
  });

  it('throws DaemonApiError on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ error: { code: ErrorCode.NOT_FOUND, message: 'not found' } }),
    });
    const client = new DaemonClient('http://127.0.0.1:65432/api');
    const err = await client.getMapping('bad-id').catch((e) => e as DaemonApiError);
    expect(err).toBeInstanceOf(DaemonApiError);
    expect(err.body.code).toBe(ErrorCode.NOT_FOUND);
    expect(err.statusCode).toBe(404);
  });

  it('returns parsed JSON on success', async () => {
    const payload = { mappings: [mockMapping] };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => payload,
    });
    const client = new DaemonClient('http://127.0.0.1:65432/api');
    const result = await client.listMappings();
    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0]?.id).toBe(mockMapping.id);
  });

  it('handles 204 No Content', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204, json: vi.fn() });
    const client = new DaemonClient('http://127.0.0.1:65432/api');
    await expect(client.deleteMapping('some-id')).resolves.toBeUndefined();
  });

  it('builds wsUrl pointing to /api/v1/events', () => {
    const client = new DaemonClient('http://127.0.0.1:65432/api');
    expect(client.wsUrl).toBe('ws://127.0.0.1:65432/api/v1/events');
  });

  it('appends query params to logs URL', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ entries: [] }) });
    const client = new DaemonClient('http://127.0.0.1:65432/api');
    await client.logs({ limit: 50, mappingId: 'abc' });
    const calledUrl = mockFetch.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('limit=50');
    expect(calledUrl).toContain('mappingId=abc');
  });
});

// ── Output formatting ────────────────────────────────────────────────────────

describe('formatMappingsTable', () => {
  it('shows "No mappings" for empty list', () => {
    expect(formatMappingsTable([])).toContain('No mappings');
  });

  it('includes id, name, source, target, status columns', () => {
    const output = formatMappingsTable([mockMapping]);
    expect(output).toContain('01ARYZ6S41TPTWG1FKVSRFN1Q0');
    expect(output).toContain('my-api');
    expect(output).toContain('8080');
    expect(output).toContain('3000');
    expect(output).toContain('listening');
  });
});

describe('formatLogEntry', () => {
  const entry: LogEntry = {
    ts: '2026-05-22T10:30:00.123Z',
    level: 'info',
    category: 'daemon',
    msg: 'Daemon started',
  };

  it('includes time, level, category and message', () => {
    const out = formatLogEntry(entry);
    expect(out).toContain('10:30:00.123');
    expect(out).toContain('info');
    expect(out).toContain('[daemon]');
    expect(out).toContain('Daemon started');
  });

  it('includes error details when present', () => {
    const withErr: LogEntry = {
      ...entry,
      err: { code: 'ENOENT', message: 'file not found' },
    };
    const out = formatLogEntry(withErr);
    expect(out).toContain('ENOENT');
    expect(out).toContain('file not found');
  });
});

describe('toJson', () => {
  it('outputs indented JSON', () => {
    const out = toJson({ a: 1 });
    expect(out).toBe('{\n  "a": 1\n}');
  });
});

// ── createProgram ────────────────────────────────────────────────────────────

describe('createProgram', () => {
  it('creates a Command with name portswitch', () => {
    const program = createProgram();
    expect(program.name()).toBe('portswitch');
  });

  it('registers expected commands', () => {
    const program = createProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain('list');
    expect(names).toContain('add');
    expect(names).toContain('enable');
    expect(names).toContain('disable');
    expect(names).toContain('toggle');
    expect(names).toContain('remove');
    expect(names).toContain('edit');
    expect(names).toContain('watch');
    expect(names).toContain('logs');
    expect(names).toContain('doctor');
    expect(names).toContain('completion');
  });

  it('has --url and --json global options', () => {
    const program = createProgram();
    const opts = program.options.map((o) => o.long);
    expect(opts).toContain('--url');
    expect(opts).toContain('--json');
  });
});
