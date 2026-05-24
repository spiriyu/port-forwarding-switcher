# Config

## File location

Resolved by a single helper in `libs/shared` (`resolveConfigPath()`); never hardcode. Order:

1. `--config <path>` CLI flag, if passed.
2. `PORTSWITCH_CONFIG` env var, if set.
3. OS-standard user config dir:
   - macOS: `~/Library/Application Support/portswitch/config.json`
   - Linux: `$XDG_CONFIG_HOME/portswitch/config.json`, fallback `~/.config/portswitch/config.json`
   - Windows: `%APPDATA%\portswitch\config.json`

If the resolved path does not exist on daemon startup, the daemon creates it with the default contents below.

## File format

JSON. Pretty-printed with 2-space indent (so it's diff-friendly if a user puts it under version control). Schema versioned with `schemaVersion` for forward compatibility.

### Default contents

```json
{
  "schemaVersion": 1,
  "daemon": {
    "port": 47600,
    "logRetention": { "maxFiles": 10, "maxFileBytes": 5242880 }
  },
  "mappings": []
}
```

### Mapping shape

```json
{
  "id": "01HX4Z...",
  "name": "api dev",
  "sourceHost": "127.0.0.1",
  "sourcePort": 8080,
  "targetHost": "127.0.0.1",
  "targetPort": 3000,
  "enabled": true,
  "drainTimeoutMs": 30000,
  "createdAt": "2026-05-21T10:00:00.000Z",
  "updatedAt": "2026-05-21T10:34:12.512Z"
}
```

- `id`: ULID, assigned by the daemon. Never reused.
- `name`: user-supplied label; need not be unique. Empty string is allowed.
- `sourceHost`: defaults to `"127.0.0.1"`. `"0.0.0.0"` is allowed but the UI shows a warning.
- `drainTimeoutMs`: per-mapping override of the daemon default (30s). 0 means "close immediately on disable."

### Daemon settings

#### `daemon.port`

The port the daemon's HTTP+WS API binds on (`127.0.0.1` only). Default `47600`. Changing this requires restarting the daemon. Clients discover the port from the same config file — see [discovery](#client-discovery).

#### `daemon.logRetention`

`maxFiles`: how many rotated log files to keep. `maxFileBytes`: per-file size before rotation. See [logging](./logging.md#rotation).

## Write semantics

- **Only the daemon writes.** Clients send REST mutations; the daemon updates memory and then writes the file.
- **Atomic writes.** Write to `config.json.tmp` in the same directory, `fsync`, then `rename` over `config.json`. Never partial-write.
- **One write per mutation, debounced 50ms.** Bulk operations flush a single write at the end (see API `/v1/mappings/bulk`).
- **External edits are detected but not auto-merged.** The daemon `fs.watch`es the file. If the inode changes (the user edited it manually), the daemon logs a warning, reloads, and emits a `daemon.configReloaded` WS event. Conflicts between the user's edit and in-flight client requests fall on the side of the file the user just saved — clients re-render from the new snapshot.

## Client discovery

Clients find the daemon by:

1. Reading the same `resolveConfigPath()` and looking at `daemon.port`.
2. Falling back to `47600` if the file is missing (daemon hasn't run yet).

The daemon writes its actual listening port back into `config.json` on startup (in case the configured one was busy and it bound to `port + 1`, etc.) so clients can always find it.

## Migration

When `schemaVersion` is bumped:

- The daemon refuses to start on a higher schema than it knows.
- On a lower schema, it runs migrations in order, writes the migrated file, and emits a one-time log entry.
- Migrations live in `libs/shared/config/migrations/v<n>-to-v<n+1>.ts`. Each is pure (input config → output config) and tested with fixture files.
