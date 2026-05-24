# Desktop app

Electron, React (Vite-bundled renderer), packaged with electron-builder. macOS, Windows, Linux from day 1.

## Process model

- **Main process** owns the HTTP+WS connection to the daemon. The renderer never talks to the daemon directly — it talks to the main process over `contextBridge`-exposed IPC. This keeps secrets (currently none, but design for the future) out of the renderer and gives us one place to handle reconnect logic.
- **Preload script** exposes a typed `window.portswitch` API to the renderer. Types are imported from `libs/shared`.
- **Renderer** is a React app rendering off a single store fed by the IPC bridge.

## Windows

### Main window

Single-window app. Layout:

```
┌─────────────────────────────────────────────────────────────┐
│ portswitch                                          ⋯  ⚙   │  <- titlebar (custom on macOS)
├─────────────────────────────────────────────────────────────┤
│  [ + New mapping ]                              🔍 search   │
├─────────────────────────────────────────────────────────────┤
│  ⬤ api dev          127.0.0.1:8080 → localhost:3000   [●] │  <- toggle switch on the right
│  ○ staging          127.0.0.1:9090 → api.staging.co:443  [ ]│
│  ⬤ legacy proxy     0.0.0.0:80 → localhost:8000      ⚠ [●]│  <- ⚠ for public-bound
├─────────────────────────────────────────────────────────────┤
│  ● daemon connected · port 47600 · 3 mappings · 5 conns    │  <- status bar
└─────────────────────────────────────────────────────────────┘
```

- Click a row to expand: live connection count, throughput, last error, recent logs (tailing).
- Right-click a row: enable/disable, edit, delete, copy as CLI command.
- The toggle switch is the "switcher" — single click flips `enabled`, with optimistic UI and rollback if the daemon rejects.

### New / edit mapping modal

Fields: name, source host + port, target host + port, drain timeout (advanced), bind publicly checkbox (with red warning copy). Inline validation: port range 1–65535, source binding conflicts checked client-side before submit (best-effort; daemon is authoritative).

### Settings window

- General: launch at login (delegates to service install state — see [service](./service.md)), update channel (stable / beta).
- Daemon: port (read-only display; editing requires daemon restart, app guides through it), log retention.
- Diagnostics: links to log file, config file, daemon status, "Open issue with diagnostics."

## System tray

Always present when the app is running. Click opens a menu:

```
portswitch — 3 mappings, 5 conns
─────────────────────────────────
[●] api dev        8080 → 3000      ▸ submenu: edit / disable / copy / delete
[ ] staging        9090 → :443
[●] legacy proxy   80 → 8000  ⚠
─────────────────────────────────
+ New mapping…
Show window
Quit
```

Each mapping is one click to toggle from the tray. Submenu (right arrow) offers actions. The tray icon overlays a small dot for connected/disconnected daemon status, and the menubar shows the active mapping count on macOS.

Closing the main window hides it to the tray (configurable: macOS keeps it as a standard dock behavior).

## Onboarding flow

First launch:

1. **Welcome screen** — what portswitch does in three sentences, one screenshot.
2. **Install daemon as a service** — explains why (so mappings survive app close and reboot), shows the elevation prompt copy that's about to appear. User clicks "Install"; the app spawns the platform-specific installer (see [service](./service.md)). On failure, fall back to a "Run this command yourself" panel with the exact `portswitch service install` line.
3. **Create your first mapping** — pre-filled with `8080 → 127.0.0.1:3000` as a placeholder; user can skip.
4. **Done** — points at the tray icon, suggests `portswitch --help` if they're CLI-curious.

State for "has completed onboarding" is stored in the Electron app's user data dir, not the daemon config. Resetting it is available from Settings → Diagnostics → "Re-run onboarding."

## Auto-update

- electron-builder + `electron-updater` against a public release feed (GitHub Releases for v1; signed `.dmg`, `.exe`, `.AppImage`, `.deb`).
- Check on launch and every 6 hours. Download in background. Prompt to restart when ready; user can defer.
- Beta channel toggle in Settings reads from a different feed URL.
- If the bundled CLI binary is updated by auto-update, the user is informed that any installed system service may need to be restarted (`portswitch service restart`). The app offers a one-click "restart now."

## Reconnect logic

- The main process maintains a single WS connection to the daemon. On disconnect: exponential backoff (1s, 2s, 4s, 8s, cap 30s), with jitter. The UI shows "Reconnecting…" in the status bar.
- If the daemon is unreachable for >5s, the UI greys mapping rows and disables toggle switches.
- On reconnect, the app does a full resync from `hello.snapshot` and re-applies any optimistic-but-unconfirmed local mutations. If a re-apply fails, surface a toast with the daemon error.

## Accessibility

- All interactive elements have ARIA labels.
- Full keyboard navigation; toggle switches respond to space/enter.
- Color-coded states (green = listening, red = error) always paired with text or icon.
- Tested with macOS VoiceOver and NVDA on Windows before v1.

## What we don't do (v1)

- No in-app mapping templates / preset library.
- No multiple profiles or workspaces.
- No remote-daemon mode.
- No translations beyond English source strings (i18n scaffolding present in `libs/shared/i18n`, but only en-US shipped).
