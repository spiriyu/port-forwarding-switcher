# portswitch docs

Product name placeholder: **portswitch**. Rename in one pass before v1.0 if it changes.

## Specs

The spec is the contract — anything that ships must match it. When implementation needs to diverge, update the spec in the same change.

- [overview](./spec/overview.md) — components, data flow, non-goals
- [api](./spec/api.md) — daemon HTTP + WebSocket protocol and error codes
- [config](./spec/config.md) — JSON config schema, file location, write rules
- [cli](./spec/cli.md) — CLI command surface, flags, exit codes
- [desktop](./spec/desktop.md) — Electron app UX: main window, tray, onboarding, auto-update
- [service](./spec/service.md) — system service install/uninstall/status and elevation flow
- [logging](./spec/logging.md) — JSONL log format and tail-over-WS protocol

## Plan

- [roadmap](./plan/roadmap.md) — phased milestones with exit criteria

## Guides

- [contributing](./contributing.md) — how to set up, architecture rules, testing philosophy
- [release](./release.md) — versioning, build artifacts, publishing checklist

## Conventions

- All identifiers, paths, and error codes used across components are defined **once** in `libs/shared` and imported. If a string appears in two places, one of them is wrong.
- Spec docs prefer concrete examples (request bodies, file fragments) over prose. If you can't write the example, the spec isn't done.
- Anything labeled "v1.x" is a deliberate post-v1 deferral, not a TODO. v1 ships without it.
