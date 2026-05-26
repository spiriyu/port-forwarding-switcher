# npm Release Pipeline — Design Spec

**Date:** 2026-05-26
**Status:** Approved

## Summary

Publish `@portswitch/cli` to the public npmjs.com registry via a dedicated GitHub Actions release workflow triggered by `v*` git tags. The workflow runs the full CI gate, stamps the version from the tag, builds the CLI + embedded web UI, and publishes with npm provenance.

---

## What Gets Published

Single package: **`@portswitch/cli`**

Published contents (controlled by the `files` field):
- `main.cjs` — the esbuild-bundled CLI/daemon entry point
- `ui/` — the pre-built React web UI, served by the daemon at `/ui`
- `package.json` — auto-included by npm

Everything else in `dist/apps/cli/` (e.g. `src/` sourcemaps) is excluded.

After global install (`npm install -g @portswitch/cli`), the `portswitch` binary is available in PATH.

---

## Source Changes

### 1. `apps/cli/src/main.ts`

Add shebang as the first line:

```
#!/usr/bin/env node
```

esbuild preserves shebangs from the entry point in the bundled output, so `dist/apps/cli/main.cjs` will be executable without a wrapper script.

### 2. `apps/cli/package.json`

Replace the current `private: true` stub with:

```json
{
  "name": "@portswitch/cli",
  "version": "0.0.1",
  "main": "./main.cjs",
  "bin": { "portswitch": "./main.cjs" },
  "files": ["main.cjs", "ui"],
  "publishConfig": { "access": "public" },
  "engines": { "node": ">=18.0.0" }
}
```

The `@nx/esbuild:esbuild` executor copies `apps/cli/package.json` into `dist/apps/cli/package.json` at build time, so these fields flow through automatically.

`publishConfig.access: "public"` is required for scoped packages on the public npm registry. The release workflow also passes `--access public` as a belt-and-suspenders safeguard.

---

## GitHub Actions Workflow

### File: `.github/workflows/release.yml`

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    name: Build & Publish
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write   # required for npm provenance

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          registry-url: 'https://registry.npmjs.org'

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npx nx run-many -t lint

      - name: Typecheck
        run: npx nx run-many -t typecheck

      - name: Test
        run: npx nx run-many -t test

      - name: Stamp version from tag
        run: npm pkg set version=${GITHUB_REF_NAME#v} --prefix apps/cli

      - name: Build CLI + Web UI
        run: npx nx run cli:copy-ui

      - name: Publish to npm
        run: npm publish --provenance --access public
        working-directory: dist/apps/cli
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### Step-by-step rationale

| Step | Why |
|---|---|
| `id-token: write` | Enables SLSA provenance attestation — npm shows the package was built from this exact Actions run |
| Lint → Typecheck → Test before build | A broken tag cannot publish a broken package |
| `npm pkg set version=…` before build | Version stamp lands in `dist/apps/cli/package.json` via the esbuild copy step |
| `cli:copy-ui` (not just `cli:build`) | Ensures the web UI is bundled into `dist/apps/cli/ui/` before publish |
| `--provenance --access public` | Provenance requires `id-token: write`; `--access public` is required for scoped packages |
| `NODE_AUTH_TOKEN` | npm uses this env var to authenticate publish when `registry-url` is set in setup-node |

---

## Required Secret

| Secret name | Value | How to create |
|---|---|---|
| `NPM_TOKEN` | npm Automation token | npmjs.com → Account Settings → Access Tokens → Generate → **Automation** type |

Add to: GitHub repo → Settings → Secrets and variables → Actions → New repository secret.

Automation tokens bypass 2FA and are the recommended token type for CI publish workflows.

---

## Release Flow

```
git tag v1.2.3
git push origin v1.2.3
      ↓
GitHub Actions: release.yml fires
      ↓
CI gate: lint → typecheck → test
      ↓
npm pkg set version=1.2.3 --prefix apps/cli
      ↓
npx nx run cli:copy-ui
  (builds cli → builds web → copies web into dist/apps/cli/ui/)
      ↓
npm publish --provenance --access public
  (from dist/apps/cli/, publishes main.cjs + ui/)
      ↓
@portswitch/cli@1.2.3 live on npmjs.com
```

---

## What Is Not in Scope

- Changelog generation (no semantic-release, no changesets)
- GitHub Release creation (can be done manually after tagging)
- Publishing `@portswitch/shared` or other libs separately
- Pre-release / `next` dist-tag support
