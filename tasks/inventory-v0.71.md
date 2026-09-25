# Anchored inventory: pi-subagents v0.66.0 → v0.71.0

Task 1 deliverable. All facts below are reproduced from the tagged upstream source and this
checkout; nothing is inferred from an unread release page.

## Anchors

| Ref | Commit | Source |
| --- | --- | --- |
| base `vendor/pi-subagents/v0.66.0` (local tag) | `0fc0eebb9604970c506708b7508d6aa38921fde2` | identical to upstream `v0.66.0` |
| `refs/pisub/v0.67.0` | `aa75b3353836f7868898e3bd58234d21eaff1463` | tag `v0.67.0` (2026-09-10) |
| `refs/pisub/v0.68.0` | `f3ccf47dc236b6c0fcc0d897cec4a9e6da3e916d` | tag `v0.68.0` (2026-09-15) |
| `refs/pisub/v0.69.0` | `f4918e80b531f1bf9f1d9e847b8f86c9016108f1` | tag `v0.69.0` (2026-09-18) |
| `refs/pisub/v0.70.0` | `b72714de95e612406b3461e63dfc182856333a7e` | tag `v0.70.0` (2026-09-19) |
| `refs/pisub/v0.70.1` | `1ac7b5e2652e9571164847ac2905ab4aded92791` | tag `v0.70.1` (2026-09-20) |
| target `refs/pisub/v0.71.0` | `4af5e85a427b9f87334585ae8d0eb365d4dd2a1e` | tag `v0.71.0` (2026-09-23) |

Fetch (already performed; remote is not configured, so refs are namespaced):

```bash
git fetch --no-tags https://github.com/nicobailon/pi-subagents.git \
  'refs/tags/v0.66.0:refs/pisub/v0.66.0' 'refs/tags/v0.71.0:refs/pisub/v0.71.0'
```

**The local vendor tag and upstream `v0.66.0` are the same commit.** The plan's earlier
"`vendor/pi-subagents/v0.66.0` is the immutable baseline" was read as a path; it is a tag whose
tree is the upstream release tree at the repository root. Our fork's copy lives at
`src/extensions/pi-subagents/`, so all three-way work compares *tag root* ↔ *that directory*.

**New finding:** `v0.70.1` exists and was absent from the plan. It is not a patch-only release —
it removes a user-facing feature (`completionGuard`). It is folded into this target.

Release notes read from the tagged `CHANGELOG.md` at `refs/pisub/v0.71.0`. The complete 440-path
upstream status/name/disposition list is [`tasks/upstream-v0.71-paths.tsv`](upstream-v0.71-paths.tsv).

## Per-release mapping (verified)

### v0.67.0
- Added: watchdog fallback models; portable Inspect commands; `quiet: true` schedules; optional
  watchdog drift questions; **built-in `evidence-auditor` agent**; per-workflow-child completion
  notifications; per-launch `intercomBridge` overrides + `orchestratorTarget`.
- Changed: Intercom bridge prompt decoupled from the parent session; **launch contracts → v3,
  launch-binding projections → v2 (launch-contract digests change)**; shorter child-facing
  instructions; child-tool-plan work for #2132–#2140 (wrapped Pi core tools + explicitly requested
  non-core tools preserved; non-core validated in the child after ceilings/exclusions).
- Notable fixes: `runs.all(...)` accepts promises; preflight digest matches execution; steering
  reported delivered only after consumption; worktree validation before parallel children; agent
  tool declarations intersected with host availability.

### v0.68.0
- Added: bounded JSON `args` for workflow scripts; async widget header fold; agent-level
  `outputSchema`; `PI_SUBAGENT_CACHE_RETENTION`; session-scoped host API for
  **required child extensions**; `machine` for Herdr remote runs; `checkpointBeforeDeadlineMs`;
  `subagents.agentExcludeDirs`.
- Changed: `authorityPolicy.inspectorOpen`/`projectOpen`; **npm package now ships compiled JS
  (extension cold start ~226 ms vs ~2 831 ms)**.
- **Removed (breaking):** `fallbackModels`, all same-launch model switching (including read-only
  HTTP 429 continuation), persistent model exclusions; **and the bundled `@earendil-works/pi-server`
  copy**. Background children on a Pi 0.85.0 host now fail loudly; Pi ≥ 0.85.1 required.
