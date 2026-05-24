# Groups Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add named groups to portswitch so that port mappings must belong to a group, and toggling a group on/off enables/disables all its member mappings atomically with conflict detection.

**Architecture:** Groups are a first-class entity stored alongside mappings in the JSON config (schemaVersion bumps to 2). A new `InMemoryGroupStore` handles CRUD and conflict detection. Group enable is all-or-nothing: if any mapping in the group conflicts on source port with an already-enabled mapping in another group, the entire enable is rejected. Multiple groups can be active simultaneously as long as they don't share a source port.

**Tech Stack:** TypeScript strict, Zod v3, Express, Vitest, React (inline styles), ulid for IDs.

---

## File Map

**libs/shared — modify:**
- `src/types/config.ts` — add `GroupConfig`, add `groupId` to `MappingConfig`
- `src/types/api.ts` — add `GroupResponse`, `CreateGroupRequest`, `PatchGroupRequest`, `ListGroupsResponse`; add `groupId` to `CreateMappingRequest`
- `src/types/events.ts` — add group WS events, add groups to `HelloPayload` snapshot
- `src/schemas/config.schema.ts` — add `GroupConfigSchema`, update `MappingConfigSchema` + `PortswitchConfigSchema`
- `src/schemas/api.schema.ts` — add `CreateGroupRequestSchema`, `PatchGroupRequestSchema`, update `CreateMappingRequestSchema`
- `src/schemas/index.ts` — re-export new schemas
- `src/config/defaults.ts` — bump `CURRENT_SCHEMA_VERSION` to `2`, add `groups: []` to `DEFAULT_CONFIG`
- `src/config/migrations/index.ts` — add v1→v2 migration (auto-creates "Default" group, sets `groupId` on all mappings)

**apps/cli — create:**
- `src/serve/store/group-store.ts` — `InMemoryGroupStore` with CRUD + active-count helpers

**apps/cli — modify:**
- `src/serve/store/mapping-store.ts` — require `groupId` on create, scope conflict checks to same-group
- `src/serve/routes/groups.ts` — CRUD + enable + disable routes at `/api/v1/groups`
- `src/serve/ws/event-bus.ts` — `addClient` accepts groups snapshot; broadcast group events
- `src/serve/server.ts` — add `groupStore` to `DaemonContext`, wire group routes, update `flushConfig` + startup
- `src/client.ts` — add group API methods
- `src/main.ts` — add `group` subcommand (`list`, `add`, `enable`, `disable`, `remove`)

**apps/web — create:**
- `src/components/GroupSection.tsx` — collapsible group card with enable/disable and per-mapping rows

**apps/web — modify:**
- `src/apiClient.ts` — add group API methods, add groups to WS snapshot type
- `src/components/AddMappingDialog.tsx` — add required `groupId` prop + hidden field
- `src/components/MappingList.tsx` — render `GroupSection` components instead of flat rows; add "Add Group" button
- `src/App.tsx` — add `groups` state, group CRUD + enable/disable handlers, handle group WS events

---

## Task 1: Shared types — GroupConfig, updated MappingConfig, GroupResponse

**Files:**
- Modify: `libs/shared/src/types/config.ts`
- Modify: `libs/shared/src/types/api.ts`
- Modify: `libs/shared/src/types/events.ts`

- [ ] **Step 1: Update `libs/shared/src/types/config.ts`**

Replace the entire file:

```ts
export interface LogRetentionConfig {
  maxFiles: number;
  maxFileBytes: number;
}

export interface DaemonConfig {
  port: number;
  logRetention: LogRetentionConfig;
}

export interface GroupConfig {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface MappingConfig {
  id: string;
  name: string;
  sourceHost: string;
  sourcePort: number;
  targetHost: string;
  targetPort: number;
  enabled: boolean;
  drainTimeoutMs: number;
  groupId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PortswitchConfig {
  schemaVersion: number;
  daemon: DaemonConfig;
  groups: GroupConfig[];
  mappings: MappingConfig[];
}
```

- [ ] **Step 2: Update `libs/shared/src/types/api.ts`**

Replace the entire file:

```ts
import { ApiErrorBody } from './errors';

export type MappingStatus = 'listening' | 'disabled' | 'error';

export interface MappingStats {
  openConnections: number;
  totalConnections: number;
  bytesIn: number;
  bytesOut: number;
}

export interface MappingResponse {
  id: string;
  name: string;
  sourceHost: string;
  sourcePort: number;
  targetHost: string;
  targetPort: number;
  enabled: boolean;
  groupId: string;
  status: MappingStatus;
  stats: MappingStats;
  error?: ApiErrorBody;
  createdAt: string;
  updatedAt: string;
}

export interface ListMappingsResponse {
  mappings: MappingResponse[];
}

export interface GroupResponse {
  id: string;
  name: string;
  mappingCount: number;
  activeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListGroupsResponse {
  groups: GroupResponse[];
}

export interface HealthResponse {
  status: 'ok';
  version: string;
  uptimeMs: number;
}

export interface DiagnosticsResponse {
  daemonVersion: string;
  pid: number;
  platform: string;
  uptimeMs: number;
  configFilePath: string;
  logFilePath: string;
  listeningMappings: number;
}

export interface CreateMappingRequest {
  name?: string;
  sourceHost?: string;
  sourcePort: number;
  targetHost: string;
  targetPort: number;
  enabled?: boolean;
  groupId: string;
}

export interface PatchMappingRequest {
  name?: string;
  sourceHost?: string;
  sourcePort?: number;
  targetHost?: string;
  targetPort?: number;
  enabled?: boolean;
}

export interface CreateGroupRequest {
  name: string;
}

export interface PatchGroupRequest {
  name?: string;
}

export interface BulkCreateOp {
  op: 'create';
  mapping: CreateMappingRequest;
}

export interface BulkUpdateOp {
  op: 'update';
  id: string;
  patch: PatchMappingRequest;
}

export interface BulkDeleteOp {
  op: 'delete';
  id: string;
}

export type BulkOperation = BulkCreateOp | BulkUpdateOp | BulkDeleteOp;

export interface BulkResultItem {
  ok: boolean;
  mapping?: MappingResponse;
  error?: ApiErrorBody;
}

export interface BulkRequest {
  operations: BulkOperation[];
}

export interface BulkResponse {
  results: BulkResultItem[];
}

export interface LogsQueryParams {
  from?: string;
  limit?: number;
  mappingId?: string;
}
```

- [ ] **Step 3: Update `libs/shared/src/types/events.ts`**

Replace the entire file:

```ts
import { ApiErrorBody } from './errors';
import { LogEntry, LogLevel, LogCategory } from './logging';
import { MappingResponse, MappingStats, MappingStatus, GroupResponse } from './api';

// ── Server → Client ──────────────────────────────────────────────────────────

export interface HelloPayload {
  serverVersion: string;
  snapshot: { mappings: MappingResponse[]; groups: GroupResponse[] };
}

export interface LogSubscribePayload {
  mappingIds?: string[];
  levels?: LogLevel[];
  categories?: LogCategory[];
}

export type ServerMessage =
  | { type: 'hello'; payload: HelloPayload }
  | { type: 'mapping.created'; payload: { mapping: MappingResponse } }
  | { type: 'mapping.updated'; payload: { mapping: MappingResponse; previousEnabled: boolean } }
  | { type: 'mapping.deleted'; payload: { id: string } }
  | { type: 'mapping.status'; payload: { id: string; status: MappingStatus; error?: ApiErrorBody } }
  | { type: 'mapping.stats'; payload: { id: string; stats: MappingStats } }
  | { type: 'group.created'; payload: { group: GroupResponse } }
  | { type: 'group.updated'; payload: { group: GroupResponse } }
  | { type: 'group.deleted'; payload: { id: string } }
  | { type: 'group.toggled'; payload: { group: GroupResponse; mappings: MappingResponse[] } }
  | { type: 'log'; payload: { entry: LogEntry } }
  | { type: 'log.dropped'; payload: { count: number } }
  | { type: 'daemon.shutdown'; payload: { reason: string } }
  | { type: 'pong' };

// ── Client → Server ──────────────────────────────────────────────────────────

export type ClientMessage =
  | { type: 'log.subscribe'; payload: LogSubscribePayload }
  | { type: 'log.unsubscribe' }
  | { type: 'ping' };
```

- [ ] **Step 4: Run typecheck to verify types compile**

```bash
npx nx run shared:typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add libs/shared/src/types/config.ts libs/shared/src/types/api.ts libs/shared/src/types/events.ts
git commit -m "feat(shared): add GroupConfig, GroupResponse, groupId on MappingConfig and group WS events"
```

---

## Task 2: Schemas — GroupConfigSchema, updated MappingConfigSchema + API schemas

**Files:**
- Modify: `libs/shared/src/schemas/config.schema.ts`
- Modify: `libs/shared/src/schemas/api.schema.ts`
- Modify: `libs/shared/src/schemas/index.ts`
- Test: `libs/shared/src/schemas/schemas.test.ts`

- [ ] **Step 1: Write failing tests for the new schemas**

Open `libs/shared/src/schemas/schemas.test.ts` and add after the existing tests:

