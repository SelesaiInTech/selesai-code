Implemented `/task` plan → build/review workflow with durable loop behavior.

Changed files: `task.ts`, workflow registration, focused tests, docs.  
Validation: task tests (4), workflow regression suite (97), TypeScript check passed.  
Open risks/questions: shared start-tool description still says “grilling”; unrelated existing whitespace warnings remain.  
Recommended next step: review and commit only the four `/task` files.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Added only the task mode, registration, focused tests, and workflow docs; reused the existing state machine, adapter, validators, and durable run engine unchanged."
    }
  ],
  "changedFiles": [
    "src/extensions/workflow/modes/task.ts",
    "src/extensions/workflow/extension.ts",
    "src/__tests__/task-workflow.test.ts",
    "docs/workflows.md"
  ],
  "testsAddedOrUpdated": [
    "src/__tests__/task-workflow.test.ts"
  ],
  "commandsRun": [
    {
      "command": "npx vitest run src/__tests__/task-workflow.test.ts",
      "result": "passed",
      "summary": "4 task workflow tests passed."
    },
    {
      "command": "npx vitest run src/__tests__/state-machine.test.ts src/__tests__/adapter.test.ts src/__tests__/workflow-race.test.ts src/__tests__/workflow-run-state.test.ts",
      "result": "passed",
      "summary": "97 workflow regression tests passed."
    },
    {
      "command": "npx tsc --noEmit --pretty false -p tsconfig.build.json",
      "result": "passed",
      "summary": "TypeScript reported no errors."
    },
    {
      "command": "git diff --check (task files) && git diff --cached --quiet",
      "result": "passed",
      "summary": "Task files are whitespace-clean; no staged files."
    }
  ],
  "validationOutput": [
    "Task mode validates plan and loop markers, reaches terminal-ready after clean review, and closes only through end_task_workflow.",
    "Blocking reviews persist loop state and pause after three rounds."
  ],
  "residualRisks": [
    "Existing unrelated trailing whitespace remains in src/extensions/workflow/adapter.ts and state-machine.ts.",
    "Shared start-tool description still refers to grilling; cosmetic and outside task-mode scope."
  ],
  "noStagedFiles": true,
  "diffSummary": "Registered a two-phase task mode with explicit empty skip rules, durable plan/build-review loop configuration, focused tests, and user documentation.",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "Pre-existing working-tree changes were left untouched."
}
```

⧉ copy assistant: /cp e549a6