- Renames in this and later releases: `src/runs/shared/model-fallback.ts` → `model-resolution.ts`;
  `src/inspectors/herdr/{inspector-runner,session-roots-codec,shell-command}.ts` →
  `src/inspectors/`; `test/smoke/pi085-extension.ts` → `sdk-extension.ts`;
  `runner-server-preload.mjs` → `runner-peer-loader.mjs` + `runner-peer-preload.mjs`.

### v0.69.0
- Added: **typed gates** (`gate: { command, output: "json", schema?, timeoutMs? }`; JSON stdout
  becomes `structuredOutput`; always uncached; cannot combine with `outputSchema`).
- Fixed: Ghostty inspector detection (embedded-Ghostty terminals); silent startup without `npm`;
  `maxOutput` doc correction.

### v0.70.0
- Added: `subagents.defaultSubagentOnlyExtensions`; `allowedAgents` restriction via agent
  frontmatter and `agentOverrides` (without granting delegation or widening ceilings).
- Fixed: `bg_wait` wake for nested `contact_supervisor`; detached workflow children; settling
  interrupted runs when child session creation hangs; concurrent workflow observers; **children use
  their own agent-declared tools instead of being narrowed to the parent's `--tools`**;
  `tool_budget_exhausted` reporting; permission forwarding scoped to the validated launch parent;
  malformed workflow script rejection; dirty-worktree async rejection; rooted field paths for
  structured-output `if`/`then`/`else`; reviewer's bounded read-only working-tree view; Fleet
  layout stability; Windows supervisor polling; source-layout runners on native Node TS; `fish`
  Orca tabs; **npm publishing restricted to the compiled package**.

### v0.70.1
- Changed: **`completionGuard` setting and `PI_SUBAGENTS_LLM_INTENT_ARBITER` switch removed** —
  successful tasks follow their process result plus explicitly configured output/acceptance checks
  instead of guessing from task wording. Custom agent files fully replace same-named bundled agents;
  implementation agents need `acceptanceRole: writer`.
- Fixed: `defaultModel`/`defaultProvider`/`defaultThinking`/tier overrides reach runtime-registered
  agents; workflow child model + thinking in parent status; pruned-fork overflow summaries on
  Pi 0.86.1; inspector bootstrap from compiled JS; host `pi-coding-agent` resolved from the Pi
  installation that owns the session; test-only runner isolation.

### v0.71.0
- Added: in-process RPC **`cost`** method (versioned `{ version: 1, parent, children, childTotal,
  total, unresolvedAsyncChildren }`, advertised via `ping.capabilities.cost`); public lifecycle
  events for async `workflowScript` runs and their children; `details.workflowTerminalProof`
  (`observed` + per-child exit evidence, else `pending`/`unknown` with a reason; the same check
  frees the workflow's capacity slot).
- Changed: **packaged `worker` agents no longer fork the parent conversation by default**;
  **`subagent` tool hidden until activated by the small `subagents_enable` loader**; child sessions
  keep readable names and nested children route via the child's intercom ID (requires a pi-intercom
  with the `intercom:session-identity` claim; older pi-intercom keeps previous naming);
  **`@earendil-works/pi-ai` peer floor raised to `>=0.86.1`**; rejected `structured_output` results
  now carry a validation-error summary.
- Fixed (selected): Git local-env vars (`GIT_DIR`, `GIT_WORK_TREE`, …) stripped from background and
  external-CLI children; retained-run startup timeout; runner exit code/signal in failure notices;
  structured output preserved through a later provider error; duplicate completion notifications;
  Git-less `watchdog_diff`; `watchdog_diff` counts as read-only; **watchdog reviews and permission
  checks on the Pi 0.86.1 package layout**; workflow child missing `agent` error names the child;
  symlinked `/prompt-workflow` files; retained-agent resume under its own allowlist; skills with
  `disable-model-invocation: true` hidden from children; Bun and pnpm/symlink peer resolution;
  MCP direct tool names; external-CLI logs in Fleet/TUI; cumulative structured-delegation usage;
  Pi 0.87 context edits in forked sessions.

## Delta counts

| Comparison | Paths | Breakdown |
| --- | --- | --- |
| upstream `v0.66.0` → `v0.71.0` | 440 | 115 added, 299 modified, 21 deleted, 5 renamed |
| our fork vs base (tag root ↔ `src/extensions/pi-subagents/`) | 720 | 2 fork-added, 202 "deleted", 516 modified |

