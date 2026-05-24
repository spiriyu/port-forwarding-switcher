# CLI + Web Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the daemon into the CLI, extract the React renderer into `apps/web/`, serve everything from a single port (65432) with `/api/*` and `/ui/*` path prefixes, and shrink Electron to a thin health-check shell.

**Architecture:** One Node.js process (`portswitch serve`) runs the proxy daemon on `http://localhost:65432/api/v1/*` and serves the React app's built static files at `http://localhost:65432/ui/*`. Electron becomes a 100-line wrapper that health-checks the daemon, spawns it if absent, and opens a `BrowserWindow` to `http://localhost:65432/ui`. The React app talks to the API via direct `fetch` and native `WebSocket` — no Electron IPC bridge.

**Tech Stack:** Node.js, Express, WS, Vite, React, TypeScript, Vitest, Playwright (e2e), Nx monorepo, tsup/esbuild.

---

## File Map

**Create:**
- `apps/web/` — new Nx Vite+React app (extracted from `apps/desktop/src/renderer/`)
- `apps/web/src/index.html`
- `apps/web/src/renderer.tsx`
- `apps/web/src/App.tsx` — rewritten to use `fetch` + native `WebSocket`
- `apps/web/src/apiClient.ts` — new: replaces `window.portswitch`
- `apps/web/src/theme.ts` — copied from desktop renderer
- `apps/web/src/components/MappingList.tsx` — copied
- `apps/web/src/components/StatusBar.tsx` — copied
- `apps/web/src/components/AddMappingDialog.tsx` — copied
- `apps/web/src/components/MappingList.test.tsx` — copied
- `apps/web/src/components/StatusBar.test.tsx` — copied
- `apps/web/src/components/AddMappingDialog.test.tsx` — copied
- `apps/web/vite.config.ts`
- `apps/web/tsconfig.json`
- `apps/web/tsconfig.app.json`
- `apps/web/tsconfig.spec.json`
- `apps/web/project.json`
- `apps/web/.eslintrc.json`
- `apps/web/package.json`
- `apps/cli/src/serve/server.ts` — adapted from `apps/daemon/src/server.ts`
- `apps/cli/src/serve/server.test.ts` — migrated from `apps/daemon/src/server.test.ts`
- `apps/cli/src/serve/server.hardening.test.ts` — migrated
- `apps/cli/src/serve/server.logs.test.ts` — migrated
- `apps/cli/src/serve/server.proxy.test.ts` — migrated
- `apps/cli/src/serve/store/mapping-store.ts` — copied
- `apps/cli/src/serve/store/mapping-store.test.ts` — migrated
- `apps/cli/src/serve/ws/event-bus.ts` — copied
- `apps/cli/src/serve/logging/logger.ts` — copied
- `apps/cli/src/serve/logging/logger.test.ts` — migrated
- `apps/cli/src/serve/config/config-store.ts` — copied
- `apps/cli/src/serve/routes/health.ts` — copied (import path updated)
- `apps/cli/src/serve/routes/mappings.ts` — copied (import path updated)
- `apps/cli/src/serve/routes/logs.ts` — copied (import path updated)
- `e2e/playwright.config.ts`
- `e2e/tests/portswitch.spec.ts`

**Modify:**
- `libs/shared/src/config/defaults.ts` — `DEFAULT_DAEMON_PORT = 65432`
- `apps/cli/src/client.ts` — default URL → `http://127.0.0.1:65432/api`
- `apps/cli/src/main.ts` — add `serve` command
- `apps/cli/src/main.test.ts` — update URL assertions
- `apps/cli/vite.config.ts` — add `@portswitch/proxy-core` alias
- `apps/cli/project.json` — add `web:build` dependency + `copy-ui` step
- `apps/cli/tsconfig.app.json` — no change needed (bundler handles serve/)
- `apps/desktop/src/main.ts` — full rewrite: thin health-check shell
- `apps/desktop/project.json` — drop `build-renderer`, simplify
- `nx.json` — update `defaultProject` from `daemon` to `cli`
- `package.json` — update scripts, add `@playwright/test`
- `CLAUDE.md` — update architecture section

**Delete:**
- `apps/daemon/` — entire directory
- `apps/desktop/src/preload.ts`
- `apps/desktop/src/ipc-handlers.ts`
- `apps/desktop/src/ipc-channels.ts`
- `apps/desktop/src/client.ts`
- `apps/desktop/src/main.test.ts` — replaced by thin shell (no unit tests worth keeping)
- `apps/desktop/vite.renderer.config.ts`
- `apps/desktop/src/renderer/` — entire directory (moved to apps/web/)

---

## Task 1: Update shared port constant

**Files:**
- Modify: `libs/shared/src/config/defaults.ts`

- [ ] **Step 1: Change DEFAULT_DAEMON_PORT to 65432**

```typescript
// libs/shared/src/config/defaults.ts
import { PortswitchConfig } from '../types/config';

export const DEFAULT_DAEMON_PORT = 65432;
export const CURRENT_SCHEMA_VERSION = 1;

export const DEFAULT_CONFIG: PortswitchConfig = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  daemon: {
    port: DEFAULT_DAEMON_PORT,
    logRetention: {
      maxFiles: 10,
      maxFileBytes: 5 * 1024 * 1024,
    },
  },
  mappings: [],
};
```

- [ ] **Step 2: Run shared tests to confirm no breakage**

```bash
npx nx test shared
```

Expected: all pass (no test references the port number directly).

- [ ] **Step 3: Commit**

```bash
git add libs/shared/src/config/defaults.ts
git commit -m "chore: update DEFAULT_DAEMON_PORT to 65432"
```

---

## Task 2: Create apps/web scaffold

**Files:**
- Create: `apps/web/package.json`, `apps/web/project.json`, `apps/web/.eslintrc.json`
- Create: `apps/web/tsconfig.json`, `apps/web/tsconfig.app.json`, `apps/web/tsconfig.spec.json`
- Create: `apps/web/vite.config.ts`

- [ ] **Step 1: Create apps/web/package.json**

```json
{
  "name": "@portswitch/web",
  "version": "0.0.1",
  "private": true
}
```

- [ ] **Step 2: Create apps/web/project.json**

```json
{
  "name": "web",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "apps/web/src",
  "projectType": "application",
  "root": "apps/web",
  "targets": {
    "build": {
      "executor": "nx:run-commands",
      "outputs": ["{workspaceRoot}/dist/apps/web"],
      "options": {
        "command": "npx vite build --config vite.config.ts",
        "cwd": "apps/web"
      }
    },
    "serve": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx vite --config vite.config.ts",
        "cwd": "apps/web"
      }
    },
    "test": {
      "executor": "@nx/vite:test",
      "outputs": ["{workspaceRoot}/coverage/apps/web"],
      "options": {
        "passWithNoTests": true,
        "config": "apps/web/vite.config.ts"
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint",
      "options": {
        "lintFilePatterns": ["apps/web/**/*.ts", "apps/web/**/*.tsx"]
      }
    },
    "typecheck": {
      "executor": "nx:run-commands",
      "options": {
        "command": "tsc -p tsconfig.app.json --noEmit",
        "cwd": "apps/web"
      }
    }
  },
  "tags": ["type:app", "scope:web"]
}
```

- [ ] **Step 3: Create apps/web/.eslintrc.json**

