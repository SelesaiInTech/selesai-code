# Task for builder

Fix the remaining blocking review issues in workspace only. These concern existing workflow-adapter changes currently in the diff and must be made internally consistent: (1) update `src/__tests__/adapter.test.ts` to match the parent-owned artifact contract now implemented—subagent calls use `output: false`, artifacts are persisted via `write_workflow_artifact`, no obsolete forced `context:fresh`, model override, or parallel/chain blocking assertions; ensure the adapter test suite passes. (2) resolve `src/extensions/workflow/task-validators.ts` importing non-existent `markerValidator`: delete dead file if genuinely unused, otherwise correctly implement/export/wire it. Do not roll back valid Auto Handoff work or alter workflow artifacts. Run the specific adapter tests plus relevant workflow tests/build. Return inline completion summary.

## Acceptance Contract
Acceptance level: checked
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Implement the requested change without widening scope

Required evidence: changed-files, tests-added, commands-run, residual-risks, no-staged-files

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