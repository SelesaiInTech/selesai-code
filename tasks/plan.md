# Implementation Plan: pi-subagents v0.66.0 → upstream v0.71.0

## Overview
Upgrade the vendored `src/extensions/pi-subagents/` without losing Selesai-specific behavior or breaking its integrations. Local package reports 0.66.0. The evidence gate is closed and the user said “continue”; implementation is proceeding with the documented defaults in [`tasks/inventory-v0.71.md`](inventory-v0.71.md). The first Git-environment substeps now filter detached background runners and default external-CLI environments; explicit external allowlists remain untouched.

## Upstream mapping (verified)

The namespaced refs `refs/pisub/v0.66.0 … v0.71.0` are anchored by explicit fetch. Detail per release — including two plan corrections — is in [`tasks/inventory-v0.71.md`](inventory-v0.71.md).

| Release | SHA | Verified substance |
| --- | --- | --- |
| v0.66.0 (base) | `0fc0eebb` | identical to local tag `vendor/pi-subagents/v0.66.0` |
| v0.67.0 | `aa75b335` | watchdog fallback models, `evidence-auditor`, Intercom bridge overrides, **launch contracts v3 / projections v2 (digests change)**, child-tool-plan fixes #2132–#2140 |
| v0.68.0 | `f3ccf47d` | workflow args, required child extensions, Herdr `machine`, agent `outputSchema`; **removes `fallbackModels`, same-launch model switching, `modelExclusions` and the bundled `@earendil-works/pi-server`**; npm ships compiled JS |
| v0.69.0 | `f4918e80` | typed gates (JSON verdict → `structuredOutput`); Ghostty detection fix |
| v0.70.0 | `b72714de` | `defaultSubagentOnlyExtensions`, `allowedAgents`, workflow/reviewer/worktree correctness fixes, compiled-package publishing |
| v0.70.1 | `1ac7b5e2` | **`completionGuard` and `PI_SUBAGENTS_LLM_INTENT_ARBITER` removed**; runtime-registered agent defaults; Pi 0.86.1 summaries |
| v0.71.0 (target) | `4af5e85a` | RPC `cost`, workflow lifecycle events, `workflowTerminalProof`, **`worker` fresh-context default**, **`subagents_enable` dynamic tool activation**, Git local-env stripping, **pi-ai peer floor `>=0.86.1`** |

Two corrections to the earlier plan: **`v0.70.1` exists and was missing** (it removes a user-facing feature, so it is not a drop-in patch), and the baseline is a *tag* whose tree is the upstream repository root, not a `vendor/` directory.

Delta counts: upstream 440 paths (115 A / 299 M / 21 D / 5 R); fork-vs-base 720 paths, of which 183 are gitignored shim artifacts rather than real deletions. After normalizing the fork's mechanical branding, **86 substantive modified paths + 2 fork-added paths** remain; **68 are true conflicts** (16 direct overlaps + 1 rename conflict; 17 production paths) and 18 are safe carries. 397 residuals are ≤4 lines and are branding-pass noise.

**Compatibility verdict:** the new `@earendil-works/pi-ai >=0.86.1` peer floor matches Selesai's pinned Pi 0.86.1, and v0.71.0 explicitly fixes watchdog/permission behavior *for* the 0.86.1 package layout. The real drift is the dev-dependency/shim story (upstream moves dev deps to 0.87.0 and replaces the shim dev dependency with the real package) — keep the fork's `@selesai/code` shim and treat any 0.87-only API need as an escalation, not a shim. The vendored pi-intercom lacks `intercom:session-identity`, and upstream degrades to previous child naming in that case, so no intercom upgrade is required.

## Fork-to-upstream conflict map (confirmed locally)

