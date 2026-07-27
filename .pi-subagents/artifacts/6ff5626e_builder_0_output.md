Implemented: updated `src/__tests__/adapter.test.ts` to match the current parent-owned artifact contract (`output: false`, artifacts persisted via `write_workflow_artifact`, no forced `context:fresh`, no model/parallel/chain blocking assertions, no subagent text fallback). Removed the unused/broken `src/extensions/workflow/task-validators.ts` (no callers; imported non-exported `markerValidator`). Did not touch workflow artifacts or Auto Handoff work.

Changed files:
- `src/__tests__/adapter.test.ts`
- `src/extensions/workflow/task-validators.ts` (deleted)

Tests added/updated:
- `src/__tests__/adapter.test.ts` (rewritten/aligned)

Commands run:
- `npx vitest run src/__tests__/adapter.test.ts` → 35 passed, 0 failed
- `npx vitest run src/__tests__/task-workflow.test.ts src/__tests__/workflow-race.test.ts` → 12 passed, 0 failed
- `npx vitest run src/__tests__/adapter.test.ts src/__tests__/task-workflow.test.ts src/__tests__/workflow-race.test.ts` → 47 passed, 0 failed
- `npm run build` → passed

Validation output: adapter, task-workflow, and workflow-race suites green; TypeScript build green. Full repository test run still has 26 unrelated failures in pi-subagents / upstream-cache tests not in scope.

Residual risks:
- The broader repository has unrelated pre-existing test failures (pi-subagents slash commands, pi-args MCP config, agent-management model mappings, upstream-cache version-check). These were not introduced by the workflow-adapter changes and are out of scope.
- No staged files.
- No build regressions from deleted file.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Adapter tests rewritten to the current contract (output:false, write_workflow_artifact persistence, no obsolete blocking/context assertions); task-validators.ts deleted as genuinely unused/broken; targeted workflow suites and build pass."
    }
  ],
  "changedFiles": [
    "src/__tests__/adapter.test.ts",
    "src/extensions/workflow/task-validators.ts"
  ],
  "testsAddedOrUpdated": [
    "src/__tests__/adapter.test.ts"
  ],
  "commandsRun": [
    {
      "command": "npx vitest run src/__tests__/adapter.test.ts",
      "result": "passed",
      "summary": "35 passed, 0 failed"
    },
    {
      "command": "npx vitest run src/__tests__/task-workflow.test.ts src/__tests__/workflow-race.test.ts",
      "result": "passed",
      "summary": "12 passed, 0 failed"
    },
    {
      "command": "npx vitest run src/__tests__/adapter.test.ts src/__tests__/task-workflow.test.ts src/__tests__/workflow-race.test.ts",
      "result": "passed",
      "summary": "47 passed, 0 failed"
    },
    {
      "command": "npm run build",
      "result": "passed",
      "summary": "tsgo build and asset copy succeeded"
    }
  ],
  "validationOutput": [
    "Adapter test suite passes under new contract.",
    "Workflow race and task workflow suites pass.",
    "Build succeeds with no TypeScript/import errors from deleted task-validators.ts."
  ],
  "residualRisks": [
    "Repository-wide vitest run reports 26 unrelated failures in pi-subagents and upstream-cache tests; these are outside the workflow-adapter scope and were not touched.",
    "Deleted task-validators.ts had no callers; if a future mode intended to use its stricter task acceptance-criteria validator, it will need to be reintroduced and wired explicitly."
  ],
  "noStagedFiles": true,
  "diffSummary": "Rewrote adapter tests to align with the parent-owned artifact contract and deleted the unused broken task-validators.ts file.",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "Only the adapter test file and the dead task-validators.ts file were modified. No workflow artifact formats, adapter implementation, Auto Handoff files, or unrelated code were changed."
}
```

⧉ copy assistant: /cp fd4a17