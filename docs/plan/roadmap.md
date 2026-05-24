# Roadmap

Phased plan to ship v1. Each phase has explicit exit criteria — don't move on until they're all true. Phases are scoped to be self-contained: at the end of each, the project is in a coherent, demoable state.

The aggressive thing about this plan is that the spec is locked first. Implementation phases build against the spec, not against each other's improvisation.

## Phase 0 — Workspace scaffold

**Goal:** an empty but valid Nx workspace where every project builds, lints, types, and runs an empty test green.

Deliverables:

- Nx workspace at repo root, npm workspaces (not pnpm).
- Projects created via generators: `apps/daemon`, `apps/cli`, `apps/desktop`, `libs/shared`, `libs/proxy-core`, `libs/service-mgr`.
- `tsconfig.base.json` with `@portswitch/*` path aliases.
- Vitest configured at the workspace level; each project has a passing `placeholder.test.ts`.
- ESLint + Prettier configured once at the root.
- GitHub Actions CI: `npx nx run-many -t lint typecheck test build` on PR.
- Build outputs go to `dist/`; `dist/` is gitignored.

Exit criteria:

- `npx nx run-many -t lint typecheck test build` is green from a fresh clone.
- CI badge in README is green on `main`.

## Phase 1 — Shared contract

**Goal:** the API and config types exist as code, with validation, before any implementation depends on them.

Deliverables in `libs/shared`:

- `types/api.ts` — request/response types from [api](../spec/api.md).
- `types/config.ts` — config + mapping types from [config](../spec/config.md).
- `types/events.ts` — WebSocket message union.
- `types/errors.ts` — error code enum + `ApiError` class.
- `schemas/` — Zod schemas mirroring the types, exported as `parseFoo()` functions.
- `paths/` — `resolveConfigPath()`, `resolveLogPath()` with per-OS branches and tests using mocked `os.homedir()` / `process.env`.
- `config/migrations/` — empty directory, `runMigrations()` function returning input unchanged. Smoke test fixture.

Exit criteria:

- 100% type coverage on the public API surface — `npx nx test shared` is green and covers every field's parser.
- `libs/shared` has no dependency on anything in `apps/`.

## Phase 2 — Daemon: API surface without forwarding

**Goal:** the daemon implements the entire HTTP+WS API against an in-memory store. No real TCP forwarding yet.

Deliverables:

- `apps/daemon` runs as a node process. Binds API on `127.0.0.1:47600`.
- All endpoints from [api](../spec/api.md) implemented and wired to a `MappingStore` interface; the v1 backend is in-memory.
- WS events fire correctly for all mutations (`mapping.created`, `updated`, `deleted`, etc.).
- Config file load/save (atomic rename) implemented; daemon hydrates from file on startup, persists on every mutation.
- External-edit detection via `fs.watch`.
- Error codes returned per spec.

Exit criteria:

- Integration tests: spin up a daemon on an ephemeral port, hit every endpoint, assert response shape and emitted WS events. All green.
- Restart test: create mappings, kill daemon, restart, confirm mappings are restored from disk.

## Phase 3 — proxy-core: actual TCP forwarding

**Goal:** a library that can bind a source, forward TCP to a target, track stats, drain gracefully. Used by the daemon.

Deliverables in `libs/proxy-core`:

