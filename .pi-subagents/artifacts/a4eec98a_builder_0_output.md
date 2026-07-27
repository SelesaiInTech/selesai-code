 Implemented the approved Task workflow refactor.

Changed files:
- src/extensions/workflow/modes/task.ts — new phases plan→reuse→handoff→loop with handoffValidator, reuse/handoff prompts, phaseArtifacts, continueAfterArtifact preserved.
- src/extensions/workflow/adapter.ts — comment update plus a chained resume-reconcile loop so resuming after a reload catches up through multiple already-written parent-owned artifacts.
- src/__tests__/task-workflow.test.ts — updated/added tests for 4 phases, transitions, handoff validation, explorer/recapper output suppression, automatic continuation, persistence/reload, and loop setup.
- docs/workflows.md — updated Task lifecycle and continueAfterArtifact description.

Validation:
- npx vitest run src/__tests__/task-workflow.test.ts src/__tests__/workflow-race.test.ts src/__tests__/workflow-run-state.test.ts src/__tests__/state-machine.test.ts → 4 passed, 59 passed.
- npm run build → succeeded.

Residual note: `src/extensions/grep-app/` is untracked and untouched by this refactor. No staged files were created.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Task workflow now uses phases ['plan','reuse','handoff','loop'] with handoffValidator, explorer/recapper output:false reuse/handoff prompts, loop prompt reading plan/reuse/handoff, and continueAfterArtifact:true preserved. Adapter resume now reconciles through multiple written artifacts. Tests cover 4-phase transitions, handoff validation, automatic continuation, reload, and loop setup. Build passes."
    }
  ],
  "changedFiles": [
    "src/extensions/workflow/modes/task.ts",
    "src/extensions/workflow/adapter.ts",
    "src/__tests__/task-workflow.test.ts",
    "docs/workflows.md"
  ],
  "testsAddedOrUpdated": [
    "src/__tests__/task-workflow.test.ts"
  ],
  "commandsRun": [
    {
      "command": "npx vitest run src/__tests__/task-workflow.test.ts src/__tests__/workflow-race.test.ts src/__tests__/workflow-run-state.test.ts src/__tests__/state-machine.test.ts",
      "result": "passed",
      "summary": "4 test files, 59 tests passed"
    },
    {
      "command": "npm run build",
      "result": "passed",
      "summary": "tsgo build and copy-assets succeeded"
    }
  ],
  "validationOutput": [
    "Vitest: 4 passed, 59 passed",
    "npm run build: succeeded"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "Task workflow expanded from plan→loop to plan→reuse→handoff→loop, reusing Quick-mode reuse/handoff prompts/validators; adapter resume now chains onArtifactMaybe to catch up durable artifacts after reload; docs and tests updated to 4-phase lifecycle.",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "src/extensions/grep-app/ is untracked and not part of this change. The resume-reconcile loop in adapter.ts was added to satisfy the reload test where plan, reuse, and handoff artifacts all exist but the saved state is still at plan."
}
```

⧉ copy assistant: /cp 0c30e0