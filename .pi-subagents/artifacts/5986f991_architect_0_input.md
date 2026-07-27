# Task for architect

Create a concrete implementation plan for adding the new `/task` workflow to this repository. Read the approved requirements at `/Users/andrewanggada/Documents/workdir/js_proj/selesai/.selesai/artifacts/95d3e10c-bfb0-4322-a49f-a3220c233104/requirements.md`, the existing workflow implementation under `src/extensions/workflow/`, its tests, and `docs/workflows.md`. Scope: architect subagent plan, then a builder/commentator loop; terminal-ready clean review requiring `end_task_workflow`; max 3 persisted blocking review rounds; reuse durable resume/run-state behavior. Identify exact files, mode configuration, tool/command names, prompts/artifacts, tests, docs, and verification. Save the self-contained plan to `/Users/andrewanggada/Documents/workdir/js_proj/selesai/.selesai/artifacts/95d3e10c-bfb0-4322-a49f-a3220c233104/plan.md` and end it with exactly `WORKFLOW_PLAN_STATUS: ready`. Do not modify source files.

---
**Output:**
Write your findings to exactly this path: /Users/andrewanggada/Documents/workdir/js_proj/selesai/.selesai/artifacts/95d3e10c-bfb0-4322-a49f-a3220c233104/plan.md
This path is authoritative for this run.
Ignore any other output filename or output path mentioned elsewhere, including output destinations in the base agent prompt, system prompt, or task instructions.

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