- `createForwarder({ sourceHost, sourcePort, targetHost, targetPort, drainTimeoutMs })` returning a controller with `start()`, `stop()`, `stats()`, and an `EventEmitter` for connection events.
- Per-connection bidirectional piping with backpressure-correct stream handling.
- Drain semantics from [api draining](../spec/api.md#draining): stop accepting, wait `drainTimeoutMs`, force-close.
- Stats: open connections, total connections, bytes in/out.
- No knowledge of HTTP, of the API, of config — pure transport.

Daemon wiring:

- Daemon swaps the in-memory `MappingStore` for one that drives `proxy-core` controllers in lockstep with state.
- Hot-edit of source port: stop old listener, start new one, drain old.
- `EADDRINUSE`, `EACCES_PRIVILEGED_PORT`, `ETARGET_UNREACHABLE` surface correctly.

Exit criteria:

- End-to-end test: daemon up, create mapping `0 → echo-server`, open 10 concurrent TCP clients, send/receive data, assert stats.
- Hot rebind test: change source port via API while connections are open; old conns drain, new conns hit new port within 1s.
- Privileged-port test: try port 80 from unprivileged process, get `EACCES_PRIVILEGED_PORT`.

## Phase 4 — Logging

**Goal:** JSONL logs to disk with rotation, plus the tail-over-WS protocol.

Deliverables:

- Logger in `libs/shared/logger` with the entry shape from [logging](../spec/logging.md).
- Daemon writes to `daemon.log.jsonl`, rotates per `daemon.logRetention`.
- Atomic rotation as specified (rename chain).
- `GET /v1/logs` paged endpoint reads across active + rotated files.
- WS `log.subscribe` / `log.unsubscribe` / `log` / `log.dropped`.
- Tee to platform-native stdio (so launchd/journald/Event Log still capture).

Exit criteria:

- Rotation test: write past `maxFileBytes` repeatedly, assert file count caps at `maxFiles`, oldest dropped.
- Tail test: subscribe over WS, generate log activity, receive entries in order.
- Slow-consumer test: subscribe but don't read; assert daemon drops oldest and emits `log.dropped`.

## Phase 5 — CLI

**Goal:** `portswitch` binary implementing the full [cli](../spec/cli.md) surface, minus `service` commands (those need Phase 6).

Deliverables:

- `apps/cli` with `commander` (or equivalent) command tree.
- All commands from the spec implemented except `service *`.
- `--json` output mode produces deterministic, schema-stable bodies.
- Exit codes per spec.
- Shell completion script generators (`portswitch completion <shell>`).
- Bundled with `tsup` to a single-file Node binary; `npx nx build cli` produces `dist/apps/cli/portswitch`.

Exit criteria:

- Snapshot tests for human and `--json` output across the command surface.
- E2E: start daemon, run a sequence of CLI commands via child_process, assert daemon state and CLI exit codes match expectations.

## Phase 6 — Service manager

**Goal:** install/start/stop/uninstall across macOS, Linux, Windows. CLI `service` commands wired up.

Deliverables in `libs/service-mgr`:

- `ServiceManager` interface and `MockServiceManager`.
- macOS backend (LaunchAgent plist + `launchctl`).
- Linux backend (systemd user unit + `systemctl --user` + `loginctl enable-linger` probe).
- Windows backend (`sc.exe` + UAC self-elevation helper).
- Linux fallback: clear message for non-systemd, no autostart.
- All operations idempotent.

CLI wiring:

- `portswitch service install / uninstall / start / stop / restart / status / logs` implemented.

Exit criteria:

- Per-OS CI runners: install → status (installed, running) → REST hit → stop → status (installed, not running) → uninstall → status (not installed). All green.
- Manual smoke: reboot the dev machine; the daemon is running; an existing mapping is listening.

## Phase 7 — Desktop app

**Goal:** the Electron app from [desktop](../spec/desktop.md), packaged for all three OSes, with onboarding and auto-update.

Deliverables:

- `apps/desktop` with main + preload + Vite-bundled React renderer.
- Main window, system tray, mapping editor modal, settings window.
- Onboarding flow including service install step.
- electron-builder targets: `.dmg` (macOS), `.exe` NSIS (Windows), `.AppImage` and `.deb` (Linux).
- electron-updater wired to GitHub Releases; stable + beta channels.
- Code signing: macOS notarization, Windows Authenticode. (Certificate management is documented in `docs/release.md` once we have one — Phase 9.)
- a11y: ARIA labels, keyboard nav, VoiceOver/NVDA smoke-tested.

Exit criteria:

- Fresh-machine onboarding: install app → run → through onboarding → first mapping works → tray icon toggles → app survives close-to-tray and reopen.
- Auto-update: cut a `v0.0.x-test` release, install older version, confirm in-app update succeeds end-to-end.

## Phase 8 — Hardening

**Goal:** the things you only find by trying to break it.

Deliverables:

- Fuzz/chaos tests: random sequences of CRUD + toggle + edits while traffic flows; daemon must not crash, must converge.
- Long-running soak: 24h test with steady connection churn on multiple mappings; memory + FD count stay flat.
- Failure injection: target unreachable, then reachable, then unreachable; mapping status events fire correctly each transition.
- Config corruption recovery: malformed `config.json` on disk; daemon refuses to start with a clear error, points at file path.
- Privileged-port flow: end-to-end manual verification on each OS, including the docs links.

Exit criteria:

- All flaky tests fixed or quarantined with a tracking issue.
- No `TODO`/`FIXME` left in `apps/daemon` or `libs/proxy-core`.

## Phase 9 — Release

**Goal:** v1.0.0 published.

Deliverables:

- README with quickstart for both CLI and desktop install paths.
- `docs/release.md` covering: version bump conventions, changelog format, signing certs, publishing the GitHub Release, updating the auto-update feed.
- `docs/contributing.md`.
- Tag `v1.0.0`. CI publishes artifacts. Auto-update feed points at the release.

Exit criteria:

- Three people who didn't write the code follow the README's quickstart on three different OSes and get a working forward in under five minutes.

---

## Explicitly deferred (post-v1)

These are recorded here so they don't get smuggled into v1.

- UDP, HTTP-aware, WebSocket-aware passthrough, TLS termination.
- Auth on the daemon API; remote daemons.
- Mapping templates / presets / profiles.
- Bandwidth limits, traffic shaping.
- Non-systemd autostart on Linux.
- i18n beyond en-US.
- External-`logrotate` mode (`maxFiles: 0`).