```ts
describe('GroupConfigSchema', () => {
  it('accepts a valid group config', () => {
    expect(() =>
      GroupConfigSchema.parse({
        id: '01HXYZ',
        name: 'Dev',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    ).not.toThrow();
  });

  it('rejects a group with empty name', () => {
    expect(() =>
      GroupConfigSchema.parse({
        id: '01HXYZ',
        name: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    ).toThrow();
  });
});

describe('MappingConfigSchema (with groupId)', () => {
  it('accepts a mapping with groupId', () => {
    expect(() =>
      MappingConfigSchema.parse({
        id: '01HABC',
        name: 'test',
        sourceHost: '127.0.0.1',
        sourcePort: 3000,
        targetHost: '127.0.0.1',
        targetPort: 8080,
        enabled: false,
        drainTimeoutMs: 30000,
        groupId: '01HXYZ',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    ).not.toThrow();
  });

  it('rejects a mapping without groupId', () => {
    expect(() =>
      MappingConfigSchema.parse({
        id: '01HABC',
        name: 'test',
        sourceHost: '127.0.0.1',
        sourcePort: 3000,
        targetHost: '127.0.0.1',
        targetPort: 8080,
        enabled: false,
        drainTimeoutMs: 30000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    ).toThrow();
  });
});

describe('PortswitchConfigSchema (with groups)', () => {
  it('accepts a config with a groups array', () => {
    expect(() =>
      PortswitchConfigSchema.parse({
        schemaVersion: 2,
        daemon: {
          port: 65432,
          logRetention: { maxFiles: 10, maxFileBytes: 5 * 1024 * 1024 },
        },
        groups: [],
        mappings: [],
      })
    ).not.toThrow();
  });
});

describe('CreateGroupRequestSchema', () => {
  it('accepts a valid create group request', () => {
    expect(() => CreateGroupRequestSchema.parse({ name: 'Staging' })).not.toThrow();
  });

  it('rejects empty name', () => {
    expect(() => CreateGroupRequestSchema.parse({ name: '' })).toThrow();
  });
});

describe('CreateMappingRequest (with groupId)', () => {
  it('accepts a mapping create request with groupId', () => {
    expect(() =>
      CreateMappingRequestSchema.parse({
        sourcePort: 3000,
        targetHost: '127.0.0.1',
        targetPort: 8080,
        groupId: '01HXYZ',
      })
    ).not.toThrow();
  });

  it('rejects a mapping create request without groupId', () => {
    expect(() =>
      CreateMappingRequestSchema.parse({
        sourcePort: 3000,
        targetHost: '127.0.0.1',
        targetPort: 8080,
      })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx nx test shared -- -t "GroupConfigSchema"
```

Expected: FAIL (GroupConfigSchema not exported).

- [ ] **Step 3: Update `libs/shared/src/schemas/config.schema.ts`**

Replace the entire file:

```ts
import { z } from 'zod';
import { MappingConfig, DaemonConfig, LogRetentionConfig, PortswitchConfig, GroupConfig } from '../types/config';

const portNumber = z.number().int().min(1).max(65535);
const isoDatetime = z.string().datetime();

export const LogRetentionConfigSchema: z.ZodType<LogRetentionConfig> = z.object({
  maxFiles: z.number().int().min(0),
  maxFileBytes: z.number().int().min(0),
});

export const DaemonConfigSchema: z.ZodType<DaemonConfig> = z.object({
  port: portNumber,
  logRetention: LogRetentionConfigSchema,
});

export const GroupConfigSchema: z.ZodType<GroupConfig> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const MappingConfigSchema: z.ZodType<MappingConfig> = z.object({
  id: z.string().min(1),
  name: z.string(),
  sourceHost: z.string().min(1),
  sourcePort: portNumber,
  targetHost: z.string().min(1),
  targetPort: portNumber,
  enabled: z.boolean(),
  drainTimeoutMs: z.number().int().min(0),
  groupId: z.string().min(1),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const PortswitchConfigSchema: z.ZodType<PortswitchConfig> = z.object({
  schemaVersion: z.number().int().min(1),
  daemon: DaemonConfigSchema,
  groups: z.array(GroupConfigSchema),
  mappings: z.array(MappingConfigSchema),
});

export function parseMappingConfig(data: unknown): MappingConfig {
  return MappingConfigSchema.parse(data);
}

export function parsePortswitchConfig(data: unknown): PortswitchConfig {
  return PortswitchConfigSchema.parse(data);
}
```

- [ ] **Step 4: Update `libs/shared/src/schemas/api.schema.ts`**

Replace the entire file:

```ts
import { z } from 'zod';
import {
  CreateMappingRequest,
  PatchMappingRequest,
  BulkOperation,
  BulkRequest,
  HealthResponse,
  MappingStats,
  MappingStatus,
  CreateGroupRequest,
  PatchGroupRequest,
} from '../types/api';
import { ErrorCode } from '../types/errors';
import { LogLevel, LogCategory } from '../types/logging';
import { LogSubscribePayload } from '../types/events';

const portNumber = z.number().int().min(1).max(65535);

export const MappingStatusSchema: z.ZodType<MappingStatus> = z.enum([
  'listening',
  'disabled',
  'error',
]);

export const MappingStatsSchema: z.ZodType<MappingStats> = z.object({
  openConnections: z.number().int().min(0),
  totalConnections: z.number().int().min(0),
  bytesIn: z.number().int().min(0),
  bytesOut: z.number().int().min(0),
});

export const CreateGroupRequestSchema: z.ZodType<CreateGroupRequest> = z.object({
  name: z.string().min(1),
});

export const PatchGroupRequestSchema: z.ZodType<PatchGroupRequest> = z.object({
  name: z.string().min(1).optional(),
});

export const CreateMappingRequestSchema: z.ZodType<CreateMappingRequest> = z.object({
  name: z.string().optional(),
  sourceHost: z.string().min(1).optional(),
  sourcePort: portNumber,
  targetHost: z.string().min(1),
  targetPort: portNumber,
  enabled: z.boolean().optional(),
  groupId: z.string().min(1),
});

export const PatchMappingRequestSchema: z.ZodType<PatchMappingRequest> = z.object({
  name: z.string().optional(),
  sourceHost: z.string().min(1).optional(),
  sourcePort: portNumber.optional(),
  targetHost: z.string().min(1).optional(),
  targetPort: portNumber.optional(),
  enabled: z.boolean().optional(),
});

const BulkCreateOpSchema = z.object({
  op: z.literal('create'),
  mapping: CreateMappingRequestSchema,
});

const BulkUpdateOpSchema = z.object({
  op: z.literal('update'),
  id: z.string().min(1),
  patch: PatchMappingRequestSchema,
});

const BulkDeleteOpSchema = z.object({
  op: z.literal('delete'),
  id: z.string().min(1),
});

export const BulkOperationSchema: z.ZodType<BulkOperation> = z.discriminatedUnion('op', [
  BulkCreateOpSchema,
  BulkUpdateOpSchema,
  BulkDeleteOpSchema,
]);

export const BulkRequestSchema: z.ZodType<BulkRequest> = z.object({
  operations: z.array(BulkOperationSchema).min(1),
});

export const HealthResponseSchema: z.ZodType<HealthResponse> = z.object({
  status: z.literal('ok'),
  version: z.string().min(1),
  uptimeMs: z.number().int().min(0),
});

export const ErrorCodeSchema = z.nativeEnum(ErrorCode);

export const LogLevelSchema: z.ZodType<LogLevel> = z.enum(['debug', 'info', 'warn', 'error']);

export const LogCategorySchema: z.ZodType<LogCategory> = z.enum([
  'daemon',
  'api',
  'mapping',
  'service',
  'config',
]);

export const LogSubscribePayloadSchema: z.ZodType<LogSubscribePayload> = z.object({
  mappingIds: z.array(z.string().min(1)).optional(),
  levels: z.array(LogLevelSchema).optional(),
  categories: z.array(LogCategorySchema).optional(),
});

export function parseCreateMappingRequest(data: unknown): CreateMappingRequest {
  return CreateMappingRequestSchema.parse(data);
}

export function parsePatchMappingRequest(data: unknown): PatchMappingRequest {
  return PatchMappingRequestSchema.parse(data);
}

export function parseBulkRequest(data: unknown): BulkRequest {
  return BulkRequestSchema.parse(data);
}
```

- [ ] **Step 5: Update `libs/shared/src/schemas/index.ts`** to export new schemas

Open `libs/shared/src/schemas/index.ts` and add exports:

```ts
export * from './config.schema';
export * from './api.schema';
```

