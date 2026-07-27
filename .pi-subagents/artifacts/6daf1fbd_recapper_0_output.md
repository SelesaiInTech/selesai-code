# Handoff: `/task` Rapid Workflow Implementation

**Status:** plan approved, implementation not yet started.

## What this is

A new `/task` workflow mode — the simplest workflow: two phases `plan → loop`. An architect subagent produces a validated `plan.md` (with `WORKFLOW_PLAN_STATUS: ready` marker), then a builder↔commentator review loop runs (max 3 blocking rounds). A clean review makes the workflow terminal-ready; only `end_task_workflow` completes it.

The entire change is **one new mode config file + one-line registration + tests + docs**. Zero engine edits — the existing state machine, adapter, validators, and run-state modules already support every behavior this mode requires.

## Approved plan (full)

The complete plan is at:
`.selesai/artifacts/95d3e10c-bfb0-4322-a49f-a3220c233104/plan.md`

It contains the full implementation details including prompts, config, test cases (27 enumerated), verification matrix, and risk analysis. Requirements are at `requirements.md` in the same directory.

## Implementation tasks

### Task 1: Create `src/extensions/workflow/modes/task.ts`

Copy the pattern from `src/extensions/workflow/modes/quick.ts`. Pure data — no engine logic.

- **Phases:** `["plan", "loop"]`
- **phaseArtifacts:** `plan → "plan.md"`, `loop → "loop-complete.md"` (engine-written)
- **artifactValidators:** `plan: planValidator`, `loop: loopCompleteValidator`
- **closeValidators:** `"loop-complete.md": loopCompleteValidator`
- **closeArtifacts:** `["loop-complete.md"]`
- **loopMaxIterations:** `3`
- **Identity:** `mode: "task"`, `statusKey: "task"`, `entryType: "task-phase"`, `footerLabel: "task"`
- **Tools:** `start_task_workflow`, `resume_task_workflow`, `end_task_workflow`
- **Command:** `/task`
- **Imports:** `planValidator` + `loopCompleteValidator` from `../validators.ts`
- **Prompts:** `plan` prompt references only `userPrompt` (no requirements.md/research.md). `loop` prompt references only `plan.md` (no handoff/reuse/research). Loop prompt names `end_task_workflow` and says "terminal-ready" (not "advance to audit"). Full prompt templates are in `plan.md` §Task 1.

### Task 2: Register in `src/extensions/workflow/extension.ts`

Add `import { taskMode } from "./modes/task.ts";` and add `taskMode` to the `MODES` array (currently `[prototypeMode, quickMode]`).

### Task 3: Create `src/__tests__/task-workflow.test.ts`

Follow patterns from:
- `src/__tests__/state-machine.test.ts` — in-memory stubs for pure SM tests (files Set + contents Map)
- `src/__tests__/adapter.test.ts` — `FakePi` + tmpdir for adapter wiring tests (harness, loop orchestration, subagent fallback, terminal close)
- `src/__tests__/workflow-race.test.ts` — hook-driven transitions with real fs

27 test cases enumerated in `plan.md` §Task 3, covering:
- SM: start at plan, plan blocked (missing + no marker), plan→loop advance, loop blocked, terminalReady, terminalNeedsArtifacts, end() blocked, end() closes, rehydrate, config validation
- Adapter: tool/command registration, start at plan, marker advance, force-output for plan, subagent fallback for plan, full loop (clean/blocking/maxed/resume), end_task_workflow close, resume reconciliation, /task help, resume path rejection

### Task 4: Update `docs/workflows.md`

Two changes:
1. Add `task.ts` to the file tree in "How it fits together"
2. Add a "Built-in modes" section documenting `/task` lifecycle

## Key source locations

| File | Role |
|---|---|
| `src/extensions/workflow/state-machine.ts` | Pure phase SM — phase graph, artifact gating, validators, terminal close, reentrancy. **No edits needed.** |
| `src/extensions/workflow/adapter.ts` | Pi wiring — tools, commands, events, fs, durable-state, loop orchestration, force-output, fallback. **No edits needed.** Loop orchestration is generic (checks `phase === "loop"`, not mode-specific). |
| `src/extensions/workflow/validators.ts` | `planValidator`, `loopCompleteValidator`, `reviewValidator`, `handoffValidator` + `MARKERS`. **No edits needed.** Existing validators reused as-is. |
| `src/extensions/workflow/run-state.ts` | Versioned atomic `workflow.json`. **No edits needed.** `modesFor(config)` handles any mode. |
| `src/extensions/workflow/extension.ts` | Single entry; `MODES` array. **Edit: add `taskMode` import + array entry.** |
| `src/extensions/workflow/modes/quick.ts` | Template for task.ts (6 phases → reduce to 2). |
| `src/extensions/workflow/modes/prototype.ts` | Reference (7 phases). |
| `src/__tests__/state-machine.test.ts` | Pattern for pure SM tests. |
| `src/__tests__/adapter.test.ts` | Pattern for adapter wiring tests (FakePi + tmpdir). |
| `src/__tests__/workflow-race.test.ts` | Pattern for hook-driven transitions. |
| `docs/workflows.md` | User-facing docs; "To add a future mode" section. |

## Why zero engine edits suffice

Verified by reading the source:
- `FORCE_OUTPUT_PHASES` = `["plan", "reuse", "handoff", "audit"]` — `plan` is included, so architect subagent output is forced to `plan.md`.
- `SUBAGENT_FALLBACK_PHASES` = same set — `plan` included, so architect text fallback saves to `plan.md`.
- Loop orchestration in `adapter.ts` `tool_result` handler checks `phase === "loop"` (generic), parses `WORKFLOW_REVIEW_STATUS`, persists `loop-review-<n>.md`, tracks `LoopState`, writes `loop-complete.md` on clean, caps at `loopMaxIterations`.
- `loop-complete.md` as both phase artifact AND close artifact works: `artifactSatisfiedFor` checks existence+validator, then `advancePhase(deps, true)` skips recheck and goes to `closeArtifacts` check → `terminalReady`.
- Default `skipRules` (skip `reuse` on empty git) is a no-op for `/task` since it has no `reuse` phase.
- Terminal-ready → `end_task_workflow` calls `sm.end(deps)` → checks terminal phase + closeArtifacts → `{ kind: "closed" }`.

## Known residual issues (cosmetic, not in scope)

1. **`start` tool description hardcodes "grilling":** The description text in `adapter.ts` says "Sets up grilling as the first phase." For `/task` the first phase is `plan`. Cosmetic only — the actual prompt comes from `config.prompts[phases[0]]`. Fixing would modify the shared adapter (scope creep).
2. **Adapter comment says "advances to audit":** In the `tool_result` handler, a code comment references audit. For `/task` it advances to `terminalReady`. Non-functional; comment is generic enough.

## Execution order

1. Create `src/extensions/workflow/modes/task.ts`
2. Register in `src/extensions/workflow/extension.ts`
3. Create `src/__tests__/task-workflow.test.ts`
4. Run tests: `npx vitest run src/__tests__/task-workflow.test.ts`
5. Run full workflow suite: `npx vitest run src/__tests__/state-machine.test.ts src/__tests__/adapter.test.ts src/__tests__/workflow-race.test.ts src/__tests__/workflow-run-state.test.ts`
6. Update `docs/workflows.md`
7. Full regression: `npx vitest run src/__tests__/`

WORKFLOW_HANDOFF_STATUS: ready