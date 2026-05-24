# Contributing

## Getting started

```bash
git clone https://github.com/your-org/portswitch.git
cd portswitch
npm install
npx nx run-many -t lint typecheck test   # everything should be green
```

## Repo structure

```
apps/
  daemon/        HTTP + WS API server; owns all listening sockets
  cli/           Thin CLI client (portswitch ...)
  desktop/       Electron app (main + preload + React renderer)
libs/
  shared/        Types, schemas, path helpers — shared by all apps
  proxy-core/    Pure TCP forwarding logic
  service-mgr/   launchd / systemd / Windows Service integration
docs/
  spec/          Authoritative specs for API, CLI, config, etc.
  plan/          Roadmap and milestones
```

## Architecture rules (non-negotiable)

1. **The daemon owns all sockets.** Never call `net.createServer()` outside `apps/daemon` or `libs/proxy-core`.
2. **Shared types live in `libs/shared`.** If a string or type appears in two packages, one import is wrong.
3. **WS events are advisory, REST is truth.** Clients validate state against REST responses; WS only triggers a re-fetch.
4. **Config writes go through the daemon API.** Clients must not write the JSON config directly.

## Working on a change

1. Create a feature branch from `main`.
2. Match the existing code style (TypeScript strict, no `any`, no comments unless the WHY is non-obvious).
3. Write tests in Vitest. For daemon changes, prefer integration tests that bind real ephemeral ports.
4. Run `npx nx run-many -t lint typecheck test` before pushing.
5. Open a PR against `main`.

## Testing philosophy

- **Daemon**: integration tests against a real in-process HTTP server (`createDaemon({ port: 0 })`). Mocking the HTTP layer defeats the purpose of an end-to-end networking stack.
- **proxy-core**: unit tests that actually bind TCP sockets on ephemeral ports.
- **service-mgr**: constructor DI to inject a command runner; real temp directories for file operations.
- **CLI**: unit tests for `parseAddress`, `DaemonClient`, output formatters, and Commander program construction.
- **Desktop**: IPC handler tests with a hand-rolled `ipcMain` mock; React component tests with `@testing-library/react` in jsdom.

## Commit style

- Short imperative subject line (`add bulk-disable endpoint`, not `Added bulk-disable endpoint`)
- Explain the WHY in the body if it's non-obvious
- No `Co-authored-by` lines unless genuinely co-authored

## Adding a new platform to service-mgr

1. Create `libs/service-mgr/src/platforms/<platform>.ts` implementing `ServiceManager`.
2. Add a branch to `libs/service-mgr/src/factory.ts`.
3. Write tests using constructor-injected command runners and `vi.stubEnv` for paths.
4. Update `docs/spec/service.md`.

## Spec changes

Any change to the HTTP API, CLI flags, config schema, or WS event format must be reflected in `docs/spec/` **in the same PR**. The spec is the contract.

## Questions

Open a GitHub issue or start a discussion.