| Surface and local source | Keep / test during rebase | Likely intersection with newer upstream |
| --- | --- | --- |
| Paths, branding and manifests: `src/shared/utils.ts`, `src/shared/artifacts.ts`, `package.json`, `src/agents/agents.ts` | `~/.selesai`, `SELESAI_*`, `@selesai/code`, distinct `.pi-subagents` project artifacts; prune **both** `.pi` and `.selesai`; never rewrite TS property `.pi`. | Config discovery, dependency floors, new asset paths and installer. |
| Builtins/selection: `src/agents/builtin-names.ts`, `src/agents/builtin-agent-augmentations.ts`, `src/extension/index.ts`, `src/extensions/pi-graft/index.ts` | Seven builtins (including `advisor`); post-0.66 additive Graft tools/provider only on selected builtins, user/project/explicit overrides win. | New builtin agents and changed agent discovery or allowlist contracts. |
| Child tools/launch: `src/extension/fanout-child.ts`, `src/runs/shared/child-tool-plan.ts`, `src/runs/shared/child-runtime-config.ts` | Host wrappers and extension tools remain usable by intended children, without widening permissions; Graft child provider is loaded, not merely allowlisted. | Final v0.71 tool-plan contract; do not reintroduce the intermediate v0.67 parent-host builtin pruning that v0.71 later removed. |
| Parent/child bridge: `src/intercom/native-supervisor-channel.ts`, `src/extensions/pi-intercom/index.ts` | `SELESAI_SUBAGENT_ORCHESTRATOR_*` and other `SELESAI_SUBAGENT_*` metadata must match at both ends; contact_supervisor routes to owning run. | Upstream supervisor/transport and background runner changes. |
| Resilience and compatible entry points: `src/runs/background/async-status.ts`, `src/runs/background/wait-tool.ts`, `src/slash/slash-commands.ts`, `src/extension/tool-description.ts` | ENOTDIR reconcile-write fallback to `readStatus` without swallowing genuine isolation errors; retained `subagent_wait` alias, exported `launchSlashSubagent`, fork full-by-default tool description. | Async status, registration and prompt schema churn. |
| Packaging and exclusions: `agents/`, `test/`, `src/skills/pi-subagents/`, `scripts/copy-extensions.mjs` | Keep deliberately removed bundled external-CLI adapters/agents removed; keep worker's four aliases and Selesai docs/skills; maintain source + packaged behavior. | New upstream files/tests and version/dependency bumps. |

Source of fork policy: `selesai-in-doc/pi-subagents-upgrade.md` plus post-baseline `git diff 671fdbebd..HEAD -- src/extensions/pi-subagents` (six touched paths: builtin augmentations source/test, extension index/fanout, native supervisor channel, wait tool). The old `.unlazy/subagents-upgrade/` scripts are **version-frozen examples**, not v0.71 proof. `src/extensions/pi-subagents/AGENTS.md` requires `VISION.md`: keep scope narrow, fail closed on unproven authority/evidence, and explicitly decide any compatibility behavior rather than accreting shims.

## Architecture decisions and dependency graph

1. Three-way refs are anchored (`base=vendor/pi-subagents/v0.66.0`, `ours=src/extensions/pi-subagents/`, `theirs=refs/pisub/v0.71.0`) and the inventory is recorded in [`tasks/inventory-v0.71.md`](inventory-v0.71.md). Reconcile per file, never wholesale copy or blind `merge-file --theirs`. Do not use already-versioned merge scripts as assertions.
2. Organize implementation into **at most five-file slices**, each containing the production change and its focused test. The inventory's slices are a dependency map, not permission to edit every listed file at once: split them further before coding if a substep exceeds five tracked paths. Use v0.71 final code, not intermediate v0.67 commits later reverted upstream. Old Tasks 2–6 survive as verification intent, not as file lists.
3. Validate source contracts first (agent discovery, tool plans), then launch/supervision, then background/workflow/status; docs/manifest and packaged integrations last. Every 2–3 tasks has a stop/go checkpoint. One writer per checkout/worktree.
4. Do not independently upgrade core Pi or intercom just to make v0.71 compile. Compare APIs (not only peer floors) to pinned Pi 0.86.1; if incompatible, stop rather than hiding incompatibility in shims. The user authorized continuing with the recorded recommendations; do not expand those decisions (especially the explicit `subagent_wait`/worker aliases) without asking.