```json
{
  "extends": ["../../.eslintrc.json"],
  "ignorePatterns": ["!**/*"],
  "overrides": [
    {
      "files": ["*.ts", "*.tsx"],
      "rules": {}
    }
  ]
}
```

- [ ] **Step 4: Create apps/web/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "files": [],
  "include": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.spec.json" }
  ]
}
```

- [ ] **Step 5: Create apps/web/tsconfig.app.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/apps/web",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["**/*.spec.ts", "**/*.spec.tsx", "**/*.test.ts", "**/*.test.tsx", "vite.config.ts"]
}
```

- [ ] **Step 6: Create apps/web/tsconfig.spec.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/out-tsc/apps/web",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["node", "vitest/globals"]
  },
  "include": [
    "src/**/*.test.ts",
    "src/**/*.test.tsx",
    "src/**/*.spec.ts",
    "src/**/*.spec.tsx",
    "vite.config.ts"
  ]
}
```

- [ ] **Step 7: Create apps/web/vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  base: '/ui/',
  root: resolve(__dirname, 'src'),
  build: {
    outDir: resolve(__dirname, '../../dist/apps/web'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@portswitch/shared': resolve(__dirname, '../../libs/shared/src/index.ts'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:65432',
      '/api/v1/events': {
        target: 'ws://localhost:65432',
        ws: true,
        rewrite: (path) => path,
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environmentMatchGlobs: [['src/**/*.{test,spec}.tsx', 'jsdom']],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
    },
  },
});
```

- [ ] **Step 8: Commit scaffold**

```bash
git add apps/web/
git commit -m "feat(web): scaffold apps/web Nx Vite+React app"
```

---

## Task 3: Copy React source into apps/web/src/

**Files:**
- Create: `apps/web/src/index.html`, `apps/web/src/renderer.tsx`, `apps/web/src/theme.ts`
- Create: `apps/web/src/components/MappingList.tsx`, `MappingList.test.tsx`
- Create: `apps/web/src/components/StatusBar.tsx`, `StatusBar.test.tsx`
- Create: `apps/web/src/components/AddMappingDialog.tsx`, `AddMappingDialog.test.tsx`

- [ ] **Step 1: Copy source files from desktop renderer**

```bash
mkdir -p apps/web/src/components
cp apps/desktop/src/renderer/theme.ts apps/web/src/theme.ts
cp apps/desktop/src/renderer/renderer.tsx apps/web/src/renderer.tsx
cp apps/desktop/src/renderer/components/MappingList.tsx apps/web/src/components/
cp apps/desktop/src/renderer/components/MappingList.test.tsx apps/web/src/components/
cp apps/desktop/src/renderer/components/StatusBar.tsx apps/web/src/components/
cp apps/desktop/src/renderer/components/StatusBar.test.tsx apps/web/src/components/
cp apps/desktop/src/renderer/components/AddMappingDialog.tsx apps/web/src/components/
cp apps/desktop/src/renderer/components/AddMappingDialog.test.tsx apps/web/src/components/
```

- [ ] **Step 2: Create apps/web/src/index.html** (drop Electron CSP, allow script module)

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>portswitch</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: system-ui, -apple-system, sans-serif; background: #0f0f13; color: #e2e2e7; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./renderer.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Run component tests to verify they pass as-is**

```bash
npx nx test web
```

