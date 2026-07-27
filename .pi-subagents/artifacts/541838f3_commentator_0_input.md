# Task for commentator

Review the workspace implementation against the auto-update-awareness plan. Inspect the actual diff and relevant code/tests. Required behavior: npm-registry check detects newer @selesai/code without auto-installing; skip/offline suppress network; interactive notification presents a manual update instruction and no pi.dev link; print mode check is fire-and-forget and writes only stderr (not RPC/stdout); tests are isolated and meaningful. Check TypeScript/style/edge cases and run or assess focused tests/build as warranted. Do not modify files and do not write workflow artifacts. Return the full review inline, with findings categorized by severity. Your final line must be exactly one of `WORKFLOW_REVIEW_STATUS: clean` or `WORKFLOW_REVIEW_STATUS: blocking`.

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