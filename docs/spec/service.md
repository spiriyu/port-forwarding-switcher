# System service

The daemon runs as a per-user system service so mappings persist across app close and reboot. Implementation lives in `libs/service-mgr`, behind a single `ServiceManager` interface; platform backends are selected at runtime.

## Interface (shared)

```ts
interface ServiceManager {
  status(): Promise<{ installed: boolean; running: boolean; pid?: number; version?: string }>;
  install(opts: { daemonBinaryPath: string; logPath: string }): Promise<void>;
  uninstall(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
}
```

All methods are **idempotent**. `install()` on an already-installed service is a no-op success. `start()` on a running daemon is a no-op success. This rule makes the install flow safe to retry, which matters on Windows where UAC can flake.

## Install trigger

- **Primary path:** the Electron app's onboarding step ([desktop](./desktop.md#onboarding-flow)) calls `install()`. Elevation prompts happen here. The user sees a clear "we're about to install a background service" screen before the platform dialog appears.
- **Alternate path:** the CLI's `portswitch service install` does the same thing, with the same `ServiceManager`. Useful for headless setups and for users who don't want the desktop app.

There is **no** auto-install on first daemon connect. Surprise system modifications are out.

## Platform behaviors

### macOS — LaunchAgent (per-user, no sudo)

- Plist at `~/Library/LaunchAgents/com.portswitch.daemon.plist`.
- `RunAtLoad: true`, `KeepAlive: true` so it restarts on crash.
- `install()` writes the plist and `launchctl bootstrap gui/<uid> <plist>`.
- `uninstall()` `bootout`s and removes the plist.
- No elevation needed.

### Linux — systemd user unit (no sudo)

- Unit at `~/.config/systemd/user/portswitch.service`.
- `WantedBy=default.target` for autostart at login.
- Requires `loginctl enable-linger <user>` for the service to survive logout — `install()` does this if not already set, and if it can't (no permission), surfaces a clear message: "Run `loginctl enable-linger <user>` to keep portswitch running when you're logged out."
- `install()` writes the unit, `systemctl --user daemon-reload`, `systemctl --user enable --now portswitch.service`.
- Fallback for non-systemd distros: print instructions for OpenRC / runit / sysvinit equivalents; do **not** attempt to write to `/etc/init.d` ourselves. Mark "no autostart" in the UI.

### Windows — Windows Service

- Service name `Portswitch`, display "portswitch daemon", per-user (LocalService account).
- `install()` runs `sc.exe create` with the daemon binary path. This requires admin — the CLI relaunches itself elevated via UAC if not already elevated, and the Electron app shells out to a manifested helper that triggers UAC.
- `uninstall()` runs `sc.exe stop` then `sc.exe delete`.
- Service start mode: `auto-delayed`.

## Privileged ports

The daemon process does **not** run as root/Administrator. It binds on `127.0.0.1:<daemon.port>` (default 47600) which never requires privilege. Forwarded source ports <1024 are a different story:

- The daemon tries to bind. If the OS returns `EACCES`, it returns `EACCES_PRIVILEGED_PORT` to the client.
- Clients render the error with platform-specific guidance:
  - **macOS/Linux:** "Source port <port> needs root. Either pick a port ≥1024 or follow the docs to grant the binary the right capabilities." Link to a docs page that explains `setcap CAP_NET_BIND_SERVICE` on Linux and the `authbind` alternative.
  - **Windows:** "Source port <port> needs Administrator. Either pick a port ≥1024 or run the daemon as Administrator." Link to docs on changing the service account.
- We never auto-elevate the daemon to work around this. The user explicitly opts in.

## Logs

The service writes daemon logs to the path returned by `resolveLogPath()` from `libs/shared`. The service-manager backends additionally tee stdout/stderr to the platform's native log facility (launchd's `StandardOutPath`/`StandardErrorPath`, systemd's journal, Windows Event Log) so platform-native tools (`log show`, `journalctl --user`, Event Viewer) still work for users who reach for them.

## Updating

When the binary on disk is replaced (auto-update or manual install):

- **macOS:** LaunchAgent's plist `Program` path is stable; the binary is replaced in place. `portswitch service restart` (or the Electron prompt) reloads.
- **Linux:** same — systemd unit's `ExecStart` is stable.
- **Windows:** the service points at a stable install path; the installer stops the service, swaps the binary, starts it.

Auto-update never replaces a running daemon binary without first stopping the service. This is an installer responsibility, not the daemon's.

## Testing

- `libs/service-mgr` has a `MockServiceManager` used everywhere outside the real install path. Integration tests on each platform's CI runner exercise the real backend end-to-end (install → start → REST hit → stop → uninstall).
- No test should leave a real service installed on the dev machine — tests always run `uninstall()` in teardown, and the service name uses a `-test` suffix when invoked from tests.
