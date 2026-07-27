 WORKFLOW_REVIEW_STATUS: blocking

## Review
- **Blocker** — `src/core/agent-session.ts:564`: `_checkAutoHandoff()` is gated on `this._extensionMode !== "tui"`, but `_extensionMode` defaults to `"print"` and is only updated inside `bindExtensions`. In the new unit test the field is patched directly, which masks the real runtime path. I do not see any code that calls `bindExtensions` with `mode: "tui"` in the session constructor or runtime initialization path, so in real interactive mode `_extensionMode` may still be `"print"` or `"rpc"` when `_checkAutoHandoff` runs. Verify and fix initialization so `bindExtensions({ mode: "tui", ... })` is invoked before auto-handoff can trigger; otherwise auto-handoff will silently never fire in the mode it is designed for.
- **Finding** — `src/extensions/context-compaction-reminder.ts:5`: the warning message hardcodes "128k tokens" while the threshold is configurable. If the user sets a different threshold, the notification is misleading. Make the message dynamic (e.g. read `ctx.getAutoHandoffThresholdTokens?.()`) or remove the exact number.
- **Finding** — `src/modes/interactive/components/settings-selector.ts:506`: threshold choices are `["64000", ..., "512000"]`, but `SettingsManager.setAutoHandoffThresholdTokens` floors and clamps to a minimum of `1000`. That is safe, but a free-text input or validation would be more honest; current discrete list does not cover every valid value.
- **Finding** — `src/modes/rpc/rpc-mode.ts:563`: `set_auto_handoff` only writes `enabled`; there is no RPC command to change the threshold. The RPC state exposes `autoHandoffEnabled` but not `autoHandoffThresholdTokens`. The contract requested RPC consistency; either expose both read/write or document why the client cannot tune the threshold.
- **Finding** — `src/core/agent-session.ts:548-566`: `_checkAutoHandoff` checks `usage.tokens < threshold` to reset `_autoHandoffTriggered`. If the session is handed off and a new session starts, the flag lives on the old `AgentSession` instance, so this is fine. If the same instance ever reloads/crosses via compaction, the reset logic works for drops, but a second crossing only re-triggers after a dip below threshold. Review whether that is the intended "once per threshold crossing" semantics — currently it is.
- **Finding** — `src/core/agent-session-auto-handoff.test.ts`: the test constructs `AgentSession` and then patches private fields `_extensionRunner`, `_extensionMode`, and `getContextUsage`. This proves the helper logic but does not exercise the real `agent_settled` dispatch path. Add at least one test that calls `_emitAgentSettled()` (or the public flow that leads to it) to ensure `_checkAutoHandoff` is invoked after an actual run.
- **Note** — the workflow adapter diff directed at parent-owned artifacts appears unrelated to the Auto Handoff feature and was already in the workspace diff; I focused on auto-handoff correctness.

## Validation
- Ran `npx vitest run src/core/agent-session-auto-handoff.test.ts src/core/settings-manager-auto-handoff.test.ts src/__tests__/task-workflow.test.ts src/__tests__/workflow-race.test.ts` — all passed.
- Ran `npx tsc --noEmit -p tsconfig.build.json` — no errors.
- `tsconfig.base.json` check has many pre-existing errors in extensions using `@selesai/code`; those are unrelated to this feature.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Review returned concrete findings with file paths and severity, including blocker, findings, and notes."
    }
  ],
  "changedFiles": [
    "src/core/agent-session.ts",
    "src/core/settings-manager.ts",
    "src/modes/interactive/components/settings-selector.ts",
    "src/modes/interactive/interactive-mode.ts",
    "src/modes/rpc/rpc-types.ts",
    "src/modes/rpc/rpc-mode.ts",
    "src/modes/rpc/rpc-client.ts",
    "src/extensions/context-compaction-reminder.ts"
  ],
  "testsAddedOrUpdated": [
    "src/core/agent-session-auto-handoff.test.ts",
    "src/core/settings-manager-auto-handoff.test.ts"
  ],
  "commandsRun": [
    {
      "command": "npx vitest run src/core/agent-session-auto-handoff.test.ts src/core/settings-manager-auto-handoff.test.ts src/__tests__/task-workflow.test.ts src/__tests__/workflow-race.test.ts --reporter=verbose",
      "result": "passed",
      "summary": "All targeted tests passed."
    },
    {
      "command": "npx tsc --noEmit -p tsconfig.build.json",
      "result": "passed",
      "summary": "No build errors."
    }
  ],
  "validationOutput": [
    "Vitest passed for auto-handoff and workflow tests.",
    "tsconfig.build.json typecheck clean."
  ],
  "residualRisks": [
    "Blocker: real TUI mode initialization must set _extensionMode before auto-handoff can fire; current diff does not show this path.",
    "Reminder message hardcodes 128k threshold even when user changes it.",
    "RPC exposes auto-handoff enabled but not threshold read/write.",
    "Tests patch private fields and do not exercise the actual agent_settled dispatch path."
  ],
  "noStagedFiles": false,
  "diffSummary": "Added persistent autoHandoff settings, TUI toggle/threshold selector, agent_settled auto-trigger of /handoff-new guarded to TUI, RPC set_auto_handoff/state exposure, updated context reminder message, and unit tests.",
  "reviewFindings": [
    "blocker: src/core/agent-session.ts:564 - auto-handoff gate uses _extensionMode, which defaults to 'print' and may not be set to 'tui' before _checkAutoHandoff runs in real interactive mode; verify/fix initialization.",
    "finding: src/extensions/context-compaction-reminder.ts:5 - warning hardcodes 128k tokens while threshold is configurable.",
    "finding: src/modes/rpc/rpc-mode.ts:563 - RPC supports set_auto_handoff enabled only, no threshold command/state; inconsistency with settings surface.",
    "finding: src/core/agent-session-auto-handoff.test.ts - tests patch private fields; missing coverage for actual agent_settled dispatch."
  ],
  "manualNotes": "Workflow adapter changes in the same diff are unrelated to Auto Handoff and were not reviewed as part of this feature's correctness."
}
```

⧉ copy assistant: /cp 9be809