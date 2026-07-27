# Task for builder

Implement the approved Task workflow refactor in the current repository exactly from this plan. Change the Task mode flow from `plan → loop` to `plan → reuse → handoff → loop` while preserving `continueAfterArtifact: true`, so each valid artifact queues the next phase. Reuse existing Quick-mode patterns and validators; do not add a new engine abstraction.

Plan context:
- Modify src/extensions/workflow/modes/task.ts: import handoffValidator; phases become ["plan", "reuse", "handoff", "loop"]; add reuse prompt using plan.md and explorer output:false with parent-owned reuse.md; add handoff prompt using plan.md + reuse.md and recapper output:false, requiring WORKFLOW_HANDOFF_STATUS: ready; update loop prompt to provide plan.md, reuse.md, handoff.md to builder; add phaseArtifacts and handoff validator; retain skipRules: [], loop validator/close gate, loopMaxIterations, and continueAfterArtifact:true; update comments and command description.
- Modify src/extensions/workflow/adapter.ts comments only, correcting stale Task plan→loop wording. Do not change behavior.
- Update src/__tests__/task-workflow.test.ts for 4 phases, plan→reuse→handoff→loop transitions, handoff validation, explorer/recapper output suppression, automatic continuation at each artifact boundary, persistence/reload expectations, and loop setup.
- Update docs/workflows.md to document Task as plan → reuse → handoff → loop (build ↔ review) → terminal-ready → end_task_workflow and its automatic artifact continuation; remove obsolete claims.
- Run the narrow Task workflow tests, the listed workflow regression tests, and npm run build if practical. Fix failures caused by the refactor.

Inspect the existing code and tests before editing. Keep the diff minimal. All code changes go in the workspace, never in /Users/andrewanggada/Documents/workdir/js_proj/selesai/.selesai/artifacts/a50aca23-f9d4-4470-b437-63fd77d44d27. Return only an inline completion summary with files changed, tests/build run and results, and any residual concerns. Do not write workflow artifacts.

## Acceptance Contract
Acceptance level: attested
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Return concrete findings with file paths and severity when applicable

Required evidence: review-findings, residual-risks

Finish with a fenced JSON block tagged `acceptance-report` in this shape:
Use empty arrays when no items apply; array fields contain strings unless object entries are shown.
```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "specific proof"
    }
  ],
  "changedFiles": [
    "src/file.ts"
  ],
  "testsAddedOrUpdated": [
    "test/file.test.ts"
  ],
  "commandsRun": [
    {
      "command": "command",
      "result": "passed",
      "summary": "short result"
    }
  ],
  "validationOutput": [
    "validation output or concise summary"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "short description of the diff",
  "reviewFindings": [
    "blocker: file.ts:12 - issue found, or no blockers"
  ],
  "manualNotes": "anything else the parent should know"
}
```