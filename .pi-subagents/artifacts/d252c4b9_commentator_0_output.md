 ## Review

I reviewed the uncommitted diff in `task.ts`, `adapter.ts`, `task-workflow.test.ts`, and `docs/workflows.md`. No blockers remain.

### Findings

- **Blocker**: none.
- **Finding**: none.
- **Note** — The task refactor correctly expands task to `plan → reuse → handoff → loop`, wires `continueAfterArtifact` for all parent-owned boundaries, and reuses the existing `handoffValidator` already present in validators. The adapter resume reconciliation now loops `onArtifactMaybe` until caught up and rolls back both in-memory and durable state if any persist fails. The test suite covers the new happy path, handoff marker validation, auto-queued phase prompts, resume reconciliation through handoff, max-iter pause, and the new rollback-on-persist-failure case.

### Validation

- `npx vitest run src/__tests__/task-workflow.test.ts src/__tests__/state-machine.test.ts` → PASS (51), FAIL (0).
- Full `npx vitest run` passes the workflow tests; the failures shown in the full run are pre-existing in unrelated areas (`filterSkillBodyForMode`, agent eject/disable/enable/reset, etc.) and are not touched by this diff.
- `git diff --check` clean; no staged files; only the four expected files modified plus an unrelated untracked `src/extensions/grep-app/---`.

WORKFLOW_REVIEW_STATUS: clean

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Diff stays within the requested task workflow refactor and adapter resume rollback: modifies only src/extensions/workflow/modes/task.ts, src/extensions/workflow/adapter.ts, src/__tests__/task-workflow.test.ts, and docs/workflows.md. No unrelated engine files are touched."
    }
  ],
  "changedFiles": [
    "src/extensions/workflow/modes/task.ts",
    "src/extensions/workflow/adapter.ts",
    "src/__tests__/task-workflow.test.ts",
    "docs/workflows.md"
  ],
  "testsAddedOrUpdated": [
    "src/__tests__/task-workflow.test.ts"
  ],
  "commandsRun": [
    {
      "command": "npx vitest run src/__tests__/task-workflow.test.ts src/__tests__/state-machine.test.ts",
      "result": "passed",
      "summary": "PASS (51), FAIL (0); all workflow/state-machine tests pass."
    },
    {
      "command": "git diff --check",
      "result": "passed",
      "summary": "No whitespace or merge conflicts."
    }
  ],
  "validationOutput": [
    "workflow/state-machine tests pass",
    "task-workflow tests cover new phases, auto-advance, handoff validator, resume reconciliation, max-iter pause, and rollback on persist failure",
    "full test suite shows unrelated pre-existing failures in skill-filter and agent-management tests; workflow diff did not regress them"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "Expanded task workflow into plan → reuse → handoff → loop, enabled automatic next-phase prompts at each parent-owned artifact boundary, added multi-step resume reconciliation with atomic rollback on persist failure, and updated tests/docs.",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "One unrelated untracked file present: src/extensions/grep-app/---"
}
```

⧉ copy assistant: /cp b53e18