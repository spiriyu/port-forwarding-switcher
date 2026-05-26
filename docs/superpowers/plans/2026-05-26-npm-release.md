# npm Release Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish `@portswitch/cli` to public npmjs.com when a `v*` git tag is pushed.

**Architecture:** Three source changes — shebang in the CLI entry, package.json fields that make the CLI publishable, and a dedicated GitHub Actions release workflow that stamps the version from the tag, builds CLI + web UI, and publishes from `dist/apps/cli/` with npm provenance.

**Tech Stack:** GitHub Actions, npm, Nx (`@nx/esbuild:esbuild`), Node.js ≥18.

---

## File Map

| File | Change |
|---|---|
| `apps/cli/src/main.ts` | Add `#!/usr/bin/env node` shebang on line 1 |
| `apps/cli/package.json` | Replace stub with publishable fields |
| `.github/workflows/release.yml` | Create release workflow |

---

## Task 1: Add shebang to CLI entry point

**Files:**
- Modify: `apps/cli/src/main.ts:1`

The esbuild executor preserves a shebang when it is the first line of the entry file. Without it, `dist/apps/cli/main.cjs` won't be directly executable as a global binary.

- [ ] **Step 1: Add the shebang line**

  Open `apps/cli/src/main.ts`. The current first line is:
  ```typescript
  import { Command } from 'commander';
  ```

  Replace with (shebang first, then the existing import on the next line):
  ```typescript
  #!/usr/bin/env node
  import { Command } from 'commander';
  ```

- [ ] **Step 2: Build the CLI and verify the shebang appears in the output**

  ```bash
  npx nx run cli:build
  head -1 dist/apps/cli/main.cjs
  ```

  Expected output:
  ```
  #!/usr/bin/env node
  ```

  If the output is `"use strict";` instead, the shebang was not preserved — stop and investigate the esbuild executor version.

- [ ] **Step 3: Commit**

  ```bash
  git add apps/cli/src/main.ts
  git commit -m "feat(cli): add shebang for global npm binary"
  ```

---

## Task 2: Update `apps/cli/package.json` for npm publishing

**Files:**
- Modify: `apps/cli/package.json`

The esbuild executor copies `apps/cli/package.json` verbatim to `dist/apps/cli/package.json` at build time. All fields added here will appear in the published package.

- [ ] **Step 1: Replace `apps/cli/package.json` with the publishable version**

  Current content:
  ```json
  {
    "name": "@portswitch/cli",
    "version": "0.0.1",
    "private": true
  }
  ```

  Replace entirely with:
  ```json
  {
    "name": "@portswitch/cli",
    "version": "0.0.1",
    "main": "./main.cjs",
    "bin": {
      "portswitch": "./main.cjs"
    },
    "files": [
      "main.cjs",
      "ui"
    ],
    "publishConfig": {
      "access": "public"
    },
    "engines": {
      "node": ">=18.0.0"
    }
  }
  ```

  Key fields:
  - `"private"` removed — package is now publishable
  - `"main": "./main.cjs"` — entry point for programmatic use
  - `"bin"` — registers the `portswitch` command when installed globally
  - `"files"` — only `main.cjs` and `ui/` are included; the `src/` directory in dist is excluded
  - `"publishConfig": { "access": "public" }` — required for scoped packages on the public npm registry
  - `"engines"` — communicates Node.js version requirement

- [ ] **Step 2: Build and verify the dist package.json has all expected fields**

  ```bash
  npx nx run cli:build
  cat dist/apps/cli/package.json
  ```

  Expected output (exact JSON):
  ```json
  {
    "name": "@portswitch/cli",
    "version": "0.0.1",
    "main": "./main.cjs",
    "bin": {
      "portswitch": "./main.cjs"
    },
    "files": [
      "main.cjs",
      "ui"
    ],
    "publishConfig": {
      "access": "public"
    },
    "engines": {
      "node": ">=18.0.0"
    }
  }
  ```

  If any field is missing (e.g. `bin` or `files`), the esbuild executor is stripping fields — stop and report before proceeding.

