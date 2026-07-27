## Review

### Blockers

1. **src/__tests__/adapter.test.ts — 25 tests fail against the new parent-owned workflow contract**
   The workflow adapter refactor changed the contract so that workflow subagent calls are forced to `output: false`, the parent must use `write_workflow_artifact` to persist phase artifacts, and the previous forced-output / fallback-text / `context: fresh` / model-override / parallel-chain blocking behaviours were removed. `adapter.test.ts` still asserts the old contract, causing 25 failures in the test run.

   Required fix: rewrite the affected tests to match the new contract:
   - replace assertions that `subagent` `output` is forced to `artifactDir/...` with assertions that it is set to `false`
   - replace assertions that `subagent` `context` defaults to `"fresh"` with assertions that it is left unchanged
   - remove tests expecting model-override blocking and parallel/chain blocking in single-owner phases
   - rewrite walk-to-phase helpers to use `write_workflow_artifact` for artifact phases instead of `writeFileSync` + `tool_result`
   - remove or rewrite the subagent-text fallback tests; the parent must now call `write_workflow_artifact` explicitly
   - ensure loop-phase helpers enter `loop` by writing the parent-owned `plan.md` / `reuse.md` / `handoff.md` artifacts through the writer tool

2. **src/extensions/workflow/task-validators.ts — imports a non-existent export**
   The file imports `markerValidator` from `./validators.ts`, but `validators.ts` only exports `planValidator`, `handoffValidator`, `loopCompleteValidator`, `reviewValidator`, `MARKERS`, and the type. No file imports `task-validators.ts`, so it is dead code, but it is a runtime error if anyone ever imports it.

   Required fix: either delete `src/extensions/workflow/task-validators.ts` if it is not used, or expose `markerValidator` from `validators.ts` and wire the validators into task mode.

### Findings (non-blocking but should be noted)

- `session-usage.test.ts` uses node:test, so `vitest` reports “no tests”; it passes under the node test runner. Consider migrating to vitest for consistency with the rest of the suite.
- `src/extensions/pi-subagents/test/unit/pi-coding-agent-dir.test.ts` references a builtin `worker` agent that no longer exists (dropped in 74d89629). That test fails independently of this change and should be updated or removed.

### Validation

- `npm run build` — passed
- Focused vitest pass on handoff/workflow changes: 5 files, 29 tests passed
  - `src/core/agent-session-auto-handoff.test.ts`: 10/10
  - `src/core/settings-manager-auto-handoff.test.ts`: 3/3
  - `src/__tests__/task-workflow.test.ts`: 6/6
  - `src/__tests__/workflow-race.test.ts`: 6/6
  - `src/extensions/context-compaction-reminder.test.ts`: 4/4
- `src/__tests__/adapter.test.ts`: 25 failed / 22 passed

