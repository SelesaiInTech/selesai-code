# Task for commentator

Review the workspace implementation for the Auto Handoff feature against this plan and user intent: configurable persistent enabled toggle (default false) and context-token threshold (default 128k); Settings UI controls; after an interactive agent settles at/above threshold, automatically run the existing handoff-new flow exactly once per threshold crossing; warning directs users to enable Auto Handoff; minimal consistent RPC exposure. Inspect the actual diff/code/tests. Report only concrete blocking correctness, lifecycle/race, persistence, type/API, test coverage, or scope issues, with file paths and actionable fixes. If the builder did not complete any implementation, identify that as blocking. End your review with exactly one standalone line, either `WORKFLOW_REVIEW_STATUS: clean` or `WORKFLOW_REVIEW_STATUS: blocking`.

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