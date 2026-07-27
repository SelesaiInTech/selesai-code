Now I have a complete picture. Here is the code context map.

---

# Code Context

## Relevant Files

| File | Lines | Why It Matters |
|------|-------|----------------|
| `src/extensions/workflow/state-machine.ts` | 1–480 | Pure state machine: phases, transitions, effects, semantic gates, reentrancy guard, skip rules, terminal gating |
| `src/extensions/workflow/adapter.ts` | 1–850+ | Pi adapter: tool/event registration, fs predicates, effect→pi dispatch, resume reconciliation, loop orchestration, `continueAfterArtifact` |
| `src/extensions/workflow/validators.ts` | 1–50 | Marker-based semantic validators (`planValidator`, `handoffValidator`, `loopCompleteValidator`, `reviewValidator`) |
| `src/extensions/workflow/run-state.ts` | 1–150 | Durable persistence: `saveWorkflowRun`, `loadWorkflowRun`, `listResumableWorkflowRuns`, `resolveWorkflowRun`, atomic write with temp+rename |
| `src/extensions/workflow/extension.ts` | 1–20 | Entry point: registers prototype, quick, task modes via `createWorkflowExtension` |
| `src/extensions/workflow/modes/task.ts` | 1–100 | Task mode config: plan→reuse→handoff→loop, `continueAfterArtifact: true`, `closeArtifacts: ["loop-complete.md"]` |
| `src/extensions/workflow/modes/prototype.ts` | 1–180 | Prototype mode config: 7 phases, `closeArtifacts: ["review.md"]`, `closeValidators: { "review.md": reviewValidator }` |
| `src/extensions/workflow/modes/quick.ts` | 1–130 | Quick mode config: 6 phases, same close/validator shape as prototype |
| `src/__tests__/state-machine.test.ts` | 1–350 | Pure SM tests: start, next, onArtifactMaybe, skip rules, terminal/end, rehydrate, config validation, semantic gates |
| `src/__tests__/adapter.test.ts` | 1–550 | Prototype adapter smoke tests: tool registration, artifact-driven transitions, resume, loop orchestration, semantic gate surface, tool_call blocking |
| `src/__tests__/task-workflow.test.ts` | 1–280 | Task mode integration: 4-phase flow, resume reconciliation, auto-queued prompts, 3-blocking-review pause, rollback on persist failure |
| `src/__tests__/workflow-race.test.ts` | 1–200 | Quick mode hook-driven transitions: no next tool, artifact→phase advance, terminal→end, write/edit blocking |
| `src/__tests__/workflow-run-state.test.ts` | 1–80 | Persistence round-trip: atomic save, list active runs, malformed/old state rejection |

## Current Behavior

### Transition
- **`start(goal, deps)`** → `"started"` effect with first phase, creates artifact dir, sets active
- **`next(deps)`** → manual advance via `advancePhase()`: checks artifact existence + semantic gate, returns `"blocked"`, `"advanced"`, `"terminalNeedsArtifacts"`, or `"terminalReady"`
- **`onArtifactMaybe(deps)`** → auto-advance hook: reentrancy-guarded (`advancing` flag), checks `autoArmed`, reads artifact, validates content, calls `advancePhase(currentPhaseSatisfied=true)`. Re-arms `autoArmed` on `terminalNeedsArtifacts` so corrected writes can advance.
- **`advancePhase(deps, currentPhaseSatisfied)`** → core transition: checks current phase artifact, finds next phase, evaluates skip rules, sets phase, returns effect

### Continuation
- **`continueCurrent()`** → re-emits current phase prompt without advancing (for `/command` resume)
- **`continueAfterArtifact`** → task mode only (`true`). In `write_workflow_artifact` handler: when `eff.kind === "advanced"`, queues next phase prompt via `continueAgent` and sets `terminate: false` so the parent turn continues
- **`resumeController()`** → loads persisted run, rehydrates SM, then **reconciles** in a while loop calling `onArtifactMaybe` repeatedly until `noOp`/`blocked`/`terminalNeedsArtifacts`/`terminalReady`. Catches up through multiple already-written artifacts. Atomic rollback on failure.

### Termination
- **`end(deps)`** → checks `closeArtifacts` existence + `closeValidators` content gates. Returns `"closed"` (sets active=false), `"endBlocked"` (missing/invalid), or `"idle"`
- **`terminalNeedsArtifacts`** → terminal phase reached but close artifacts missing or semantically invalid. Carries `promptToQueue` + optional `reason`
- **`terminalReady`** → all close artifacts satisfied, waiting for explicit `end_workflow` tool call
- **`closeCurrent()`** → detaches in-memory (marks done, sets active=false), leaves on-disk record as resumable

### Mixed Batches (multi-phase catch-up)
- **`resumeController()`** while loop (adapter.ts:237–252): keeps calling `onArtifactMaybe` while `active && autoArmed`. Each iteration persists after advance. Breaks on `noOp`/`blocked`/`terminalNeedsArtifacts`/`terminalReady`. This handles the case where multiple artifacts were written between sessions (e.g., plan.md + reuse.md + handoff.md all exist when resuming from plan).