Fork "deletions" decompose as: **183 gitignored shim files** (`test/fixtures/pi-coding-agent-shim/dist/**`
— ignore-rule artifacts, *not* intentional deletions) + **19 deliberate deletions** (6 external-CLI
adapter agents, 3 `src/runs/shared/*-adapter.ts`, 6 integration smoke tests, 3 unit adapter tests,
`banner.png`).

Fork delta after normalizing the mechanical branding pass
(`.selesai`/`SELESAI_`/`@selesai/code`/`Selesai` → upstream spellings):

| Class | Count |
| --- | --- |
| substantive fork-modified paths (>4 residual lines after branding normalization) | **86** |
| fork-added paths | **2** |
| substantive fork changes that upstream also changed or renamed → **true conflicts** | **68** |
| substantive fork paths untouched by upstream → safe carry | 18 |
| residuals ≤4 lines (branding pass artifacts) | 397 |

Fork-added files (not in upstream at all): `src/agents/builtin-agent-augmentations.ts`,
`test/unit/builtin-agent-augmentations.test.ts`. Do not add upstream `agents/evidence-auditor.md`
verbatim: it requires the `pi-web-access` tools (`web_search`, `fetch_content`,
`get_search_content`, `source_check`), while Selesai's bundled web provider exposes a different
contract. Add an adapter only if a separately tested need appears.

## True conflict surface

`src/` conflicts (16 direct path overlaps + 1 rename conflict) — the production files needing hand reconciliation:

```
src/agents/agent-management.ts          src/runs/background/async-status.ts
src/agents/builtin-names.ts             src/runs/background/subagent-runner.ts
src/extension/fanout-child.ts           src/runs/background/wait-tool.ts
src/extension/index.ts                  src/runs/foreground/subagent-executor.ts
src/extension/tool-description.ts       src/runs/shared/external-cli-contract.ts
src/intercom/native-supervisor-channel.ts  src/runs/shared/pi-spawn.ts
src/shared/types.ts                     src/slash/slash-commands.ts
src/workflows/workflow-receipt.ts       src/watchdog/scope.ts
```

Remaining 51 conflicts are 31 `test/unit`, 7 `test/integration`, 2 `test/support`, 7 `docs`,
1 `skills/pi-subagents/references`, 1 `agents`, plus `package.json`, `package-lock.json`,
`CHANGELOG.md`.

Clean-merge candidates (upstream changed, fork has **no** substantive delta — take upstream
verbatim, then typecheck): `src/runs/shared/child-tool-plan.ts`, `child-runtime-config.ts`,
`child-launch.ts`, `src/extension/schemas.ts`, `src/workflows/scripted-workflow.ts`,
`src/runs/background/notify.ts`, `src/runs/shared/acceptance.ts`,
`src/runs/background/stale-run-reconciler.ts`, and the rest of the 299 modified upstream paths not
listed above.

Renames and removals that relocate fork-modified files:

- `src/inspectors/herdr/{inspector-runner,session-roots-codec,shell-command}.ts` → `src/inspectors/`.
  Fork-modified `src/inspectors/herdr/actions.ts` and `project-panes.ts` must move with them.
- `src/runs/shared/model-fallback.ts` → `model-resolution.ts`; the fork has a substantive delta in
  the old file. It is included in the **68 true conflicts** as a rename conflict; reconcile the
  fork's model-scope behavior with upstream's removal of same-launch fallback switching.

### Upstream-deleted paths the fork still contains (21 deleted; 18 present)

| Path in fork | Upstream disposition | Fork action |
| --- | --- | --- |
| `runner-server-preload.mjs` | replaced by peer loader/preload pair | delete, adopt new pair |
| `src/runs/shared/completion-evidence.ts` | removed | delete **if** `completionGuard` is dropped |
| `src/runs/shared/completion-guard.ts` | removed | same |
| `src/runs/shared/llm-intent-arbiter.ts` | removed | same |
| `src/runs/shared/model-exclusions.ts` | removed | delete **if** persistent model exclusions are dropped |
| `src/runs/shared/readonly-model-continuation.ts` | removed | delete (same-launch model switching) |
| `src/runs/shared/readonly-session-evidence.ts` | removed | delete |
| `src/runs/shared/task-intent.ts` | removed | delete with the arbiter |
| `test/smoke/pi085-child.ts`, `pi085-clean-install.mjs` | removed | delete |
| 8 unit tests (`completion-evidence`, `completion-guard`, `llm-intent-arbiter`, `model-exclusions`, `model-fallback`, `readonly-model-continuation`, `readonly-session-evidence`, `task-intent`) | removed | delete with their subjects; `model-fallback` → `model-resolution` test |
| `test/fixtures/.../@earendil-works/pi-server/**` (3) | removed | already absent on disk; do not restore |