(If it doesn't already re-export everything — check the file and ensure `GroupConfigSchema`, `CreateGroupRequestSchema`, `PatchGroupRequestSchema` are reachable from `@portswitch/shared`.)

- [ ] **Step 6: Run the tests to confirm they pass**

```bash
npx nx test shared -- -t "GroupConfigSchema|MappingConfigSchema|PortswitchConfigSchema|CreateGroupRequest|CreateMappingRequest"
```

Expected: all new tests PASS.

- [ ] **Step 7: Run full shared test suite**

```bash
npx nx test shared
```

Expected: all tests pass (existing tests may fail on missing `groupId` — fix those by adding `groupId: '01TEST'` to any existing `MappingConfigSchema` test fixtures).

- [ ] **Step 8: Commit**

```bash
git add libs/shared/src/schemas/
git commit -m "feat(shared): add GroupConfigSchema, CreateGroupRequestSchema, groupId to MappingConfigSchema and CreateMappingRequestSchema"
```

---

## Task 3: Defaults + migration v1→v2

**Files:**
- Modify: `libs/shared/src/config/defaults.ts`
- Modify: `libs/shared/src/config/migrations/index.ts`
- Test: `libs/shared/src/config/migrations/migrations.test.ts`

- [ ] **Step 1: Write failing migration tests**

Open `libs/shared/src/config/migrations/migrations.test.ts` and add:

```ts
import { describe, it, expect } from 'vitest';
import { runMigrations } from './index';

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
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npx nx test shared -- -t "runMigrations v1"
```

Expected: FAIL.

- [ ] **Step 3: Update `libs/shared/src/config/migrations/index.ts`**

Replace the entire file:

```ts
import { ulid } from 'ulid';

type RawConfig = Record<string, unknown>;
type Migration = { from: number; migrate: (c: RawConfig) => RawConfig };

const migrations: Migration[] = [
  {
    from: 1,
    migrate: (c: RawConfig): RawConfig => {
      const now = new Date().toISOString();
      const defaultGroupId = ulid();
      const defaultGroup = { id: defaultGroupId, name: 'Default', createdAt: now, updatedAt: now };
      const mappings = Array.isArray(c['mappings']) ? (c['mappings'] as RawConfig[]) : [];
      return {
        ...c,
        schemaVersion: 2,
        groups: [defaultGroup],
        mappings: mappings.map((m) => ({ ...m, groupId: defaultGroupId })),
      };
    },
  },
];

export function runMigrations(rawConfig: unknown): unknown {
  let current = rawConfig as RawConfig;
  const startVersion = typeof current?.['schemaVersion'] === 'number' ? current['schemaVersion'] : 0;
  let version = startVersion;

  for (const migration of migrations) {
    if (migration.from === version) {
      current = migration.migrate(current);
      version += 1;
    }
  }

  return current;
}
```

- [ ] **Step 4: Update `libs/shared/src/config/defaults.ts`**

Replace the entire file:

```ts
import { PortswitchConfig } from '../types/config';

export const DEFAULT_DAEMON_PORT = 65432;
export const CURRENT_SCHEMA_VERSION = 2;

export const DEFAULT_CONFIG: PortswitchConfig = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  daemon: {
    port: DEFAULT_DAEMON_PORT,
    logRetention: {
      maxFiles: 10,
      maxFileBytes: 5 * 1024 * 1024,
    },
  },
  groups: [],
  mappings: [],
};
```

- [ ] **Step 5: Run migration tests**

```bash
npx nx test shared -- -t "runMigrations"
```

Expected: all PASS.

- [ ] **Step 6: Run full shared suite**

```bash
npx nx test shared
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add libs/shared/src/config/
git commit -m "feat(shared): add v1→v2 migration (Default group), bump CURRENT_SCHEMA_VERSION to 2"
```

---

## Task 4: InMemoryGroupStore

**Files:**
- Create: `apps/cli/src/serve/store/group-store.ts`
- Create: `apps/cli/src/serve/store/group-store.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/cli/src/serve/store/group-store.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npx nx test cli -- -t "InMemoryGroupStore"
```

Expected: FAIL (module not found).

- [ ] **Step 3: Create `apps/cli/src/serve/store/group-store.ts`**

```ts
import { ulid } from 'ulid';
import { GroupConfig, GroupResponse, CreateGroupRequest, PatchGroupRequest } from '@portswitch/shared';
import { ApiError, ErrorCode } from '@portswitch/shared';

interface GroupRecord {
  id: string;
  name: string;
  mappingCount: number;
  activeCount: number;
  createdAt: string;
  updatedAt: string;
}

function toResponse(r: GroupRecord): GroupResponse {
  return {
    id: r.id,
    name: r.name,
    mappingCount: r.mappingCount,
    activeCount: r.activeCount,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export class InMemoryGroupStore {
  private records = new Map<string, GroupRecord>();

  hydrate(configs: GroupConfig[]): void {
    this.records.clear();
    for (const c of configs) {
      this.records.set(c.id, { ...c, mappingCount: 0, activeCount: 0 });
    }
  }

  toConfigs(): GroupConfig[] {
    return Array.from(this.records.values()).map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  list(): GroupResponse[] {
    return Array.from(this.records.values()).map(toResponse);
  }

  get(id: string): GroupResponse | undefined {
    const r = this.records.get(id);
    return r ? toResponse(r) : undefined;
  }

  create(input: CreateGroupRequest): GroupResponse {
    const nameLower = input.name.toLowerCase();
    for (const r of this.records.values()) {
      if (r.name.toLowerCase() === nameLower) {
        throw new ApiError(ErrorCode.CONFLICT, `A group named "${input.name}" already exists.`);
      }
    }
    const now = new Date().toISOString();
    const record: GroupRecord = {
      id: ulid(),
      name: input.name,
      mappingCount: 0,
      activeCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.id, record);
    return toResponse(record);
  }

  update(id: string, patch: PatchGroupRequest): GroupResponse {
    const record = this.records.get(id);
    if (!record) throw new ApiError(ErrorCode.NOT_FOUND, `Group ${id} not found.`);
    const updated: GroupRecord = {
      ...record,
      ...(patch.name !== undefined && { name: patch.name }),
      updatedAt: new Date().toISOString(),
    };
    this.records.set(id, updated);
    return toResponse(updated);
  }

  delete(id: string): void {
    if (!this.records.has(id)) throw new ApiError(ErrorCode.NOT_FOUND, `Group ${id} not found.`);
    this.records.delete(id);
  }

  updateCounts(id: string, counts: { mappingCount: number; activeCount: number }): void {
    const r = this.records.get(id);
    if (!r) return;
    this.records.set(id, { ...r, ...counts });
  }
}
```

- [ ] **Step 4: Run group store tests**

```bash
npx nx test cli -- -t "InMemoryGroupStore"
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/serve/store/group-store.ts apps/cli/src/serve/store/group-store.test.ts
git commit -m "feat(cli): add InMemoryGroupStore with CRUD and updateCounts"
```

---

## Task 5: Update InMemoryMappingStore — groupId-aware conflict checks

**Files:**
- Modify: `apps/cli/src/serve/store/mapping-store.ts`
- Modify: `apps/cli/src/serve/store/mapping-store.test.ts`

- [ ] **Step 1: Update existing mapping store tests to include groupId**

Open `apps/cli/src/serve/store/mapping-store.test.ts`. Every `CreateMappingRequest` fixture needs a `groupId: 'GRP01'`. Add or replace the helper that builds create requests:

```ts
// Helper at the top of the test file (add/replace existing helper):
function makeCreateReq(overrides: Partial<{
  sourcePort: number;
  targetPort: number;
  name: string;
  enabled: boolean;
  groupId: string;
}> = {}): CreateMappingRequest {
  return {
    sourcePort: overrides.sourcePort ?? 3000,
    targetHost: '127.0.0.1',
    targetPort: overrides.targetPort ?? 8080,
    name: overrides.name ?? 'test',
    enabled: overrides.enabled ?? false,
    groupId: overrides.groupId ?? 'GRP01',
  };
}
```

Also add these new tests covering cross-group same-port behavior:

```ts
describe('cross-group conflict rules', () => {
  it('allows two mappings with the same source port in different groups', () => {
    store.create({ sourcePort: 3000, targetHost: '127.0.0.1', targetPort: 8080, groupId: 'GRP01' });
    expect(() =>
      store.create({ sourcePort: 3000, targetHost: '127.0.0.1', targetPort: 9090, groupId: 'GRP02' })
    ).not.toThrow();
  });

  it('rejects two mappings with the same source port in the same group', () => {
    store.create({ sourcePort: 3000, targetHost: '127.0.0.1', targetPort: 8080, groupId: 'GRP01' });
    expect(() =>
      store.create({ sourcePort: 3000, targetHost: '127.0.0.1', targetPort: 9090, groupId: 'GRP01' })
    ).toThrow();
  });
});

describe('groupId on MappingResponse', () => {
  it('includes groupId in the response', () => {
    const m = store.create({ sourcePort: 3000, targetHost: '127.0.0.1', targetPort: 8080, groupId: 'GRP01' });
    expect(m.groupId).toBe('GRP01');
  });
});
```

- [ ] **Step 2: Run to confirm new tests fail**

```bash
npx nx test cli -- -t "cross-group conflict|groupId on MappingResponse"
```

Expected: FAIL.

- [ ] **Step 3: Update `apps/cli/src/serve/store/mapping-store.ts`**

Replace the entire file:

```ts
import { ulid } from 'ulid';
import {
  MappingResponse,
  MappingConfig,
  MappingStats,
  MappingStatus,
  CreateMappingRequest,
  PatchMappingRequest,
  BulkOperation,
  BulkResultItem,
  ApiError,
  ApiErrorBody,
  ErrorCode,
} from '@portswitch/shared';

interface MappingRecord {
  id: string;
  name: string;
  sourceHost: string;
  sourcePort: number;
  targetHost: string;
  targetPort: number;
  enabled: boolean;
  drainTimeoutMs: number;
  groupId: string;
  stats: MappingStats;
  status: MappingStatus;
  error?: ApiErrorBody;
  createdAt: string;
  updatedAt: string;
}

const EMPTY_STATS: MappingStats = {
  openConnections: 0,
  totalConnections: 0,
  bytesIn: 0,
  bytesOut: 0,
};

function toResponse(record: MappingRecord): MappingResponse {
  return {
    id: record.id,
    name: record.name,
    sourceHost: record.sourceHost,
    sourcePort: record.sourcePort,
    targetHost: record.targetHost,
    targetPort: record.targetPort,
    enabled: record.enabled,
    groupId: record.groupId,
    status: record.status,
    stats: record.stats,
    ...(record.error && { error: record.error }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export class InMemoryMappingStore {
  private records = new Map<string, MappingRecord>();

  hydrate(configs: MappingConfig[]): void {
    this.records.clear();
    for (const c of configs) {
      this.records.set(c.id, {
        ...c,
        stats: { ...EMPTY_STATS },
        status: 'disabled',
      });
    }
  }

  toConfigs(): MappingConfig[] {
    return Array.from(this.records.values()).map((r) => ({
      id: r.id,
      name: r.name,
      sourceHost: r.sourceHost,
      sourcePort: r.sourcePort,
      targetHost: r.targetHost,
      targetPort: r.targetPort,
      enabled: r.enabled,
      drainTimeoutMs: r.drainTimeoutMs,
      groupId: r.groupId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  list(): MappingResponse[] {
    return Array.from(this.records.values()).map(toResponse);
  }

  listByGroup(groupId: string): MappingResponse[] {
    return Array.from(this.records.values())
      .filter((r) => r.groupId === groupId)
      .map(toResponse);
  }

  get(id: string): MappingResponse | undefined {
    const r = this.records.get(id);
    return r ? toResponse(r) : undefined;
  }

  create(input: CreateMappingRequest): MappingResponse {
    const sourceHost = input.sourceHost ?? '127.0.0.1';
    const sourcePort = input.sourcePort;

    if (this.hasConflict(sourceHost, sourcePort, input.groupId)) {
      throw new ApiError(
        ErrorCode.CONFLICT,
        `Source ${sourceHost}:${sourcePort} is already used by another mapping in this group.`,
      );
    }

    const now = new Date().toISOString();
    const record: MappingRecord = {
      id: ulid(),
      name: input.name ?? '',
      sourceHost,
      sourcePort,
      targetHost: input.targetHost,
      targetPort: input.targetPort,
      enabled: input.enabled ?? false,
      drainTimeoutMs: 30000,
      groupId: input.groupId,
      stats: { ...EMPTY_STATS },
      status: 'disabled',
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.id, record);
    return toResponse(record);
  }

  update(id: string, patch: PatchMappingRequest): MappingResponse {
    const record = this.records.get(id);
    if (!record) {
      throw new ApiError(ErrorCode.NOT_FOUND, `Mapping ${id} not found.`);
    }

    const newSourceHost = patch.sourceHost ?? record.sourceHost;
    const newSourcePort = patch.sourcePort ?? record.sourcePort;

    if (
      (patch.sourceHost !== undefined || patch.sourcePort !== undefined) &&
      this.hasConflict(newSourceHost, newSourcePort, record.groupId, id)
    ) {
      throw new ApiError(
        ErrorCode.CONFLICT,
        `Source ${newSourceHost}:${newSourcePort} is already used by another mapping in this group.`,
      );
    }

    const updated: MappingRecord = {
      ...record,
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.sourceHost !== undefined && { sourceHost: patch.sourceHost }),
      ...(patch.sourcePort !== undefined && { sourcePort: patch.sourcePort }),
      ...(patch.targetHost !== undefined && { targetHost: patch.targetHost }),
      ...(patch.targetPort !== undefined && { targetPort: patch.targetPort }),
      ...(patch.enabled !== undefined && { enabled: patch.enabled }),
      updatedAt: new Date().toISOString(),
    };
    this.records.set(id, updated);
    return toResponse(updated);
  }

  delete(id: string): void {
    if (!this.records.has(id)) {
      throw new ApiError(ErrorCode.NOT_FOUND, `Mapping ${id} not found.`);
    }
    this.records.delete(id);
  }

  toggle(id: string): MappingResponse {
    const record = this.records.get(id);
    if (!record) {
      throw new ApiError(ErrorCode.NOT_FOUND, `Mapping ${id} not found.`);
    }
    return this.update(id, { enabled: !record.enabled });
  }

  bulk(ops: BulkOperation[]): BulkResultItem[] {
    return ops.map((op) => {
      try {
        if (op.op === 'create') {
          return { ok: true, mapping: this.create(op.mapping) };
        }
        if (op.op === 'update') {
          return { ok: true, mapping: this.update(op.id, op.patch) };
        }
        this.delete(op.id);
        return { ok: true };
      } catch (err) {
        if (err instanceof ApiError) {
          return { ok: false, error: { code: err.code, message: err.message } };
        }
        return { ok: false, error: { code: ErrorCode.INTERNAL, message: String(err) } };
      }
    });
  }

  setListening(id: string): void {
    const r = this.records.get(id);
    if (!r) return;
    this.records.set(id, { ...r, status: 'listening', error: undefined });
  }

  setDisabled(id: string): void {
    const r = this.records.get(id);
    if (!r) return;
    this.records.set(id, { ...r, status: 'disabled', error: undefined });
  }

  setError(id: string, code: ErrorCode, message: string): void {
    const r = this.records.get(id);
    if (!r) return;
    this.records.set(id, { ...r, status: 'error', error: { code, message } });
  }

  updateStats(id: string, stats: MappingStats): void {
    const r = this.records.get(id);
    if (!r) return;
    this.records.set(id, { ...r, stats });
  }

  /** Returns IDs of enabled mappings in other groups that conflict on sourceHost:sourcePort. */
  findActiveConflicts(groupId: string): string[] {
    const groupMappings = Array.from(this.records.values()).filter(
      (r) => r.groupId === groupId && r.enabled,
    );
    const otherEnabled = Array.from(this.records.values()).filter(
      (r) => r.groupId !== groupId && r.enabled,
    );

    const conflicts: string[] = [];
    for (const gm of groupMappings) {
      const conflict = otherEnabled.find(
        (om) => om.sourceHost === gm.sourceHost && om.sourcePort === gm.sourcePort,
      );
      if (conflict) conflicts.push(conflict.id);
    }
    return conflicts;
  }

  private hasConflict(
    sourceHost: string,
    sourcePort: number,
    groupId: string,
    excludeId?: string,
  ): boolean {
    for (const [id, r] of this.records) {
      if (excludeId && id === excludeId) continue;
      if (r.groupId !== groupId) continue;
      if (r.sourceHost === sourceHost && r.sourcePort === sourcePort) return true;
    }
    return false;
  }
}
```

- [ ] **Step 4: Run all mapping store tests**

```bash
npx nx test cli -- -t "InMemoryMappingStore|cross-group|groupId on MappingResponse"
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/serve/store/mapping-store.ts apps/cli/src/serve/store/mapping-store.test.ts
git commit -m "feat(cli): update MappingStore with groupId, cross-group conflict rules, findActiveConflicts"
```

---

## Task 6: Group REST routes

**Files:**
- Modify: `apps/cli/src/serve/server.ts` (DaemonContext interface only — full wiring in Task 7)
- Create: `apps/cli/src/serve/routes/groups.ts`
- Test via: new `apps/cli/src/serve/server.groups.test.ts`

- [ ] **Step 1: Add `groupStore` to `DaemonContext` in `server.ts`**

Open `apps/cli/src/serve/server.ts` and add `groupStore` to the `DaemonContext` interface only (do not wire it yet — full wiring is Task 7):

```ts
export interface DaemonContext {
  store: InMemoryMappingStore;
  groupStore: InMemoryGroupStore;   // ADD THIS LINE
  eventBus: EventBus;
  logger: Logger;
  startedAt: number;
  version: string;
  configPath: string;
  logPath: string;
  daemonConfig: PortswitchConfig['daemon'];
  persist: () => void;
  startForwarding(id: string): Promise<void>;
  stopForwarding(id: string): Promise<void>;
  liveStats(id: string): import('@portswitch/proxy-core').ForwarderStats | undefined;
}
```

Also add the import at the top of server.ts:

```ts
import { InMemoryGroupStore } from './store/group-store';
```

- [ ] **Step 3: Write failing integration tests for group routes**

Add a new test file `apps/cli/src/serve/server.groups.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDaemon, DaemonHandle } from './server';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

let daemon: DaemonHandle;
let base: string;

function url(p: string) { return `http://127.0.0.1:${daemon.port}${p}`; }

async function req<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(url(path), {
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
  base = `http://127.0.0.1:${daemon.port}`;
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
    await req('POST', '/api/v1/mappings', { sourcePort: 3000, targetHost: '127.0.0.1', targetPort: 8080, groupId });
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
    // Use port 19800 — high enough to be available in test, low enough to be predictable
    await req('POST', '/api/v1/mappings', { sourcePort: 19800, targetHost: '127.0.0.1', targetPort: 19801, groupId });
    const r = await req<{ group: { activeCount: number } }>('POST', `/api/v1/groups/${groupId}/enable`);
    expect(r.status).toBe(200);
  });

  it('rejects enable when a port conflicts with another active group', async () => {
    const g1 = await req<{ id: string }>('POST', '/api/v1/groups', { name: 'Dev' });
    const g2 = await req<{ id: string }>('POST', '/api/v1/groups', { name: 'Staging' });
    const port = 19876;
    await req('POST', '/api/v1/mappings', { sourcePort: port, targetHost: '127.0.0.1', targetPort: port, groupId: g1.body.id });
    await req('POST', '/api/v1/mappings', { sourcePort: port, targetHost: '127.0.0.1', targetPort: port + 1, groupId: g2.body.id });
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
```

- [ ] **Step 4: Run to confirm they fail**

```bash
npx nx test cli -- --reporter=verbose -t "GET /api/v1/groups"
```

Expected: FAIL (route not registered yet).

- [ ] **Step 5: Create `apps/cli/src/serve/routes/groups.ts`**

```ts
import { Router, Request, Response } from 'express';
import { ApiError, ErrorCode, ERROR_HTTP_STATUS, CreateGroupRequestSchema, PatchGroupRequestSchema } from '@portswitch/shared';
import { DaemonContext } from '../server';

function sendApiError(res: Response, err: unknown): void {
  if (err instanceof ApiError) {
    res.status(ERROR_HTTP_STATUS[err.code]).json(err.toResponse());
  } else {
    res.status(500).json(new ApiError(ErrorCode.INTERNAL, 'Unexpected error').toResponse());
  }
}

function syncGroupCounts(ctx: DaemonContext, groupId: string): void {
  const mappings = ctx.store.listByGroup(groupId);
  ctx.groupStore.updateCounts(groupId, {
    mappingCount: mappings.length,
    activeCount: mappings.filter((m) => m.enabled).length,
  });
}

function syncAllGroupCounts(ctx: DaemonContext): void {
  for (const g of ctx.groupStore.list()) {
    syncGroupCounts(ctx, g.id);
  }
}

export function createGroupRoutes(ctx: DaemonContext): Router {
  const router = Router();
  const { groupStore, store, eventBus, persist, stopForwarding, startForwarding } = ctx;

  // GET /v1/groups
  router.get('/', (_req, res) => {
    syncAllGroupCounts(ctx);
    res.json({ groups: groupStore.list() });
  });

  // POST /v1/groups
  router.post('/', (req: Request, res: Response) => {
    const result = CreateGroupRequestSchema.safeParse(req.body);
    if (!result.success) {
      return sendApiError(res, new ApiError(ErrorCode.VALIDATION, 'Invalid request body'));
    }
    try {
      const group = groupStore.create(result.data);
      persist();
      eventBus.broadcast({ type: 'group.created', payload: { group } });
      res.status(201).json(group);
    } catch (err) {
      sendApiError(res, err);
    }
  });

  // GET /v1/groups/:id
  router.get('/:id', (req, res) => {
    const group = groupStore.get(req.params['id'] ?? '');
    if (!group) return sendApiError(res, new ApiError(ErrorCode.NOT_FOUND, 'Group not found.'));
    syncGroupCounts(ctx, group.id);
    res.json(groupStore.get(group.id));
  });

  // PATCH /v1/groups/:id
  router.patch('/:id', (req: Request, res: Response) => {
    const result = PatchGroupRequestSchema.safeParse(req.body);
    if (!result.success) {
      return sendApiError(res, new ApiError(ErrorCode.VALIDATION, 'Invalid patch body'));
    }
    try {
      const group = groupStore.update(req.params['id'] ?? '', result.data);
      persist();
      eventBus.broadcast({ type: 'group.updated', payload: { group } });
      res.json(group);
    } catch (err) {
      sendApiError(res, err);
    }
  });

  // DELETE /v1/groups/:id — also deletes all member mappings
  router.delete('/:id', async (req: Request, res: Response) => {
    const id = req.params['id'] ?? '';
    try {
      groupStore.get(id); // throws NOT_FOUND if missing (will be caught below)
      const members = store.listByGroup(id);
      await Promise.all(members.map((m) => stopForwarding(m.id)));
      for (const m of members) {
        store.delete(m.id);
        eventBus.broadcast({ type: 'mapping.deleted', payload: { id: m.id } });
      }
      groupStore.delete(id);
      persist();
      eventBus.broadcast({ type: 'group.deleted', payload: { id } });
      res.status(204).send();
    } catch (err) {
      sendApiError(res, err);
    }
  });

  // POST /v1/groups/:id/enable — enable all mappings (all-or-nothing conflict check)
  router.post('/:id/enable', async (req: Request, res: Response) => {
    const id = req.params['id'] ?? '';
    const group = groupStore.get(id);
    if (!group) return sendApiError(res, new ApiError(ErrorCode.NOT_FOUND, 'Group not found.'));

    const conflicts = store.findActiveConflicts(id);
    if (conflicts.length > 0) {
      return sendApiError(
        res,
        new ApiError(
          ErrorCode.CONFLICT,
          `Cannot enable group: ${conflicts.length} mapping(s) in other groups conflict on source port.`,
          { conflictingMappingIds: conflicts },
        ),
      );
    }

    const members = store.listByGroup(id);
    for (const m of members) {
      store.update(m.id, { enabled: true });
    }
    await Promise.all(members.map((m) => startForwarding(m.id)));

    const updatedMembers = store.listByGroup(id);
    syncGroupCounts(ctx, id);
    const updatedGroup = groupStore.get(id)!;

    persist();
    eventBus.broadcast({ type: 'group.toggled', payload: { group: updatedGroup, mappings: updatedMembers } });
    res.json({ group: updatedGroup, mappings: updatedMembers });
  });

  // POST /v1/groups/:id/disable — disable all mappings
  router.post('/:id/disable', async (req: Request, res: Response) => {
    const id = req.params['id'] ?? '';
    const group = groupStore.get(id);
    if (!group) return sendApiError(res, new ApiError(ErrorCode.NOT_FOUND, 'Group not found.'));

    const members = store.listByGroup(id);
    await Promise.all(members.map((m) => stopForwarding(m.id)));
    for (const m of members) {
      store.update(m.id, { enabled: false });
    }

    const updatedMembers = store.listByGroup(id);
    syncGroupCounts(ctx, id);
    const updatedGroup = groupStore.get(id)!;

    persist();
    eventBus.broadcast({ type: 'group.toggled', payload: { group: updatedGroup, mappings: updatedMembers } });
    res.json({ group: updatedGroup, mappings: updatedMembers });
  });

  return router;
}
```

- [ ] **Step 6: Run group route tests**

```bash
npx nx test cli -- --reporter=verbose -t "GET /api/v1/groups|POST /api/v1/groups|PATCH /api/v1/groups|DELETE /api/v1/groups"
```

Expected: FAIL (router not wired into server yet — 404 for all group routes).

- [ ] **Step 7: Commit routes file**

```bash
git add apps/cli/src/serve/routes/groups.ts apps/cli/src/serve/server.groups.test.ts apps/cli/src/serve/server.ts
git commit -m "feat(cli): add group routes file and DaemonContext.groupStore interface (pre-wiring)"
```

---

## Task 7: Update server.ts — wire groups, update EventBus, update flushConfig

**Files:**
- Modify: `apps/cli/src/serve/ws/event-bus.ts`
- Modify: `apps/cli/src/serve/server.ts`

- [ ] **Step 1: Update `apps/cli/src/serve/ws/event-bus.ts`**

Change `addClient` signature to accept groups snapshot. Replace the file:

```ts
import { WebSocket } from 'ws';
import { ServerMessage, ClientMessage, LogSubscribePayload, MappingResponse, GroupResponse, LogEntry, LogLevel, LogCategory, LogSubscribePayloadSchema } from '@portswitch/shared';

const LOG_DROP_BUFFER = 500;
const LOG_DROP_BYTES = 256 * 1024;

interface ClientState {
  logFilter: LogSubscribePayload | null;
  pendingDrops: number;
  logBuffer: LogEntry[];
}

function matchesFilter(entry: LogEntry, filter: LogSubscribePayload): boolean {
  if (filter.mappingIds && filter.mappingIds.length > 0) {
    if (!entry.mappingId || !filter.mappingIds.includes(entry.mappingId)) return false;
  }
  if (filter.levels && filter.levels.length > 0) {
    if (!filter.levels.includes(entry.level)) return false;
  }
  if (filter.categories && filter.categories.length > 0) {
    if (!filter.categories.includes(entry.category as LogCategory)) return false;
  }
  return true;
}

export class EventBus {
  private clients = new Map<WebSocket, ClientState>();
  private version: string;

  constructor(version: string) {
    this.version = version;
  }

  addClient(ws: WebSocket, snapshotMappings: MappingResponse[], snapshotGroups: GroupResponse[]): void {
    this.clients.set(ws, { logFilter: null, pendingDrops: 0, logBuffer: [] });

    this.send(ws, {
      type: 'hello',
      payload: { serverVersion: this.version, snapshot: { mappings: snapshotMappings, groups: snapshotGroups } },
    });

    ws.on('message', (data) => this.handleMessage(ws, data.toString()));
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
    ws.on('drain', () => this.drainLogBuffer(ws));
  }

  broadcast(event: ServerMessage): void {
    const json = JSON.stringify(event);
    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(json);
      }
    }
  }

  broadcastLog(entry: LogEntry): void {
    for (const [ws, state] of this.clients) {
      if (!state.logFilter) continue;
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (!matchesFilter(entry, state.logFilter)) continue;

      const socketLen = (ws as unknown as { _socket?: { writableLength?: number } })
        ._socket?.writableLength ?? 0;

      if (socketLen > LOG_DROP_BYTES || state.logBuffer.length > 0) {
        if (state.logBuffer.length < LOG_DROP_BUFFER) {
          state.logBuffer.push(entry);
        } else {
          state.pendingDrops++;
        }
      } else {
        if (state.pendingDrops > 0) {
          this.send(ws, { type: 'log.dropped', payload: { count: state.pendingDrops } });
          state.pendingDrops = 0;
        }
        this.send(ws, { type: 'log', payload: { entry } });
      }
    }
  }

  clientCount(): number {
    return this.clients.size;
  }

  private drainLogBuffer(ws: WebSocket): void {
    const state = this.clients.get(ws);
    if (!state || state.logBuffer.length === 0) return;

    if (state.pendingDrops > 0) {
      this.send(ws, { type: 'log.dropped', payload: { count: state.pendingDrops } });
      state.pendingDrops = 0;
    }

    while (state.logBuffer.length > 0 && ws.readyState === WebSocket.OPEN) {
      const entry = state.logBuffer.shift();
      if (entry && state.logFilter && matchesFilter(entry, state.logFilter)) {
        this.send(ws, { type: 'log', payload: { entry } });
      }
    }
  }

  private send(ws: WebSocket, event: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  private handleMessage(ws: WebSocket, raw: string): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }

    if (msg.type === 'ping') {
      this.send(ws, { type: 'pong' });
    } else if (msg.type === 'log.subscribe') {
      const state = this.clients.get(ws);
      if (state) {
        const parsed = LogSubscribePayloadSchema.safeParse(msg.payload);
        if (parsed.success) {
          state.logFilter = parsed.data;
          state.logBuffer = [];
          state.pendingDrops = 0;
        }
      }
    } else if (msg.type === 'log.unsubscribe') {
      const state = this.clients.get(ws);
      if (state) {
        state.logFilter = null;
        state.logBuffer = [];
        state.pendingDrops = 0;
      }
    }
  }
}

