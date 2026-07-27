## Discovery findings

- **High — `src/extensions/workflow/modes/task.ts`:** Task currently defines only `["plan", "loop"]`; it has no `reuse.md`/`handoff.md` artifacts, prompts, or handoff semantic validator.
- **Medium — `docs/workflows.md`:** Task is documented as plan→loop and explicitly claims it has no reuse or handoff phases.
- **No engine gap:** `src/extensions/workflow/state-machine.ts`, `adapter.ts`, and `validators.ts` already support ordered artifacts, parent-owned writes, semantic handoff validation, durable resume, and automatic continuation. `extension.ts` already registers `taskMode`.

## Decision

Keep `continueAfterArtifact: true`: writing `plan.md` queues reuse, writing `reuse.md` queues handoff, and writing a valid `handoff.md` queues the build/review loop. Do not change the shared engine.

## Implementation plan

### 1. Expand Task mode configuration and prompts
**File:** `src/extensions/workflow/modes/task.ts`  
**Ownership:** This pure mode configuration owns Task’s phase order, artifacts, prompts, validators, and command description.

1. Import the existing `handoffValidator` alongside `planValidator` and `loopCompleteValidator`.
2. Change phases to:
   ```ts
   ["plan", "reuse", "handoff", "loop"]
   ```
3. Add `reuse: "reuse.md"` and `handoff: "handoff.md"` to `phaseArtifacts`.
4. Add a Task-specific `reuse` prompt modeled on Quick’s existing reuse phase, but reference only `plan.md`:
   - ask an `explorer` subagent for inline findings when exploration is useful;
   - otherwise write a brief skip note;
   - require the parent to persist all outcomes via `write_workflow_artifact`;
   - do not add a requirements artifact or child output paths.
5. Add a Task-specific `handoff` prompt modeled on Quick’s handoff phase:
   - direct a `recapper` to synthesize `plan.md` and `reuse.md`;
   - require `WORKFLOW_HANDOFF_STATUS: ready`;
   - require the parent to write `handoff.md` through `write_workflow_artifact`.
6. Update the loop prompt to read and provide `plan.md`, `reuse.md`, and `handoff.md` to the builder/reviewer loop.
7. Add `handoff: handoffValidator` to `artifactValidators`.
8. Retain `skipRules: []`, making Task’s reuse artifact phase mandatory even if its content is a skip note; retain `continueAfterArtifact: true`.
9. Update Task comments and `commandDescription` to describe `plan → reuse → handoff → build↔review`.

Do not modify tool names, close artifacts, loop-round behavior, or add new validators/utilities.

### 2. Update Task workflow integration tests
**File:** `src/__tests__/task-workflow.test.ts`  
**Ownership:** This is the existing real Task-mode harness covering persistence, continuation, stale handlers, and loop behavior.

1. Update the state-machine test to verify:
   - valid `plan.md` advances to `reuse` at step 2;
   - `reuse.md` advances to `handoff` at step 3;
   - missing or marker-invalid `handoff.md` blocks;
   - a valid handoff marker advances to `loop` at step 4;
   - only a clean `loop-complete.md` makes the run terminal-ready; explicit end closes it.
2. Update status/phase assertions from `1/2` to `1/4`.
3. Replace plan→loop continuation assertions with a full automatic sequence:
   - plan write queues reuse;
   - reuse write queues handoff;
   - valid handoff write queues loop;
   - each queued transition is a follow-up and does not terminate the turn.
4. Update parent-persistence coverage so architect, explorer, and recapper inline results do not create artifacts themselves; only parent `write_workflow_artifact` advances each phase.
5. Update reload/resume coverage: a persisted plan reconciles into `reuse`, not directly into `loop`; retain stale-handler and durable-state assertions.
6. Before existing builder/reviewer-loop assertions run, write valid reuse and handoff artifacts. Likewise update the blocking-review test setup to reach loop through all three preparatory artifacts.

Do not duplicate shared state-machine or adapter tests; the Task harness is sufficient because shared behavior is already covered elsewhere.

### 3. Correct workflow documentation
**File:** `docs/workflows.md`  
**Ownership:** This document is the user-facing lifecycle reference for built-in modes and continuation behavior.

1. Change Task’s built-in mode description and lifecycle to:
   ```text
   plan → reuse → handoff → loop (build ↔ review) → terminal-ready → end_task_workflow
   ```
2. Replace the statement that Task skips reuse/handoff with the accurate scope: it still omits grilling, research, and audit.
3. Document that Task automatically queues reuse after a ready plan, handoff after reuse, and the builder/reviewer loop after a valid handoff.
4. Update general adapter/durable-run wording that currently says Task moves directly from plan to build.

Do not alter the extension registration documentation or introduce a new mode.

## Verification

Run:

```bash
npx vitest run src/__tests__/state-machine.test.ts src/__tests__/adapter.test.ts src/__tests__/workflow-race.test.ts src/__tests__/workflow-run-state.test.ts src/__tests__/task-workflow.test.ts
npm run build
```

### Success cases
- New Task run persists `plan → reuse → handoff → loop` in `workflow.json`.
- Parent-written valid plan, reuse, and handoff artifacts advance in that order.
- Each preparatory artifact queues the next Task prompt automatically.
- A valid handoff requires `WORKFLOW_HANDOFF_STATUS: ready`.
- The existing clean/blocking builder-review loop, max-three-round pause, explicit resume, and explicit end behavior remain intact.

### Failure cases
- Plan without `WORKFLOW_PLAN_STATUS: ready` does not advance.
- Handoff without `WORKFLOW_HANDOFF_STATUS: ready` does not advance.
- `end_task_workflow` remains blocked until clean loop completion exists.
- Child inline output without the parent artifact-writer call does not advance workflow state.

### Regression checks
- `extension.ts` registration and Task tool/command identities remain unchanged.
- Prototype and Quick workflows retain their existing graphs.
- No shared engine, adapter, persistence schema, dependency, or migration changes are needed.
- Existing active Task runs at `plan` or `loop` remain structurally resumable; a saved ready plan now correctly continues into reuse.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete findings identify src/extensions/workflow/modes/task.ts as high-severity missing-flow ownership and docs/workflows.md as stale documentation; the plan names exact implementation and test files."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "Repository inspection confirms handoffValidator and the generic phase/artifact engine already exist; only Task mode configuration, its existing harness, and documentation require changes."
  ],
  "residualRisks": [
    "An active persisted Task run with a ready plan will follow the new reuse/handoff path after upgrade rather than entering loop directly; this is the intended semantic change."
  ],
  "noStagedFiles": true,
  "diffSummary": "No files changed; this is an implementation plan only.",
  "reviewFindings": [
    "high: src/extensions/workflow/modes/task.ts - Task lacks reuse and handoff phases, artifacts, prompts, and handoff validation.",
    "medium: docs/workflows.md - Task lifecycle and continuation documentation incorrectly state plan→loop and no reuse/handoff."
  ],
  "manualNotes": "Preserve continueAfterArtifact: true without shared-engine changes, per clarified decision."
}
```

WORKFLOW_PLAN_STATUS: ready

⧉ copy assistant: /cp e28bea