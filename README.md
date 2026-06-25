# @selesai/code

Selesai coding agent — a terminal-based AI coding agent built on the
[`pi`](https://github.com/earendil-works/pi-coding-agent) runtime.

This repo is the Selesai-branded fork/repackage. It builds the same TypeScript
source and ships a `selesai` CLI binary plus an importable SDK.

---

## Prerequisites

- **Node.js ≥ 20** (ESM, `Node16` module resolution)
- **npm ≥ 10**
- A POSIX shell (`shx` handles cross-platform file ops in build scripts)
- No native compilation required for the agent itself; one dependency
  (`@silvia-odwyer/photon-node`) ships prebuilt native binaries via npm
  optionalDependencies, so just `npm install`.

## Install (from source)

```bash
git clone git@github.com:SelesaiInTech/selesai-code.git
cd selesai-code
npm install
```

## Build

```bash
npm run build
```

What it does:

1. `tsgo -p tsconfig.build.json` — compiles `src/**/*.ts` → `dist/` with
   declarations, source maps, and rewritten `.ts`→`.js` import extensions.
2. `chmod +x dist/cli.js` — makes the CLI entrypoint executable.
3. `copy-assets` — copies non-TS assets into `dist/`:
   - `src/modes/interactive/theme/*.json`
   - `src/modes/interactive/assets/*.png`
   - `src/core/export-html/{template.html,template.css,template.js}`
   - `src/core/export-html/vendor/*.js`

Clean rebuild:

```bash
npm run clean && npm run build
```

## Run locally

After building, invoke the CLI directly:

```bash
./dist/cli.js
# or link it globally:
npm link
selesai
```

Or run from source without linking (TypeScript via `jiti` is a runtime dep):

```bash
node --experimental-strip-types src/cli.ts
```

> Note: the `bin` field maps `selesai` → `dist/cli.js`, so the published
> package exposes a `selesai` command once installed.

## Project layout

```
src/
  cli.ts            CLI entrypoint
  index.ts          public SDK exports (main/types)
  cli/startup-ui.ts  pre-session TUI prompts (first-run setup, selectors)
  modes/             interactive, non-interactive, headless modes
  core/              agent loop, settings, package manager, export-html
  config.ts          app name, config dir, paths
docs/                user + contributor documentation
examples/           extension / SDK examples
```

Config dir on disk is `~/.selesai` (see `piConfig.configDir` in
`package.json`).

---

## Publish to npm

The package is published as **`@selesai/code`** (scoped). There is **no
`prepare`/`prepublishOnly` script** — you must build before publishing so
`dist/` exists and is included by the `files` allowlist.

### 1. Authenticate

```bash
# one-time: log in to npm under the @selesai scope owner account
npm login
npm whoami        # confirm you're authenticated
```

> Publishing a scoped package publicly requires the Selesai org (or your
> account) to own the `@selesai` scope. If the scope isn't created yet:
> ```bash
> npm org create selesai <your-npm-username>
> ```

### 2. Bump version

There's no `version` script wired up; use the standard flow:

```bash
npm version patch      # 0.1.0 -> 0.1.1   (bugfix)
npm version minor      # 0.1.0 -> 0.2.0   (backward-compatible feature)
npm version major       # 0.1.0 -> 1.0.0   (breaking)
```

This updates `package.json`, commits, and tags. Update `CHANGELOG.md`
in the same commit if you maintain one (it's in the `files` allowlist).

### 3. Build, verify pack contents, publish

```bash
# build dist/ (REQUIRED — npm publishes whatever is on disk)
npm run build

# dry-run: inspect exactly what gets published (must NOT include src/)
npm pack --dry-run

# publish to the public registry
npm publish --access public
```

`--access public` is mandatory for scoped packages unless you intend a paid
private package; without it the publish fails by default.

### 4. Verify

```bash
npm view @selesai/code version
# or in a clean sandbox:
npx @selesai/code@latest --help
```

### Continuous publishing (CI)

Minimal GitHub Actions snippet — adapt to your runner auth (e.g. an
`NPM_TOKEN` secret with publish rights on `@selesai`):

```yaml
# .github/workflows/publish.yml
name: publish
on:
  release:
    types: [published]
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org
      - run: npm ci
      - run: npm run build
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### Publishing checklist

- [ ] `npm run clean && npm run build` succeeds with no errors
- [ ] `npm pack --dry-run` shows only `dist/`, `docs/`, `examples/`,
      `CHANGELOG.md`, `package.json`, `README.md`, `LICENSE` — **never `src/`**
- [ ] Version bumped and committed
- [ ] Logged in as an account with publish rights on `@selesai`
- [ ] `--access public` passed (scoped package)
- [ ] `npm view @selesai/code version` matches the version you intended

---

## Notes & gotchas

- **No `prepublishOnly` hook.** Forgetting `npm run build` before
  `npm publish` will publish a stale (or empty) `dist/`. Always build.
- **`tsgo`** is `@typescript/native-preview` (the Go-backed TS compiler
  preview) — it's a devDependency, so CI/`npm ci` installs it automatically.
- **Asset copy is manual**, not a bundler step. If you add new JSON/PNG/HTML
  themes or vendor JS, update the `copy-assets` script in `package.json`.
- **Scoped publish.** `@selesai/code` is under a scope; first-time publish
  needs `--access public` (public visibility is free, private costs money).
- **Binary name.** Users get a `selesai` command after `npm i -g @selesai/code`.