## Host and peer compatibility

- **Runtime peer floor is compatible.** `@earendil-works/pi-ai` becomes `>=0.86.1`; Selesai pins
  Pi 0.86.1. v0.71.0 explicitly fixes watchdog reviews and permission checks *for* the Pi 0.86.1
  package layout, so 0.86.1 is a supported host, not a tolerated one.
- **Dev-dependency drift is the real gap.** Upstream dev deps move to `@earendil-works/*: 0.87.0`
  and replace the `file:./test/fixtures/pi-coding-agent-shim` dev dependency with the real
  `@earendil-works/pi-coding-agent: 0.87.0`. Our fork's whole typecheck story *is* that shim
  (`@selesai/code` type stubs, gitignored). Verify against 0.86.1 and keep the shim; do not adopt
  the `0.87.0` dev pins. Any code that needs 0.87-only APIs is a stop-and-escalate item, not a shim.
- `dependencies` loses `@earendil-works/pi-server: 0.85.0` — the fork's runner preload must resolve
  the host's own copy. Our test fixture for it is already gone.
- Selesai Pi 0.86.1 has dynamic-tool APIs, but D1 deliberately keeps the fork's eager `subagent`
  registration; the compact activation loader is not being ported in this upgrade.
- pi-intercom: the vendored `src/extensions/pi-intercom/` contains **no** `intercom:session-identity`
  support, so the v0.71.0 child-naming change degrades to previous naming — routing still works.
  No intercom upgrade is required for this port.

## Baseline state (this checkout; source unchanged)

Slice 0 environment setup is complete. `npm ci --ignore-scripts` ran in the root and extension;
restored the 177-file gitignored shim from the main worktree; `npm run build` succeeded. No tracked
production file or lockfile changed. Root `npm ci` reported 7 audit advisories (3 moderate, 4 high);
left unchanged as unrelated dependency work.

- `npm run typecheck` → **clean, exit 0**.
- `npm run test:unit` → **2916 pass / 1 fail / 12 skipped**. The lone failure was the known
  load-sensitive `watchdog-lsp-diagnostics` malformed-language-server-JSON case timing out instead
  of reporting `failed`; isolated rerun of that exact case **passes**.
- `npm run test:integration` → first run under default parallelism: **977 pass / 8 fail / 1
  cancelled**; failures were runner-startup/result timeouts under suite load. All nine affected
  cases passed in a serialized targeted rerun. Full `--test-concurrency=1` baseline → **985 pass /
  1 fail**; the remaining failure was `persists workflow parent metadata in an async worktree
  child status and result` (expected 1, got 0), and isolated rerun **passes**.

No deterministic baseline regression surfaced, but the entire suites have not produced one all-green
run yet. Historical 2916/986 counts remain prior-gate figures; compare later slices against the
recorded runs above and rerun any flaky case in isolation.

## Decisions in effect (user said “continue”; applying these defaults)

| # | Change in v0.68–v0.71 | Conflict with fork | Decision |
| --- | --- | --- | --- |
| D1 | `subagent` tool hidden until `subagents_enable` activates it | Fork deliberately keeps the **full** description/default tool | Keep eager `subagent` + full description; skip loader for now. Add only if measured prompt savings justify an activation turn. |
| D2 | Packaged `worker` now starts with fresh context instead of forking the parent | Fork's worker behavior differs | Adopt upstream fresh-context default; fork per-call/global option remains. Record it as an intentional change. |
| D3 | Remove `completionGuard`, intent arbiter, `fallbackModels`, same-launch model switching and persistent exclusions | Shipped `prompting-and-roles.md` currently teaches `fallbackModels`; management docs do too | Adopt removals and migrate the shipped skill, root README and `doc-web/src/data/extension-customization.json`. Keep unrelated Hermes Memory `llmFallbackModels`. |
| D4 | Launch contracts v3 / launch-binding projections v2 → **launch-contract digests change** | Saved runs resume (upstream asserts this), but pinned digest fixtures may break | Accept; update fixtures deliberately and note the digest change. |
| D5 | npm package ships compiled JS; source package becomes `private: true`; adds package-build files | Root `scripts/copy-extensions.mjs` owns `dist/extensions/` | Adopt `private: true` only. Skip `build:pkg`/`dist-pkg`; root packaging owns dist. |

