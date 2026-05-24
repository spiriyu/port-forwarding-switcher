# Logging

## Format: JSON Lines

Every log entry is one JSON object, one per line, UTF-8, no trailing comma, terminated by `\n`. JSONL was chosen because it streams cleanly, tails cleanly with `tail -f | jq`, and is trivially parseable by anything from a shell to a log shipper.

### Entry shape

```json
{ "ts": "2026-05-21T10:34:12.512Z",
  "level": "info",
  "category": "mapping",
  "mappingId": "01HX4Z...",
  "msg": "listener bound",
  "ctx": { "sourceHost": "127.0.0.1", "sourcePort": 8080, "targetHost": "127.0.0.1", "targetPort": 3000 } }
```

Fields:

| Field | Required | Notes |
| --- | --- | --- |
| `ts` | yes | RFC 3339, ms precision, `Z` |
| `level` | yes | `debug` \| `info` \| `warn` \| `error` |
| `category` | yes | `daemon` \| `api` \| `mapping` \| `service` \| `config` |
| `mappingId` | when relevant | absent for daemon-wide events |
| `msg` | yes | short human-readable string; stable enough to grep on |
| `ctx` | optional | structured context; keys vary by event but documented per-category in this file |
| `err` | on errors | `{ code, message, stack? }` — `stack` only at `debug` level |

`msg` strings are kept short and stable. Do not interpolate variable values into `msg`; put them in `ctx`.

### Categories and notable events

- `daemon`: `startup`, `shutdown`, `configReloaded`, `apiBound`
- `api`: `request` (with `method`, `path`, `status`, `durationMs`, no body), `wsConnected`, `wsDisconnected`
- `mapping`: `listenerBound`, `listenerUnbound`, `connectionAccepted`, `connectionClosed` (`bytesIn`, `bytesOut`, `durationMs`), `connectionError`
- `service`: install / uninstall / start / stop events from the service manager
- `config`: `loaded`, `saved`, `migrationApplied`, `externalEditDetected`

`connectionAccepted` and `connectionClosed` are **info**-level. They will be high-volume on busy mappings; log retention defaults are sized accordingly. They can be filtered out at the API or CLI side via the `category`/`level` filter.

## Files

- Active file: `<userDataDir>/logs/daemon.log.jsonl`
- Rotated files: `<userDataDir>/logs/daemon.log.<N>.jsonl` where `N` increases with age (1 = most recent rotation).
- `userDataDir` resolved by `resolveLogPath()` in `libs/shared`. Paths:
  - macOS: `~/Library/Logs/portswitch/`
  - Linux: `$XDG_STATE_HOME/portswitch/logs/`, fallback `~/.local/state/portswitch/logs/`
  - Windows: `%LOCALAPPDATA%\portswitch\logs\`

## Rotation

Policy lives in `daemon.logRetention` in [config](./config.md#daemonlogretention):

- `maxFileBytes`: when the active file exceeds this (checked after each write batch), rotate. Default 5 MB.
- `maxFiles`: keep at most this many rotated files. Default 10. Older files are deleted on rotation.

Rotation algorithm (atomic):

1. Close the active file handle.
2. Rename `daemon.log.<N>.jsonl` → `daemon.log.<N+1>.jsonl` for N from `maxFiles - 1` down to 1.
3. Rename `daemon.log.jsonl` → `daemon.log.1.jsonl`.
4. Open a new active file.
5. If the rotation count exceeded `maxFiles`, delete the oldest.

No external `logrotate` integration in v1; the daemon owns rotation. If a user wants `logrotate`, they can disable internal rotation by setting `maxFiles: 0` (v1.x — explicitly deferred).

## Tail-over-WebSocket

Clients receive log entries by sending `{ "type": "log.subscribe", "payload": { "mappingIds": [...]?, "levels": [...]?, "categories": [...]? } }`. The daemon then streams matching entries as `{ "type": "log", "payload": { "entry": {...} } }`.

- Multiple subscribes from the same client replace the prior filter.
- `log.unsubscribe` stops the stream.
- The daemon buffers up to 500 entries per slow consumer. If a client is too slow, the daemon drops oldest and emits a single `{ "type": "log.dropped", "payload": { "count": N } }` notice. Drops are also written to the file at `warn` level.

The historical paged API (`GET /v1/logs`) reads from the active and rotated files. It does not look at the in-memory ring buffer.

## What we don't log

- Request or response bodies of the daemon's own API.
- Forwarded TCP payload bytes (we count them; we don't capture them).
- Any value identified in `libs/shared/redact.ts` as sensitive (none in v1, but the helper is in place).

## Levels at startup

Default level is `info`. Set via `PORTSWITCH_LOG_LEVEL=debug` env var on the daemon process, or via the desktop Settings → Diagnostics (which restarts the daemon).
