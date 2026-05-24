# Release process

## Versioning

portswitch follows [Semantic Versioning](https://semver.org). The version is set in the root `package.json` and propagated to `apps/daemon/package.json`, `apps/cli/package.json`, and `apps/desktop/package.json` before every release.

The daemon reports its version string via `GET /v1/health` → `version` and `GET /v1/diagnostics` → `daemonVersion`. Keep these in sync with `package.json`.

## Pre-release checklist

- [ ] All tests pass on the target platform: `npx nx run-many -t lint typecheck test`
- [ ] The version has been bumped in all `package.json` files
- [ ] `CHANGELOG.md` (if present) has an entry for this version
- [ ] `docs/spec/` reflects any changed API or CLI surface
- [ ] A git tag `vX.Y.Z` has been created and pushed

## Building release artifacts

### CLI (all platforms)

```bash
npx nx run cli:build
# Output: dist/apps/cli/main.js  (self-contained, no node_modules needed at runtime)
```

### Desktop app

```bash
npx nx run desktop:package
# Runs electron-builder for the current platform.
# Output: dist/apps/desktop/{mac,linux,win}/
```

To cross-compile for a different platform, set the `--platform` flag in the electron-builder config or use a CI matrix (see `.github/workflows/`).

## Publishing the CLI to npm

```bash
# From the repo root
npm version patch|minor|major --workspace=apps/cli
npm publish --workspace=apps/cli --access public
```

## Git tag

```bash
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```

## Post-release

- Verify the daemon's `/v1/health` response returns the new version string
- Smoke-test `portswitch service install && portswitch service start` on each supported platform
- Close / tag the GitHub milestone (if used)
