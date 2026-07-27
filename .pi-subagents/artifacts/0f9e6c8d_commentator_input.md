# Task for commentator

You are reviving a previous subagent conversation.

Original run: a0025c68
Original agent: commentator
Original session file: /Users/andrewanggada/.selesai/agent/sessions/--Users-andrewanggada-Documents-workdir-js_proj-selesai--/2026-07-11T20-44-08-321Z_019f52ec-5701-777d-971f-dfa649571254/a0025c68/run-0/session.jsonl

Use the stored session context as background. Answer the orchestrator's follow-up below. Do not assume the original child process is still alive.

Follow-up:
Retry immediately. Inspect the current workspace diff and return your concise Auto Handoff review inline. Include concrete blockers only, then end exactly with one standalone `WORKFLOW_REVIEW_STATUS: clean` or `WORKFLOW_REVIEW_STATUS: blocking` line.

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