export type { LogEntry, LogLevel, LogCategory };
```

- [ ] **Step 2: Update `apps/cli/src/serve/server.ts`**

Make these targeted changes to `server.ts`:

1. Import `InMemoryGroupStore` and `createGroupRoutes`:

```ts
import { InMemoryGroupStore } from './store/group-store';
import { createGroupRoutes } from './routes/groups';
```

2. Update `DaemonContext` interface — add `groupStore`:

```ts
export interface DaemonContext {
  store: InMemoryMappingStore;
  groupStore: InMemoryGroupStore;   // ADD THIS
  eventBus: EventBus;
  logger: Logger;
  startedAt: number;
  version: string;
  configPath: string;
  logPath: string;
  daemonConfig: PortswitchConfig['daemon'];
  persist: () => void;
  startForwarding(id: string): Promise<void>;
  stopForwarding(id: string): Promise<void>;
  liveStats(id: string): import('@portswitch/proxy-core').ForwarderStats | undefined;
}
```

3. In `createDaemon`, after `const store = new InMemoryMappingStore();`, add:

```ts
const groupStore = new InMemoryGroupStore();
```

4. Update `flushConfig` to include groups:

```ts
async function flushConfig(): Promise<void> {
  const config: PortswitchConfig = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    daemon: currentDaemonConfig,
    groups: groupStore.toConfigs(),
    mappings: store.toConfigs(),
  };
  await saveConfig(configPath, config);
}
```

5. Update the `ctx` object to include `groupStore`:

```ts
const ctx: DaemonContext = {
  store, groupStore, eventBus, logger, startedAt, version: PKG_VERSION,
  configPath, logPath,
  get daemonConfig() { return currentDaemonConfig; },
  persist, startForwarding, stopForwarding, liveStats,
};
```

6. Register the group router under `/api`:

```ts
apiRouter.use('/v1/groups', createGroupRoutes(ctx));
```

7. In `start()`, add group hydration after `store.hydrate`:

```ts
groupStore.hydrate(config.groups);
store.hydrate(config.mappings);
```

8. In the WS connection handler, pass groups to `addClient`:

```ts
wss.on('connection', (ws) => {
  (ws as TrackedSocket)._pingSent = false;
  eventBus.addClient(ws, store.list(), groupStore.list());
  // ...
});
```

9. In the config file watcher, after `store.hydrate(reloaded.mappings)`:

```ts
groupStore.hydrate(reloaded.groups);
store.hydrate(reloaded.mappings);
```

And update the `hello` broadcast in the watcher:

```ts
eventBus.broadcast({ type: 'hello', payload: { serverVersion: PKG_VERSION, snapshot: { mappings: next, groups: groupStore.list() } } });
```

- [ ] **Step 3: Run the full CLI test suite**

```bash
npx nx test cli
```

Expected: all PASS (including the group route integration tests from Task 6).

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/serve/
git commit -m "feat(cli): wire InMemoryGroupStore and group routes into server, update EventBus hello snapshot"
```

