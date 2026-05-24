# portswitch — implementation status

## Status: v1.0.0 complete ✅

---

## Phase 0 — Workspace scaffold ✅ complete
## Phase 1 — Shared contract ✅ complete
## Phase 2 — Daemon API surface ✅ complete
## Phase 3 — proxy-core TCP forwarding ✅ complete
## Phase 4 — Logging ✅ complete

---

## Phase history

### Phase 0 — Workspace scaffold _(in progress)_

Goal: empty-but-valid Nx monorepo. Every project builds, lints, typechecks, and has a passing test from a fresh clone.

| Step | Status |
|------|--------|
| Root config files (package.json, nx.json, tsconfigs, ESLint, Prettier, .gitignore) | ✅ done |
| GitHub Actions CI workflow | ✅ done |
| App scaffolds — daemon, cli, desktop | ✅ done |
| Lib scaffolds — shared, proxy-core, service-mgr | ✅ done |
| `npm install` + `nx run-many -t lint typecheck test build` green | ✅ done |

---

### Phase 1 — Shared contract ✅ complete
All TypeScript types (config, api, events, errors, logging), Zod schemas + parsers, OS-aware path resolvers, DEFAULT_CONFIG, runMigrations passthrough. 53 tests passing.

### Phase 2 — Daemon: API surface without forwarding ✅ complete
Full REST + WS server. InMemoryMappingStore, ConfigStore (atomic write, fs.watch), EventBus. 47 tests. All endpoints + WS events + restart/persistence test passing.

### Phase 3 — proxy-core: TCP forwarding ✅ complete
`createForwarder()` in `libs/proxy-core` — bidirectional TCP pipe, backpressure, graceful drain, stats. Daemon wired: `startForwarding`/`stopForwarding` on all CRUD/toggle operations. `debounce.flush()` on stop prevents ENOENT race. 65 tests total passing.

### Phase 4 — Logging ✅ complete
`Logger` class with rotating JSONL files (`maxFileBytes`/`maxFiles`), `onEntry` callback wired to `eventBus.broadcastLog()`. WS log streaming with per-client filter (level/category/mappingId), drop buffering. `GET /v1/logs?from&limit&mappingId` reads from active + rotated files. Key daemon events logged: startup, shutdown, apiBound, configLoaded, listenerBound/Unbound, API requests. `debounce` fixed to await in-flight writes. 73 tests passing.

### Phase 5 — CLI ✅ complete
Full `portswitch` command surface (minus `service`). `list`, `add`, `enable`, `disable`, `toggle`, `remove`, `edit`, `watch`, `logs [--follow]`, `doctor`, `completion`. Exit codes 0–7. `--json` output flag. 21 tests passing.

### Phase 6 — Service manager ✅ complete
`ServiceManager` interface + `MockServiceManager`. Platform backends: `LaunchdServiceManager` (macOS), `SystemdServiceManager` (Linux), `WindowsServiceManager` (Windows). `createServiceManager()` factory. CLI `service install/uninstall/start/stop/status` commands. 23 tests passing.

### Phase 7 — Desktop app ✅ complete
Electron main/preload/renderer. contextBridge + contextIsolation. IPC handlers (DaemonClient → ipcMain.handle). React UI: StatusBar, MappingList, AddMappingDialog. Tray with show/hide/quit. 32 tests passing.

### Phase 8 — Hardening ✅ complete
Config corruption recovery (corrupt/truncated JSON → deterministic rejection), target-unreachable graceful handling, concurrent creates/toggles, 5-client concurrent round-trips, daemon restart with persistence, EADDRINUSE recovery. 13 hardening tests (86 daemon total).

### Phase 9 — Release ✅ complete
README.md with quickstart + CLI reference + config table. docs/release.md (versioning, build, publish checklist). docs/contributing.md (setup, architecture rules, testing philosophy, spec change policy).
