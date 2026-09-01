# pi-subagents fork-maintenance record

The pi-subagents extension is vendored from upstream `https://github.com/nicobailon/pi-subagents`
into `src/extensions/pi-subagents/`. This records the Selesai modifications to upstream code that
must be reconsidered each time the vendored extension is upgraded. See `README.md` for the folder
convention.

## Upstream remote & tag anchoring

- Upstream repo: `nicobailon/pi-subagents` (a fork of `earendil-works/pi` monorepo; the extension
  source lives at the repo root).
- Remote is **not** configured in this repo (remotes are `origin`, `upstream`, `pi-intercom-upstream`).
  Fetch a tag with an explicit namespaced ref so it does not collide with pi's own semver tags:
  ```bash
  git fetch https://github.com/nicobailon/pi-subagents.git \
    "refs/tags/v0.61.0:refs/tags/pi-subagents/v0.61.0"
  ```
  Local bare `v0.60.0`/`v0.61.0` tags belong to `earendil-works/pi` (different project, same semver).

## Vendoring process (how an upgrade was done for v0.60.0 → v0.61.0)

The fork's delta from upstream is **almost entirely mechanical branding plus a few small behavior
tweaks**. A wholesale upstream copy (or a 3-way `git merge-file` that blindly "keeps theirs" on
conflict) is **wrong**: it drops fork-only additions that live in files upstream also rewrote
(runtime-agent registration, `launchSlashSubagent`, `.selesai` config-root text, `.selesai` prune).

Recommended approach: **3-way merge per delta file** — `base=pi-subagents/v0.<n>.0`,
`ours=fork HEAD`, `theirs=v0.<n+1>.0` — then resolve conflicts with these rules:
- **Fork branding** wins (env names, import paths, config dirs) — never let upstream's `PI_*` /
  `@earendil-works/pi-coding-agent` / `~/.pi` overwrite the Selesai forms.
- **Upstream feature additions** win when the fork made no deliberate change in that region.
- **Fork-added symbols/features** must be re-applied on top (see below).

After the merge, apply the branding transform; the critical rule is to **only** rewrite `.pi`/`.pi/`
**config-path literals** → `.selesai`, never `.pi` as a property access (`input.pi`) or
`.pi-subagents` (the fork keeps this project-artifact dir name). A too-greedy `.pi`→`.selesai`
regex silently corrupts `input.pi` → `input.selesai` and breaks runtime-agent registration.

**Gotcha (hit during v0.60.0 → v0.61.0):** bare `".pi"` string literals used as *value* directory
names are **not** config-path literals and must stay `.pi`. The fork deliberately prunes both
stock-pi and Selesai agent dirs, e.g. `DISCOVERY_PRUNED_DIR_NAMES` in `agents.ts` should be
`[".git", "node_modules", ".pi", ".selesai", "sync-backups"]`. A greedy rebrand turned `".pi"`
to `".selesai"`, dropping `.pi` and duplicating `.selesai` — always re-check array/set literals
of directory names for duplicate `.selesai` entries after a branding pass.

## Fork-owned behavior deltas (re-apply after every upgrade)

These differ from upstream and must survive future upgrades:

| Surface | Fork behavior | Upstream v0.61.x behavior |
| --- | --- | --- |
| Config dir / env prefixes | `~/.selesai`, `SELESAI_*`, `@selesai/code` | `~/.pi`, `PI_*`, `@earendil-works/pi-coding-agent` |
| Subagent project artifact dir | `PROJECT_SUBAGENTS_RELATIVE_DIR = ".pi-subagents"` | `".pi/subagents"` (note: fork keeps the `.pi-subagents` name) |
| `agents.ts` discovery prune | adds `".selesai"` to `DISCOVERY_PRUNED_DIR_NAMES` | does not |
| `agent-management.ts` config-root error text | `(.selesai or .agents)` | `(.pi or .agents)` |
| `slash-commands.ts` | exports `launchSlashSubagent` (fork-only public API) | no such export |
| Tool-description default | **fork keeps "full" by default** (restored after v0.61.0 port; upstream's split-metadata default overridden, the split-metadata constants `DEFAULT_SUBAGENT_TOOL_DESCRIPTION`/`SUBAGENT_TOOL_PROMPT_*` were removed) | split metadata + 5 guidelines |

## Local uncommitted fix (must be re-applied on upgrade — NOT superseded)

`src/extensions/pi-subagents/src/runs/background/async-status.ts` has a fork-only hardening that is
**not absorbed** by upstream v0.61.0 (upstream's `isAsyncStatusIsolationError` does not match
ENOTDIR repair-write failures). It wraps `reconcileAsyncRun` so a repair-write failure (unaddressable
results dir) does not abort restoring the whole async-run list.

- The fix coexists with upstream v0.61.0's `isolateCorruptActiveRun` (corrupt-status reads).
- Merge rule: in `listAsyncRuns`, when `reconcileAsyncRun` throws:
  - if `isAsyncStatusIsolationError(...)` → let upstream isolate/continue;
  - otherwise (ENOTDIR repair-write) → fall back to a non-repairing `readStatus`.
- Companion fork-owned test: `test/unit/stale-run-reconciler.test.ts` ("does not abort the whole
  async-run list when one run's reconcile write throws"). Upstream does not touch this file.
- A blind vendor overwrite of `async-status.ts` or `test/unit/` silently drops it (P1).

## Environment note

`test/fixtures/pi-coding-agent-shim/dist/` (type stubs for `@selesai/code`) is **gitignored**. If a
fresh `rsync --delete` wipes it, `npm run typecheck` and the `host ci` integration test fail with
`TS7016: Could not find a declaration file for module '@selesai/code'`. Restore it from the built
`dist/extensions/pi-subagents/test/fixtures/pi-coding-agent-shim/dist/` before running the suites.

## Validate after each upgrade

```bash
cd src/extensions/pi-subagents
npx tsc --noEmit                       # clean (requires shim dist/ present)
npm run test:unit                      # expected: only pre-existing async-retention failure
npm run test:integration               # expected: 0 failures
node --test --test-name-pattern "isolates active reconciliation validation failures" \
  test/integration/async-status.test.ts  # upstream isolation + fork fix coexist
node --test test/unit/stale-run-reconciler.test.ts  # fork-local fix preserved
```