---

## Task 8: CLI client + group subcommands

**Files:**
- Modify: `apps/cli/src/client.ts`
- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/src/main.test.ts`

- [ ] **Step 1: Add group methods to `apps/cli/src/client.ts`**

Add these methods to `DaemonClient` (after `toggleMapping`):

```ts
listGroups() { return this.req<ListGroupsResponse>('GET', '/v1/groups'); }
getGroup(id: string) { return this.req<GroupResponse>('GET', `/v1/groups/${id}`); }
createGroup(req: CreateGroupRequest) { return this.req<GroupResponse>('POST', '/v1/groups', req); }
patchGroup(id: string, req: PatchGroupRequest) { return this.req<GroupResponse>('PATCH', `/v1/groups/${id}`, req); }
deleteGroup(id: string) { return this.req<void>('DELETE', `/v1/groups/${id}`); }
enableGroup(id: string) { return this.req<{ group: GroupResponse; mappings: MappingResponse[] }>('POST', `/v1/groups/${id}/enable`); }
disableGroup(id: string) { return this.req<{ group: GroupResponse; mappings: MappingResponse[] }>('POST', `/v1/groups/${id}/disable`); }
```

Also add the new types to the import from `@portswitch/shared`:

```ts
import {
  // ... existing imports ...
  type GroupResponse,
  type ListGroupsResponse,
  type CreateGroupRequest,
  type PatchGroupRequest,
} from '@portswitch/shared';
```

- [ ] **Step 2: Add `group` subcommand to `apps/cli/src/main.ts`**

After the `edit` command, before `watch`, add:

```ts
// group
const groupCmd = program
  .command('group <action>')
  .description('Manage groups  (actions: list, add, enable, disable, remove)')
  .option('-n, --name <name>', 'group name (required for add)');

