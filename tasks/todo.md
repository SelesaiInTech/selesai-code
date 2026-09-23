# pi-subagents v0.66.0 → v0.71.0 task list

**Status:** planning only. Task 1 and a human review of the amended plan gate all implementation. Every task must stay ≤5 touched files; split against the anchored tag inventory before coding. Paths below name probable touchpoints, not an assertion that upstream changed them. Apply the repo Definition of Done (runtime, tests, integration, docs, security, rollback).

## Task 1: Anchor the target and approve a conflict inventory

**Description:** Obtain the canonical `nicobailon/pi-subagents` v0.71.0 tag under a namespaced ref (do not use bare Pi `v0.71.0`); read v0.67–v0.71 tagged notes/changelog; compare upstream v0.66 vs v0.71 and each changed file vs our fork. Record added/deleted/clean/conflicting files, per-file keep/adopt/drop decision, peer floors, baseline test state, and revised slices here. Existing `vendor/pi-subagents/v0.66.0` is the immutable base; `.unlazy/*` inventories are examples, not 0.71 validators.

**Acceptance criteria:**
- [ ] Record both tag SHAs, links to each release, verified per-release changes, counts/path inventory and explicit fork conflict decisions in `tasks/plan.md` (or a linked inventory).
- [ ] Identify exact host Pi 0.86.1 compatibility, new/removed public APIs, tests and assets; no unknown tagged changes or >5-file implementation task remains.
- [ ] Record clean-tree baseline and owner approval of updated scope before touching vendored implementation.

**Verification:**
- [ ] `git status --short` is clean apart from the plan files; compare exact namespaced tag manifests and cumulative diff, never a similarly numbered Pi tag.
- [ ] `cd src/extensions/pi-subagents && npm run typecheck && npm run test:unit && npm run test:integration` (record actual results and flakes, not historical counts).

**Dependencies:** None. **Files likely touched:** `tasks/plan.md`, `tasks/todo.md` (optional inventory document). **Estimated scope:** S (1–3 planning files).

## Task 2: Keep agent selection and child tool plans correct

**Description:** Reconcile upstream agent/tool changes against fork Graft builtin augmentation and tool allowlists. Explicitly check wrapped `read`/`grep` and extension-only `graft_*` names; allowlisting must not impersonate extension loading or widen child authority. Keep local seven builtins and user/project override precedence.

**Acceptance criteria:**
- [ ] Builtin Graft-aware profiles get provider plus tools; `researcher` and overridden profiles do not gain them inadvertently.
- [ ] Wrapped core tools and extension-provided names remain accessible under correct child authorization; genuine unavailable required builtins still fail closed.
- [ ] All affected v0.71 agent/tool-plan changes in the inventory are reconciled; a launched child (not just a plan object) demonstrates wrapped `read`/`grep` and a loaded `graft_*` provider.

**Verification:**
- [ ] `cd src/extensions/pi-subagents && npm run typecheck && node --experimental-strip-types --import ./test/support/isolated-temp-root.mjs --test test/unit/builtin-agent-augmentations.test.ts test/unit/child-tool-plan.test.ts test/unit/child-tool-plan-permission-system.test.ts`.
- [ ] Add/run a focused launched-child integration regression using extension-loaded Graft tools and wrapped core tools (choose the tagged `test/integration/in-process-child.test.ts` or a focused new test at Task 1); assert the child actually executes them. From root after build: `node --experimental-strip-types scripts/verify-graft-integration.mjs profiles`.

**Dependencies:** 1. **Files likely touched:** `src/extensions/pi-subagents/src/agents/builtin-agent-augmentations.ts`, `src/extensions/pi-subagents/src/extension/index.ts`, `src/extensions/pi-subagents/src/runs/shared/child-tool-plan.ts`, companion tests. **Estimated scope:** M (≤5; split if more).

### Checkpoint A (after Tasks 1–2)
- [ ] Amended release mapping and slices approved; focused tool-plan regressions and source Graft profile contract pass.

## Task 3: Preserve launch and supervisor bridge contracts

