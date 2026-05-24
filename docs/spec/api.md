# Daemon API

Base URL: `http://127.0.0.1:<port>` (default `47600`; see [config](./config.md#daemonport)).

All request and response bodies are JSON. All timestamps are RFC 3339 with millisecond precision and `Z` suffix.

## Security model

- The daemon binds **only** on `127.0.0.1`. Attempts to bind on any other interface are a bug.
- No auth token, no TLS. Loopback is the trust boundary.
- CORS: the daemon sets `Access-Control-Allow-Origin: http://127.0.0.1:*` and `file://`. The Electron renderer talks to the daemon directly from the main process, not the renderer — the CORS allowance is for development/debugging only.

If a future version exposes the daemon beyond loopback, this section is the place to add the auth design — do **not** sneak it in elsewhere.

## REST endpoints

### `GET /v1/health`

Returns `{ "status": "ok", "version": "<semver>", "uptimeMs": <int> }`. Used by clients to detect the daemon is up before showing real UI.

### `GET /v1/mappings`

Returns all mappings.

```json
{
  "mappings": [
    {
      "id": "01HX4Z9...",
      "name": "api dev",
      "sourceHost": "127.0.0.1",
      "sourcePort": 8080,
      "targetHost": "127.0.0.1",
      "targetPort": 3000,
      "enabled": true,
      "status": "listening",
      "stats": { "openConnections": 2, "totalConnections": 137, "bytesIn": 81234, "bytesOut": 99001 },
      "createdAt": "2026-05-21T10:00:00.000Z",
      "updatedAt": "2026-05-21T10:34:12.512Z"
    }
  ]
}
```

`status` is one of: `listening`, `disabled`, `error`. When `error`, an `error` field is present with `{ code, message }`.

### `POST /v1/mappings`

Create a mapping.

Request:

```json
{
  "name": "api dev",
  "sourceHost": "127.0.0.1",
  "sourcePort": 8080,
  "targetHost": "127.0.0.1",
  "targetPort": 3000,
  "enabled": true
}
```

`name`, `sourceHost`, and `enabled` are optional (defaults: empty string, `"127.0.0.1"`, `false`). Returns `201 Created` with the full mapping object.

### `PATCH /v1/mappings/:id`

Partial update. Any subset of `name`, `sourceHost`, `sourcePort`, `targetHost`, `targetPort`, `enabled`. Returns the updated mapping. All edits are hot — see [draining](#draining).

### `DELETE /v1/mappings/:id`

Removes the mapping. Drains in-flight connections (see below). Returns `204 No Content`.

### `POST /v1/mappings/:id/toggle`

Convenience for flipping `enabled`. Returns the updated mapping. Equivalent to `PATCH { enabled: !current }`.

### `POST /v1/mappings/bulk`

Single-shot multi-operation, for the desktop app's "import config" / "apply preset" flows. Body:

```json
{ "operations": [
    { "op": "create", "mapping": { ... } },
    { "op": "update", "id": "...", "patch": { ... } },
    { "op": "delete", "id": "..." }
] }
```

Applied transactionally with respect to the config file (single atomic write at the end). Listener changes are applied per-operation in order. Returns `{ "results": [ { "ok": true, "mapping": {...} }, ... ] }`.

### `GET /v1/logs?from=<iso>&limit=<n>&mappingId=<id>`

Returns a page of historical log entries. See [logging](./logging.md) for the entry shape. `limit` defaults to 200, max 1000. For live tail, use the WebSocket — do not poll.

### `GET /v1/diagnostics`

Returns daemon process info, listening port count, OS, version, config file path, log file path. Used by the desktop app's "Help → Diagnostics" panel.

## WebSocket events

Endpoint: `ws://127.0.0.1:<port>/v1/events`

Each message is one JSON object with a `type` and a `payload`.

| `type` | Fired when | Payload |
| --- | --- | --- |
| `hello` | On connect | `{ serverVersion, snapshot: { mappings: [...] } }` |
| `mapping.created` | After create | `{ mapping }` |
| `mapping.updated` | After update or toggle | `{ mapping, previousEnabled }` |
| `mapping.deleted` | After delete | `{ id }` |
| `mapping.status` | Listener state changes (listening → error, etc.) | `{ id, status, error? }` |
| `mapping.stats` | Throttled stat updates (max once per 500ms per mapping) | `{ id, stats }` |
| `log` | New log entry the client subscribed to | `{ entry }` (see [logging](./logging.md)) |
| `daemon.shutdown` | Daemon is exiting | `{ reason }` |

Clients send:

| `type` | Effect |
| --- | --- |
| `log.subscribe` | `{ mappingIds?: string[], levels?: string[] }` — opt into `log` events. Without subscribing, the client receives none. |
| `log.unsubscribe` | Stops `log` events. |
| `ping` | Daemon replies with `pong`. App-level heartbeat. |

A client that disconnects and reconnects must resync from the `hello` snapshot; do not assume events seen before disconnect.

## Draining

When a mapping is disabled, deleted, or rebound to a different source port:

1. The listener stops accepting new connections **immediately**.
2. In-flight connections continue until either side closes, or for `drainTimeoutMs` (default 30s, configurable per-mapping), whichever is sooner.
3. After the deadline, remaining sockets are forcibly closed.
4. A `mapping.status` event fires when the drain completes (`status: "disabled"`).

The CLI's `--wait` flag on `disable`/`delete` blocks until the drain finishes; without it, the command returns as soon as the listener stops accepting.

## Errors

All error responses use:

```json
{ "error": { "code": "EADDRINUSE", "message": "Source port 8080 is already in use by another process.", "details": { ... } } }
```

HTTP status follows the code class (see below).

### Error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION` | 400 | Bad request shape or invalid field |
| `NOT_FOUND` | 404 | Mapping ID doesn't exist |
| `CONFLICT` | 409 | Source `host:port` is already claimed by another mapping in this daemon |
| `EADDRINUSE` | 409 | OS reports the port is already bound by some other process |
| `EACCES_PRIVILEGED_PORT` | 403 | Source port <1024 and daemon lacks privilege to bind it |
| `EACCES` | 403 | OS-level permission denied for any other reason |
| `ETARGET_UNREACHABLE` | 502 | Target `host:port` refused or timed out on listener startup |
| `INTERNAL` | 500 | Unhandled — should never happen, file a bug |

Clients must render `EACCES_PRIVILEGED_PORT` with platform-specific guidance — see [service](./service.md#privileged-ports).
