# Task for builder

Implement the complete Auto Handoff plan in the workspace, following the tasks in order. Do not write to `.selesai/artifacts/9d8cc930-e05a-47c2-86ef-fba9ca4acdac` or any workflow artifacts. Requirements: persist `autoHandoff` settings (enabled default false; configurable token threshold default 128k); add two Settings UI controls; after an interactive agent run settles, automatically invoke the existing `handoff-new` flow once when token usage reaches the configured threshold; retain/update the existing warning so it points users to Auto Handoff; expose the planned minimal RPC support. Inspect actual APIs and existing patterns rather than blindly applying pseudocode; resolve plan inconsistencies safely (especially command invocation/session lifecycle). Add or update meaningful tests for settings, lifecycle behavior, UI/RPC as appropriate, and run targeted plus relevant type/test checks. Keep changes scoped to auto handoff, not compaction/refresh. Return an inline completion summary with changed files, behavior, tests run/results, and any residual risks.

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