**Description:** Reconcile upstream child launch/runtime changes with fork `SELESAI_SUBAGENT_*` metadata and pi-intercom consumer. Keep post-v0.66 fanout tool-discovery changes. If v0.71 needs core/peer versions beyond Selesai 0.86.1, stop for a separate owner decision.

**Acceptance criteria:**
- [ ] Orchestrator target/session and run/child env names match pi-intercom in source and packaged children.
- [ ] Foreground/background child startup and `contact_supervisor` routing work without an unrequested CLI/foreground fallback.
- [ ] Extension-local runner/preload dependency resolves and new tagged launch tests pass.

**Verification:**
- [ ] `cd src/extensions/pi-subagents && npm run typecheck && npm run test:integration` (focused cases first if the inventory names them).
- [ ] `npx vitest run src/extensions/pi-intercom/intercom.integration.test.ts` from root; check env assertions and supervisor ownership.

**Dependencies:** 2. **Files likely touched:** `src/extensions/pi-subagents/src/runs/shared/child-runtime-config.ts`, `src/extensions/pi-subagents/src/intercom/native-supervisor-channel.ts`, `src/extensions/pi-subagents/src/extension/fanout-child.ts`, focused test(s); edit `src/extensions/pi-intercom/index.ts` only if a verified contract change requires it. **Estimated scope:** M (≤5; split if more).

## Task 4: Preserve async recovery and compatibility wait

**Description:** Reconcile upstream runner/status repair against fork ENOTDIR read-only fallback and `bg_wait`/`subagent_wait` registration. Keep background work visible and never report successful completion before durable evidence exists.

**Acceptance criteria:**
- [ ] A reconciliation write failure does not hide other active runs; isolation errors still use upstream isolation handling.
- [ ] Both wait names are registered unless the owner expressly approves a cutover; completion/stop/steer behavior stays truthful.
- [ ] New upstream async changes and any renamed runner files are covered by the revised inventory and tests.

**Verification:**
- [ ] `cd src/extensions/pi-subagents && node --experimental-strip-types --import ./test/support/isolated-temp-root.mjs --test test/unit/stale-run-reconciler.test.ts test/unit/subagent-wait.test.ts test/unit/wait-subscriptions.test.ts`.
- [ ] `cd src/extensions/pi-subagents && node --experimental-strip-types --import ./test/support/register-loader.mjs --test --test-name-pattern 'isolates active reconciliation validation failures' test/integration/async-status.test.ts`.

**Dependencies:** 3. **Files likely touched:** `src/extensions/pi-subagents/src/runs/background/async-status.ts`, `src/extensions/pi-subagents/src/runs/background/wait-tool.ts`, focused tests. **Estimated scope:** M (≤5; split if more).

### Checkpoint B (after Tasks 3–4)
- [ ] Typecheck, launch/intercom checks, async isolation and fork repair-write regression pass; no child runs invisible or orphaned.

## Task 5: Reconcile workflow and public API changes

**Description:** Port tagged upstream workflow/schema/API changes in narrow slices without replacing fork `launchSlashSubagent` or changing execution authority by accident. New APIs not supported by the host are escalated rather than shimmed.

**Acceptance criteria:**
- [ ] Existing scripted workflow and exported slash/API entry points still pass regression tests or have an owner-approved cutover.
- [ ] Tagged upstream workflow acceptance/permission changes are reflected in focused security and failure-path tests.
- [ ] Schema, docs and runtime agree on the chosen contracts.

**Verification:**
- [ ] `cd src/extensions/pi-subagents && npm run typecheck && node --experimental-strip-types --import ./test/support/isolated-temp-root.mjs --test test/unit/scripted-workflow.test.ts test/unit/schemas.test.ts` (adjust named tests to tagged inventory).
- [ ] `cd src/extensions/pi-subagents && npm run test:integration`.

**Dependencies:** 2, 3. **Files likely touched:** `src/extensions/pi-subagents/src/workflows/scripted-workflow.ts`, `src/extensions/pi-subagents/src/extension/schemas.ts`, `src/extensions/pi-subagents/src/slash/slash-commands.ts`, focused test(s). **Estimated scope:** M (≤5; split if more).

## Task 6: Reconcile status, notification and observability changes

**Description:** Port remaining tagged status/event/visibility changes, including any v0.71 external-consumer interfaces **only after Task 1 proves their exact contract**. Preserve evidence and bounded hot-path cost.