- [ ] **Step 3: Verify a dry-run publish lists only the intended files**

  ```bash
  cd dist/apps/cli && npm publish --dry-run --access public 2>&1 | grep -E "npm notice|Tarball"
  cd ../../../
  ```

  Expected: output lists `main.cjs` and `ui/` files. Must NOT list `src/` files. Example:
  ```
  npm notice 📦  @portswitch/cli@0.0.1
  npm notice === Tarball Contents ===
  npm notice 1.2kB  package.json
  npm notice 847kB  main.cjs
  npm notice 123kB  ui/index.html
  ...
  ```

  If `src/` appears in the tarball contents, the `files` field is not being respected — stop and investigate.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/cli/package.json
  git commit -m "feat(cli): configure package.json for npm publishing"
  ```

---

## Task 3: Create the release GitHub Actions workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create `.github/workflows/release.yml`**

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
        id-token: write

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

  Notes on key decisions:
  - `id-token: write` — required for `--provenance` (SLSA attestation, links the package to this exact Actions run on npmjs.com)
  - `Stamp version from tag` runs BEFORE `Build CLI + Web UI` — the version stamp updates `apps/cli/package.json` in-place so esbuild copies the correct version into `dist/apps/cli/package.json`
  - `cli:copy-ui` (not just `cli:build`) — this Nx target depends on both the CLI build and the web build, then copies the web assets into `dist/apps/cli/ui/`
  - `working-directory: dist/apps/cli` — npm publishes the contents of this directory, not the repo root
  - `NODE_AUTH_TOKEN` — npm reads this env var when `registry-url` is set in `setup-node`

- [ ] **Step 2: Validate the workflow YAML syntax**

  ```bash
  npx js-yaml .github/workflows/release.yml > /dev/null && echo "YAML valid" || echo "YAML invalid"
  ```

  Expected: `YAML valid`

  If `js-yaml` is not available: `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/release.yml','utf8')); console.log('YAML valid')"` — both work.

- [ ] **Step 3: Verify the existing CI workflow is unchanged**

  ```bash
  cat .github/workflows/ci.yml | grep "name:"
  ```

  Expected: shows `name: CI` — existing workflow is untouched.

- [ ] **Step 4: Commit**

  ```bash
  git add .github/workflows/release.yml
  git commit -m "feat(ci): add release workflow for npm publish on v* tags"
  ```

---

## Task 4: End-to-end smoke test

No code changes. Verifies the full pipeline manually before pushing a real tag.

- [ ] **Step 1: Build the full stack**

  ```bash
  npx nx run cli:copy-ui
  ```

  Expected: exits 0. `dist/apps/cli/` should contain `main.cjs`, `package.json`, `ui/`.

- [ ] **Step 2: Verify the shebang is in the output**

  ```bash
  head -1 dist/apps/cli/main.cjs
  ```

  Expected: `#!/usr/bin/env node`

- [ ] **Step 3: Simulate the version stamp**

  ```bash
  npm pkg set version=1.0.0 --prefix apps/cli
  npx nx run cli:build
  cat dist/apps/cli/package.json | grep '"version"'
  ```

  Expected: `"version": "1.0.0"`

  Restore to placeholder version:

  ```bash
  npm pkg set version=0.0.1 --prefix apps/cli
  git checkout apps/cli/package.json
  ```

- [ ] **Step 4: Run a dry-run publish from dist**

  ```bash
  npx nx run cli:copy-ui
  cd dist/apps/cli && npm publish --dry-run --access public 2>&1 | head -30
  cd ../../../
  ```

  Expected: lists `main.cjs` and `ui/` files, no `src/` files, no auth errors (dry-run does not require an npm token).

---

## Secret Setup (manual, outside the codebase)

These steps cannot be automated — they require browser access.

1. **Create npm Automation token:**
   - Log in to npmjs.com
   - Account Settings → Access Tokens → Generate New Token → select **Automation**
   - Copy the token (shown only once)

2. **Add token to GitHub repository:**
   - GitHub repo → Settings → Secrets and variables → Actions → New repository secret
   - Name: `NPM_TOKEN`
   - Value: paste the token from step 1

3. **Verify the token has publish rights** to `@portswitch/cli` (either you own the `@portswitch` scope or you are a collaborator with publish access).

---

## How to Cut a Release

Once all tasks are complete and the secret is in place:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Then watch the **Actions** tab in the GitHub repo — the `Release` workflow fires, runs CI, builds, and publishes `@portswitch/cli@1.0.0` to npmjs.com.