Expected: MappingList, StatusBar, AddMappingDialog tests all pass (they don't use `window.portswitch`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/
git commit -m "feat(web): copy React components and tests from desktop renderer"
```

---

## Task 4: Create apps/web/src/apiClient.ts and rewrite App.tsx

The current `App.tsx` uses `window.portswitch` (Electron IPC bridge). We replace it with a module-level `apiClient` that uses `fetch` and native `WebSocket`.

**Files:**
- Create: `apps/web/src/apiClient.ts`
- Create: `apps/web/src/App.tsx` (rewritten)

- [ ] **Step 1: Create apps/web/src/apiClient.ts**

```typescript
import type {
  HealthResponse,
  ListMappingsResponse,
  MappingResponse,
  CreateMappingRequest,
  PatchMappingRequest,
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

- [ ] **Step 2: Create apps/web/src/App.tsx** (same logic as desktop, swaps `window.portswitch` for `apiClient`)

```typescript
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CreateMappingRequest, HealthResponse, MappingResponse, PatchMappingRequest } from '@portswitch/shared';
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
  padding: '10px 16px',
  background: 'var(--toast-bg)',
  borderBottom: '1px solid var(--toast-border)',
  color: 'var(--danger)',
  fontSize: '13px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
};
const toastClose: React.CSSProperties = {
  background: 'transparent', border: 'none', color: 'var(--danger)',
  cursor: 'pointer', fontSize: '16px', padding: '0 4px',
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
  const [showDialog, setShowDialog] = useState(false);
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

  const refreshMappings = useCallback(async () => {
    try {
      const result = await apiClient.mappings.list();
      setMappings(result.mappings);
    } catch {
      // Mapping list failure is reflected by the daemon-unreachable status bar.
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void refreshMappings();
    }, WS_REFRESH_DEBOUNCE_MS);
  }, [refreshMappings]);

  const scheduleRefreshRef = useRef(scheduleRefresh);
  useEffect(() => { scheduleRefreshRef.current = scheduleRefresh; }, [scheduleRefresh]);

  useEffect(() => {
    void refreshHealth();
    void refreshMappings();
    const healthInterval = setInterval(() => void refreshHealth(), HEALTH_POLL_MS);
    const unsub = apiClient.events.subscribe(() => scheduleRefreshRef.current());
    return () => {
      clearInterval(healthInterval);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      unsub();
    };
  }, [refreshHealth, refreshMappings]);

  const handleToggle = async (id: string): Promise<void> => {
    try {
      const updated = await apiClient.mappings.toggle(id);
      setMappings((prev) => prev.map((m) => (m.id === id ? updated : m)));
    } catch (err) { setError(errorMessage(err)); }
  };

  const handleDelete = async (id: string): Promise<void> => {
    try {
      await apiClient.mappings.delete(id);
      setMappings((prev) => prev.filter((m) => m.id !== id));
    } catch (err) { setError(errorMessage(err)); }
  };

  const handleAdd = async (values: MappingDialogValues): Promise<void> => {
    const r: CreateMappingRequest = { ...values, enabled: false };
    try {
      const created = await apiClient.mappings.create(r);
      setMappings((prev) => [...prev, created]);
      setShowDialog(false);
    } catch (err) { setError(errorMessage(err)); }
  };

  const handleEditSave = async (values: MappingDialogValues): Promise<void> => {
    if (!editing) return;
    const patch: PatchMappingRequest = { ...values };
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
        mappings={mappings}
        onToggle={(id) => void handleToggle(id)}
        onDelete={(id) => void handleDelete(id)}
        onEdit={(m) => setEditing(m)}
        onAdd={() => setShowDialog(true)}
      />
      {showDialog && (
        <AddMappingDialog
          onConfirm={(values) => void handleAdd(values)}
          onCancel={() => setShowDialog(false)}
        />
      )}
      {editing && (
        <AddMappingDialog
          initial={editing}
          onConfirm={(values) => void handleEditSave(values)}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run web tests**

```bash
npx nx test web
```

Expected: all pass (component tests don't touch App.tsx or apiClient).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/apiClient.ts
git commit -m "feat(web): add apiClient using fetch+WebSocket, rewrite App.tsx"
```

---

## Task 5: Create apps/cli/src/serve/ — server code

Move daemon server code into the CLI. The key change: routes mount under `/api` instead of directly on the root Express app; the origin check allows the app's own origin; `/ui` serves static files.

**Files:**
- Create: `apps/cli/src/serve/store/mapping-store.ts`
- Create: `apps/cli/src/serve/ws/event-bus.ts`
- Create: `apps/cli/src/serve/logging/logger.ts`
- Create: `apps/cli/src/serve/config/config-store.ts`
- Create: `apps/cli/src/serve/routes/health.ts`
- Create: `apps/cli/src/serve/routes/mappings.ts`
- Create: `apps/cli/src/serve/routes/logs.ts`
- Create: `apps/cli/src/serve/server.ts`

- [ ] **Step 1: Copy unchanged internal modules**

```bash
mkdir -p apps/cli/src/serve/store apps/cli/src/serve/ws apps/cli/src/serve/logging apps/cli/src/serve/config apps/cli/src/serve/routes
cp apps/daemon/src/store/mapping-store.ts apps/cli/src/serve/store/
cp apps/daemon/src/ws/event-bus.ts apps/cli/src/serve/ws/
cp apps/daemon/src/logging/logger.ts apps/cli/src/serve/logging/
cp apps/daemon/src/config/config-store.ts apps/cli/src/serve/config/
```

- [ ] **Step 2: Create apps/cli/src/serve/routes/health.ts** (update import)

```typescript
import { Router } from 'express';
import { DaemonContext } from '../server';

export function createHealthRouter(ctx: DaemonContext): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({
      status: 'ok',
      version: ctx.version,
      uptimeMs: Date.now() - ctx.startedAt,
    });
  });

  return router;
}
```

- [ ] **Step 3: Create apps/cli/src/serve/routes/mappings.ts** (update import only)

```typescript
import { Router, Request, Response } from 'express';
import {
  ApiError,
  ErrorCode,
  ERROR_HTTP_STATUS,
  CreateMappingRequestSchema,
  PatchMappingRequestSchema,
  BulkRequestSchema,
} from '@portswitch/shared';
import { MappingResponse } from '@portswitch/shared';
import { DaemonContext } from '../server';

function sendApiError(res: Response, err: unknown): void {
  if (err instanceof ApiError) {
    res.status(ERROR_HTTP_STATUS[err.code]).json(err.toResponse());
  } else {
    res.status(500).json(new ApiError(ErrorCode.INTERNAL, 'Unexpected error').toResponse());
  }
}

export function createMappingRoutes(ctx: DaemonContext): Router {
  const router = Router();
  const { store, eventBus, persist, startForwarding, stopForwarding, liveStats } = ctx;

  function withLiveStats(m: MappingResponse): MappingResponse {
    const s = liveStats(m.id);
    return s ? { ...m, stats: s } : m;
  }

  router.get('/', (_req, res) => {
    res.json({ mappings: store.list().map(withLiveStats) });
  });

  router.post('/bulk', async (req: Request, res: Response) => {
    const result = BulkRequestSchema.safeParse(req.body);
    if (!result.success) {
      return sendApiError(res, new ApiError(ErrorCode.VALIDATION, 'Invalid bulk request body'));
    }
    const prevEnabledMap = new Map(store.list().map((m) => [m.id, m.enabled]));
    const results = store.bulk(result.data.operations);
    persist();
    const forwardingOps: Array<Promise<void>> = [];
    result.data.operations.forEach((op, i) => {
      const item = results[i];
      if (!item?.ok) return;
      if (op.op === 'create') {
        if (item.mapping?.enabled) forwardingOps.push(startForwarding(item.mapping.id));
      } else if (op.op === 'update') {
        if (!item.mapping) return;
        if (item.mapping.enabled) {
          forwardingOps.push(startForwarding(item.mapping.id));
        } else {
          forwardingOps.push(stopForwarding(item.mapping.id));
        }
      } else if (op.op === 'delete') {
        forwardingOps.push(stopForwarding(op.id));
      }
    });
    await Promise.all(forwardingOps);
    result.data.operations.forEach((op, i) => {
      const item = results[i];
      if (!item?.ok) return;
      if (op.op === 'create') {
        const mapping = (item.mapping && store.get(item.mapping.id)) ?? item.mapping;
        if (!mapping) return;
        eventBus.broadcast({ type: 'mapping.created', payload: { mapping } });
      } else if (op.op === 'update') {
        if (!item.mapping) return;
        const mapping = store.get(item.mapping.id) ?? item.mapping;
        eventBus.broadcast({
          type: 'mapping.updated',
          payload: { mapping, previousEnabled: prevEnabledMap.get(mapping.id) ?? false },
        });
      } else if (op.op === 'delete') {
        eventBus.broadcast({ type: 'mapping.deleted', payload: { id: op.id } });
      }
    });
    res.json({ results });
  });

  router.post('/', async (req: Request, res: Response) => {
    const result = CreateMappingRequestSchema.safeParse(req.body);
    if (!result.success) {
      return sendApiError(res, new ApiError(ErrorCode.VALIDATION, 'Invalid request body', { issues: result.error.issues }));
    }
    try {
      const mapping = store.create(result.data);
      persist();
      eventBus.broadcast({ type: 'mapping.created', payload: { mapping } });
      if (mapping.enabled) await startForwarding(mapping.id);
      res.status(201).json(store.get(mapping.id) ?? mapping);
    } catch (err) {
      sendApiError(res, err);
    }
  });

  router.get('/:id', (req, res) => {
    const mapping = store.get(req.params['id'] ?? '');
    if (!mapping) return sendApiError(res, new ApiError(ErrorCode.NOT_FOUND, `Mapping not found.`));
    res.json(withLiveStats(mapping));
  });

  router.patch('/:id', async (req: Request, res: Response) => {
    const result = PatchMappingRequestSchema.safeParse(req.body);
    if (!result.success) {
      return sendApiError(res, new ApiError(ErrorCode.VALIDATION, 'Invalid patch body', { issues: result.error.issues }));
    }
    try {
      const id = req.params['id'] ?? '';
      const previous = store.get(id);
      const mapping = store.update(id, result.data);
      persist();
      eventBus.broadcast({ type: 'mapping.updated', payload: { mapping, previousEnabled: previous?.enabled ?? mapping.enabled } });
      const wasEnabled = previous?.enabled ?? false;
      const nowEnabled = mapping.enabled;
      if (nowEnabled) {
        await startForwarding(id);
      } else if (wasEnabled) {
        await stopForwarding(id);
      }
      res.json(store.get(id) ?? mapping);
    } catch (err) {
      sendApiError(res, err);
    }
  });

  router.delete('/:id', async (req: Request, res: Response) => {
    const id = req.params['id'] ?? '';
    try {
      await stopForwarding(id);
      store.delete(id);
      persist();
      eventBus.broadcast({ type: 'mapping.deleted', payload: { id } });
      res.status(204).send();
    } catch (err) {
      sendApiError(res, err);
    }
  });

  router.post('/:id/toggle', async (req: Request, res: Response) => {
    const id = req.params['id'] ?? '';
    try {
      const previous = store.get(id);
      const mapping = store.toggle(id);
      persist();
      eventBus.broadcast({ type: 'mapping.updated', payload: { mapping, previousEnabled: previous?.enabled ?? !mapping.enabled } });
      if (mapping.enabled) {
        await startForwarding(id);
      } else {
        await stopForwarding(id);
      }
      res.json(store.get(id) ?? mapping);
    } catch (err) {
      sendApiError(res, err);
    }
  });

  return router;
}
```

- [ ] **Step 4: Create apps/cli/src/serve/routes/logs.ts** (update import)

```typescript
import { Router, Request, Response } from 'express';
import * as fs from 'fs/promises';
import { LogEntry } from '@portswitch/shared';
import { Logger } from '../logging/logger';
import { DaemonContext } from '../server';

async function readEntriesFromFile(filePath: string): Promise<LogEntry[]> {
  const raw = await fs.readFile(filePath, 'utf-8').catch(() => '');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line) as LogEntry; }
      catch { return null; }
    })
    .filter((e): e is LogEntry => e !== null);
}

export function createLogsRouter(ctx: DaemonContext): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    const from = typeof req.query['from'] === 'string' ? req.query['from'] : undefined;
    const mappingId = typeof req.query['mappingId'] === 'string' ? req.query['mappingId'] : undefined;
    const rawLimit = parseInt(typeof req.query['limit'] === 'string' ? req.query['limit'] : '200', 10);
    const limit = Math.min(isNaN(rawLimit) ? 200 : rawLimit, 1000);

    const filePaths = Logger.logFilePaths(ctx.logPath, ctx.daemonConfig.logRetention.maxFiles);
    let entries: LogEntry[] = [];
    for (const fp of filePaths) {
      const fileEntries = await readEntriesFromFile(fp);
      entries.push(...fileEntries);
    }
    if (from) entries = entries.filter((e) => e.ts > from);
    if (mappingId) entries = entries.filter((e) => e.mappingId === mappingId);
    res.json({ entries: entries.slice(-limit) });
  });

  return router;
}

export function diagnosticsHandler(ctx: DaemonContext) {
  return (_req: unknown, res: { json: (body: unknown) => void }) => {
    const listeningMappings = ctx.store.list().filter((m) => m.status === 'listening').length;
    res.json({
      daemonVersion: ctx.version,
      pid: process.pid,
      platform: process.platform,
      uptimeMs: Date.now() - ctx.startedAt,
      configFilePath: ctx.configPath,
      logFilePath: ctx.logPath,
      listeningMappings,
    });
  };
}
```

- [ ] **Step 5: Create apps/cli/src/serve/server.ts** (adapted: /api prefix, /ui static, origin check)

```typescript
import * as http from 'http';
import * as net from 'net';
import * as path from 'path';
import express from 'express';
import { WebSocketServer, WebSocket as WsSocket } from 'ws';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PKG_VERSION: string = (require(path.join(__dirname, '../../../package.json')) as { version: string }).version;
import {
  resolveConfigPath,
  resolveLogPath,
  PortswitchConfig,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_DAEMON_PORT,
  ErrorCode,
} from '@portswitch/shared';
import { createForwarder, ForwarderHandle } from '@portswitch/proxy-core';
import { InMemoryMappingStore } from './store/mapping-store';
import { EventBus } from './ws/event-bus';
import { Logger } from './logging/logger';
import { loadConfig, saveConfig, watchConfig, debounce } from './config/config-store';
import { createHealthRouter } from './routes/health';
import { createMappingRoutes } from './routes/mappings';
import { createLogsRouter, diagnosticsHandler } from './routes/logs';

export interface DaemonContext {
  store: InMemoryMappingStore;
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

export interface DaemonOptions {
  port?: number;
  configPath?: string;
  logPath?: string;
  uiDir?: string;
}

export interface DaemonHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly port: number;
  readonly httpServer: http.Server;
  readonly configPath: string;
}

export function createDaemon(opts: DaemonOptions = {}): DaemonHandle {
  const configPath = opts.configPath ?? resolveConfigPath();
  const logPath = opts.logPath ?? resolveLogPath();
  const bindPort = opts.port ?? DEFAULT_DAEMON_PORT;
  const uiDir = opts.uiDir ?? path.join(__dirname, 'ui');
  const startedAt = Date.now();

  const store = new InMemoryMappingStore();
  const eventBus = new EventBus(PKG_VERSION);
  const forwarders = new Map<string, ForwarderHandle>();
  const forwarderLocks = new Map<string, Promise<void>>();

  function withForwarderLock(id: string, fn: () => Promise<void>): Promise<void> {
    const prev = forwarderLocks.get(id) ?? Promise.resolve();
    const next = prev.then(fn).finally(() => {
      if (forwarderLocks.get(id) === next) forwarderLocks.delete(id);
    });
    forwarderLocks.set(id, next);
    return next;
  }

  let currentDaemonConfig: PortswitchConfig['daemon'] = {
    port: bindPort,
    logRetention: { maxFiles: 10, maxFileBytes: 5 * 1024 * 1024 },
  };

  const logger = new Logger({
    logDir: logPath,
    maxFileBytes: currentDaemonConfig.logRetention.maxFileBytes,
    maxFiles: currentDaemonConfig.logRetention.maxFiles,
    onEntry: (entry) => eventBus.broadcastLog(entry),
  });

  async function flushConfig(): Promise<void> {
    const config: PortswitchConfig = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      daemon: currentDaemonConfig,
      mappings: store.toConfigs(),
    };
    await saveConfig(configPath, config);
  }

  const persist = debounce(flushConfig, 50);

  async function startForwardingImpl(id: string): Promise<void> {
    const mapping = store.get(id);
    if (!mapping) return;
    const existing = forwarders.get(id);
    if (existing) {
      await existing.stop();
      forwarders.delete(id);
    }
    const handle = createForwarder({
      sourceHost: mapping.sourceHost,
      sourcePort: mapping.sourcePort,
      targetHost: mapping.targetHost,
      targetPort: mapping.targetPort,
      drainTimeoutMs: 30000,
    });
    try {
      await handle.start();
      forwarders.set(id, handle);
      store.setListening(id);
      logger.info('mapping', 'listenerBound', {
        sourceHost: mapping.sourceHost, sourcePort: mapping.sourcePort,
        targetHost: mapping.targetHost, targetPort: mapping.targetPort,
      }, id);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'EADDRINUSE') {
        store.setError(id, ErrorCode.EADDRINUSE, `Port ${mapping.sourcePort} is already in use.`);
      } else if (e.code === 'EACCES' && mapping.sourcePort < 1024) {
        store.setError(id, ErrorCode.EACCES_PRIVILEGED_PORT, `Port ${mapping.sourcePort} requires elevated privileges.`);
      } else if (e.code === 'EACCES') {
        store.setError(id, ErrorCode.EACCES, `Permission denied binding to port ${mapping.sourcePort}.`);
      } else {
        store.setError(id, ErrorCode.INTERNAL, e.message);
      }
      logger.error('mapping', 'listenerError', e, { sourcePort: mapping.sourcePort, code: e.code }, id);
    }
    eventBus.broadcast({
      type: 'mapping.status',
      payload: { id, status: store.get(id)?.status ?? 'error', error: store.get(id)?.error },
    });
  }

  async function stopForwardingImpl(id: string): Promise<void> {
    const handle = forwarders.get(id);
    if (!handle) return;
    forwarders.delete(id);
    await handle.stop();
    if (store.get(id)) {
      store.setDisabled(id);
      eventBus.broadcast({ type: 'mapping.status', payload: { id, status: 'disabled' } });
      logger.info('mapping', 'listenerUnbound', {}, id);
    }
  }

  function startForwarding(id: string): Promise<void> {
    return withForwarderLock(id, () => startForwardingImpl(id));
  }
  function stopForwarding(id: string): Promise<void> {
    return withForwarderLock(id, () => stopForwardingImpl(id));
  }
  function liveStats(id: string) {
    return forwarders.get(id)?.stats();
  }

  const ctx: DaemonContext = {
    store, eventBus, logger, startedAt, version: PKG_VERSION,
    configPath, logPath,
    get daemonConfig() { return currentDaemonConfig; },
    persist, startForwarding, stopForwarding, liveStats,
  };

  const app = express();
  app.disable('x-powered-by');

  // Allow same-origin requests (UI at /ui, API at /api, same port).
  // Block cross-origin to prevent DNS-rebinding.
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const origin = req.headers['origin'];
    if (
      origin !== undefined &&
      origin !== `http://localhost:${bindPort}` &&
      origin !== `http://127.0.0.1:${bindPort}`
    ) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cross-origin requests are not allowed.' } });
      return;
    }
    next();
  });

  app.use(express.json({ limit: '64kb' }));

  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const t0 = Date.now();
    res.on('finish', () => {
      logger.debug('api', 'request', { method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - t0 });
    });
    next();
  });

  // Mount all API routes under /api
  const apiRouter = express.Router();
  apiRouter.use('/v1/health', createHealthRouter(ctx));
  apiRouter.use('/v1/mappings', createMappingRoutes(ctx));
  apiRouter.use('/v1/logs', createLogsRouter(ctx));
  apiRouter.get('/v1/diagnostics', diagnosticsHandler(ctx) as express.RequestHandler);
  app.use('/api', apiRouter);

  // Serve the React UI at /ui
  app.use('/ui', express.static(uiDir, { index: 'index.html' }));
  app.get('/ui/*', (_req, res) => res.sendFile(path.join(uiDir, 'index.html')));
  app.get('/', (_req, res) => res.redirect('/ui'));

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if ((err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid JSON body' } });
    } else {
      res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
    }
  });

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/api/v1/events' });

  type TrackedSocket = WsSocket & { _pingSent?: boolean };

  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const ext = ws as TrackedSocket;
      if (ext._pingSent) { ws.terminate(); return; }
      ext._pingSent = true;
      ws.ping();
      ws.once('pong', () => { ext._pingSent = false; });
    });
  }, 30_000);

  wss.on('connection', (ws) => {
    (ws as TrackedSocket)._pingSent = false;
    eventBus.addClient(ws, store.list());
    logger.debug('api', 'wsConnected', { clients: eventBus.clientCount() });
    ws.once('close', () => {
      logger.debug('api', 'wsDisconnected', { clients: eventBus.clientCount() });
    });
  });

  let stopWatcher: (() => void) | null = null;
  let stopped = false;

  return {
    async start(): Promise<void> {
      await logger.open();
      logger.info('daemon', 'startup', { version: PKG_VERSION, configPath, logPath });
      const config = await loadConfig(configPath);
      currentDaemonConfig = config.daemon;
      store.hydrate(config.mappings);
      logger.info('config', 'loaded', { configPath, mappings: config.mappings.length });
      await Promise.all(store.list().filter((m) => m.enabled).map((m) => startForwarding(m.id)));

      stopWatcher = watchConfig(configPath, (reloaded) => {
        const prevList = store.list();
        const prevIds = new Set(prevList.map((m) => m.id));
        const prevEnabled = new Set(prevList.filter((m) => m.enabled).map((m) => m.id));
        currentDaemonConfig = reloaded.daemon;
        store.hydrate(reloaded.mappings);
        for (const [id] of forwarders) store.setListening(id);
        const next = store.list();
        const nextIds = new Set(next.map((m) => m.id));
        const nextEnabled = new Set(next.filter((m) => m.enabled).map((m) => m.id));
        const toStop = [...prevEnabled].filter((id) => !nextEnabled.has(id));
        const toStart = next.filter((m) => m.enabled && !prevEnabled.has(m.id));
        const deleted = [...prevIds].filter((id) => !nextIds.has(id));
        void Promise.all([...[...toStop, ...deleted].map((id) => stopForwarding(id))])
          .then(() => Promise.all(toStart.map((m) => startForwarding(m.id))));
        logger.info('config', 'externalEditDetected', { configPath });
        eventBus.broadcast({ type: 'hello', payload: { serverVersion: PKG_VERSION, snapshot: { mappings: next } } });
      });

      await new Promise<void>((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(bindPort, '127.0.0.1', () => {
          httpServer.off('error', reject);
          const addr = httpServer.address() as net.AddressInfo;
          logger.info('daemon', 'apiBound', { host: '127.0.0.1', port: addr.port });
          resolve();
        });
      });
    },

    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      clearInterval(pingInterval);
      logger.info('daemon', 'shutdown', { reason: 'stop' });
      eventBus.broadcast({ type: 'daemon.shutdown', payload: { reason: 'stop' } });
      if (stopWatcher) { stopWatcher(); stopWatcher = null; }
      await persist.flush();
      await Promise.all(Array.from(forwarders.keys()).map((id) => stopForwarding(id)));
      wss.clients.forEach((ws) => ws.terminate());
      await new Promise<void>((resolve, reject) => {
        wss.close((err) => (err ? reject(err) : resolve()));
      });
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      await logger.close();
    },

    get port(): number {
      const addr = httpServer.address();
      if (!addr || typeof addr === 'string') throw new Error('Daemon is not listening');
      return addr.port;
    },
    httpServer,
    configPath,
  };
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/serve/
git commit -m "feat(cli): add serve/ with daemon server code mounted under /api"
```

---

## Task 6: Update CLI vite.config.ts and add serve command

**Files:**
- Modify: `apps/cli/vite.config.ts`
- Modify: `apps/cli/src/client.ts`
- Modify: `apps/cli/src/main.ts`

- [ ] **Step 1: Update apps/cli/vite.config.ts** (add proxy-core alias for tests)

```typescript
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@portswitch/shared': new URL('../../libs/shared/src/index.ts', import.meta.url).pathname,
      '@portswitch/proxy-core': new URL('../../libs/proxy-core/src/index.ts', import.meta.url).pathname,
      '@portswitch/service-mgr': new URL('../../libs/service-mgr/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
    },
  },
});
```

- [ ] **Step 2: Update apps/cli/src/client.ts** — change default URL to include /api base

Replace the `DEFAULT_DAEMON_PORT` usage for the URL so the client automatically prefixes `/api`. The cleanest approach: change `DEFAULT_URL` to include `/api` and leave all route paths unchanged (`/v1/health` etc. are appended to it).

```typescript
import {
  ErrorCode,
  DEFAULT_DAEMON_PORT,
  type ApiErrorBody,
  type MappingResponse,
  type ListMappingsResponse,
  type CreateMappingRequest,
  type PatchMappingRequest,
  type HealthResponse,
  type DiagnosticsResponse,
  type LogEntry,
} from '@portswitch/shared';