groupCmd.action(async (action: string) => {
  const opts = groupCmd.opts() as { name?: string };
  const c = getClient();

  try {
    switch (action) {
      case 'list': {
        const { groups } = await c.listGroups();
        if (isJson()) {
          console.log(toJson(groups));
        } else {
          if (groups.length === 0) {
            console.log(chalk.dim('No groups. Use: portswitch group add --name <name>'));
          } else {
            console.log(chalk.bold('ID'.padEnd(28)) + chalk.bold('NAME'.padEnd(24)) + chalk.bold('MAPPINGS') + '  ' + chalk.bold('ACTIVE'));
            for (const g of groups) {
              const active = g.activeCount > 0 ? chalk.green(String(g.activeCount)) : chalk.dim('0');
              console.log(g.id.padEnd(28) + g.name.padEnd(24) + String(g.mappingCount).padEnd(10) + active);
            }
          }
        }
        break;
      }
      case 'add': {
        if (!opts.name) {
          console.error(chalk.red('Error:'), '--name is required for group add');
          process.exit(ExitCode.BAD_INVOCATION);
        }
        const group = await c.createGroup({ name: opts.name });
        if (isJson()) {
          console.log(toJson(group));
        } else {
          console.log(chalk.green('Group created:'), group.name, chalk.dim(`(${group.id})`));
        }
        break;
      }
      case 'enable': {
        if (!opts.name) {
          console.error(chalk.red('Error:'), '--name is required for group enable');
          process.exit(ExitCode.BAD_INVOCATION);
        }
        const { groups: all } = await c.listGroups();
        const match = all.find((g) => g.name.toLowerCase() === opts.name!.toLowerCase() || g.id === opts.name);
        if (!match) {
          console.error(chalk.red('Error:'), `Group "${opts.name}" not found`);
          process.exit(ExitCode.DAEMON_ERROR);
        }
        const result = await c.enableGroup(match.id);
        if (isJson()) {
          console.log(toJson(result));
        } else {
          console.log(chalk.green('Enabled:'), result.group.name, chalk.dim(`(${result.mappings.length} mapping(s))`));
        }
        break;
      }
      case 'disable': {
        if (!opts.name) {
          console.error(chalk.red('Error:'), '--name is required for group disable');
          process.exit(ExitCode.BAD_INVOCATION);
        }
        const { groups: all } = await c.listGroups();
        const match = all.find((g) => g.name.toLowerCase() === opts.name!.toLowerCase() || g.id === opts.name);
        if (!match) {
          console.error(chalk.red('Error:'), `Group "${opts.name}" not found`);
          process.exit(ExitCode.DAEMON_ERROR);
        }
        const result = await c.disableGroup(match.id);
        if (isJson()) {
          console.log(toJson(result));
        } else {
          console.log(chalk.dim('Disabled:'), result.group.name);
        }
        break;
      }
      case 'remove': {
        if (!opts.name) {
          console.error(chalk.red('Error:'), '--name is required for group remove');
          process.exit(ExitCode.BAD_INVOCATION);
        }
        const { groups: all } = await c.listGroups();
        const match = all.find((g) => g.name.toLowerCase() === opts.name!.toLowerCase() || g.id === opts.name);
        if (!match) {
          console.error(chalk.red('Error:'), `Group "${opts.name}" not found`);
          process.exit(ExitCode.DAEMON_ERROR);
        }
        await c.deleteGroup(match.id);
        if (!isJson()) console.log(chalk.dim('Group removed.'));
        break;
      }
      default: {
        console.error(chalk.red('Error:'), 'Unknown group action: ' + action);
        console.error('  Valid actions: list, add, enable, disable, remove');
        process.exit(ExitCode.BAD_INVOCATION);
      }
    }
  } catch (err) {
    handleError(err);
  }
});
```

- [ ] **Step 3: Run the CLI main tests**

```bash
npx nx test cli -- -t "group"
```

Expected: pass (or update existing snapshot tests to include the new `group` subcommand in the help output).

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/client.ts apps/cli/src/main.ts
git commit -m "feat(cli): add group subcommand (list, add, enable, disable, remove) and client methods"
```

---

## Task 9: Web API client + GroupSection component

**Files:**
- Modify: `apps/web/src/apiClient.ts`
- Create: `apps/web/src/components/GroupSection.tsx`

- [ ] **Step 1: Update `apps/web/src/apiClient.ts`**

Replace the entire file:

```ts
import type {
  HealthResponse,
  ListMappingsResponse,
  ListGroupsResponse,
  GroupResponse,
  MappingResponse,
  CreateMappingRequest,
  PatchMappingRequest,
  CreateGroupRequest,
  PatchGroupRequest,
} from '@portswitch/shared';

const BASE = '/api/v1';
const WS_RETRY_MS = 5_000;

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } })) as { error: { message: string } };
    throw new Error(err.error?.message ?? res.statusText);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

export const apiClient = {
  daemon: {
    health: () => req<HealthResponse>('GET', '/health'),
  },
  groups: {
    list: () => req<ListGroupsResponse>('GET', '/groups'),
    create: (r: CreateGroupRequest) => req<GroupResponse>('POST', '/groups', r),
    patch: (id: string, r: PatchGroupRequest) => req<GroupResponse>('PATCH', `/groups/${id}`, r),
    delete: (id: string) => req<void>('DELETE', `/groups/${id}`),
    enable: (id: string) => req<{ group: GroupResponse; mappings: MappingResponse[] }>('POST', `/groups/${id}/enable`),
    disable: (id: string) => req<{ group: GroupResponse; mappings: MappingResponse[] }>('POST', `/groups/${id}/disable`),
  },
  mappings: {
    list: () => req<ListMappingsResponse>('GET', '/mappings'),
    create: (r: CreateMappingRequest) => req<MappingResponse>('POST', '/mappings', r),
    patch: (id: string, r: PatchMappingRequest) => req<MappingResponse>('PATCH', `/mappings/${id}`, r),
    delete: (id: string) => req<void>('DELETE', `/mappings/${id}`),
    toggle: (id: string) => req<MappingResponse>('POST', `/mappings/${id}/toggle`),
  },
  events: {
    subscribe(cb: (event: unknown) => void): () => void {
      let ws: WebSocket | null = null;
      let stopped = false;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;

      function connect(): void {
        if (stopped) return;
        ws = new WebSocket(`ws://${location.host}/api/v1/events`);
        ws.onmessage = (e) => {
          try { cb(JSON.parse(e.data as string)); } catch { /* ignore malformed frames */ }
        };
        ws.onclose = () => {
          ws = null;
          if (!stopped) retryTimer = setTimeout(connect, WS_RETRY_MS);
        };
      }

      connect();
      return () => {
        stopped = true;
        if (retryTimer) clearTimeout(retryTimer);
        ws?.close();
      };
    },
  },
};
```

- [ ] **Step 2: Create `apps/web/src/components/GroupSection.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import type { GroupResponse, MappingResponse } from '@portswitch/shared';

const STATUS_COLOR: Record<string, string> = {
  listening: 'var(--success)',
  disabled: 'var(--text-muted)',
  error: 'var(--danger)',
};

