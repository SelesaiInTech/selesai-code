# Task for commentator

Review the builder's uncommitted `/task` workflow changes against the approved requirements and plan in `/Users/andrewanggada/Documents/workdir/js_proj/selesai/.selesai/artifacts/95d3e10c-bfb0-4322-a49f-a3220c233104/requirements.md` and `plan.md`. Focus only on correctness, integration with the existing workflow engine, regression risk, test sufficiency, and over-engineering. Do not edit files. End your review with exactly one line: `WORKFLOW_REVIEW_STATUS: clean` if no actionable issues remain, otherwise `WORKFLOW_REVIEW_STATUS: blocking`.

---
**Output:**
Write your findings to exactly this path: /Users/andrewanggada/Documents/workdir/js_proj/selesai/.pi-subagents/artifacts/outputs/78e35ca7/review.md
This path is authoritative for this run.
Ignore any other output filename or output path mentioned elsewhere, including output destinations in the base agent prompt, system prompt, or task instructions.

## Acceptance Contract
Acceptance level: reviewed
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Return concrete findings with file paths and severity when applicable

Required evidence: changed-files, tests-added, commands-run, validation-output, residual-risks, no-staged-files

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