export const DEFAULT_URL = `http://127.0.0.1:${DEFAULT_DAEMON_PORT}/api`;

export class DaemonUnreachableError extends Error {
  constructor(cause?: unknown) {
    super(cause instanceof Error ? cause.message : 'Cannot reach daemon');
    this.name = 'DaemonUnreachableError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DaemonApiError extends Error {
  readonly statusCode: number;
  readonly body: ApiErrorBody;

  constructor(statusCode: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'DaemonApiError';
    this.statusCode = statusCode;
    this.body = body;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DaemonClient {
  readonly baseUrl: string;
  readonly wsUrl: string;

  constructor(httpUrl: string = DEFAULT_URL) {
    this.baseUrl = httpUrl.replace(/\/$/, '');
    this.wsUrl = this.baseUrl.replace(/^http/, 'ws').replace('/api', '') + '/api/v1/events';
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new DaemonUnreachableError(err);
    }
    if (!res.ok) {
      let errBody: ApiErrorBody;
      try {
        const j = (await res.json()) as { error: ApiErrorBody };
        errBody = j.error;
      } catch {
        errBody = { code: ErrorCode.INTERNAL, message: res.statusText };
      }
      throw new DaemonApiError(res.status, errBody);
    }
    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
  }

  listMappings() { return this.req<ListMappingsResponse>('GET', '/v1/mappings'); }
  getMapping(id: string) { return this.req<MappingResponse>('GET', `/v1/mappings/${id}`); }
  createMapping(req: CreateMappingRequest) { return this.req<MappingResponse>('POST', '/v1/mappings', req); }
  patchMapping(id: string, req: PatchMappingRequest) { return this.req<MappingResponse>('PATCH', `/v1/mappings/${id}`, req); }
  deleteMapping(id: string) { return this.req<void>('DELETE', `/v1/mappings/${id}`); }
  toggleMapping(id: string) { return this.req<MappingResponse>('POST', `/v1/mappings/${id}/toggle`); }
  health() { return this.req<HealthResponse>('GET', '/v1/health'); }
  diagnostics() { return this.req<DiagnosticsResponse>('GET', '/v1/diagnostics'); }
  logs(params?: { from?: string; limit?: number; mappingId?: string }) {
    const qs = new URLSearchParams();
    if (params?.from) qs.set('from', params.from);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    if (params?.mappingId) qs.set('mappingId', params.mappingId);
    const q = qs.toString();
    return this.req<{ entries: LogEntry[] }>('GET', `/v1/logs${q ? '?' + q : ''}`);
  }
}
```

- [ ] **Step 3: Add `serve` command to apps/cli/src/main.ts**

Add before the `if (!process.env['VITEST'])` block at the bottom. Insert after the `completion` command:

```typescript
  // serve — start daemon + static UI server
  program
    .command('serve')
    .description('Start the portswitch daemon and web UI server')
    .option('-p, --port <port>', 'port to listen on', String(DEFAULT_DAEMON_PORT))
    .action(async (opts: { port: string }) => {
      const { createDaemon } = await import('./serve/server');
      const port = parseInt(opts.port, 10);
      const daemon = createDaemon({ port });

      process.on('unhandledRejection', (reason) => {
        console.error('Unhandled rejection:', reason);
        process.exit(1);
      });

      process.on('uncaughtException', (err) => {
        console.error('Uncaught exception:', err);
        process.exit(1);
      });

      await daemon.start();
      console.log(`portswitch daemon listening on http://127.0.0.1:${daemon.port}/api`);
      console.log(`web UI available at http://127.0.0.1:${daemon.port}/ui`);
      console.log(`config: ${daemon.configPath}`);

      const shutdown = () => {
        daemon.stop().then(() => process.exit(0)).catch(() => process.exit(1));
      };
      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
    });
```

Also add the import at the top of main.ts (after existing imports):

```typescript
import { DEFAULT_DAEMON_PORT } from '@portswitch/shared';
```

- [ ] **Step 4: Run CLI tests to catch any URL assertion failures**

```bash
npx nx test cli
```

Expected: tests related to URL may fail because they assert `/v1/mappings` against the old default URL. Fix any failures by updating URL assertions in `apps/cli/src/main.test.ts` to use the new `DEFAULT_URL` (`http://127.0.0.1:65432/api`).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/client.ts apps/cli/src/main.ts apps/cli/vite.config.ts
git commit -m "feat(cli): add serve command, update DaemonClient to /api prefix"
```

---

## Task 7: Migrate daemon integration tests to apps/cli/src/serve/

**Files:**
- Create: `apps/cli/src/serve/server.test.ts`
- Create: `apps/cli/src/serve/server.hardening.test.ts`
- Create: `apps/cli/src/serve/server.logs.test.ts`
- Create: `apps/cli/src/serve/server.proxy.test.ts`
- Create: `apps/cli/src/serve/store/mapping-store.test.ts`
- Create: `apps/cli/src/serve/logging/logger.test.ts`

- [ ] **Step 1: Copy test files with updated imports**

```bash
# Copy the test files
cp apps/daemon/src/server.test.ts apps/cli/src/serve/server.test.ts
cp apps/daemon/src/server.hardening.test.ts apps/cli/src/serve/server.hardening.test.ts
cp apps/daemon/src/server.logs.test.ts apps/cli/src/serve/server.logs.test.ts
cp apps/daemon/src/server.proxy.test.ts apps/cli/src/serve/server.proxy.test.ts
cp apps/daemon/src/store/mapping-store.test.ts apps/cli/src/serve/store/mapping-store.test.ts
cp apps/daemon/src/logging/logger.test.ts apps/cli/src/serve/logging/logger.test.ts
```

- [ ] **Step 2: Fix imports in all migrated test files**

In each test file, the import `from './server'` already works (same relative path). But tests that reference `from '../server'` (store tests etc.) need updating. Also update the WS path in tests from `/v1/events` to `/api/v1/events`, and API paths from `/v1/health` to `/api/v1/health`, etc.

In `apps/cli/src/serve/server.test.ts` — update every route path:
- `'/v1/health'` → `'/api/v1/health'`
- `'/v1/mappings'` → `'/api/v1/mappings'`
- `'/v1/logs'` → `'/api/v1/logs'`
- `'/v1/diagnostics'` → `'/api/v1/diagnostics'`
- `ws://127.0.0.1:${port}/v1/events` → `ws://127.0.0.1:${port}/api/v1/events`

Run this sed across all server tests:
```bash
sed -i "s|/v1/health|/api/v1/health|g; s|/v1/mappings|/api/v1/mappings|g; s|/v1/logs|/api/v1/logs|g; s|/v1/diagnostics|/api/v1/diagnostics|g; s|/v1/events|/api/v1/events|g" \
  apps/cli/src/serve/server.test.ts \
  apps/cli/src/serve/server.hardening.test.ts \
  apps/cli/src/serve/server.logs.test.ts \
  apps/cli/src/serve/server.proxy.test.ts
```

- [ ] **Step 3: Run migrated tests**

```bash
npx nx test cli
```

Expected: all server integration tests pass (they use `port: 0` so no conflict with real port). Fix any remaining import path issues.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/serve/
git commit -m "test(cli): migrate daemon integration tests to apps/cli/src/serve/"
```

---

## Task 8: Update apps/cli/project.json to depend on web build and copy UI files

**Files:**
- Modify: `apps/cli/project.json`

- [ ] **Step 1: Update apps/cli/project.json**

```json
{
  "name": "cli",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "apps/cli/src",
  "projectType": "application",
  "root": "apps/cli",
  "targets": {
    "build": {
      "executor": "@nx/esbuild:esbuild",
      "outputs": ["{options.outputPath}"],
      "dependsOn": ["web:build"],
      "options": {
        "main": "apps/cli/src/main.ts",
        "outputPath": "dist/apps/cli",
        "tsConfig": "apps/cli/tsconfig.app.json",
        "platform": "node",
        "format": ["cjs"],
        "bundle": true,
        "additionalEntryPoints": []
      }
    },
    "copy-ui": {
      "executor": "nx:run-commands",
      "options": {
        "command": "cp -r dist/apps/web dist/apps/cli/ui",
        "cwd": "{workspaceRoot}"
      }
    },
    "build-with-ui": {
      "executor": "nx:run-commands",
      "dependsOn": ["build", "copy-ui"],
      "options": {
        "command": "echo 'CLI build with UI complete'",
        "cwd": "{workspaceRoot}"
      }
    },
    "test": {
      "executor": "@nx/vite:test",
      "outputs": ["{workspaceRoot}/coverage/apps/cli"],
      "options": {
        "passWithNoTests": true,
        "config": "apps/cli/vite.config.ts"
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint",
      "options": {
        "lintFilePatterns": ["apps/cli/**/*.ts"]
      }
    },
    "typecheck": {
      "executor": "nx:run-commands",
      "options": {
        "command": "tsc -p tsconfig.app.json --noEmit",
        "cwd": "apps/cli"
      }
    }
  },
  "tags": ["type:app", "scope:cli"]
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/project.json
git commit -m "build(cli): add web:build dependency and copy-ui target"
```

---

## Task 9: Simplify apps/desktop Electron main

**Files:**
- Modify: `apps/desktop/src/main.ts` (full rewrite)
- Modify: `apps/desktop/project.json`
- Delete: `apps/desktop/src/preload.ts`, `ipc-handlers.ts`, `ipc-channels.ts`, `client.ts`, `main.test.ts`
- Delete: `apps/desktop/vite.renderer.config.ts`

- [ ] **Step 1: Rewrite apps/desktop/src/main.ts**

```typescript
import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import * as http from 'http';
import { spawn, ChildProcess } from 'child_process';

app.setAppUserModelId('com.portswitch.app');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const UI_URL = 'http://localhost:65432/ui';
const HEALTH_URL = 'http://127.0.0.1:65432/api/v1/health';
const isDev = process.env['NODE_ENV'] !== 'production';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let daemonProcess: ChildProcess | null = null;

function checkHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_URL, { timeout: 2000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function spawnDaemon(): void {
  const bin = isDev
    ? path.join(__dirname, '../../../dist/apps/cli/main.js')
    : path.join(process.resourcesPath, 'portswitch');
  const args = isDev ? ['serve'] : ['serve'];
  daemonProcess = spawn(isDev ? process.execPath : bin, isDev ? [bin, ...args] : args, {
    detached: false,
    stdio: 'ignore',
  });
  daemonProcess.unref();
}

async function waitForDaemon(maxMs = 10_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await checkHealth()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    title: 'portswitch',
    show: false,
  });
  win.loadURL(UI_URL).catch(() => undefined);
  win.once('ready-to-show', () => win.show());
  win.on('close', (e) => { e.preventDefault(); win.hide(); });
  return win;
}

function createTray(win: BrowserWindow): Tray {
  const icon = nativeImage.createEmpty();
  const t = new Tray(icon);
  const updateMenu = () => {
    const menu = Menu.buildFromTemplate([
      {
        label: win.isVisible() ? 'Hide portswitch' : 'Show portswitch',
        click: () => { win.isVisible() ? win.hide() : (win.show(), win.focus()); updateMenu(); },
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]);
    t.setContextMenu(menu);
  };
  updateMenu();
  t.setToolTip('portswitch');
  t.on('click', () => { win.isVisible() ? win.hide() : (win.show(), win.focus()); updateMenu(); });
  return t;
}

app.whenReady().then(async () => {
  const healthy = await checkHealth();
  if (!healthy) {
    spawnDaemon();
    const ready = await waitForDaemon();
    if (!ready) {
      const { dialog } = await import('electron');
      const { response } = await dialog.showMessageBox({
        type: 'error',
        title: 'portswitch',
        message: 'Could not start the portswitch daemon.',
        buttons: ['Retry', 'Quit'],
      });
      if (response === 0) {
        app.relaunch();
      }
      app.quit();
      return;
    }
  }

  mainWindow = createWindow();
  tray = createTray(mainWindow);

  app.on('second-instance', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });

  app.on('activate', () => {
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
  });
});

app.on('window-all-closed', () => { /* quit via tray only */ });

app.on('before-quit', () => {
  if (mainWindow) mainWindow.removeAllListeners('close');
  tray?.destroy();
  tray = null;
  daemonProcess?.kill();
  daemonProcess = null;
});
```

- [ ] **Step 2: Delete dead desktop files**

```bash
rm apps/desktop/src/preload.ts
rm apps/desktop/src/ipc-handlers.ts
rm apps/desktop/src/ipc-channels.ts
rm apps/desktop/src/client.ts
rm apps/desktop/src/main.test.ts
rm apps/desktop/vite.renderer.config.ts
```

- [ ] **Step 3: Update apps/desktop/project.json** (remove renderer build, simplify)

```json
{
  "name": "desktop",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "apps/desktop/src",
  "projectType": "application",
  "root": "apps/desktop",
  "targets": {
    "build": {
      "executor": "nx:run-commands",
      "outputs": ["{workspaceRoot}/dist/apps/desktop/main"],
      "options": {
        "command": "npx tsup src/main.ts --outDir ../../dist/apps/desktop/main --format cjs --no-splitting --external electron --tsconfig tsconfig.app.json",
        "cwd": "apps/desktop"
      }
    },
    "package": {
      "executor": "nx:run-commands",
      "outputs": ["{workspaceRoot}/dist/apps/desktop/release"],
      "dependsOn": ["build"],
      "options": {
        "command": "npx electron-builder --config electron-builder.config.json",
        "cwd": "apps/desktop"
      }
    },
    "test": {
      "executor": "@nx/vite:test",
      "outputs": ["{workspaceRoot}/coverage/apps/desktop"],
      "options": {
        "passWithNoTests": true,
        "config": "apps/desktop/vite.config.ts"
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint",
      "options": {
        "lintFilePatterns": ["apps/desktop/**/*.ts"]
      }
    },
    "typecheck": {
      "executor": "nx:run-commands",
      "options": {
        "command": "tsc -p tsconfig.app.json --noEmit",
        "cwd": "apps/desktop"
      }
    }
  },
  "tags": ["type:app", "scope:desktop"]
}
```

- [ ] **Step 4: Update apps/desktop/tsconfig.app.json** (remove renderer types, jsx)

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/apps/desktop",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["**/*.spec.ts", "**/*.test.ts", "vite.config.ts"]
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/
git commit -m "feat(desktop): simplify Electron to thin health-check shell, remove IPC"
```

---

## Task 10: Delete apps/daemon and clean up apps/desktop/src/renderer/

**Files:**
- Delete: `apps/daemon/` (entire directory)
- Delete: `apps/desktop/src/renderer/` (moved to apps/web/)

- [ ] **Step 1: Remove daemon app**

```bash
rm -rf apps/daemon
```

- [ ] **Step 2: Remove desktop renderer (moved to apps/web)**

```bash
rm -rf apps/desktop/src/renderer
```

- [ ] **Step 3: Update nx.json** — change defaultProject from daemon to cli

In `nx.json`, change `"defaultProject": "daemon"` to `"defaultProject": "cli"`.

- [ ] **Step 4: Update package.json scripts**

Replace old daemon/desktop scripts with new ones:

```json
{
  "scripts": {
    "nx": "nx",
    "build": "nx run-many -t build",
    "test": "nx run-many -t test",
    "lint": "nx run-many -t lint",
    "typecheck": "nx run-many -t typecheck",
    "serve": "npx nx run cli:build && node dist/apps/cli/main.js serve",
    "serve:watch": "npx tsup apps/cli/src/main.ts --outDir dist/apps/cli --platform node --format cjs --tsconfig apps/cli/tsconfig.app.json --watch --onSuccess \"node dist/apps/cli/main.js serve\"",
    "web:dev": "cd apps/web && npx vite",
    "cli:build": "nx run cli:build",
    "cli:test": "nx run cli:test",
    "cli": "node dist/apps/cli/main.js",
    "desktop:build": "nx run desktop:build",
    "desktop:package": "nx run desktop:package",
    "desktop:test": "nx run desktop:test",
    "web:build": "nx run web:build",
    "web:test": "nx run web:test"
  }
}
```

- [ ] **Step 5: Run all tests to confirm nothing broke**

```bash
npx nx run-many -t test
```

Expected: all pass. The `passWithNoTests: true` on desktop means its now-empty test suite is fine.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: delete apps/daemon and apps/desktop/src/renderer (migrated)"
```

---

## Task 11: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the architecture, repo layout, and commands sections**

In CLAUDE.md, update:

1. **Architecture section** — remove `apps/daemon` from the diagram; describe the new 2-app structure and `/api`/`/ui` routing.

2. **Repo layout section**:
```
apps/
  cli/           # CLI commands + portswitch serve (daemon + static UI server)
  desktop/       # Thin Electron shell (health-check + BrowserWindow)
  web/           # React app (Vite), built and served by CLI at /ui
libs/
  shared/        # API types, config schema, path resolution, error codes
  proxy-core/    # Pure TCP-forwarding logic
  service-mgr/   # launchd / systemd / Windows Service install/uninstall/status
```

3. **Commands section** — replace the 3-terminal dev workflow with the 2-terminal version.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for 2-app architecture"
```

---

## Task 12: Install Playwright and write e2e tests

**Files:**
- Create: `e2e/playwright.config.ts`
- Create: `e2e/tests/portswitch.spec.ts`
- Modify: `package.json` (add @playwright/test)

- [ ] **Step 1: Install Playwright**

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Create e2e/playwright.config.ts**

```typescript
import { defineConfig, devices } from '@playwright/test';
import { createDaemon } from '../apps/cli/src/serve/server';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:65432',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
});
```

- [ ] **Step 3: Create e2e/global-setup.ts**

```typescript
import { createDaemon } from '../apps/cli/src/serve/server';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

let tmpDir: string;

async function globalSetup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'portswitch-e2e-'));
  const configPath = path.join(tmpDir, 'config.json');
  const logPath = path.join(tmpDir, 'logs');

  // Serve the built web app from dist/apps/web (must run `nx build web` first)
  const uiDir = path.join(process.cwd(), 'dist/apps/web');

  const daemon = createDaemon({ port: 65432, configPath, logPath, uiDir });
  await daemon.start();

  // Store daemon handle for teardown
  (globalThis as Record<string, unknown>).__E2E_DAEMON__ = daemon;
  (globalThis as Record<string, unknown>).__E2E_TMPDIR__ = tmpDir;
}

export default globalSetup;
```

- [ ] **Step 4: Create e2e/global-teardown.ts**

```typescript
import * as fs from 'fs/promises';

async function globalTeardown() {
  const daemon = (globalThis as Record<string, unknown>).__E2E_DAEMON__ as { stop(): Promise<void> } | undefined;
  const tmpDir = (globalThis as Record<string, unknown>).__E2E_TMPDIR__ as string | undefined;

  if (daemon) await daemon.stop().catch(() => undefined);
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
}

export default globalTeardown;
```

- [ ] **Step 5: Create e2e/tests/portswitch.spec.ts**

```typescript
import { test, expect } from '@playwright/test';

test.describe('portswitch web UI', () => {
  test('/ redirects to /ui', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/ui/);
  });

  test('UI loads with Port Mappings heading', async ({ page }) => {
    await page.goto('/ui');
    await expect(page.getByText('Port Mappings')).toBeVisible();
  });

  test('shows empty state initially', async ({ page }) => {
    await page.goto('/ui');
    await expect(page.getByText(/no mappings yet/i)).toBeVisible();
  });

  test('can add a mapping', async ({ page }) => {
    await page.goto('/ui');
    await page.getByRole('button', { name: /add mapping/i }).click();
    await page.getByPlaceholder('8080').fill('18080');
    await page.getByPlaceholder('localhost:3000').fill('localhost:13000');
    await page.getByRole('button', { name: /^add$/i }).click();
    await expect(page.getByText('18080')).toBeVisible();
  });

  test('can toggle a mapping on and off', async ({ page }) => {
    await page.goto('/ui');

    // Add a mapping first
    await page.getByRole('button', { name: /add mapping/i }).click();
    await page.getByPlaceholder('8080').fill('18081');
    await page.getByPlaceholder('localhost:3000').fill('localhost:13001');
    await page.getByRole('button', { name: /^add$/i }).click();

    // Toggle on
    await page.getByTitle('Enable').click();
    await expect(page.getByTitle('Disable')).toBeVisible({ timeout: 5000 });

    // Toggle off
    await page.getByTitle('Disable').click();
    await expect(page.getByTitle('Enable')).toBeVisible({ timeout: 5000 });
  });

  test('can delete a mapping', async ({ page }) => {
    await page.goto('/ui');

    // Add a mapping first
    await page.getByRole('button', { name: /add mapping/i }).click();
    await page.getByPlaceholder('8080').fill('18082');
    await page.getByPlaceholder('localhost:3000').fill('localhost:13002');
    await page.getByRole('button', { name: /^add$/i }).click();
    await expect(page.getByText('18082')).toBeVisible();

    // Delete with two-click confirmation
    await page.getByLabel('Delete mapping').click();
    await page.getByLabel('Confirm delete').click();
    await expect(page.getByText('18082')).not.toBeVisible({ timeout: 3000 });
  });

  test('/api/v1/health returns 200', async ({ request }) => {
    const res = await request.get('/api/v1/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  test('/api/v1/mappings returns list', async ({ request }) => {
    const res = await request.get('/api/v1/mappings');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.mappings)).toBe(true);
  });
});
```

- [ ] **Step 6: Add e2e script to package.json**

Add to the `scripts` section:
```json
"e2e": "npx playwright test --config e2e/playwright.config.ts"
```

- [ ] **Step 7: Commit**

```bash
git add e2e/ package.json package-lock.json
git commit -m "test(e2e): add Playwright tests for web UI and API"
```

---

## Task 13: Build and run e2e validation

- [ ] **Step 1: Build the web app**

```bash
npx nx build web
```

Expected: `dist/apps/web/` is created with `index.html` and `assets/`.

- [ ] **Step 2: Run all unit tests to confirm full suite passes**

```bash
npx nx run-many -t test
```

Expected: all pass.

- [ ] **Step 3: Run Playwright e2e tests**

```bash
npm run e2e
```

Expected: all 7 tests pass in Chromium. If a test fails, investigate the failure message and fix the relevant code or test assertion.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: verify all tests pass after consolidation"
```
