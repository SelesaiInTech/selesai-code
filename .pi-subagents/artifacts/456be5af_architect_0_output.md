## Findings

- **Info — `src/extensions/workflow/modes/task.ts`**: Task is currently configured as `plan → loop`; it already has `continueAfterArtifact: true`, and the adapter queues the next phase after every successful artifact transition.
- **Info — `src/extensions/workflow/adapter.ts`**: The existing `queueNextPhase` behavior is mode-generic. No engine or selective-continuation change is needed.
- **Info — `src/extensions/workflow/modes/quick.ts` and `validators.ts`**: Reuse/handoff prompt patterns and `handoffValidator` already exist and can be reused.
- **Info — `src/__tests__/task-workflow.test.ts`**: Tests currently assert the obsolete two-phase flow and must cover the two inserted artifacts/transitions.
- **Warning — `docs/workflows.md` and comments in `adapter.ts`**: They describe Task as `plan → loop` and must be corrected alongside the config.

## Implementation plan

### 1. Update Task mode configuration
**Modify:** `src/extensions/workflow/modes/task.ts`  
**Why:** This pure mode configuration owns Task’s phase graph, prompts, artifact gates, validators, and command description.

1. Import `handoffValidator` from `../validators.ts` alongside the existing plan and loop validators.
2. Change `phases` from `["plan", "loop"]` to:
   ```ts
   ["plan", "reuse", "handoff", "loop"]
   ```
3. Add a `reuse` prompt, adapted from the existing Quick workflow:
   - Use `plan.md` as its context; Task has no requirements artifact.
   - Optionally call the `explorer` subagent with `output: false`.
   - Have the parent write exploration findings, or a brief skip rationale, through `write_workflow_artifact` to `reuse.md`.
4. Add a `handoff` prompt:
   - Read `plan.md` and `reuse.md`.
   - Call the `recapper` subagent with `output: false`.
   - Require exactly one `WORKFLOW_HANDOFF_STATUS: ready` line before the parent writes `handoff.md` with `write_workflow_artifact`.
5. Update the loop prompt to read and supply `plan.md`, `reuse.md`, and `handoff.md` to the builder, so implementation has the new accumulated context.
6. Add `reuse: "reuse.md"` and `handoff: "handoff.md"` to `phaseArtifacts`.
7. Add `handoff: handoffValidator` to `artifactValidators`; leave `reuse.md` existence-only so a valid skip note advances it.
8. Keep `skipRules: []`, `loop-complete.md` close validation, and `continueAfterArtifact: true`.
   - This deliberately makes valid writes queue every next phase: `plan → reuse`, `reuse → handoff`, and `handoff → loop`.
   - Do not add phase-specific continuation configuration or a new abstraction.
9. Update mode comments and `commandDescription` to say `plan → reuse → handoff → build↔review loop`.

### 2. Correct shared adapter comments only
**Modify:** `src/extensions/workflow/adapter.ts`  
**Why:** Its behavior already supports all required automatic transitions; only its Task-specific comments become false after the mode change.

1. Change the comments near `queueNextPhase` and `terminate` from “plan → loop” wording to state that Task queues the next configured phase after each successful nonterminal artifact.
2. Do not modify the `queueNextPhase` condition, state machine, persistence code, or tool registration.

### 3. Update Task workflow tests
**Modify:** `src/__tests__/task-workflow.test.ts`  
**Why:** It directly mounts `taskMode` through both the state machine and adapter harness, covering the actual mode configuration and persistence seams.

1. Expand the state-machine lifecycle test:
   - Assert plan starts at step `1/4`.
   - A ready `plan.md` advances to `reuse`.
   - `reuse.md` advances to `handoff`.
   - Missing or invalid `WORKFLOW_HANDOFF_STATUS: ready` blocks handoff.
   - A valid `handoff.md` advances to `loop`.
   - Existing loop-clean and explicit-end assertions remain.
2. Update footer expectations from `1/2` to `1/4`.
3. Extend the child-output suppression test to cover `explorer` and `recapper`, in addition to architect and builder, and confirm all have `output: false`.
4. Replace the plan-to-loop continuation assertion with three assertions:
   - writing valid `plan.md` queues the Reuse prompt;
   - writing `reuse.md` queues the Handoff prompt;
   - writing valid `handoff.md` queues the Loop prompt;
   - each result has `terminate === false` and uses follow-up delivery.
