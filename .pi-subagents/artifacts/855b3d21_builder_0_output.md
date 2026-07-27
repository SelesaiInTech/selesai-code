 Implemented: Addressed the three blocking review findings.

1. **Atomic resume reconciliation (adapter.ts)**: Replaced the inner-checkpoint catch-up loop with a single `reconcileBefore` checkpoint. On any `onArtifactMaybe`/`persistRun` failure, the adapter now restores in-memory controller state to that pre-reconcile checkpoint and writes it back to disk, preventing a drift between persisted phase and controller state. Successful multi-artifact catch-up still persists each advance. Also added `terminalNeedsArtifacts` as a loop-break condition.
2. **Reuse skip clarity (task.ts)**: Rewrote the `reuse` prompt to state up front that the adapter auto-skips reuse when the project has no git history, so exploration is only useful when commits exist.
3. **Docs wording (docs/workflows.md)**: Changed the `skipRules` description from “empty projects” to “when the project has no git history”.
4. **Internal consistency (adapter.ts)**: Renamed `isEmptyProject` to `hasNoGitHistory` and updated comments so the code no longer conflates “empty project” with “no git history”.

Also added a regression test that mocks `saveWorkflowRun` to fail on the third reconcile persist and verifies the durable state rolls back to the pre-reconcile `plan` phase, then resumes cleanly after the mock is removed.

Changed files:
- `src/extensions/workflow/adapter.ts`
- `src/extensions/workflow/modes/task.ts`
- `docs/workflows.md`
- `src/__tests__/task-workflow.test.ts`

Validation:
- `npm run build` — passed
- `npx vitest run src/__tests__/task-workflow.test.ts` — 9 passed
- `npx vitest run src/__tests__/workflow-run-state.test.ts src/__tests__/workflow-race.test.ts` — 9 passed

Open risks/questions:
- The regression test relies on `vi.doMock` + `vi.resetModules()` to intercept the adapter’s static import of `run-state.ts`. This pattern works in the current vitest setup but is slightly fragile if module caching behavior changes.
- The rollback persist in the catch block is best-effort; if it also fails, disk remains at the last successful intermediate persist while memory is rolled back.
- Untracked `src/extensions/grep-app/` files were left untouched as requested.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "All three enumerated review findings were fixed with concrete file paths and severity noted: (1) BLOCKER in src/extensions/workflow/adapter.ts resume reconcile loop now atomic with rollback to pre-reconcile checkpoint; (2) UX in src/extensions/workflow/modes/task.ts reuse prompt now clearly ties auto-skip to no git history; (3) DOCS in docs/workflows.md skipRules wording now says 'no git history' instead of 'empty projects'."
    }
  ],
  "changedFiles": [
    "src/extensions/workflow/adapter.ts",
    "src/extensions/workflow/modes/task.ts",
    "docs/workflows.md",
    "src/__tests__/task-workflow.test.ts"
  ],
  "testsAddedOrUpdated": [
    "src/__tests__/task-workflow.test.ts"
  ],
  "commandsRun": [
    {
      "command": "npm run build",
      "result": "passed",
      "summary": "TypeScript build and asset copy succeeded."
    },
    {
      "command": "npx vitest run src/__tests__/task-workflow.test.ts",
      "result": "passed",
      "summary": "9/9 task workflow tests passed, including new atomic rollback regression test."
    },
    {
      "command": "npx vitest run src/__tests__/workflow-run-state.test.ts src/__tests__/workflow-race.test.ts",
      "result": "passed",
      "summary": "9/9 workflow run-state and race tests passed."
    }
  ],
  "validationOutput": [
    "Build completed without errors.",
    "Task workflow suite: PASS (9).",
    "Workflow run-state + race suites: PASS (9)."
  ],
  "residualRisks": [
    "Rollback persist in the catch block is best-effort; if it fails, disk may remain at an intermediate phase while memory is already rolled back.",
    "New regression test depends on vitest doMock/resetModules for the adapter's static run-state import; module cache behavior changes could make it fragile."
  ],
  "noStagedFiles": true,
  "diffSummary": "Workflow adapter resume reconciliation made atomic with single pre-reconcile checkpoint and rollback; reuse skip wording clarified in task prompt and docs; added focused regression test for durable rollback.",
  "reviewFindings": [
    "blocker: src/extensions/workflow/adapter.ts:229 - resume catch-up loop checkpointed inside each iteration, risking inconsistent state on later failure; fixed by using one reconcileBefore checkpoint and restoring both memory and disk on any failure.",
    "ux: src/extensions/workflow/modes/task.ts:33 - reuse prompt conflated empty project with no git history; fixed by stating the adapter auto-skips reuse only when there is no git history.",
    "docs: docs/workflows.md:145 - skipRules table described default as 'empty projects'; fixed to 'when the project has no git history'."
  ],
  "manualNotes": "Untracked src/extensions/grep-app/ files were not touched."
}
```

⧉ copy assistant: /cp a5bf84