Unblocked by evidence: peer-floor check, pi-intercom no-op, upstream deletions of `readonly-*` and
the pi-server fixture, and all 18 safe carries.

## Revised implementation slices (≤5 files each)

Reordered so D3's feature removals and upstream relocations are reconciled before dependent code.
D1 preserves the existing eager tool contract. Every slice keeps its focused test and stays ≤5
tracked paths.

1. **Slice 0 — make this worktree verifiable. DONE.** Installed deps, restored the gitignored
   shim, built the host package, and recorded typecheck/unit/integration baseline above. *Files:
   none (environment only).*
2. **Slice 1 — upstream deletions + renames.** Delete the 18 present upstream-deleted paths and
   perform the `model-fallback` → `model-resolution` and `inspectors/herdr` → `inspectors` moves
   including the fork's `actions.ts`/`project-panes.ts`. *Files: ≤5 per commit, several commits.*
   Depends on D3.
3. **Slice 2 — clean-merge adoption.** Take upstream verbatim for the fork-untouched modified
   files in dependency order (`child-tool-plan.ts`, `child-runtime-config.ts`, `child-launch.ts`,
   `schemas.ts`, `scripted-workflow.ts`, `notify.ts`, `acceptance.ts`,
   `stale-run-reconciler.ts`), typechecking after each. This delivers the wrapped-core-tool and
   child-tool fixes that Task 2 originally targeted.
4. **Slice 3 — preserve eager tool contract (D1).** Keep the existing full `subagent` registration;
   reconcile upstream extension-index lifecycle changes without adding `subagents_enable`. Split
   into ≤5-file substeps with focused registration tests.
5. **Slice 4 — agent selection and Graft augmentation.** `src/agents/agent-management.ts`,
   `src/agents/builtin-names.ts`, `src/agents/builtin-agent-augmentations.ts` (+ test),
   `src/extension/index.ts` follow-up. Keep seven Selesai builtins and verify the Graft provider
   still loads only on selected builtins. Skip `evidence-auditor` until its tool contract exists in
   Selesai.
6. **Slice 5 — launch, supervisor, child env.** `src/extension/fanout-child.ts`,
   `src/intercom/native-supervisor-channel.ts`, `src/runs/shared/pi-spawn.ts`,
   `src/runs/foreground/subagent-executor.ts`, `src/shared/types.ts` (launch contract v3 +
   Git local-env stripping). Fork `SELESAI_SUBAGENT_*` names must survive at both ends.
7. **Slice 6 — async runner, status and wait.** `src/runs/background/async-status.ts`
   (ENOTDIR fallback re-applied), `subagent-runner.ts`, `wait-tool.ts`,
   `src/workflows/workflow-receipt.ts`. Includes `workflowTerminalProof` and the cost RPC.
8. **Slice 7 — slash/API surface.** `src/slash/slash-commands.ts` (`launchSlashSubagent` preserved),
   `src/watchdog/scope.ts`, `src/runs/shared/external-cli-contract.ts` (deleted adapters stay
   deleted), plus the `package.json` manifest remainder.
9. **Slice 8 — docs, skills, manifest, lockfile.** The 7 conflicting docs, the conflicting
   `skills/pi-subagents/references/*`, `agents/*` (fork's 7 builtins), `package.json`,
   `package-lock.json`, and the fork-delta record.
10. **Slice 9 — full gates and handoff** (unchanged from `todo.md` Task 8).

Old Tasks 2–6 survive as the *verification intent* of slices 3–8; their predicted touchpoints were
mostly wrong (Task 2's `builtin-agent-augmentations.ts` is fork-only and upstream-untouched; Task 5's
`scripted-workflow.ts` and `schemas.ts` are clean merges, not conflicts). The plan file is amended
accordingly.
