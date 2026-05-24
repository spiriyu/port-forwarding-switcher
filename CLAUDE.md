# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

All phases implemented and passing. Use the architecture and conventions below as the source of truth when generating code; when something contradicts these conventions, update CLAUDE.md in the same change rather than silently diverging.

## Asking clarifying questions

When anything about a task is unclear (architecture, naming, scope, trade-offs), gather **all** open questions and ask them in a single batch at the start — don't dribble them out across the conversation. Use this exact format:

- Number every question (`1.`, `2.`, `3.`, …).
- Each question must be atomic — no sub-questions, no "and also" clauses. If you feel a sub-question coming on, split it into a new top-level question.
- For every question, offer exactly four options labeled `A`, `B`, `C`, `D`. Make them concrete, mutually distinct, and self-contained (the user shouldn't need to read the others to understand any one).
- Tell the user they may pick **one or more** letters, **or** reply with a custom answer, **or** both (a letter plus a refinement). Default to honoring whatever they write.
- Don't ask questions you can answer yourself by reading the repo or this file. Don't ask preference questions when the architecture in this file already decides them.

## What this project is

An open-source host port-forwarding manager with a one-click "switcher" UX. A long-running Node.js proxy daemon owns all sockets and forwards traffic from source ports to target ports (many mappings, individually toggleable). Two thin clients drive it: an Electron desktop shell and a CLI. Everything is TypeScript.

## Architecture

Two runtime processes, one shared contract:

```
+--------------------+        +------------------------------------+
|  Electron shell    |  HTTP  |  CLI  (portswitch serve)          |
|  - checks daemon   | -----> |  - proxy daemon (owns sockets)    |
|  - spawns if down  |        |  - REST API at /api               |
|  - BrowserWindow   |        |  - React web UI at /ui            |
|    at /ui          |        |  - WS at /api/v1/events           |
+--------------------+        +------------------------------------+
                                        |
                                        v
                        JSON config (OS-standard user config dir)
```

**Single port 65432** — one HTTP server handles everything:
- `/api/*` — REST + WebSocket API
- `/ui/*` — React SPA (served as static files from `dist/apps/web`)
- `/` — redirects to `/ui`

- **CLI is the daemon.** `portswitch serve` starts the proxy server, binds sockets, serves the web UI. It is the only process that opens listening sockets. Never reach for `net.createServer` in the Electron main process.
- **Electron is a thin shell.** It checks `GET /api/v1/health`; if down, spawns the CLI (`portswitch serve`); then opens a `BrowserWindow` at `http://127.0.0.1:65432/ui`. No IPC, no preload, no React — it is a browser launcher with an auto-start feature.
- **Transport: HTTP REST for commands, WebSocket for events.** REST handles mapping CRUD and explicit on/off toggles. The WebSocket pushes state changes (mapping toggled, listener died, traffic counters) so both clients reflect reality without polling. Define the request/response types once in the shared package; both server and clients import from there.
- **CLI must be able to install, start, stop, and uninstall the service** (launchd on macOS, systemd user unit on Linux, Windows Service / Task Scheduler on Windows). The Electron app spawns the CLI for auto-start during app launch.
- **Config persistence: JSON** at the OS-standard user config dir:
  - macOS: `~/Library/Application Support/portswitch/config.json`
  - Linux: `$XDG_CONFIG_HOME/portswitch/config.json` (fallback `~/.config/portswitch/config.json`)
  - Windows: `%APPDATA%\portswitch\config.json`

  Resolve via a single helper in the shared package — never hardcode paths. The daemon owns writes; on startup it loads the file and rebinds any mapping marked `enabled: true`.
- **Privileged ports (<1024)** are allowed in config but binding will fail unless the daemon process has the privilege. The daemon must return a structured error (e.g. `EACCES_PRIVILEGED_PORT`) that clients render with actionable guidance ("re-run the daemon with sudo / install the service as root / use a port ≥1024"). Do **not** silently auto-elevate, swallow the error, or substitute a different port.
- **Cross-platform from day 1.** macOS, Linux, and Windows are all first-class. Path handling, service installation, and socket behavior must be tested per-platform — no `process.platform === 'darwin'` shortcuts that quietly break Windows.

## Repo layout (Nx workspace)

```
apps/
  cli/           # portswitch CLI — also runs as the proxy daemon (portswitch serve)
  web/           # React SPA — built to dist/apps/web, served by the CLI at /ui
  desktop/       # Electron shell — thin launcher that opens the web UI in a window
libs/
  shared/        # API types, config schema, path resolution, error codes
  proxy-core/    # Pure TCP-forwarding logic, no transport/IO concerns
  service-mgr/   # launchd / systemd / Windows Service install/uninstall/status
```

Anything used by more than one app belongs in a `libs/` package. Cross-app imports go through `@portswitch/<lib>` paths defined in `tsconfig.base.json` — never relative-traverse into a sibling app.

## Tooling conventions

- **Nx** drives task orchestration. Prefer `nx run <project>:<target>` over package-local scripts so caching and the project graph work correctly.
- **Build:** `tsc` for `libs/`, `tsup` (esbuild under the hood) for the CLI and Electron bundles, **Vite** for the React web app (`apps/web`), **electron-builder** for packaging the desktop app. Don't introduce Webpack.
- **Tests:** **Vitest** in every package. One framework everywhere — don't mix in Jest. For the CLI serve integration tests, prefer integration tests that actually bind on ephemeral ports (`port: 0`) over mocked sockets; the whole point of this project is real socket behavior.
- **TypeScript strict mode** project-wide. Shared API types live in `libs/shared` and are the single source of truth — generate or hand-write them once, import everywhere.

## Commands

```bash
# Workspace
npm install
npx nx graph                          # visualize the project graph
```

### Running locally (dev mode)

```bash
# Terminal 1 — CLI daemon (watch mode, auto-restarts on changes)
npx nx run cli:build && node dist/apps/cli/main.js serve

# Terminal 2 — Vite dev server for the web app (proxies /api to localhost:65432)
npx nx run web:serve

# Terminal 3 — Electron (points at the Vite dev server or the CLI directly)
PORTSWITCH_DAEMON_URL=http://127.0.0.1:65432 npx nx run desktop:build && npx electron dist/apps/desktop/main/main.js
```

#### Build and run the full stack

```bash
# Build the web app and bundle it into the CLI dist
npx nx run cli:copy-ui

# Run the daemon + UI
node dist/apps/cli/main.js serve
# Open http://127.0.0.1:65432/ui in a browser
```

#### CLI commands

```bash
npx nx run cli:build
node dist/apps/cli/main.js --help
node dist/apps/cli/main.js serve              # start daemon + web UI
node dist/apps/cli/main.js list
node dist/apps/cli/main.js add --source 8080 --target 3000
```

#### Config file location (for manual inspection)

```
macOS:   ~/Library/Application Support/portswitch/config.json
Linux:   ~/.config/portswitch/config.json
Windows: %APPDATA%\portswitch\config.json
```

### Tests

```bash
npx nx test <project>                 # vitest for one project
npx nx run-many -t test               # all projects
npx nx test cli -- --reporter=verbose       # verbose output
npx nx test cli -- -t "partial test name"   # filter by name
```

### Lint / typecheck / package

```bash
npx nx run-many -t lint typecheck
npx nx run desktop:package            # electron-builder, current platform
```

When you add a new app or lib, register it in Nx (`nx g @nx/node:app` / `@nx/js:lib` / etc.) rather than hand-rolling a `package.json` — the generators wire up the project graph correctly.

## Things to be careful about

- **Never bind a listening socket from the CLI command handlers or the Electron process.** All listeners live in `apps/cli/src/serve/` (the `portswitch serve` command). If you find yourself reaching for `net.createServer` outside `apps/cli/src/serve/` or `libs/proxy-core`, stop.
- **WebSocket events are advisory, not authoritative.** Clients should treat REST responses as truth and use WS purely to invalidate cached views. Don't build client-side state machines that only update on WS events — a dropped connection will desync them.
- **Config writes go through the daemon.** The web UI and CLI subcommands should not edit the JSON file directly; concurrent writes will corrupt state.
- **Service install/uninstall touches the user's machine.** Treat those code paths the way you'd treat a database migration — explicit, idempotent, with a dry-run mode for tests.
- **Web app asset paths use `/ui/` base.** The Vite config sets `base: '/ui/'` so all asset URLs are prefixed correctly when served by the CLI's `express.static` at `/ui`. Never change this without also updating the Express static mount point.
