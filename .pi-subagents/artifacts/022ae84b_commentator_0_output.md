 ## Review

Verified the Auto Handoff feature and the two prior workflow-adapter blockers. No actionable blockers remain.

- **Auto Handoff** — implemented in `src/core/agent-session.ts`, gated to `tui` mode, fires once per threshold crossing from `_emitAgentSettled`, resets when usage drops, and surfaces errors non-fatally.
- **Settings persistence/defaults** — `SettingsManager` exposes getter/setter for enabled (default `false`) and threshold (default `128_000`, clamped to `≥1000`); defaults/persistence are unit-tested.
- **Interactive UI** — `settings-selector.ts` adds toggle + threshold dropdown wired to the settings manager.
- **Reminder** — `context-compaction-reminder.ts` updated to mention `/handoff-new` and Auto Handoff.
- **RPC threshold support** — `rpc-types.ts`, `rpc-mode.ts`, and `rpc-client.ts` add `set_auto_handoff` and `set_auto_handoff_threshold` commands/types/state fields and client methods.
- **Workflow adapter parent-owned artifacts** — removed `FORCE_OUTPUT_PHASES`, `SUBAGENT_FALLBACK_PHASES`, output injection, per-absolute-path override logic, model/context defaults, and broken fallback validators. Child `subagent` calls now get `output: false`; parent must use `write_workflow_artifact`; only the engine-owned loop persists subagent output.
- **Task loop queue** — `continueAfterArtifact` config flag lets `task` queue the loop prompt immediately after a valid plan artifact.
- **Adapter tests** — updated to assert parent-owned artifact semantics and `task` auto-continuation.

Validation:
- `npx vitest run src/__tests__/adapter.test.ts src/__tests__/task-workflow.test.ts src/__tests__/workflow-race.test.ts src/__tests__/state-machine.test.ts src/core/agent-session-auto-handoff.test.ts src/core/settings-manager-auto-handoff.test.ts` → 102 passed.
- `npx tsc --noEmit -p tsconfig.build.json` → no errors.
- `git diff --check` → clean.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Reviewed the actual diff and tests. Auto Handoff emits from _emitAgentSettled with a tui-mode guard and one-shot trigger; settings manager supports enabled/threshold with defaults and persistence; interactive settings selector and RPC commands/types added; context reminder updated; workflow adapter now enforces parent-owned artifacts (child output suppressed to false, no fallback validators/output injectors); task mode uses continueAfterArtifact to queue the loop; adapter/task/race/state-machine/auto-handoff/settings tests pass (102 tests) and tsc --noEmit is clean."
    }
  ],
  "changedFiles": [
    "src/core/agent-session.ts",
    "src/core/settings-manager.ts",
    "src/core/agent-session-auto-handoff.test.ts",
    "src/core/settings-manager-auto-handoff.test.ts",
    "src/extensions/context-compaction-reminder.ts",
    "src/index.ts",
    "src/modes/interactive/interactive-mode.ts",
    "src/modes/interactive/components/settings-selector.ts",
    "src/modes/rpc/rpc-client.ts",
    "src/modes/rpc/rpc-mode.ts",
    "src/modes/rpc/rpc-types.ts",
    "src/extensions/workflow/adapter.ts",
    "src/extensions/workflow/state-machine.ts",
    "src/extensions/workflow/modes/prototype.ts",
    "src/extensions/workflow/modes/quick.ts",
    "src/extensions/workflow/modes/task.ts",
    "src/__tests__/adapter.test.ts",
    "src/__tests__/task-workflow.test.ts",
    "src/__tests__/workflow-race.test.ts",
    "docs/workflows.md"
  ],
  "testsAddedOrUpdated": [
    "src/core/agent-session-auto-handoff.test.ts",
    "src/core/settings-manager-auto-handoff.test.ts",
    "src/__tests__/adapter.test.ts",
    "src/__tests__/task-workflow.test.ts",
    "src/__tests__/workflow-race.test.ts"
  ],
  "commandsRun": [
    {
      "command": "npx vitest run src/__tests__/adapter.test.ts src/__tests__/task-workflow.test.ts src/__tests__/workflow-race.test.ts src/__tests__/state-machine.test.ts src/core/agent-session-auto-handoff.test.ts src/core/settings-manager-auto-handoff.test.ts",
      "result": "passed",
      "summary": "102 tests passed"
    },
    {
      "command": "npx tsc --noEmit -p tsconfig.build.json",
      "result": "passed",
      "summary": "No TypeScript errors"
    },
    {
      "command": "git diff --check",
      "result": "passed",
      "summary": "No whitespace errors"
    }
  ],
  "validationOutput": [
    "102 workflow + auto-handoff + state-machine tests passed",
    "TS build clean",
    "git diff --check clean"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "Add Auto Handoff (interactive/RPC/settings), refactor workflow adapter for parent-owned artifacts, remove broken fallback validators and child-output forcing, and update tests/docs accordingly.",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "Workflow adapter simplification is complete: child subagent output is always suppressed to false, only the engine-owned loop persists subagent results, and task mode queues the build loop automatically after a valid plan artifact."
}
```

WORKFLOW_REVIEW_STATUS: clean

⧉ copy assistant: /cp ac925f