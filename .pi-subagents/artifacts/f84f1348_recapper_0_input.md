# Task for recapper

Create a self-contained handoff document for the quick-workflow prototype described by these artifacts:
- ./.selesai/artifacts/20260710-194326-i-think-caveman-not-auto-inject-like-pon/requirements.md
- ./.selesai/artifacts/20260710-194326-i-think-caveman-not-auto-inject-like-pon/plan.md
- ./.selesai/artifacts/20260710-194326-i-think-caveman-not-auto-inject-like-pon/reuse.md

Prototype/topic: fix the likely root cause where the caveman extension does not persist and auto-inject into the system/runtime prompt like ponytail does.

The handoff should be self-contained for loop-phase implementation subagents. Include:
- user goal and approved requirements
- root cause summary
- exact files/patterns to inspect and reuse
- minimum implementation steps
- test/manual verification expectations
- coexistence rule when caveman and ponytail are both active
- constraints on keeping the fix minimal and avoiding unnecessary abstractions

End the handoff with exactly one machine-readable line on its own:
WORKFLOW_HANDOFF_STATUS: ready

---
**Output:**
Write your findings to exactly this path: /Users/andrewanggada/Documents/workdir/js_proj/selesai/.selesai/artifacts/20260710-194326-i-think-caveman-not-auto-inject-like-pon/handoff.md
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