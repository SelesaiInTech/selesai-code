# Task for builder

Address the blocking review findings in the workspace only; do not modify workflow artifacts. 1) In `src/modes/interactive/interactive-mode.ts`, pass `PACKAGE_NAME` explicitly to `checkForNewPiVersion(this.version, PACKAGE_NAME)` at the startup call site. 2) In `src/modes/print-mode.ts`, ensure the fire-and-forget version-check chain cannot ever surface an unhandled rejection by appending an explicit no-op `.catch(() => {})` after its `.then(...)`, preserving stderr-only, non-blocking behavior. Run the focused version-check test and build/type validation if practical. Return completion summary inline with changed files and command outcomes.

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