# Overview

## What portswitch is

A host-local TCP port-forwarding manager. Users define mappings (source port → target `host:port`) and toggle them on or off with one click in a desktop app, one command in a CLI, or one keystroke from the system tray. A long-running daemon owns the sockets; clients are thin.

## Why three processes

| Process | Role | Lifetime |
| --- | --- | --- |
| **daemon** | Owns every listening socket. Routes TCP traffic. Persists config. Emits events. | System service. Starts at user login, runs until stopped. |
| **CLI** (`portswitch`) | Thin HTTP client. Scripts, dev-loop commands, service install. | Short-lived; one command per invocation. |
| **desktop** (Electron) | Thin HTTP+WS client. Window + tray UI. Onboarding + auto-update. | User-controlled; can run in tray when window closed. |

The daemon is the **only** writer of mapping state and the **only** owner of OS sockets. Clients cannot bind, cannot mutate the config file directly, and cannot fork their own forwarder. This rule exists so that two clients running at once (common: tray app + CLI script) never disagree about reality.

## Forwarding model (v1)

- **TCP only.** UDP, protocol-aware HTTP, WebSocket-aware passthrough, and TLS termination are explicit non-goals for v1.
- **Targets may be any `host:port`** — loopback, LAN, or remote. There is no allowlist in v1; the user is responsible for what they point traffic at. (We document this clearly in the desktop app's mapping editor.)
- **Source binds default to `127.0.0.1`** for safety. The user can opt a mapping into `0.0.0.0` per-mapping; this is surfaced in the UI with a visible warning.
- **Hot updates for all CRUD.** Add, remove, toggle, and edit (including changing the source port) apply live. In-flight connections drain gracefully — see [api](./api.md#draining) for the contract.

## Trust boundary

The daemon binds its HTTP+WS API on `127.0.0.1` only. There is no auth token in v1; loopback is the trust boundary. This is documented in [api](./api.md#security-model) so it's not mistaken for an oversight.

## Non-goals (v1)

These are explicitly out of scope. Don't add them "while you're in there."

- Non-TCP protocols (UDP, QUIC, raw IP).
- Protocol-aware routing (host-header, path, SNI).
- TLS termination or certificate management.
- Authentication on the daemon API.
- Remote daemons (managing a forwarder on another machine).
- Per-mapping bandwidth/throughput limits or traffic shaping.
- Multi-user / multi-tenant operation. One config per OS user.

## Data flow

```
User input
  │
  ├── CLI: HTTP POST → daemon
  └── Desktop: HTTP POST → daemon
                              │
                              ├── mutate in-memory state
                              ├── write config.json (atomic rename)
                              ├── rebind/drain affected listeners
                              └── broadcast WS event → all connected clients
                                                          │
                                                          ├── CLI (if `--watch`)
                                                          └── Desktop (always)
```

Both clients re-render off the event. Neither client trusts its local cache as authoritative once the WS is open — the daemon is the source of truth.