Dependency graph: tagged release audit → inventory/contract decisions → tools/selection → launch/bridge → async/workflows/visibility → docs/package → full source + packaged + host gates → human review.

## Task list

Detailed acceptance, verification, file ceilings and dependencies: [`tasks/todo.md`](todo.md).

- [x] 1. Anchor v0.71 tag, release delta, compatibility and baseline; revise tasks by inventory. → [`tasks/inventory-v0.71.md`](inventory-v0.71.md). User said “continue”; recorded defaults are in effect.
- [x] 2. Slice 0: make the working checkout verifiable and re-record the live baseline (unit/integration results include isolated flakes).
- [ ] 3. Slice 1: upstream deletions, renames and relocations (D3), split into ≤5-file commits.
- [ ] Checkpoint A: typecheck after each deletion/rename substep; no dangling imports.
- [x] 4a. Slice 2a: require child-supervisor reply tooling to have effective fanout authorization (focused tool-plan test).
- [x] 4b. Slice 2b: add launched-child regression that preserves wrapped `read`/`grep` names and the Graft provider path/required tool.
- [ ] 4c. Finish the remaining final v0.71 child-tool-plan/runtime changes and directly exercise the loaded Graft tool in the child harness.
- [ ] 5. Slice 3: preserve eager tool registration and full-by-default description (D1).
- [x] 6a. Slice 4a (D2): packaged worker defaults to fresh context and declares `acceptanceRole: writer`.
- [ ] 6b. Slice 4b: reconcile agent selection, builtin names and Graft augmentation; skip incompatible evidence auditor.
- [ ] Checkpoint B: tool plan, Graft source profiles and agent selection verified.
- [x] 7a. Slice 5a: filter Git routing env for detached background runners (helper + spawn-boundary regression).
- [x] 7b. Slice 5b: filter inherited env for default external-CLI runs; preserve explicit allowlists.
- [ ] 7c. Finish launch/supervisor contract (launch contract v3, `SELESAI_SUBAGENT_*` symmetry).
- [ ] 8. Slice 6: async runner/recovery, status proof, wait aliases and the cost RPC.
- [x] 8a. Foreground structured-output rejection details are sanitized and retained in the run result.
- [x] 8b. Propagate sanitized structured-output rejection evidence through background results and status.
- [x] 8c. Share workflow-child process evidence with async capacity release; helper and proof cases pass.
- [x] 8d. Expose the same `workflowTerminalProof` in status output and verify projection.
- [x] 8e. Extract `/subagent-cost` collection/formatting into one shared module without changing its output.
- [x] 8f. Expose that report through versioned RPC `cost` data and test its advertisement/shape.
- [ ] Checkpoint C: launch/background regressions verified.
- [ ] 9. Slice 7: slash/API surface and manifest remainder.
- [ ] 10. Slice 8: docs, skills, manifest and lockfile; update the fork-delta record.
- [ ] 11. Slice 9: whole extension and packaged host gates; review, record results and rollback ref.
- [ ] Final checkpoint: human approval before merge/release.

## Validation and rollback

From `src/extensions/pi-subagents/`: `npm run typecheck`, `npm run test:unit`, `npm run test:integration`; baseline counts and isolated flakes are recorded in the inventory. Use targeted regressions for `stale-run-reconciler.test.ts`, async-status isolation and `test/unit/builtin-agent-augmentations.test.ts`, plus v0.71 tests (for example `test/unit/tool-activation.test.ts`, `test/unit/workflow-terminal-proof.test.ts`, `test/smoke/tool-activation.test.ts`). The `.unlazy/*` gate references in the original draft were not available and are not treated as evidence. Preserve ignored `test/fixtures/pi-coding-agent-shim/dist/` before cleanup. The runner preload no longer resolves bundled `@earendil-works/pi-server`; it must resolve the host's own copy.

