# CLI

Binary name: `portswitch`. Single executable, bundled with `tsup`/esbuild from `apps/cli`.

## Global flags

| Flag | Default | Effect |
| --- | --- | --- |
| `--config <path>` | OS-standard | Override config file path. Affects daemon discovery only — doesn't fork a separate daemon. |
| `--daemon-url <url>` | `http://127.0.0.1:<configured-port>` | Override the daemon URL. For tests / advanced use. |
| `--json` | off | Machine-readable output: one JSON object per command, or NDJSON for streaming commands. |
| `--no-color` | off | Disable ANSI colors. Also honors `NO_COLOR` env var. |
| `--quiet` | off | Suppress non-essential output; only errors and the final result. |
| `-h`, `--help` | — | Per-command help. |
| `-v`, `--version` | — | CLI version (separate from daemon version; both shown). |

## Commands

### `portswitch list`

Lists all mappings. Default output is a table with columns: id (short), name, source, target, status, conns.

```
ID       NAME      SOURCE             TARGET                STATUS      CONNS
01HX4Z…  api dev   127.0.0.1:8080  →  127.0.0.1:3000        listening   2
01HX5A…  staging   127.0.0.1:9090  →  api.staging.co:443    disabled    0
```

`--json` emits the daemon's `GET /v1/mappings` body verbatim.

### `portswitch add <source> <target> [--name <name>] [--disabled] [--bind-public]`

`<source>` is `[host:]port`, default host `127.0.0.1`. `<target>` is `host:port`, no default. `--bind-public` sets `sourceHost` to `0.0.0.0` and prints a one-line warning.

Examples:

```
portswitch add 8080 localhost:3000 --name "api dev"
portswitch add 8443 api.staging.example.com:443
portswitch add 0.0.0.0:80 localhost:3000 --bind-public
```

### `portswitch enable <id|name>` / `portswitch disable <id|name> [--wait]`

Toggle a mapping on or off. `<name>` is matched if unique; if multiple mappings share the name, error and require the ID. `--wait` on `disable` blocks until drain completes — see [api draining](./api.md#draining).

### `portswitch toggle <id|name>`

Flip whatever the current state is.

### `portswitch remove <id|name> [--wait]`

Delete a mapping. Drain semantics identical to `disable`.

### `portswitch edit <id|name> [--source <host:port>] [--target <host:port>] [--name <name>]`

Patch fields on an existing mapping. Each field optional. At least one must be passed.

### `portswitch watch`

Long-running. Subscribes to the WS event stream and prints events as they arrive. With `--json`, emits NDJSON — one event per line, suitable for piping to `jq` or a log collector.

### `portswitch logs [--mapping <id|name>] [--follow] [--since <iso>] [--level <info|warn|error>] [--limit <n>]`

Without `--follow`, prints a page of historical logs via `GET /v1/logs`. With `--follow`, switches to WS tail. See [logging](./logging.md).

### `portswitch service <subcommand>`

System service management. See [service](./service.md) for behavior per platform.

- `portswitch service install` — installs and starts the user-level service. Requires elevation on Windows; on macOS uses a per-user LaunchAgent (no sudo); on Linux uses a systemd user unit (no sudo).
- `portswitch service uninstall`
- `portswitch service start` / `stop` / `restart`
- `portswitch service status` — prints daemon status, PID, version, listening port, log path.
- `portswitch service logs [--follow]` — convenience alias for `portswitch logs` scoped to daemon events (no mapping ID).

### `portswitch doctor`

Runs a diagnostic battery: config file readable, daemon reachable, version match between CLI and daemon, no listener errors, no privileged-port failures. Exits 0 on all-green, non-zero otherwise. Output is human-readable; `--json` gives a structured report.

### `portswitch completion <bash|zsh|fish|powershell>`

Prints a shell completion script to stdout.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Generic failure (most user errors land here) |
| `2` | Bad invocation — unknown flag or missing required arg |
| `3` | Daemon unreachable |
| `4` | Daemon returned a structured error with a non-recoverable code |
| `5` | Privileged-port error (`EACCES_PRIVILEGED_PORT`) — distinct so scripts can prompt |
| `6` | Conflict (`CONFLICT` or `EADDRINUSE`) |
| `7` | Validation error (`VALIDATION`) |

## Output and TTY behavior

- When stdout is a TTY and `--json` is not set: human format with colors (unless `--no-color`).
- When stdout is not a TTY: human format without colors, no spinners, no progress bars.
- `--json` always disables colors and decorations regardless of TTY.

## Env vars

| Var | Effect |
| --- | --- |
| `PORTSWITCH_CONFIG` | Override config path. Same as `--config`. |
| `PORTSWITCH_DAEMON_URL` | Override daemon URL. Same as `--daemon-url`. |
| `NO_COLOR` | Disable colors. |
| `PORTSWITCH_LOG_LEVEL` | Set CLI's own logging verbosity (`error`, `warn`, `info`, `debug`). Does not affect daemon. |
