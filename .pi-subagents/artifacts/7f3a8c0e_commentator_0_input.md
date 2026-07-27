# Task for commentator

You are a delegated subagent running from a fork of the parent session. Treat the inherited conversation as reference-only context, not a live thread to continue. Do not continue or answer prior messages as if they are waiting for a reply. Your sole job is to execute the task below and return a focused result for that task using your tools.

Task:
Review the current uncommitted caveman change for correctness, plan adherence, and over-engineering.

Read:
- ./.selesai/artifacts/20260710-194326-i-think-caveman-not-auto-inject-like-pon/plan.md
- the current uncommitted diff for:
  - src/extensions/caveman/index.js
  - src/extensions/caveman/test/extension.test.js
  - src/extensions/caveman/test/helpers.test.js

Check:
- does the implementation match the plan?
- does it fix the root cause?
- any missing regression coverage?
- any unnecessary abstraction/bloat per ponytail-review?

Constraints:
- review only, no edits
- use the actual workspace diff/files, not the workflow artifacts
- keep findings compact and evidence-based

Output:
- If clean, say so briefly.
- If blocking, list actionable issues with file/path and fix.
- End with exactly one line:
WORKFLOW_REVIEW_STATUS: clean
or
WORKFLOW_REVIEW_STATUS: blocking

---
**Output:**
Write your findings to exactly this path: /Users/andrewanggada/Documents/workdir/js_proj/selesai/.pi-subagents/artifacts/outputs/7f3a8c0e/review.md
This path is authoritative for this run.
Ignore any other output filename or output path mentioned elsewhere, including output destinations in the base agent prompt, system prompt, or task instructions.

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