**Current checkpoint at `a7e17119e`:** `npm run typecheck` passes. Full `npm run test:unit` reports 2,933 passed / 1 flaky timeout / 12 skipped; the known malformed-LSP-JSON case passes in isolation. Serialized full integration reports 988 passed / 2 flakes; `background keeps a terminal answer authoritative over an earlier tool timeout` and `does not kill a tool that completes before the per-tool timeout` both pass in isolation. Focused structured-output, workflow-proof, child-tool-plan, and in-process-child tests pass. Do not call the full suites green until a full run passes.

From root after `npm run build`: `npm test`, `npx vitest run src/extensions/pi-graft`, `node scripts/verify-graft-integration.mjs loader`, `node --experimental-strip-types scripts/verify-graft-integration.mjs profiles`, and `npx vitest run src/extensions/pi-intercom/intercom.integration.test.ts` (confirm actual test runner path at execution). Inspect `dist/extensions/pi-subagents/package.json`, packaged tool discovery and bridge. Record baseline-vs-target results and any pre-existing flakes separately; do not label a red suite green. Roll back to the pre-port commit/tag in an isolated branch/worktree; do not replace a dirty checkout or live run artifacts.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Product-contract changes land silently inside a version bump (`worker` fresh context, guard/fallback removals) | D1–D5 defaults are recorded in the inventory and were authorized by “continue”; each adopted change is noted in the fork-delta record. |
| Wholesale re-vendoring drops fork deltas or brings deleted CLI adapters back | Per-file 3-way inventory (86 substantive modified paths + 2 fork-added / 68 conflicts) and deliberate keep/adopt/drop decisions, backed by fork tests. |
| Strict child tool allowlists silently remove wrapper/extension tools | The intermediate v0.67 parent-host pruning was reverted upstream. A foreground-child regression now verifies `read`/`grep` names, required tools, and the Graft provider path survive launch; direct tool execution through that loaded child provider remains a Checkpoint B verification item. |
| Full suites show load-sensitive timeouts | Baseline is recorded with failures and isolated passes; rerun affected cases in isolation and report red full-suite results honestly. |
| 0.87-only APIs in ported code | Keep the `@selesai/code` shim and the 0.86.1 dev pins; escalate instead of shimming. |
| Async or supervisor failure hides active children | Test isolation, ENOTDIR fallback, completion delivery, `workflowTerminalProof` and intercom ownership. |
| Prompt/default/API drift breaks operators | Preserve full default description, alias/export contracts unless owner approves cutover; check schemas and built artifacts. |

## Decisions in effect

User said “continue”; apply these narrow defaults unless corrected:

- **D1 — dynamic tool activation:** keep the `subagent` tool eagerly visible and preserve the full description; skip the `subagents_enable` loader for now. It adds an activation turn and contradicts the fork's full-by-default contract. Revisit if prompt-footprint measurements justify that user-visible cost.
- **D2 — `worker` fresh-context default:** adopt upstream; update the agent definition and fork-maintenance record.
- **D3 — completion/fallback removals:** adopt upstream's removal of `completionGuard`, the intent arbiter, `fallbackModels`, same-launch model switching and persistent exclusions. `src/skills/pi-subagents/references/{management-authoring-rpc,prompting-and-roles}.md` currently teaches `fallbackModels`; update it, the root README and `doc-web/src/data/extension-customization.json` in the docs slice. Hermes Memory's separate `llmFallbackModels` is unrelated and stays.
- **D4 — launch-contract digest change:** accept v3 / projections v2; update pinned fixtures deliberately.
- **D5 — packaging:** adopt `private: true` only; skip `build:pkg`/`dist-pkg` because root `scripts/copy-extensions.mjs` owns `dist/`.
- Keep `subagent_wait` and the four worker aliases; no compatibility cutover authorized.
- Peer floor `@earendil-works/pi-ai >=0.86.1` matches Selesai's pinned Pi 0.86.1. Escalate if source uses a 0.87-only host API rather than adding a shim.
- **Do not add upstream `agents/evidence-auditor.md` verbatim:** it requires `web_search`, `fetch_content`, `get_search_content`, and `source_check`; Selesai's bundled web provider exposes a different tool contract. Revisit only with a tested adapter.