WORKFLOW_REVIEW_STATUS: blocking

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Review returned concrete file/line findings with severity: src/__tests__/adapter.test.ts blocker with 25 failing tests and exact required test rewrites; src/extensions/workflow/task-validators.ts dead-code import blocker."
    }
  ],
  "changedFiles": [
    "src/core/agent-session.ts",
    "src/core/settings-manager.ts",
    "src/extensions/context-compaction-reminder.ts",
    "src/modes/interactive/components/settings-selector.ts",
    "src/modes/interactive/interactive-mode.ts",
    "src/modes/rpc/rpc-client.ts",
    "src/modes/rpc/rpc-mode.ts",
    "src/modes/rpc/rpc-types.ts",
    "src/extensions/workflow/adapter.ts",
    "src/extensions/workflow/modes/prototype.ts",
    "src/extensions/workflow/modes/quick.ts",
    "src/extensions/workflow/modes/task.ts",
    "src/extensions/workflow/state-machine.ts",
    "src/extensions/pi-powerline-footer/index.ts",
    "src/extensions/pi-powerline-footer/session-usage.ts",
    "src/extensions/pi-subagents/README.md",
    "src/extensions/pi-subagents/agents/architect.md",
    "src/extensions/pi-subagents/agents/builder.md",
    "src/extensions/pi-subagents/agents/commentator.md",
    "src/extensions/pi-subagents/agents/explorer.md",
    "src/extensions/pi-subagents/agents/recapper.md",
    "src/extensions/pi-subagents/agents/researcher.md",
    "src/extensions/pi-subagents/src/agents/agents.ts",
    "src/extensions/pi-subagents/src/extension/index.ts",
    "src/extensions/pi-subagents/src/runs/background/result-watcher.ts",
    "src/extensions/pi-subagents/src/runs/background/subagent-runner.ts",
    "src/extensions/pi-subagents/test/unit/pi-coding-agent-dir.test.ts",
    "src/index.ts",
    "docs/workflows.md"
  ],
  "testsAddedOrUpdated": [
    "src/core/agent-session-auto-handoff.test.ts",
    "src/core/settings-manager-auto-handoff.test.ts",
    "src/__tests__/task-workflow.test.ts",
    "src/__tests__/workflow-race.test.ts",
    "src/extensions/pi-powerline-footer/tests/session-usage.test.ts"
  ],
  "commandsRun": [
    {
      "command": "npm run build",
      "result": "passed",
      "summary": "TypeScript build completed successfully"
    },
    {
      "command": "npx vitest run src/core/agent-session-auto-handoff.test.ts src/core/settings-manager-auto-handoff.test.ts src/__tests__/task-workflow.test.ts src/__tests__/workflow-race.test.ts src/extensions/context-compaction-reminder.test.ts",
      "result": "passed",
      "summary": "5 test files, 29 tests passed"
    },
    {
      "command": "npx vitest run src/__tests__/adapter.test.ts",
      "result": "failed",
      "summary": "1 failed test file, 25 failed tests, 22 passed"
    }
  ],
  "validationOutput": [
    "Auto-handoff unit tests pass: threshold/default, TUI gating, settled-event dispatch, reset-on-token-drop.",
    "Settings persistence tests pass: defaults, enabled state, threshold clamp at 1000.",
    "Context-compaction reminder tests pass and reminder text now references /handoff-new + Auto Handoff setting.",
    "RPC read/write API present: set_auto_handoff, set_auto_handoff_threshold in command/state/response types, client methods, and rpc-mode handler with threshold validation.",
    "Task/race workflow tests pass after aligning to parent-owned artifact contract.",
    "src/__tests__/adapter.test.ts still asserts the old forced-output/fallback-text contract and fails 25 tests."
  ],
  "residualRisks": [
    "adapter.test.ts must be rewritten before the workflow adapter change is safe to merge",
    "src/extensions/workflow/task-validators.ts is dead code with an invalid import and should be deleted or wired in",
    "src/extensions/pi-subagents/test/unit/pi-coding-agent-dir.test.ts references a dropped builtin 'worker' agent and fails independently"
  ],
  "noStagedFiles": true,
  "diffSummary": "Auto Handoff: settings, TUI eligibility from _emitAgentSettled, RPC API, interactive settings UI, and non-misleading context reminder. Workflow adapter refactored to parent-owned artifacts (output:false, no fallback persistence, no forced fresh context/model/parallel blocks). Task mode validators and subagent usage tracking in powerline footer are new but currently unused/broken.",
  "reviewFindings": [
    "blocker: src/__tests__/adapter.test.ts:303-925 - 25 tests fail because they assert the removed forced-output, text-fallback, context:fresh, model/parallel/chain blocking contract. Rewrite them to assert output:false and parent writer-tool persistence.",
    "blocker: src/extensions/workflow/task-validators.ts:4 - imports non-existent markerValidator from validators.ts and is not imported anywhere. Delete it or export markerValidator and wire it into task mode."
  ],
  "manualNotes": "The Auto Handoff implementation itself (core + settings + RPC + TUI + reminder) is correct and well-tested. The remaining work is test alignment for the workflow adapter contract change, plus removal of the orphaned task-validators.ts file."
}
```

⧉ copy assistant: /cp 2baeb9