5. Update the persistence-boundary test so:
   - architect output alone does not create `plan.md` or advance;
   - parent-written plan advances only to reuse;
   - parent-written reuse advances only to handoff;
   - parent-written valid handoff advances to loop;
   - the existing builder/reviewer completion and explicit end behavior remains.
6. Update reload/resume expectations: reconciling an already-written valid plan after reload should persist phase `reuse`, not `loop`.
7. Update the blocking-review setup to write valid plan, reuse, and handoff artifacts before simulating the loop.

### 4. Update workflow documentation
**Modify:** `docs/workflows.md`  
**Why:** It is the user-facing lifecycle reference and currently documents the obsolete Task graph.

1. Change the Task description and lifecycle to:
   ```text
   plan → reuse → handoff → loop (build ↔ review) → terminal-ready → end_task_workflow
   ```
2. Explain that Task automatically continues after each parent-owned artifact write:
   - ready plan queues reuse;
   - reuse findings/skip note queue handoff;
   - ready handoff queues the builder/reviewer loop.
3. Remove statements that Task has no reuse or handoff phases.
4. Update the `continueAfterArtifact` config-reference and durable-run explanation to describe Task’s full automatic chain rather than only “plan → build”.

## Verification

Run:

```bash
npx vitest run src/__tests__/task-workflow.test.ts
npx vitest run src/__tests__/state-machine.test.ts src/__tests__/adapter.test.ts src/__tests__/workflow-race.test.ts src/__tests__/workflow-run-state.test.ts src/__tests__/task-workflow.test.ts
npm run build
```

Success cases:

- A valid plan queues reuse, `reuse.md` queues handoff, and a handoff with `WORKFLOW_HANDOFF_STATUS: ready` queues loop.
- The builder receives plan, reuse, and handoff context.
- The loop still permits at most three blocking review rounds, becomes terminal-ready only on a clean loop completion, and requires `end_task_workflow`.
- Reload/resume retains durable state and reconciles a written plan into `reuse`.

Failure/regression cases:

- Missing plan marker still blocks plan advancement.
- Missing handoff marker blocks transition into loop.
- Child subagents cannot write workflow artifacts directly.
- Reuse may advance from a parent-written skip note.
- Prototype and Quick modes, the shared state machine, and continuation implementation remain unchanged.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Inspected src/extensions/workflow/modes/task.ts, src/extensions/workflow/adapter.ts, src/extensions/workflow/modes/quick.ts, src/extensions/workflow/validators.ts, docs/workflows.md, and src/__tests__/task-workflow.test.ts. Findings identify the mode-owned graph, reusable prompt/validator patterns, existing generic continuation seam, and stale documentation/comments."
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
  "commandsRun": [],
  "validationOutput": [
    "No files were edited or test commands run because this task produced an implementation plan only.",
    "The plan specifies the narrow mode test, related workflow regression suite, and build command."
  ],
  "residualRisks": [
    "Existing active Task runs already at loop remain resumable because loop remains a valid phase; runs reconciling a persisted plan will now require the newly introduced reuse and handoff artifacts before loop.",
    "Automatic continuation is intentionally global per mode; continueAfterArtifact: true queues every successful Task artifact transition."
  ],
  "noStagedFiles": true,
  "diffSummary": "Planned minimal change: extend only Task mode configuration, its direct tests and documentation, plus stale adapter comments; no shared-engine behavior changes.",
  "reviewFindings": [
    "warning: docs/workflows.md:127-132 and :148 describe the obsolete plan-to-loop Task lifecycle.",
    "warning: src/extensions/workflow/adapter.ts:484-485 and :508-509 contain obsolete Task plan-to-loop comments.",
    "no blockers: src/extensions/workflow/adapter.ts already queues the next phase for every advanced artifact when continueAfterArtifact is true."
  ],
  "manualNotes": "Reuse existing Quick-mode prompt structure and the existing handoffValidator; do not add a selective continuation option."
}
```

WORKFLOW_PLAN_STATUS: ready

⧉ copy assistant: /cp 2e1fe3