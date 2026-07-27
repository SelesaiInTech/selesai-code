# Task for commentator

Review the workspace implementation of Auto Handoff against the requested plan and intent. Verify persistence/defaults for `autoHandoff.enabled` and threshold; Settings toggle and threshold UI; safe interactive agent-settled invocation of existing `handoff-new` exactly once per threshold crossing; warning messaging; RPC consistency; and meaningful tests. Inspect the diff and actual APIs—do not trust summaries. Identify only concrete blocking issues (correctness, lifecycle/race, type/API, persistence, test gaps that leave core behavior unverified, or scope violations) with paths and precise fixes. If no blockers, say so. End with exactly one standalone line: `WORKFLOW_REVIEW_STATUS: clean` or `WORKFLOW_REVIEW_STATUS: blocking`.

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