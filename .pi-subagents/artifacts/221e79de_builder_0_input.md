# Task for builder

Address this blocking review for the Auto Handoff implementation. Work in workspace only, never workflow artifacts. Inspect actual runtime initialization rather than assuming reviewer claims. Ensure the auto-handoff TUI guard is reliable in real interactive sessions: either prove/cover that extension mode is set before `_emitAgentSettled`, or replace it with the correct reliable interactive capability check; add a test that exercises `_emitAgentSettled()`/actual settled dispatch rather than only calling private helper. Fix the warning text so it does not misleadingly hardcode 128k when configurable Auto Handoff threshold differs (or correctly distinguish the reminder’s independent fixed threshold). Make RPC fully consistent with the feature: state must expose both enabled and threshold and RPC must support setting threshold with validation/persistence, plus client API/types/tests as suitable. Preserve once-per-threshold-crossing semantics and scope. Run targeted tests and type/build checks. Return inline completion summary including exact fixes and validations.

Recorded review:
- Blocker `src/core/agent-session.ts:564`: `_extensionMode` may be default `print` rather than initialized to `tui` before auto handoff.
- `src/extensions/context-compaction-reminder.ts:5`: hardcoded 128k warning becomes misleading with custom threshold.
- `src/modes/rpc/rpc-mode.ts:563`: no RPC threshold state/read/write.
- `src/core/agent-session-auto-handoff.test.ts`: private-field stubbing fails to exercise settled dispatch.

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