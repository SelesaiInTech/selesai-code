# Task for commentator

Review the builder's implementation for the approved Task workflow refactor. Inspect the full uncommitted diff and relevant existing code/tests. Verify the requested flow is exactly `plan → reuse → handoff → loop`, that task mode reuses existing patterns without unnecessary engine changes, that automatic continuation remains correct, that handoff validation and parent-owned artifacts are enforced, that reload/resume behavior is safe, and that tests/docs/build are adequate. Check for regressions to Prototype/Quick workflows, stale documentation/comments, over-engineering, and unrelated changes. Return an actionable evidence-based review inline. If there are no actionable issues, say so clearly. End with exactly one machine-readable line on its own: WORKFLOW_REVIEW_STATUS: clean or WORKFLOW_REVIEW_STATUS: blocking

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