**Acceptance criteria:**
- [ ] Parent and external status consumers see accurate active/terminal outcomes, spend and event fields only where tagged upstream specifies them.
- [ ] No unapproved persistence/notification schema migration or status polling cost is introduced.
- [ ] Tagged regressions plus fork delivery/ownership tests pass.

**Verification:**
- [ ] `cd src/extensions/pi-subagents && npm run typecheck && npm run test:unit && npm run test:integration`.
- [ ] Inspect active → terminal run artifacts and status output for an actual background test case.

**Dependencies:** 4, 5. **Files likely touched:** `src/extensions/pi-subagents/src/runs/background/async-status.ts`, `src/extensions/pi-subagents/src/runs/background/notify.ts`, matching status/event modules and focused tests **to be named at Task 1**. **Estimated scope:** M (≤5 per slice; split if more).

### Checkpoint C (after Tasks 5–6)
- [ ] Workflow/public API and async status suites pass; fork safety/permission contracts reviewed against `VISION.md`.

## Task 7: Update packaged assets, docs and fork-maintenance record

**Description:** Adopt tagged package/lockfile/skills/docs only where they match actual host behavior. Update the fork delta record to include post-0.66 Graft augmentation and any new v0.71 decisions; prevent namespace/path leaks and deleted adapter resurrection.

**Acceptance criteria:**
- [ ] Manifest and lockfile pin correct version/dependencies; source and built package include needed files, with deleted bundled CLI agents still absent.
- [ ] Shipped `src/skills/pi-subagents/`, vendored docs, and full-by-default tool description reflect chosen fork behavior; no accidental `.pi` config-root rewrites.
- [ ] `selesai-in-doc/pi-subagents-upgrade.md` records new baseline SHA and durable fork-delta/merge decisions.

**Verification:**
- [ ] `cd src/extensions/pi-subagents && npm run typecheck`; inspect package-lock + manifest diff, exports and asset list.
- [ ] From root: `npm run build`; inspect `dist/extensions/pi-subagents/package.json` and copied skills/docs against the chosen source.

**Dependencies:** 2–6. **Files likely touched:** `src/extensions/pi-subagents/package.json`, `src/extensions/pi-subagents/package-lock.json`, `src/skills/pi-subagents/SKILL.md`, `selesai-in-doc/pi-subagents-upgrade.md`, one tagged doc at a time. **Estimated scope:** M (≤5 per slice; split if more).

## Task 8: Validate the whole candidate and hand off for review

**Description:** Run extension, intercom, Graft and host/package gates; document baseline-vs-target results, security/performance risks and rollback ref. Reviewer examines inventory-to-diff coverage independently before merge.

**Acceptance criteria:**
- [ ] Every anchored upstream path has a disposition; intentional fork behavior and user-approved departures have corresponding tests/documentation.
- [ ] Vendor unit/integration, root test/build, Graft loader + source/packaged profiles, and intercom gates pass (or recorded pre-existing failures are explicitly accepted by owner).
- [ ] Independent review and human approval occur before merge/shipping; rollback ref is documented.

**Verification:**
- [ ] `cd src/extensions/pi-subagents && npm run typecheck && npm run test:unit && npm run test:integration`.
- [ ] From root: `npm run build && npm test && npx vitest run src/extensions/pi-graft && npx vitest run src/extensions/pi-intercom/intercom.integration.test.ts && node scripts/verify-graft-integration.mjs loader && node --experimental-strip-types scripts/verify-graft-integration.mjs profiles`.
- [ ] `git status --short`, source vs packaged diff audit, no staged/stray files; reproduce a read-only async child and inspect completion/run artifacts if real credentials are available (otherwise explicitly record the missing manual gate).

**Dependencies:** 1–7. **Files likely touched:** `tasks/plan.md`, `tasks/todo.md` (gate receipts; no production changes expected). **Estimated scope:** S for verification, split any remediation into a new ≤5-file task.

### Final checkpoint
- [ ] All acceptance criteria and standing Definition of Done satisfied; upstream release mapping completed; independent reviewer and human approve the tag-anchored upgrade before merge/release.