### Key Constraints
- **One active workflow per pi instance** (enforced by `activeControllersFor`)
- **write/edit blocked** while workflow active (tool_call handler returns `{block: true}`)
- **Subagent output forced to `false`** during active workflow (tool_call handler mutates input)
- **Parent-owned phases** (grilling→handoff, audit): only `write_workflow_artifact` advances; raw tool_result does not
- **Engine-owned loop**: only `tool_result` with `agent: "commentator"` + clean status writes `loop-complete.md` and advances
- **Reentrancy guard**: `advancing` flag prevents double-advance from concurrent `onArtifactMaybe` calls
- **Duplicate toolCallId**: `seenToolCallIds` Set prevents processing the same subagent result twice

## Reuse / Risks

### Patterns to Reuse
- **Pure SM + adapter separation**: SM returns domain `WorkflowEffect`; adapter pattern-matches and applies pi side effects. Test SM without fs/pi.
- **`makeDeps()` test helper**: in-memory `Set<string>` for files + `Map<string,string>` for content. Used across all test files.
- **`checkpoint`/`restoreCheckpoint`/`persistAfter`**: atomic rollback pattern for all state mutations.
- **Semantic gate validators**: `markerValidator()` factory produces regex-based content checkers. Config-level `artifactValidators` + `closeValidators` maps.
- **`continueAfterArtifact`**: config flag controls whether `write_workflow_artifact` queues next phase prompt or stops the parent turn.

### Concrete Risks
1. **`terminalNeedsArtifacts` prompt lost during resume** (adapter.ts:234–252): the while loop breaks on `terminalNeedsArtifacts` but never applies its `promptToQueue`. The fallthrough to `continueCurrent()` re-emits the phase prompt, which is adequate for prototype/quick (audit prompt tells user to write review.md) and task (loop prompt tells user to do builder/commentator rounds), but the specific "fix this file" guidance is dropped.
2. **`continueAfterArtifact` only for `advanced`**: when `onArtifactMaybe` returns `terminalReady`, the `write_workflow_artifact` handler does NOT queue the "call end_workflow" prompt via `queueNextPhase` (since `eff.kind !== "advanced"`). But `applyControllerEffect` with default `queuePrompt: true` still sends it via `applyEffect`'s `terminalReady` branch. So this works, but the logic is non-obvious.
3. **Skip rule evaluation only on `nextPhase`**: skip rules fire when advancing TO the next phase, not when currently AT the skip-eligible phase. If a workflow is resumed at a phase that has a skip rule, the skip rule won't fire until the current phase artifact is satisfied and the SM tries to advance. This is correct behavior but subtle.
4. **No test for `continueAfterArtifact: false` (prototype/quick) with `terminalReady` from `write_workflow_artifact`**: the existing tests cover `terminalReady` from `next()` and from resume, but not from the `write_workflow_artifact` handler directly.

## Start Here
- **`src/extensions/workflow/state-machine.ts`** — the pure transition engine. All phase graph, gating, and effect logic lives here. Tests in `state-machine.test.ts` exercise every transition without fs/pi.
- For adapter wiring: **`src/extensions/workflow/adapter.ts`** lines 470–540 (`write_workflow_artifact` handler) and lines 220–270 (`resumeController` reconcile loop).

---

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Read-only reconnaissance completed. No files edited, no scope widened. All workflow extension files and test files inspected."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Returned complete code context map with file/line references, current behavior trace for transition/continuation/termination/mixed-batches, reuse patterns, and concrete risks. No staged changes."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "Read 15 files: state-machine.ts (480 lines), adapter.ts (850+ lines), validators.ts (50 lines), run-state.ts (150 lines), extension.ts (20 lines), modes/task.ts (100 lines), modes/prototype.ts (180 lines), modes/quick.ts (130 lines), state-machine.test.ts (350 lines), adapter.test.ts (550 lines), task-workflow.test.ts (280 lines), workflow-race.test.ts (200 lines), workflow-run-state.test.ts (80 lines), package.json (15 lines)"
  ],
  "residualRisks": [
    "terminalNeedsArtifacts promptToQueue dropped during resumeController reconcile loop (adapter.ts:234-252); fallthrough to continueCurrent() covers it but specific guidance lost",
    "continueAfterArtifact logic is non-obvious: queueNextPhase only true for 'advanced' effects, but terminalReady prompt still sent via applyControllerEffect default queuePrompt:true",
    "No test for continueAfterArtifact:false (prototype/quick) write_workflow_artifact producing terminalReady directly",
    "Skip rules only evaluated when advancing TO the next phase, not when currently AT the skip-eligible phase on resume"
  ],
  "noStagedFiles": true,
  "diffSummary": "No changes — read-only reconnaissance",
  "reviewFindings": [
    "no blockers: architecture is sound, pure SM/adapter separation is clean, test coverage is thorough for all transition paths"
  ],
  "manualNotes": "Code context map covers all workflow extension files and all 5 test files. Key entry point for next agent: state-machine.ts (pure transitions) and adapter.ts:470-540 (write_workflow_artifact handler) + adapter.ts:220-270 (resume reconcile loop)."
}
```

⧉ copy assistant: /cp e62404