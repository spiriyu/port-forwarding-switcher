# pfs — port-forwarding manager

[![npm](https://img.shields.io/npm/v/@spiriyu/port-forwarding-mapper)](https://www.npmjs.com/package/@spiriyu/port-forwarding-mapper)
[![node](https://img.shields.io/node/v/@spiriyu/port-forwarding-mapper)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![Release](https://img.shields.io/github/actions/workflow/status/spiriyu/port-forwarding-switcher/release.yml?label=Release)](https://github.com/spiriyu/port-forwarding-switcher/actions/workflows/release.yml)

A host-local TCP port-forwarding manager. One long-running daemon owns all the listeners; a web UI, desktop app, and CLI drive it interactively — all staying in sync in real time.

Think `kubectl port-forward`, but persistent, named, and toggled with a single click or command.

## Features

- **Named, persistent mappings** — forward `source` port → `target` host:port, survive daemon restarts
- **One-click toggle** — enable or disable any mapping without restarting the daemon or losing others
- **Live sync** — the web UI, Electron desktop app, and CLI all reflect changes instantly via WebSocket events
- **Service install** — install as a launchd/systemd/Windows Service so it starts at login
- **Cross-platform** — macOS, Linux, and Windows first-class

## Install

```bash
npm install -g @spiriyu/port-forwarding-mapper
```

This puts the `pfs` binary on your PATH.

Or run without installing:

```bash
npx @spiriyu/port-forwarding-mapper serve                 # default port 65432
npx @spiriyu/port-forwarding-mapper serve --port 8888     # custom port
npx @spiriyu/port-forwarding-mapper add 8080 localhost:3000 --name dev-api
npx @spiriyu/port-forwarding-mapper list
```

If you prefer a shorter alias without a global install, add this to your shell profile:

```bash
alias pfs='npx @spiriyu/port-forwarding-mapper'
```

## Quickstart

**1. Start the daemon**

```bash
pfs serve                  # default port 65432
pfs serve --port 8888      # custom port
pfs serve -p 8888          # shorthand
```

Or install it as a persistent system service:

```bash
pfs service install
pfs service start
```

**2. Open the web UI**

Navigate to `http://127.0.0.1:65432/ui` in your browser, or launch the Electron desktop app.

**3. Add a mapping**

```bash
# Forward local port 8080 → localhost:3000
pfs add 8080 localhost:3000

# Give it a name
pfs add 8080 localhost:3000 --name dev-api

# Bind on all interfaces
pfs add 0.0.0.0:8080 localhost:3000 --name dev-api
```

**4. List and manage mappings**

```bash
pfs list
```

```
  NAME      SOURCE             TARGET            STATUS
  dev-api   127.0.0.1:8080  →  localhost:3000    listening
```

```bash
pfs toggle dev-api      # flip enabled ↔ disabled
pfs disable dev-api
pfs enable dev-api
pfs remove dev-api
```

**5. Watch events in real time**

```bash
pfs watch          # stream mapping status changes
pfs logs --follow  # stream daemon log entries
```

## CLI reference

```
pfs [--url <daemon-url>] [--json] <command> [args]

Mapping commands:
  list                           List all port mappings
  add <source> <target>          Create a mapping  (--name, --enabled, --group)
  enable <id|name>               Enable a mapping
  disable <id|name>              Disable a mapping
  toggle <id|name>               Flip enabled ↔ disabled
  remove <id|name>               Delete a mapping
  edit <id|name>                 Edit a mapping  (-s/--source, -t/--target, --name)

Group commands:
  group list                     List groups
  group add --name <name>        Create a group
  group rename <id> --name <n>   Rename a group
  group enable/disable <id>      Enable or disable all mappings in a group
  group remove <id>              Delete a group
  group duplicate <id>           Duplicate a group

Streaming:
  watch                          Stream mapping status changes over WS
  logs [--follow] [--level]      View daemon logs

Daemon:
  serve [-p/--port <port>]       Start the daemon + web UI (default port: 65432)
  doctor                         Connectivity and version diagnostics

Service management:
  service install [--exec <p>]   Install as launchd/systemd/Windows service
  service uninstall              Remove the service
  service start                  Start the service
  service stop                   Stop the service
  service status                 Show service status

Shell completion:
  completion <shell>             Print completion script (bash|zsh|fish)

Global flags:
  -v, --version  Output the version number
  --url <url>    Daemon base URL (default: http://127.0.0.1:65432)
  --json         Output machine-readable JSON
```

## Privileged ports

Binding ports below 1024 requires elevated privileges. The daemon returns a structured `EACCES_PRIVILEGED_PORT` error if it cannot bind. On Linux:

```bash
sudo pfs service install
sudo pfs service start
```

Or grant the Node binary `CAP_NET_BIND_SERVICE` instead of running as root.

## Config file

All mappings are persisted to JSON at the OS-standard user config location. Do not edit the file while the daemon is running — all writes go through the daemon API.

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/pfs/config.json` |
| Linux | `$XDG_CONFIG_HOME/pfs/config.json` (fallback: `~/.config/pfs/config.json`) |
| Windows | `%APPDATA%\pfs\config.json` |

### Config structure

```jsonc
{
  "schemaVersion": 2,
  "daemon": {
    "port": 65432,
    "logRetention": { "maxFiles": 5, "maxFileBytes": 1048576 }
  },
  "groups": [
    {
      "id": "01J...",        // ULID — generated automatically
      "name": "My Services",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "mappings": [
    {
      "id": "01J...",        // ULID — generated automatically
      "name": "dev-api",
      "sourceHost": "127.0.0.1",
      "sourcePort": 8080,
      "targetHost": "localhost",
      "targetPort": 3000,
      "enabled": true,
      "drainTimeoutMs": 5000,
      "groupId": "01J...",   // must match a group id above
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

### Groups

Groups are a way to organise related mappings so you can enable/disable them all at once. Every mapping belongs to exactly one group. The daemon creates a **Default** group on first run if none exist.

To create a group and add mappings to it via the CLI:

```bash
pfs group add --name "My Services"
pfs add 8080 localhost:3000 --name dev-api --group "My Services"
pfs add 5432 localhost:5432 --name dev-db  --group "My Services"

# Enable or disable the whole group at once
pfs group enable  "My Services"
pfs group disable "My Services"
```

The `groupId` field in each mapping entry is the `id` of the group it belongs to. IDs are [ULIDs](https://github.com/ulid/spec) generated automatically — use the CLI or web UI rather than writing them by hand.

## Development

```bash
git clone https://github.com/spiriyu/port-forwarding-switcher.git
cd port-forwarding-switcher
npm install
npx nx run-many -t lint typecheck test    # verify everything
```

Run the full stack locally:

```bash
npx nx run cli:build && node dist/apps/cli/main.cjs serve   # daemon + web UI
npx nx run web:serve                                         # Vite dev server (proxies /api to :65432)
```

See [CLAUDE.md](./CLAUDE.md) for architecture details and conventions.

## License

MIT — see [LICENSE](./LICENSE).
