# Task for architect

Create an implementation plan for hardening the existing TASK workflow only. Context: task workflow currently has plan → builder/commentator loop, three-round cap, state persisted in workflow.json, and plan→loop now queues the initial prompt. The desired hardening: define clean as plan acceptance criteria covered plus verification evidence, not merely a clean marker; automatically queue commentator after builder and builder after blocking review; enforce expected builder/commentator role by loop stage; preserve durable resume and a 3-round pause; keep quick/prototype behavior unchanged. Examine the repository and return a concrete file-by-file plan including validator/config/API design, migration/compatibility concerns, and test cases. Ensure the final line is exactly WORKFLOW_PLAN_STATUS: ready.

---
**Output:**
Write your findings to exactly this path: /Users/andrewanggada/Documents/workdir/js_proj/selesai/.selesai/artifacts/24dcbf40-8724-4270-bd71-a5c3423f56c5/plan.md
This path is authoritative for this run.
Ignore any other output filename or output path mentioned elsewhere, including output destinations in the base agent prompt, system prompt, or task instructions.

## Acceptance Contract
Acceptance level: reviewed
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Implement the requested change without widening scope
- criterion-2: Return evidence sufficient for an independent acceptance review

Required evidence: changed-files, tests-added, commands-run, validation-output, residual-risks, no-staged-files

Review gate: required by reviewer.

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