const styles: Record<string, React.CSSProperties> = {
  group: {
    marginBottom: '16px',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 14px',
    background: 'var(--bg-secondary)',
    cursor: 'pointer',
    userSelect: 'none',
  },
  chevron: { fontSize: '10px', color: 'var(--text-muted)', flexShrink: 0 },
  groupName: { fontSize: '14px', fontWeight: 600, flex: 1 },
  badge: {
    fontSize: '11px',
    color: 'var(--text-faint)',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    padding: '1px 7px',
    flexShrink: 0,
  },
  activeBadge: {
    fontSize: '11px',
    color: 'var(--success)',
    background: 'var(--bg-primary)',
    border: '1px solid var(--success)',
    borderRadius: '10px',
    padding: '1px 7px',
    flexShrink: 0,
  },
  actionBtn: {
    padding: '3px 10px',
    border: '1px solid var(--border-strong)',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    background: 'transparent',
    flexShrink: 0,
  },
  body: { padding: '8px 12px 12px 12px', background: 'var(--bg-primary)' },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 10px',
    background: 'var(--bg-secondary)',
    borderRadius: '6px',
    marginBottom: '6px',
    border: '1px solid var(--border)',
    flexWrap: 'wrap',
  },
  statusDot: { width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0 },
  name: {
    fontSize: '13px', fontWeight: 500, flex: '1 1 100px',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
  },
  route: {
    fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace',
    flex: '2 1 180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
  },
  errorMsg: { flexBasis: '100%', fontSize: '12px', color: 'var(--danger)', margin: 0, paddingLeft: '20px' },
  addBtn: {
    marginTop: '6px', width: '100%',
    padding: '5px 0',
    background: 'transparent',
    border: '1px dashed var(--border-strong)',
    borderRadius: '6px',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '12px',
  },
  emptyMsg: { fontSize: '13px', color: 'var(--text-faint)', textAlign: 'center', padding: '12px 0' },
};

interface MappingRowProps {
  mapping: MappingResponse;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
}

function MappingRow({ mapping: m, onToggle, onDelete, onEdit }: MappingRowProps): React.ReactElement {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);

  const handleDeleteClick = (): void => {
    if (confirming) { setConfirming(false); onDelete(); }
    else setConfirming(true);
  };

  return (
    <div style={styles.row}>
      <span style={{ ...styles.statusDot, background: STATUS_COLOR[m.status] ?? 'var(--text-muted)' }} />
      <span style={styles.name} title={m.name || '(unnamed)'}>{m.name || <em style={{ color: 'var(--text-faint)' }}>(unnamed)</em>}</span>
      <span style={styles.route} title={`${m.sourceHost}:${m.sourcePort} → ${m.targetHost}:${m.targetPort}`}>
        {m.sourceHost}:{m.sourcePort} → {m.targetHost}:{m.targetPort}
      </span>
      <button
        style={{ ...styles.actionBtn, padding: '3px 8px', color: m.enabled ? 'var(--success)' : 'var(--text-muted)' }}
        onClick={onToggle} title={m.enabled ? 'Disable' : 'Enable'}
      >
        {m.enabled ? 'On' : 'Off'}
      </button>
      <button style={{ ...styles.actionBtn, color: 'var(--text-secondary)' }} onClick={onEdit} aria-label="Edit mapping">✎</button>
      <button
        style={confirming
          ? { ...styles.actionBtn, padding: '3px 8px', border: '1px solid var(--danger)', background: 'var(--danger-bg)', color: 'var(--danger)' }
          : { ...styles.actionBtn, color: 'var(--danger)' }}
        onClick={handleDeleteClick}
        aria-label={confirming ? 'Confirm delete' : 'Delete mapping'}
      >
        {confirming ? 'Confirm?' : '×'}
      </button>
      {m.status === 'error' && m.error?.message && (
        <p style={styles.errorMsg}>{m.error.message}</p>
      )}
    </div>
  );
}

export interface GroupSectionProps {
  group: GroupResponse;
  mappings: MappingResponse[];
  onEnable: () => void;
  onDisable: () => void;
  onToggleMapping: (id: string) => void;
  onDeleteMapping: (id: string) => void;
  onEditMapping: (m: MappingResponse) => void;
  onAddMapping: () => void;
  onDeleteGroup: () => void;
}

