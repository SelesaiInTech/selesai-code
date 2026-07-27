# Task for planner

Produce a concise executable implementation plan only (no edits) for this repo task: update src/extensions/question so TUI questions always render inline in the chat, never as floating overlays/dialogs. Remove question-tool status/footer writes entirely. Remove overlay/display configuration from the public tool schema/API (displayMode, overlayToggleKey, PI_QUESTION_DISPLAY_MODE/PI_QUESTION_OVERLAY_TOGGLE_KEY) and delete obsolete overlay code/types/constants/tests. Preserve context in the inline question UI for every question type, including no-options freeform: route it through the existing QuestionComponent rather than ctx.ui.input. Keep RPC/headless behavior functional using the existing dialog/text fallback because inline custom UI is unavailable there. User chose fully remove overlay controls, not compat. Relevant files already identified: src/extensions/question/index.ts, tui-adapter.ts, types.ts, schemas.ts, constants.ts, shortcuts.ts, dialog-adapter.ts, ui-protocol.ts, tests/*. Include exact ownership, deletion/reuse, test updates, verification. Note current status is unrelated user changes elsewhere; do not touch.

---
**Output:**
Write your findings to exactly this path: /Users/andrewanggada/Documents/workdir/js_proj/selesai/.pi-subagents/artifacts/outputs/8db2d4b2/plan.md
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