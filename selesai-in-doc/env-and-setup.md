# Environment & run setup

Notes on how this project is built, run, and tested locally.

## Three ways the app runs

1. **Global install** — `selesai` binary (`/opt/homebrew/bin/selesai` →
   `/opt/homebrew/lib/node_modules/@selesai/code/dist/cli.js`). Point-of-truth for daily use but
   a **separate copy** from this repo's `src/`.
2. **Built dist in repo** — `npm run build` → `dist/`.
3. **Run from source** — `npm run dev` (`tsx src/cli.ts`) — loads `src/` directly, **no build**.
   Best for iterating on changes.

## The "stale global build" gotcha (IMPORTANT)

`npm i -g .` installs a fresh copy into `/opt/homebrew/lib/node_modules/@selesai/code`, but any
`selesai` **process already running** keeps its old in-memory code until restarted. Symptoms of
running stale code: new features "don't work" even though the source has them.

Check which build a running process is on by looking at its **start time** vs. when you last
reinstalled. Multiple `selesai` processes may be running different builds simultaneously.

**To update the global install from this repo:**
```bash
npm run build && npm i -g .
# then fully quit and restart any running selesai windows
```

## Run / build / test

```bash
npm run dev          # interactive, run from src (no build)
npm run dev:print    # non-interactive --print, one-shot
npm run build        # tsgo compile -> dist/ + copy assets
npm test             # canonical vitest suite (see package.json "test")
```

## Shared config

- User settings: `~/.selesai/agent/settings.json`
- User models override: `~/.selesai/agent/models.json` (merged with bundled `src/defaults/models.json`)
- App config dir resolver: `getAgentDir()` in `src/config.ts` (this fork may use `~/.selesai` vs
  upstream `~/.pi` — see the `config-dir-leak-audit` skill if that drifts).
- Bundled defaults: `src/defaults/settings.json`, `src/defaults/models.json`

**Note:** `npm run dev` shares the same `~/.selesai` config as the global install. Use a scratch
cwd / distinct session when running a dev instance alongside production to avoid session-file races.

## Merge behavior of models.json (important for gemma-4)

`ModelConfig.loadMerged()` (in `src/core/model-config.ts`, `mergeProviderConfig`) merges user
`models.json` over bundled defaults **by model id**. Models present only in the bundled defaults
(e.g. `gemma-4`, `auto`) survive even if the user's `models.json` lists its own `tokenin` models.
So `gemma-4` is resolvable even though the user's file does not list it.
