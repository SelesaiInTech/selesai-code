```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Implemented only the requested fixes: verified TUI-mode guard before settled events and added _emitAgentSettled() test proving dispatch; updated context reminder wording for configurable threshold; completed RPC threshold support (state, command/response, client method, persistence/validation). Build and focused tests pass."
    }
  ],
  "changedFiles": [
    "src/core/agent-session.ts",
    "src/core/settings-manager.ts",
    "src/extensions/context-compaction-reminder.ts",
    "src/modes/rpc/rpc-types.ts",
    "src/modes/rpc/rpc-mode.ts",
    "src/modes/rpc/rpc-client.ts",
    "src/core/agent-session-auto-handoff.test.ts",
    "src/core/settings-manager-auto-handoff.test.ts"
  ],
  "testsAddedOrUpdated": [
    "src/core/agent-session-auto-handoff.test.ts",
    "src/core/settings-manager-auto-handoff.test.ts"
  ],
  "commandsRun": [
    {
      "command": "npx vitest run src/core/agent-session-auto-handoff.test.ts src/core/settings-manager-auto-handoff.test.ts src/extensions/context-compaction-reminder.test.ts --no-coverage --reporter=verbose",
      "result": "passed",
      "summary": "17 passed, 0 failed"
    },
    {
      "command": "npx tsc --noEmit -p tsconfig.build.json",
      "result": "passed",
      "summary": "TypeScript: No errors found"
    },
    {
      "command": "npm run build",
      "result": "passed",
      "summary": "Build completed successfully"
    }
  ],
  "validationOutput": [
    "Focused auto-handoff tests pass (17/17)",
    "Build config TypeScript clean",
    "Full npm build succeeds"
  ],
  "residualRisks": [
    "Base tsconfig (tsconfig.base.json) reports 4357 pre-existing errors in unrelated workflow/subagents files; not introduced by this change.",
    "Full vitest suite has unrelated failures in pi-subagents/workflow areas; focused tests pass."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added auto-handoff dispatch after agent_settled with TUI-only guard, persisted threshold settings, updated reminder wording, and completed RPC support for auto-handoff threshold; added focused tests.",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "Workspace-only changes; other modified files in git status are from unrelated in-progress work and were not touched by this task."
}
```

⧉ copy assistant: /cp 4bd351