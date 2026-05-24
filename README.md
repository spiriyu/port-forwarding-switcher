# portswitch

A host-local TCP port-forwarding manager. One long-running daemon owns all the listeners; a desktop app and a CLI drive it interactively.

## What it does

- Forwards traffic from a **source** port to a **target** host:port (think `kubectl port-forward`, but persistent and managed)
- Each mapping is individually toggled on/off without restaring the daemon
- Both the CLI and the Electron desktop app stay in sync in real time via WebSocket events
- Supports macOS, Linux, and Windows

## Install

### macOS / Linux (from source)

```bash
git clone https://github.com/your-org/portswitch.git
cd portswitch
npm install
npx nx run cli:build
sudo npm link ./apps/cli          # puts `portswitch` on PATH (optional)
```

### Windows (from source)

Same steps; service management uses Windows Service / Task Scheduler automatically.

## Quickstart

**1. Install and start the daemon as a system service**

```bash
portswitch service install
portswitch service start
```

The daemon binds on `127.0.0.1:47600` by default.

**2. Add a mapping**

```bash
# Forward local port 8080 → localhost:3000
portswitch add 8080 localhost:3000 --name dev-api

# Or with a full source host
portswitch add 0.0.0.0:8080 localhost:3000
```

**3. Enable it**

```bash
portswitch enable dev-api
portswitch list
```

Output:

```
  NAME      SOURCE             TARGET            STATUS
  dev-api   127.0.0.1:8080  →  localhost:3000    listening
```

**4. Toggle, disable, delete**

```bash
portswitch toggle dev-api      # flip enabled ↔ disabled
portswitch disable dev-api
portswitch remove dev-api
```

**5. Watch events in real time**

```bash
portswitch watch          # streams mapping status changes
portswitch logs --follow  # streams daemon log entries
```

**6. Run the desktop app**

```bash
npx nx serve desktop      # dev mode (Vite + Electron)
```

## CLI reference

```
portswitch [--url <daemon-url>] [--json] <command> [args]

  list                           List all port mappings
  add <source> <target>          Create a new mapping  (--name, --enabled)
  enable <id|name>               Enable a mapping
  disable <id|name>              Disable a mapping
  toggle <id|name>               Flip enabled ↔ disabled
  remove <id|name>               Delete a mapping
  edit <id|name>                 Edit source/target/name  (--source, --target, --name)
  watch                          Stream mapping status changes over WS
  logs [--follow] [--level]      View daemon logs
  doctor                         Connectivity and version diagnostics
  completion <shell>             Print shell completion script (bash|zsh|fish)

  service <action>               Manage the system service
    install [--exec <path>]      Install as launchd/systemd/Windows service
    uninstall                    Remove the service
    start                        Start the service
    stop                         Stop the service
    status                       Show service status

Global flags:
  --url <url>   Daemon base URL (default: http://127.0.0.1:47600)
  --json        Output machine-readable JSON
```

## Privileged ports

Binding ports below 1024 requires elevated privileges. The daemon will return a structured `EACCES_PRIVILEGED_PORT` error if it cannot bind. On Linux, use:

```bash
sudo portswitch service install
sudo portswitch service start
```

Or grant the Node binary the `CAP_NET_BIND_SERVICE` capability instead of running as root.

## Config file

The daemon persists all mappings to JSON at the OS-standard user config location:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/portswitch/config.json` |
| Linux | `$XDG_CONFIG_HOME/portswitch/config.json` (fallback: `~/.config/portswitch/config.json`) |
| Windows | `%APPDATA%\portswitch\config.json` |

Do not edit the file while the daemon is running — all writes go through the daemon API.

## Development

See [CLAUDE.md](./CLAUDE.md) for commands, architecture, and conventions.

```bash
npm install
npx nx run-many -t lint typecheck test   # verify everything
npx nx serve daemon                       # run daemon in watch mode
npx nx serve desktop                      # Electron dev server
```

## License

MIT — see [LICENSE](./LICENSE).
