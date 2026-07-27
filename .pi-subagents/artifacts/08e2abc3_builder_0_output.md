 Implemented the Auto Handoff plan in the active workspace, reusing existing settings manager, RPC, and settings selector patterns.

Changed files:
- src/core/settings-manager.ts
- src/core/agent-session.ts
- src/extensions/context-compaction-reminder.ts
- src/modes/interactive/components/settings-selector.ts
- src/modes/interactive/interactive-mode.ts
- src/modes/rpc/rpc-types.ts
- src/modes/rpc/rpc-mode.ts
- src/modes/rpc/rpc-client.ts
Tests added:
- src/core/settings-manager-auto-handoff.test.ts
- src/core/agent-session-auto-handoff.test.ts

Validation:
- npx vitest run src/core/settings-manager-auto-handoff.test.ts src/core/agent-session-auto-handoff.test.ts passed (11 tests)
- npm run build passed
- npx tsc -p tsconfig.build.json --noEmit passed

Behavior:
- Added persistent autoHandoff.enabled (default false) and thresholdTokens (default 128000) in Settings.
- Settings UI has Auto handoff toggle and Auto handoff threshold selector.
- On interactive agent-settled, if enabled and token usage reaches threshold, invokes the existing command:handoff-new once.
- Per-session triggered flag resets if tokens drop below threshold.
- Non-TUI modes are guarded; the handoff-new command requires TUI.
- Context compaction reminder now mentions Settings Auto Handoff.
- RPC supports set_auto_handoff, exposes autoHandoffEnabled in state, and RpcClient has setAutoHandoff().

Open risk: The settings-selector UI exposes preset thresholds; custom thresholds require manual settings file edits.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Implemented persistent settings, TUI selectors, agent_settled auto handoff trigger, context-reminder wording update, and RPC support. All changes stayed within the requested scope and reused existing APIs/patterns."
    }
  ],
  "changedFiles": [
    "src/core/settings-manager.ts",
    "src/core/agent-session.ts",
    "src/extensions/context-compaction-reminder.ts",
    "src/modes/interactive/components/settings-selector.ts",
    "src/modes/interactive/interactive-mode.ts",
    "src/modes/rpc/rpc-types.ts",
    "src/modes/rpc/rpc-mode.ts",
    "src/modes/rpc/rpc-client.ts"
  ],
  "testsAddedOrUpdated": [
    "src/core/settings-manager-auto-handoff.test.ts",
    "src/core/agent-session-auto-handoff.test.ts"
  ],
  "commandsRun": [
    {
      "command": "npx vitest run src/core/settings-manager-auto-handoff.test.ts src/core/agent-session-auto-handoff.test.ts --reporter=verbose",
      "result": "passed",
      "summary": "11 tests passed"
    },
    {
      "command": "npm run build",
      "result": "passed",
      "summary": "Build completed successfully"
    },
    {
      "command": "npx tsc -p tsconfig.build.json --noEmit",
      "result": "passed",
      "summary": "No TypeScript errors"
    }
  ],
  "validationOutput": [
    "Vitest: 11/11 passed",
    "npm run build: success",
    "tsc: No errors found"
  ],
  "residualRisks": [
    "Settings selector exposes fixed preset thresholds; non-preset thresholds require editing the settings file directly."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added persistent autoHandoff settings, TUI toggle and threshold selector, agent_settled automatic handoff-new invocation for TUI once threshold is reached, context reminder update mentioning Settings Auto Handoff, and minimal RPC support for reading and enabling auto handoff.",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "All changes were made in the workspace repository. The existing handoff-new extension is reused for the actual handoff behavior; auto handoff simply calls it with an empty goal string on the settled event."
}
```

⧉ copy assistant: /cp ff38b5