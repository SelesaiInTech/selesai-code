---
name: config-dir-leak-audit
description: Hunt hardcoded config-dir path literals (e.g. `~/.pi/agent`, `.pi/settings.json`) in a forked pi-based coding agent and route them through the host's resolvers. Use when forking pi to a new name (selesai, tau, …), when an extension silently reads/writes the wrong config dir, or when you see `".pi"` path literals in extension `.ts` files. Fire on any fork/audit work in a pi-derived codebase.
---

A config-dir **leak** is the upstream's config-dir name (`".pi"`) written as a path literal in code that runs on a **fork** (`.selesai`, `.tau`, …). The code points at the dead upstream dir and silently breaks. The fork renames the dir once in `package.json` (`piConfig.configDir`); the host's resolvers — `getAgentDir()`, `CONFIG_DIR_NAME`, `getSettingsPath()` — pick up the rename. Any literal `".pi"` bypasses them, so it is the one site the rename does not reach. Hunt leaks; route every real one through the host.

## Steps

1. **Find the leaks.** Grep the fork's vendored code for the upstream literal — the full set of candidates, not a sample:
   ```sh
   grep -rn '"\.pi"\|/\.pi/\|join([^)]*"\.pi"\|homedir(),\s*"\.pi\|\.pi/agent' src/extensions/ --include="*.ts" | grep -v node_modules
   ```
   **Done when** every `.ts` under `src/extensions/` (and any other vendored code) has been swept and the grep output is the complete candidate set.

2. **Classify each hit** into exactly one bucket (see table). A hit is a real **leak** only if it resolves a config path the host also manages. **Done when** every hit carries a bucket label — none left "maybe".

3. **Route every real leak through the host.** Replace the literal with `getAgentDir()` / `CONFIG_DIR_NAME` / `getSettingsPath()` imported from the host package the extension already peers on (see *Host re-exports*). Delete the local shim helpers that reimplement those resolvers — their callers now use the import. **Done when** zero `".pi"` config-path literals remain in real-path code and every removed shim's callers reach the imported resolver.

4. **Leave the non-leaks.** `os.homedir()` / `process.env.HOME` used for `~`-expansion, or paths under `.claude` / `.cursor` / `.agents` / `.config` / `.codex` / `.windsurf`, are the real OS home or third-party tool dirs — correct as-is. Cosmetic `~/.pi/...` in comments, docstrings, or user-facing strings is not a leak; rename it to the fork's name for consistency only if you are already touching the file.

5. **Verify.** Typecheck the touched files; re-grep the same pattern and expect only intentional comments; confirm the host re-exports the resolvers you imported. **Done when** tsc is clean on touched files and the residual grep returns nothing (or only comments you chose to keep).

## Reference

### Classification

| Hit shape | Bucket | Action |
|---|---|---|
| `join(homedir(), ".pi", "agent", …)` or `".pi/agent/…"` resolving settings / sessions / extensions / skills / commands / vibes / compaction / intercom / stash / any host-managed path | **leak** | route through host |
| `".pi"` in comments, docstrings, `console.log`, user-facing strings | cosmetic | optional rename; not a leak |
| `process.env.HOME` / `os.homedir()` for `~`-expansion; paths under `.claude` / `.cursor` / `.agents` / `.config` / `.codex` / `.windsurf` | not a leak | leave |

### Host re-exports

The resolvers live in the agent core (`src/config.ts`) and are re-exported from `src/index.ts`. For this fork the canonical host package is **`@selesai/code`** — import the resolvers from there. jiti's `virtualModules` maps every published host alias (`@selesai/code`, `@earendil-works/pi-coding-agent`, `@mariozechner/pi-coding-agent`) to the same bundled core, so a leftover alias import still _runs_ — but an untouched upstream alias (`@mariozechner/…`) in the extension's own imports or `package.json` peer-deps is itself leftover from the fork, same class of staleness as a `".pi"` literal. Normalise it to `@selesai/code` while you're in the file.

`getAgentDir`, `CONFIG_DIR_NAME`, `getSettingsPath` are all exported from `@selesai/code`.

### Why leaks bite silently

Extensions load via jiti at runtime — it transpiles `.ts` on the fly, so edit the file and restart the agent: no compile step, no `npm link`. A literal and a resolver both load, both look valid, but point at different dirs. That is why a leak ships and survives: nothing crashes, the paths just diverge.
