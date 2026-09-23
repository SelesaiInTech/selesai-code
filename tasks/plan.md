# Implementation Plan: pi-subagents v0.66.0 → upstream v0.71.0

## Overview
Upgrade the vendored `src/extensions/pi-subagents/` without losing Selesai-specific behavior or breaking its integrations. **Planning only; no vendored code has been changed.** Local package and dist report 0.66.0. The immutable upstream baseline is `vendor/pi-subagents/v0.66.0`; the v0.71.0 tag is not present locally. The source checkout was clean when planning started and `cd src/extensions/pi-subagents && npm run typecheck` passed. The last recorded upgrade gate (not a fresh test run) was 2916 passing unit / 986 passing integration tests (`.unlazy/pi-v0.85.1-sync/gates/leaf-1.2.md`).

## Upstream mapping and evidence boundary

| Release | Evidence available now | Required before implementation |
| --- | --- | --- |
| v0.67.0 | [Release](https://github.com/nicobailon/pi-subagents/releases/tag/v0.67.0) not independently read; [#2160](https://github.com/nicobailon/pi-subagents/issues/2160) appears to report child-tool-plan wrapper/extension-tool pruning; the issue text and affected versions are **not independently verified** here, nor is a fix-on-main claim evidence it is in 0.71. | Read tagged notes and test the exact v0.71 implementation, especially `read`/`grep` wrappers and extension-provided `graft_*` tools. |
| v0.68.0 | [Release](https://github.com/nicobailon/pi-subagents/releases/tag/v0.68.0) not independently read. | Record features, changed/removed files, migrations, tests and host requirements from tag. |
| v0.69.0 | [Release](https://github.com/nicobailon/pi-subagents/releases/tag/v0.69.0) not independently read. | Same. |
| v0.70.0 | [Release](https://github.com/nicobailon/pi-subagents/releases/tag/v0.70.0) not independently read. | Same. |
| v0.71.0 | User-provided [release](https://github.com/nicobailon/pi-subagents/releases/tag/v0.71.0); release body/tagged source unavailable in this research pass. | Read [tagged changelog](https://github.com/nicobailon/pi-subagents/blob/v0.71.0/CHANGELOG.md), tag contents, manifest/peer dependencies and cumulative diff. |

**Why the gap:** the web research tool returned unrelated/main README material rather than verifiable release bodies; a `researcher` child failed with `Agent 'researcher' requested unavailable child tools: web_search, fetch_content, get_search_content, source_check` (run `facaf8bc-7d4c-4ae6-b9c2-624902d6543f`). No exact per-release claims are inferred from that output. Phase 1 is a blocking evidence gate, not a formality. Never mistake bare Pi `v0.71.0` tags for pi-subagents tags.

## Fork-to-upstream conflict map (confirmed locally)

| Surface and local source | Keep / test during rebase | Likely intersection with newer upstream |
| --- | --- | --- |
| Paths, branding and manifests: `src/shared/utils.ts`, `src/shared/artifacts.ts`, `package.json`, `src/agents/agents.ts` | `~/.selesai`, `SELESAI_*`, `@selesai/code`, distinct `.pi-subagents` project artifacts; prune **both** `.pi` and `.selesai`; never rewrite TS property `.pi`. | Config discovery, dependency floors, new asset paths and installer. |
| Builtins/selection: `src/agents/builtin-names.ts`, `src/agents/builtin-agent-augmentations.ts`, `src/extension/index.ts`, `src/extensions/pi-graft/index.ts` | Seven builtins (including `advisor`); post-0.66 additive Graft tools/provider only on selected builtins, user/project/explicit overrides win. | New builtin agents and changed agent discovery or allowlist contracts. |
| Child tools/launch: `src/extension/fanout-child.ts`, `src/runs/shared/child-tool-plan.ts`, `src/runs/shared/child-runtime-config.ts` | Host wrappers and extension tools remain usable by intended children, without widening permissions; Graft child provider is loaded, not merely allowlisted. | 0.67 tool intersection bug and subsequent fixes; host Pi 0.86.1 compatibility. |
| Parent/child bridge: `src/intercom/native-supervisor-channel.ts`, `src/extensions/pi-intercom/index.ts` | `SELESAI_SUBAGENT_ORCHESTRATOR_*` and other `SELESAI_SUBAGENT_*` metadata must match at both ends; contact_supervisor routes to owning run. | Upstream supervisor/transport and background runner changes. |
| Resilience and compatible entry points: `src/runs/background/async-status.ts`, `src/runs/background/wait-tool.ts`, `src/slash/slash-commands.ts`, `src/extension/tool-description.ts` | ENOTDIR reconcile-write fallback to `readStatus` without swallowing genuine isolation errors; retained `subagent_wait` alias, exported `launchSlashSubagent`, fork full-by-default tool description. | Async status, registration and prompt schema churn. |
| Packaging and exclusions: `agents/`, `test/`, `src/skills/pi-subagents/`, `scripts/copy-extensions.mjs` | Keep deliberately removed bundled external-CLI adapters/agents removed; keep worker's four aliases and Selesai docs/skills; maintain source + packaged behavior. | New upstream files/tests and version/dependency bumps. |

Source of fork policy: `selesai-in-doc/pi-subagents-upgrade.md` plus post-baseline `git diff 671fdbebd..HEAD -- src/extensions/pi-subagents` (six touched paths: builtin augmentations source/test, extension index/fanout, native supervisor channel, wait tool). The old `.unlazy/subagents-upgrade/` scripts are **version-frozen examples**, not v0.71 proof. `src/extensions/pi-subagents/AGENTS.md` requires `VISION.md`: keep scope narrow, fail closed on unproven authority/evidence, and explicitly decide any compatibility behavior rather than accreting shims.

## Architecture decisions and dependency graph

1. Anchor upstream old/new immutable refs and list each upstream-added/changed/deleted path; calculate three-way inventory with `base=vendor/pi-subagents/v0.66.0`, `ours=current vendored file`, `theirs=upstream v0.71.0`. Reconcile per file, never wholesale copy or blind `merge-file --theirs`. Do not use already-versioned merge scripts as assertions.
2. Organize implementation into **at most five-file slices**, each containing the production change and its focused test; if the anchored inventory exceeds a task's listed paths, split it and update `tasks/todo.md` before implementing. Preserve new upstream work where not in conflict with a deliberate fork choice.
3. Validate source contracts first (agent discovery, tool plans), then launch/supervision, then background/workflow/status; docs/manifest and packaged integrations last. Every 2–3 tasks has a stop/go checkpoint. One writer per checkout/worktree.
4. Do not independently upgrade core Pi or intercom just to make v0.71 compile. Compare new peer floors to Selesai's pinned Pi 0.86.1; if incompatible, stop for owner decision rather than hiding incompatibility in shims. Owner approval is required before implementing broad launch/API/persistence changes or deciding to remove explicit fork compatibility (`subagent_wait`).

Dependency graph: tagged release audit → inventory/contract decisions → tools/selection → launch/bridge → async/workflows/visibility → docs/package → full source + packaged + host gates → human review.

## Task list

Detailed acceptance, verification, file ceilings and dependencies: [`tasks/todo.md`](todo.md).

- [ ] 1. Anchor v0.71 tag, exact release delta and clean baseline; revise tasks by inventory.
- [ ] 2. Reconcile builtins, child tool allowlists and Graft augmentation.
- [ ] Checkpoint A: tool plan and Graft source profiles verified.
- [ ] 3. Reconcile child launch and intercom supervisor contract.
- [ ] 4. Reconcile async runner/recovery and wait aliases.
- [ ] Checkpoint B: launch/background regressions verified.
- [ ] 5. Reconcile scripted workflows, schemas and public APIs.
- [ ] 6. Reconcile status, visibility and delivery changes.
- [ ] Checkpoint C: focused workflow/status suites verified.
- [ ] 7. Reconcile docs, skills, assets, manifest and lockfile.
- [ ] 8. Run whole extension and packaged host gates; review, record results and rollback ref.
- [ ] Final checkpoint: human approval before merge/release.

## Validation and rollback

From `src/extensions/pi-subagents/`: `npm run typecheck`, `npm run test:unit`, `npm run test:integration`; targeted regression commands from `.unlazy/pi-v0.85.1-sync/gates/leaf-1.2.md` for `stale-run-reconciler.test.ts` and async-status isolation, plus `test/unit/builtin-agent-augmentations.test.ts` and tagged upstream new tests. Reinstall/verify the extension-local dependencies if the tagged lockfile changes (the runner's `@earendil-works/pi-server` preload must resolve); preserve ignored `test/fixtures/pi-coding-agent-shim/dist/` before any cleanup.

From root after `npm run build`: `npm test`, `npx vitest run src/extensions/pi-graft`, `node scripts/verify-graft-integration.mjs loader`, `node --experimental-strip-types scripts/verify-graft-integration.mjs profiles`, and `npx vitest run src/extensions/pi-intercom/intercom.integration.test.ts` (confirm actual test runner path at execution). Inspect `dist/extensions/pi-subagents/package.json`, packaged tool discovery and bridge. Record baseline-vs-target results and any pre-existing flakes separately; do not label a red suite green. Roll back to the pre-port commit/tag in an isolated branch/worktree; do not replace a dirty checkout or live run artifacts.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| v0.71 tag/release details unverified | Task 1 is a hard blocker. Confirm actual upstream tag SHA, notes, file list and peer floors; amend this plan before approving implementation. |
| Wholesale re-vendoring drops fork deltas or brings deleted CLI adapters back | Per-file 3-way inventory and deliberate keep/adopt/drop decision, backed by fork tests. |
| Strict child tool allowlists silently remove wrapper/Graft tools | Add a real launched-child regression for wrapped builtins + loaded extension-tool provider, alongside source/packaged Graft profile checks. |
| Async or supervisor failure hides active children | Test isolation, ENOTDIR fallback, completion delivery and intercom ownership. |
| Prompt/default/API drift breaks operators | Preserve full default description, alias/export contracts unless owner approves cutover; check schemas and built artifacts. |
| New dependency assumes incompatible Pi host | Compare peer ranges to pinned Pi 0.86.1 and run actual host gates; escalate incompatibility. |

## Open questions / approvals

- Confirm after Task 1 whether to adopt every new v0.67–v0.71 feature or only upstream correctness/security fixes where it changes the product contract.
- Keep the fork-requested deprecated `subagent_wait` alias and four worker aliases? Proposed default: **yes**, until the owner explicitly approves a cutover.
- Is any new upstream peer floor higher than pinned Pi 0.86.1? Stop and coordinate a separate host upgrade if so.
- **Human review of amended, tag-anchored plan is required before implementation.**
