# Task for architect

Create a concrete build plan for this quick-workflow task based on ./.selesai/artifacts/20260710-194326-i-think-caveman-not-auto-inject-like-pon/requirements.md.

Goal: fix the likely root cause where caveman does not auto-inject/persist like ponytail.

Requirements to plan against:
- Audit mode injection first; do not patch just one call site.
- Caveman should behave like ponytail in two ways:
  - persistent once enabled until explicitly turned off
  - auto-injected into the system/runtime prompt
- Use the smallest root-cause fix in the shared path if possible.
- Validation should include:
  - a manual smoke test
  - one small regression test
- If caveman and ponytail are both enabled, both apply:
  - caveman affects brevity/style
  - ponytail affects implementation style

Please produce a concise implementation plan that states:
- what to inspect first
- suspected shared components / code paths to touch
- the minimum code changes to make
- test and manual verification steps
- what the finished prototype should look like
- implementation order

End the plan with exactly one machine-readable line on its own:
WORKFLOW_PLAN_STATUS: ready

---
**Output:**
Write your findings to exactly this path: /Users/andrewanggada/Documents/workdir/js_proj/selesai/.selesai/artifacts/20260710-194326-i-think-caveman-not-auto-inject-like-pon/plan.md
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