export function GroupSection({
  group, mappings,
  onEnable, onDisable,
  onToggleMapping, onDeleteMapping, onEditMapping, onAddMapping,
  onDeleteGroup,
}: GroupSectionProps): React.ReactElement {
  const [expanded, setExpanded] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isActive = group.activeCount > 0;

  useEffect(() => {
    if (!confirmingDelete) return;
    const t = setTimeout(() => setConfirmingDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmingDelete]);

  const handleGroupDelete = (): void => {
    if (confirmingDelete) { setConfirmingDelete(false); onDeleteGroup(); }
    else setConfirmingDelete(true);
  };

  return (
    <div style={styles.group}>
      <div style={styles.header} onClick={() => setExpanded((e) => !e)}>
        <span style={styles.chevron}>{expanded ? '▼' : '▶'}</span>
        <span style={styles.groupName}>{group.name}</span>
        {isActive
          ? <span style={styles.activeBadge}>{group.activeCount}/{group.mappingCount} active</span>
          : <span style={styles.badge}>{group.mappingCount} mapping{group.mappingCount !== 1 ? 's' : ''}</span>
        }
        <button
          style={{ ...styles.actionBtn, color: isActive ? 'var(--text-muted)' : 'var(--success)' }}
          onClick={(e) => { e.stopPropagation(); isActive ? onDisable() : onEnable(); }}
          title={isActive ? 'Disable group' : 'Enable group'}
        >
          {isActive ? 'Disable all' : 'Enable all'}
        </button>
        <button
          style={confirmingDelete
            ? { ...styles.actionBtn, border: '1px solid var(--danger)', background: 'var(--danger-bg)', color: 'var(--danger)', padding: '3px 8px' }
            : { ...styles.actionBtn, color: 'var(--danger)' }}
          onClick={(e) => { e.stopPropagation(); handleGroupDelete(); }}
          aria-label={confirmingDelete ? 'Confirm delete group' : 'Delete group'}
          title={confirmingDelete ? 'Click again to confirm' : 'Delete group and all its mappings'}
        >
          {confirmingDelete ? 'Confirm?' : '×'}
        </button>
      </div>
      {expanded && (
        <div style={styles.body}>
          {mappings.length === 0 && (
            <p style={styles.emptyMsg}>No mappings in this group.</p>
          )}
          {mappings.map((m) => (
            <MappingRow
              key={m.id}
              mapping={m}
              onToggle={() => onToggleMapping(m.id)}
              onDelete={() => onDeleteMapping(m.id)}
              onEdit={() => onEditMapping(m)}
            />
          ))}
          <button style={styles.addBtn} onClick={(e) => { e.stopPropagation(); onAddMapping(); }}>
            + Add Mapping
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck the web app**

```bash
npx nx run web:typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/apiClient.ts apps/web/src/components/GroupSection.tsx
git commit -m "feat(web): add group API client methods and GroupSection component"
```

---

## Task 10: Update AddMappingDialog, MappingList, and App.tsx

**Files:**
- Modify: `apps/web/src/components/AddMappingDialog.tsx`
- Modify: `apps/web/src/components/MappingList.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Update `apps/web/src/components/AddMappingDialog.tsx`**

Add `groupId` to `MappingDialogValues` and to the form — read the current file first, then add:

1. Add `groupId: string` to `MappingDialogValues` interface.
2. Add a `groupId` prop to the dialog (pre-set, not shown to user — the group is determined by which "Add Mapping" button was clicked):
   ```ts
   interface Props {
     groupId: string;   // ADD
     initial?: MappingResponse;
     onConfirm: (values: MappingDialogValues) => void;
     onCancel: () => void;
   }
   ```
3. Include `groupId` in the returned `MappingDialogValues` from `onConfirm`.

Read the file and make these additions surgically — do not change the existing form fields.

- [ ] **Step 2: Update `apps/web/src/components/MappingList.tsx`**

Replace the entire file to render `GroupSection` components instead of flat rows:

```tsx
import React from 'react';
import type { GroupResponse, MappingResponse } from '@portswitch/shared';
import { GroupSection } from './GroupSection';

interface Props {
  groups: GroupResponse[];
  mappings: MappingResponse[];
  onEnableGroup: (id: string) => void;
  onDisableGroup: (id: string) => void;
  onToggleMapping: (id: string) => void;
  onDeleteMapping: (id: string) => void;
  onEditMapping: (m: MappingResponse) => void;
  onAddMapping: (groupId: string) => void;
  onDeleteGroup: (id: string) => void;
  onAddGroup: () => void;
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '16px', flex: 1, overflowY: 'auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  title: { fontSize: '16px', fontWeight: 600 },
  addBtn: {
    padding: '6px 14px', background: 'var(--accent)', color: '#fff',
    border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
  },
  empty: { color: 'var(--text-muted)', fontSize: '14px', textAlign: 'center', paddingTop: '40px' },
};

export function MappingList({
  groups, mappings,
  onEnableGroup, onDisableGroup,
  onToggleMapping, onDeleteMapping, onEditMapping,
  onAddMapping, onDeleteGroup, onAddGroup,
}: Props): React.ReactElement {
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>Port Mappings</span>
        <button style={styles.addBtn} onClick={onAddGroup}>+ Add Group</button>
      </div>
      {groups.length === 0 ? (
        <p style={styles.empty}>No groups yet. Click &ldquo;Add Group&rdquo; to get started.</p>
      ) : (
        groups.map((g) => (
          <GroupSection
            key={g.id}
            group={g}
            mappings={mappings.filter((m) => m.groupId === g.id)}
            onEnable={() => onEnableGroup(g.id)}
            onDisable={() => onDisableGroup(g.id)}
            onToggleMapping={onToggleMapping}
            onDeleteMapping={onDeleteMapping}
            onEditMapping={onEditMapping}
            onAddMapping={() => onAddMapping(g.id)}
            onDeleteGroup={() => onDeleteGroup(g.id)}
          />
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 3: Update `apps/web/src/App.tsx`**

Replace the entire file:

```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CreateMappingRequest,
  HealthResponse,
  MappingResponse,
  PatchMappingRequest,
  GroupResponse,
} from '@portswitch/shared';
import { StatusBar } from './components/StatusBar';
import { MappingList } from './components/MappingList';
import { AddMappingDialog, type MappingDialogValues } from './components/AddMappingDialog';
import { useColorScheme } from './theme';
import { apiClient } from './apiClient';

const layout: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', height: '100vh',
  background: 'var(--bg-primary)', color: 'var(--text-primary)',
};
const toast: React.CSSProperties = {
  padding: '10px 16px', background: 'var(--toast-bg)',
  borderBottom: '1px solid var(--toast-border)', color: 'var(--danger)',
  fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px',
};
const toastClose: React.CSSProperties = {
  background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '16px', padding: '0 4px',
};
const dialogOverlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const dialogBox: React.CSSProperties = {
  background: 'var(--bg-primary)', border: '1px solid var(--border)',
  borderRadius: '10px', padding: '24px', minWidth: '280px', maxWidth: '400px', width: '90%',
};

const HEALTH_POLL_MS = 10_000;
const WS_REFRESH_DEBOUNCE_MS = 200;
const TOAST_AUTO_DISMISS_MS = 6_000;

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}

export default function App(): React.ReactElement {
  useColorScheme();

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [mappings, setMappings] = useState<MappingResponse[]>([]);
  const [groups, setGroups] = useState<GroupResponse[]>([]);
  const [addMappingGroupId, setAddMappingGroupId] = useState<string | null>(null);
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [editing, setEditing] = useState<MappingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), TOAST_AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [error]);

  const refreshHealth = useCallback(async () => {
    const h = await apiClient.daemon.health().catch(() => null);
    setHealth(h as HealthResponse | null);
    setHealthLoading(false);
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const [mResult, gResult] = await Promise.all([apiClient.mappings.list(), apiClient.groups.list()]);
      setMappings(mResult.mappings);
      setGroups(gResult.groups);
    } catch {
      // Failures are reflected by the daemon-unreachable status bar.
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void refreshAll();
    }, WS_REFRESH_DEBOUNCE_MS);
  }, [refreshAll]);

  const scheduleRefreshRef = useRef(scheduleRefresh);
  useEffect(() => { scheduleRefreshRef.current = scheduleRefresh; }, [scheduleRefresh]);

  useEffect(() => {
    void refreshHealth();
    void refreshAll();
    const healthInterval = setInterval(() => void refreshHealth(), HEALTH_POLL_MS);
    const unsub = apiClient.events.subscribe(() => scheduleRefreshRef.current());
    return () => {
      clearInterval(healthInterval);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      unsub();
    };
  }, [refreshHealth, refreshAll]);

  const handleEnableGroup = async (id: string): Promise<void> => {
    try {
      const result = await apiClient.groups.enable(id);
      setGroups((prev) => prev.map((g) => (g.id === id ? result.group : g)));
      setMappings((prev) => {
        const updatedIds = new Set(result.mappings.map((m) => m.id));
        return prev.map((m) => (updatedIds.has(m.id) ? (result.mappings.find((u) => u.id === m.id) ?? m) : m));
      });
    } catch (err) { setError(errorMessage(err)); }
  };

  const handleDisableGroup = async (id: string): Promise<void> => {
    try {
      const result = await apiClient.groups.disable(id);
      setGroups((prev) => prev.map((g) => (g.id === id ? result.group : g)));
      setMappings((prev) => {
        const updatedIds = new Set(result.mappings.map((m) => m.id));
        return prev.map((m) => (updatedIds.has(m.id) ? (result.mappings.find((u) => u.id === m.id) ?? m) : m));
      });
    } catch (err) { setError(errorMessage(err)); }
  };

  const handleDeleteGroup = async (id: string): Promise<void> => {
    try {
      await apiClient.groups.delete(id);
      setGroups((prev) => prev.filter((g) => g.id !== id));
      setMappings((prev) => prev.filter((m) => m.groupId !== id));
    } catch (err) { setError(errorMessage(err)); }
  };

  const handleAddGroup = async (): Promise<void> => {
    const name = newGroupName.trim();
    if (!name) return;
    try {
      const group = await apiClient.groups.create({ name });
      setGroups((prev) => [...prev, group]);
      setShowAddGroup(false);
      setNewGroupName('');
    } catch (err) { setError(errorMessage(err)); }
  };

  const handleToggleMapping = async (id: string): Promise<void> => {
    try {
      const updated = await apiClient.mappings.toggle(id);
      setMappings((prev) => prev.map((m) => (m.id === id ? updated : m)));
      setGroups((prev) => prev.map((g) => {
        if (g.id !== updated.groupId) return g;
        const groupMappings = mappings.map((m) => (m.id === id ? updated : m)).filter((m) => m.groupId === g.id);
        return { ...g, activeCount: groupMappings.filter((m) => m.enabled).length };
      }));
    } catch (err) { setError(errorMessage(err)); }
  };

  const handleDeleteMapping = async (id: string): Promise<void> => {
    try {
      await apiClient.mappings.delete(id);
      setMappings((prev) => prev.filter((m) => m.id !== id));
    } catch (err) { setError(errorMessage(err)); }
  };

  const handleAddMapping = async (values: MappingDialogValues): Promise<void> => {
    const r: CreateMappingRequest = { ...values, enabled: false };
    try {
      const created = await apiClient.mappings.create(r);
      setMappings((prev) => [...prev, created]);
      setAddMappingGroupId(null);
    } catch (err) { setError(errorMessage(err)); }
  };

  const handleEditSave = async (values: MappingDialogValues): Promise<void> => {
    if (!editing) return;
    const patch: PatchMappingRequest = {
      name: values.name,
      sourceHost: values.sourceHost,
      sourcePort: values.sourcePort,
      targetHost: values.targetHost,
      targetPort: values.targetPort,
    };
    try {
      const updated = await apiClient.mappings.patch(editing.id, patch);
      setMappings((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      setEditing(null);
    } catch (err) { setError(errorMessage(err)); }
  };

  return (
    <div style={layout}>
      <StatusBar health={health} loading={healthLoading} />
      {error && (
        <div style={toast} role="alert">
          <span>{error}</span>
          <button style={toastClose} onClick={() => setError(null)} aria-label="Dismiss">×</button>
        </div>
      )}
      <MappingList
        groups={groups}
        mappings={mappings}
        onEnableGroup={(id) => void handleEnableGroup(id)}
        onDisableGroup={(id) => void handleDisableGroup(id)}
        onToggleMapping={(id) => void handleToggleMapping(id)}
        onDeleteMapping={(id) => void handleDeleteMapping(id)}
        onEditMapping={(m) => setEditing(m)}
        onAddMapping={(groupId) => setAddMappingGroupId(groupId)}
        onDeleteGroup={(id) => void handleDeleteGroup(id)}
        onAddGroup={() => setShowAddGroup(true)}
      />

      {showAddGroup && (
        <div style={dialogOverlay} onClick={() => setShowAddGroup(false)}>
          <div style={dialogBox} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 16px', fontSize: '16px' }}>New Group</h2>
            <input
              autoFocus
              style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', boxSizing: 'border-box' }}
              placeholder="Group name"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleAddGroup(); if (e.key === 'Escape') { setShowAddGroup(false); setNewGroupName(''); } }}
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
              <button style={{ padding: '6px 14px', border: '1px solid var(--border)', borderRadius: '6px', background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '13px' }} onClick={() => { setShowAddGroup(false); setNewGroupName(''); }}>Cancel</button>
              <button style={{ padding: '6px 14px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }} onClick={() => void handleAddGroup()}>Create</button>
            </div>
          </div>
        </div>
      )}

      {addMappingGroupId && (
        <AddMappingDialog
          groupId={addMappingGroupId}
          onConfirm={(values) => void handleAddMapping(values)}
          onCancel={() => setAddMappingGroupId(null)}
        />
      )}
      {editing && (
        <AddMappingDialog
          groupId={editing.groupId}
          initial={editing}
          onConfirm={(values) => void handleEditSave(values)}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Fix AddMappingDialog to accept and pass through groupId**

Read `apps/web/src/components/AddMappingDialog.tsx`. Make these targeted changes:

1. Add `groupId: string` to `MappingDialogValues`:
```ts
export interface MappingDialogValues {
  name: string;
  sourceHost: string;
  sourcePort: number;
  targetHost: string;
  targetPort: number;
  groupId: string;   // ADD
}
```

2. Add `groupId: string` to the `Props` interface:
```ts
interface Props {
  groupId: string;          // ADD
  initial?: MappingResponse;
  onConfirm: (values: MappingDialogValues) => void;
  onCancel: () => void;
}
```

3. In the component function signature, destructure `groupId`:
```ts
export function AddMappingDialog({ groupId, initial, onConfirm, onCancel }: Props)
```

4. In the `handleSubmit` (or wherever `onConfirm` is called), include `groupId`:
```ts
onConfirm({
  name,
  sourceHost,
  sourcePort: Number(sourcePort),
  targetHost,
  targetPort: Number(targetPort),
  groupId,   // ADD — comes from props, not the form
});
```

The `groupId` is NOT shown as a form field — it is passed in as a prop and forwarded to `onConfirm`.

- [ ] **Step 5: Run the web app typecheck**

```bash
npx nx run web:typecheck
```

Expected: no errors.

- [ ] **Step 6: Run web tests**

```bash
npx nx test web
```

Expected: all pass (update any test fixtures that relied on the old `MappingList` or `AddMappingDialog` props).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/
git commit -m "feat(web): update MappingList and App for group-based UI, add group management"
```

---

## Task 11: Full test run + typecheck

- [ ] **Step 1: Run all tests across all projects**

```bash
npx nx run-many -t test
```

Expected: all pass.

- [ ] **Step 2: Run typecheck across all projects**

```bash
npx nx run-many -t typecheck
```

Expected: no errors.

- [ ] **Step 3: Build the full stack and smoke-test manually**

```bash
npx nx run cli:build
node dist/apps/cli/main.js serve
```

Open `http://127.0.0.1:65432/ui` in a browser. Verify:
- "Add Group" button appears
- Creating a group shows a group section
- Adding a mapping to a group shows it inside the group
- "Enable all" button enables all mappings in the group
- If two groups share a source port, enabling the second shows an error toast

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: groups feature — group-based port mapping management with all-or-nothing enable"
```
