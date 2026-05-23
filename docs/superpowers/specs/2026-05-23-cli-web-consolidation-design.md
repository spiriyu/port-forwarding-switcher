# CLI + Web Consolidation Design

**Date:** 2026-05-23
**Status:** Approved

## Overview

Consolidate from three runtime processes (daemon, CLI, Electron renderer) into two apps:

- **`apps/cli`** — CLI commands + `portswitch serve` which runs the proxy daemon and serves the React web UI from a single port.
- **`apps/desktop`** — thin Electron shell that health-checks the daemon and opens a `BrowserWindow` to the web UI. No IPC logic, no React source, no preload bridge.

`apps/daemon` is deleted. Its server code migrates into `apps/cli/src/serve/`. The React renderer moves out of `apps/desktop/` into a new standalone app `apps/web/`.

## Repository Structure

**Before:**
```
apps/
  daemon/        # standalone daemon process
  cli/           # thin CLI client
  desktop/       # Electron main + React renderer
```

**After:**
```
apps/
  cli/           # CLI commands + portswitch serve (daemon + static server)
  desktop/       # thin Electron shell only (~150 lines, no IPC)
  web/           # React app (Vite), served by CLI on /ui
libs/
  shared/        # unchanged
  proxy-core/    # unchanged
  service-mgr/   # unchanged
```

## Runtime Behavior

### `portswitch serve` — single server, single port

```
portswitch serve
  └── port 65432
        ├── /api/*   →  Express REST API + WebSocket (all daemon logic)
        ├── /ui/*    →  express.static serving built React app
        └── /        →  redirect → /ui
```

One Express instance, one port. WebSocket upgrades attach to the same underlying `http.Server`. No CORS headers needed — everything is same-origin (`localhost:65432`).

### CLI commands

`DaemonClient` prefixes all routes with `/api` (`/api/health`, `/api/mappings`, etc.). Default daemon URL: `http://127.0.0.1:65432`. All existing commands (`list`, `add`, `toggle`, `enable`, `disable`, `remove`, `edit`, `watch`, `logs`, `doctor`, `service`) work without behavioral changes beyond the URL prefix update.

### React app (`apps/web/`)

- Drops all `window.portswitch` / Electron IPC usage entirely.
- REST calls: `fetch('/api/mappings')` (relative, same-origin).
- Real-time events: `new WebSocket('ws://localhost:65432')`.
- Vite config sets `base: '/ui/'` so all built asset paths are prefixed correctly.
- Daemon URL is configurable via `VITE_DAEMON_BASE_URL` env var (default: empty string = same origin).

### Electron (`apps/desktop/`)

```
Electron starts
  └── GET http://localhost:65432/api/health
        ├── 200 OK  →  open BrowserWindow to http://localhost:65432/ui
        └── fail    →  spawn `portswitch serve` as child process
                        poll health every 500ms (timeout 10s)
                        → open BrowserWindow to http://localhost:65432/ui
                        → on timeout: show native error dialog with Retry
```

No preload script. No IPC handlers. No `ipc-handlers.ts`, no `ipc-channels.ts`. Minimal tray menu (Show/Hide + Quit).

## Build Pipeline

### Nx dependency graph

```
web:build  ←── cli:build  ←── desktop:build
```

`cli`'s `project.json` declares `web:build` as an implicit dependency. After `web:build`, a post-build step copies `dist/apps/web/` into `dist/apps/cli/ui/`.

### Static file serving at runtime

CLI resolves UI files via:
```typescript
path.join(__dirname, 'ui')
```

The `ui/` directory is present alongside `main.js` in the CLI dist — no flags or environment variables required for normal use.

### Vite config (`apps/web/`)

```typescript
// vite.config.ts
export default defineConfig({
  base: '/ui/',
  build: { outDir: '../../dist/apps/web' },
});
```

### Electron packaging

`electron-builder` packages the Electron shell. For users without a global `portswitch` install, the packaged app includes the CLI binary in `extraResources/`. Electron locates it via `process.resourcesPath` at runtime.

In dev mode (`NODE_ENV=development`), Electron resolves the CLI by running `node <workspace>/dist/apps/cli/main.js serve` directly. In production, it uses the binary at `path.join(process.resourcesPath, 'portswitch')`.

### Dev workflow

```bash
# Terminal 1 — daemon + API + UI server (port 65432)
npx nx serve cli -- serve

# Terminal 2 — Vite dev server with hot reload (port 5173, proxies /api → 65432)
cd apps/web && npx vite
```

During development, the browser points at `localhost:5173`. Vite's `server.proxy` config forwards `/api` and the WebSocket path to `localhost:65432`:

```typescript
// apps/web/vite.config.ts (dev only)
server: {
  proxy: {
    '/api': 'http://localhost:65432',
    '/ws':  { target: 'ws://localhost:65432', ws: true },
  },
}
```

Electron is not needed during UI development — any browser at `localhost:5173` works as the client.

## Error Handling

| Scenario | Behavior |
|---|---|
| Daemon not running (Electron) | Spawn `portswitch serve`, poll health (500ms, 10s timeout), then open UI. On timeout: native error dialog with Retry. |
| UI files missing at serve time | Log warning, skip `/ui` route. API continues to work. |
| Port 65432 in use | Structured `EADDRINUSE` error with actionable message (already implemented). |
| Privileged port (<1024) | Existing `EACCES_PRIVILEGED_PORT` error path unchanged. |

## Testing

- **Daemon integration tests** migrate from `apps/daemon/src/` to `apps/cli/src/serve/`. All tests bind on ephemeral ports (`port: 0`) — no changes to test logic, only file locations.
- **React component tests** (`apps/web/`) use Vitest + `@testing-library/react`. Mock `fetch` instead of `window.portswitch` — simpler, no Electron dependency.
- **Electron tests** (`apps/desktop/`) shrink to health-check + spawn logic only.
- Framework: Vitest everywhere, no new frameworks introduced.

## Migration Summary

| File / directory | Action |
|---|---|
| `apps/daemon/` | Delete — code migrates to `apps/cli/src/serve/` |
| `apps/desktop/src/renderer/` | Move to `apps/web/src/` |
| `apps/desktop/src/preload.ts` | Delete |
| `apps/desktop/src/ipc-handlers.ts` | Delete |
| `apps/desktop/src/ipc-channels.ts` | Delete |
| `apps/desktop/src/client.ts` | Delete (Electron no longer calls daemon directly) |
| `apps/desktop/src/main.ts` | Rewrite — health check + spawn + BrowserWindow only |
| `apps/cli/src/client.ts` | Update — prefix all routes with `/api` |
| `apps/cli/src/main.ts` | Add `serve` command |
| `apps/cli/src/serve/` | New — daemon server code from `apps/daemon/src/` |
| `apps/web/` | New Nx app — React + Vite, `base: '/ui/'` |
| `libs/shared/src/config/defaults.ts` | Update `DEFAULT_DAEMON_PORT` to `65432` |
| `CLAUDE.md` | Update architecture section to reflect 2-app structure |
