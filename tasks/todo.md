# pi-subagents v0.66.0 → v0.71.0 task list

**Status:** the evidence gate and Slice 0 are complete. The user said “continue”; implementation
is proceeding with the narrow defaults in [`tasks/inventory-v0.71.md`](inventory-v0.71.md).

**Corrections to this file's original assumptions:** `v0.70.1` exists and removes a user-facing
feature; the baseline is a *tag* (tree = upstream repo root), not a `vendor/` directory; the fork's
delta is 86 substantive modified paths + 2 fork-added files, not 720; the true conflict surface is
68 paths (17 production paths including one rename); and the predicted touchpoints below were mostly wrong (`builtin-agent-augmentations.ts` is
fork-only and untouched upstream; `scripted-workflow.ts` and `schemas.ts` are clean merges). Use the inventory's slice map, not the
original file lists. Split each implementation step into ≤5 tracked paths and test before moving on.
Apply the repo Definition of Done (runtime, tests, integration, docs, security, rollback).

## Task 1: Anchor the target and approve a conflict inventory — DONE

**Result:** [`tasks/inventory-v0.71.md`](inventory-v0.71.md) plus the full 440-path
[`tasks/upstream-v0.71-paths.tsv`](upstream-v0.71-paths.tsv). Anchors, per-release mapping read from
the tagged `CHANGELOG.md`, delta counts, the 17 production conflicts, upstream-deleted path dispositions,
renames, host/peer verdict and D1–D5.

**Acceptance criteria:**
- [x] Tag SHAs, per-release changes, counts/path inventory and fork conflict classes recorded.
- [x] Host Pi 0.86.1 compatibility, new/removed public APIs, tests and assets identified; no unknown
      tagged change remains, and every implementation slice is ≤5 files.
- [x] User said “continue”; proceed with the documented D1–D5 defaults and revised order.

**Verification:**
- [x] Local `vendor/pi-subagents/v0.66.0` confirmed byte-identical to upstream `v0.66.0`
      (`0fc0eebb`), so three-way comparison is exact rather than approximate.
- [x] `npm run typecheck` in this worktree → clean, exit 0.
- [x] Unit/integration baseline recorded in `tasks/inventory-v0.71.md`; two full-suite timeout flakes
      pass when isolated. No deterministic baseline failure identified.

**Dependencies:** None. **Files touched:** `tasks/plan.md`, `tasks/todo.md`, `tasks/inventory-v0.71.md`, `tasks/upstream-v0.71-paths.tsv`.

## Slice 0: Make the checkout verifiable

**Description:** Install root and extension dependencies, restore the gitignored
`test/fixtures/pi-coding-agent-shim/dist/` from the main checkout, build the host package, and record
the live unit and integration baseline. No product code changes.

**Acceptance criteria:**
- [x] Typecheck, unit and integration suites ran; real results and isolated flakes are recorded in
      `tasks/inventory-v0.71.md` (unit full run 2916/1/12 skipped; serialized integration 985/1,
      with the remaining test passing in isolation).
- [x] Baseline is recorded in one place for later comparison.

**Verification:** `npm run typecheck` passed. The full unit/integration invocations exposed only
load-sensitive failures; each failed case was rerun in isolation and passed (see inventory).

**Dependencies:** 1. **Files touched:** none (environment only). **Scope:** S. **Status:** DONE.

## Slices 1–9

Use **"Revised implementation slices"** in [`tasks/inventory-v0.71.md`](inventory-v0.71.md),
with D1 (eager tool) and D3 (drop guard/fallback features, migrate docs) in effect. Sequence:
small clean merges and final v0.71 tool-plan behavior → agent selection/Graft → launch/supervisor/env
→ async/status/API → docs, skills, manifest, lockfile and fork record → full gates and rollback ref.

Each slice carries its own acceptance criteria and focused test. The verification intent of the
original Tasks 2–6 is preserved there: builtin Graft profiles and launched-child tool access
(Task 2), supervisor `SELESAI_SUBAGENT_*` symmetry and `contact_supervisor` routing (Task 3), ENOTDIR
fallback with both wait aliases (Task 4), scripted workflow/schema/public API regressions (Task 5),
and active→terminal status accuracy (Task 6).

### Checkpoints
- **A** after the deletion/rename and clean-merge slices: typecheck clean, no dangling imports, and
  `test/unit/child-tool-plan*.test.ts` + `builtin-agent-augmentations.test.ts` pass.
- **B** after tool activation and agent selection: Graft source profiles and wrapped-tool
  launched-child regressions pass.
- **C** after launch/background: intercom, async isolation and wait-alias suites pass.
- **Final:** all acceptance criteria and the standing Definition of Done satisfied; independent
  reviewer and human approve the tag-anchored upgrade before merge/release.

## Task 8 (final): Validate the whole candidate and hand off for review

**Description:** Run the extension, intercom, Graft and host/package gates; document
baseline-vs-target results, security/performance risks and the rollback ref. A reviewer checks the
inventory-to-diff coverage independently before merge.

**Acceptance criteria:**
- [ ] Every anchored upstream path has a disposition; intentional fork behavior and any
      user-approved departure (D1–D5) have corresponding tests/documentation.
- [ ] Vendor unit/integration, root test/build, Graft loader + source/packaged profiles, and
      intercom gates pass, or recorded pre-existing failures are explicitly accepted by the owner.
- [ ] Independent review and human approval occur before merge/shipping; the rollback ref is
      documented.

**Verification:**
- [ ] `cd src/extensions/pi-subagents && npm run typecheck && npm run test:unit && npm run test:integration`.
- [ ] From root: `npm run build && npm test && npx vitest run src/extensions/pi-graft && npx vitest run src/extensions/pi-intercom/intercom.integration.test.ts && node scripts/verify-graft-integration.mjs loader && node --experimental-strip-types scripts/verify-graft-integration.mjs profiles`.
- [ ] `git status --short`, source vs packaged diff audit, no staged/stray files; reproduce a
      read-only async child and inspect completion/run artifacts if real credentials are available
      (otherwise explicitly record the missing manual gate).

**Dependencies:** 1–9. **Files touched:** `tasks/plan.md`, `tasks/todo.md` (gate receipts; no
production changes expected). **Scope:** S for verification, split any remediation into a new
≤5-file slice.
