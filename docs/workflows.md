# Workflows

Selesai ships a workflow engine under `src/extensions/workflow/`. It powers the built-in `prototype`, `quick`, and `task` workflows and is designed so you can add a new workflow mode as a thin config file — no engine changes.

## How it fits together

```
src/extensions/workflow/
  package.json          pi package manifest; loads ./extension.ts as the single entry
  state-machine.ts      pure phase state machine (no fs, no pi API)
  adapter.ts            pi wiring: tools, commands, events, fs, durable-state lifecycle
  run-state.ts          versioned atomic workflow.json load/save/discovery
  extension.ts          single pi extension that mounts every workflow mode
  modes/
    prototype.ts        mode config + registration object (exported as `prototypeMode`)
    quick.ts            mode config + registration object (exported as `quickMode`)
    task.ts             mode config + registration object (exported as `taskMode`)
```

- **`state-machine.ts`** is the deep module. It owns the phase graph, artifact gating, skip rules, the terminal close gate, and the reentrancy guard. It imports nothing external — no `node:fs`, no pi API, no `pi-tui`, no `typebox`. Every method returns a `WorkflowEffect` (a discriminated union in domain vocabulary) that the adapter pattern-matches on.
- **`adapter.ts`** is the thin glue. It owns Pi/fs wiring, durable state, explicit resume, loop review persistence, and the git-based `reuse` skip predicate. Parent-written artifacts advance durable phase state and queue hidden engine continuations; every built-in mode flows automatically.
- **`workflow.json`** in each artifact directory is the canonical, versioned run record. It is atomically replaced after state changes; session custom entries are only pointers for UI/history and never reconstruct an active run.
- **`extension.ts`** imports each mode's registration object and calls `createWorkflowExtension(config, options)(pi)` for each. One extension load registers the model-facing artifact writer and `end_workflow` tool. Starting and resuming are user-only actions exposed by each mode's slash command.
- **A mode file** is pure data: the phase list, per-phase artifact filenames, prompt generators, terminal close artifacts, and command/status/entry identities. Prompts receive `{ artifactDir, userPrompt }`. Each mode exports a `WorkflowModeRegistration` object (e.g. `prototypeMode`, `quickMode`); it does not call `createWorkflowExtension` itself.

## To add a future mode

Copy `modes/quick.ts` (the smaller one) and change the config. That's the whole change — the engine never needs editing.

### 1. Create the mode file

`src/extensions/workflow/modes/rigorous.ts`:

```typescript
import type {
  Phase,
  PromptContext,
  WorkflowConfig,
  WorkflowModeRegistration,
} from "../state-machine.ts";

const phases: Phase[] = [
  "grilling",
  "spec",      // ← new phase, not in the built-in set
  "research",
  "plan",
  "reuse",
  "handoff",
  "loop",
  "audit",
  "sign-off",  // ← new terminal phase
];

const prompts: Partial<Record<Phase, (ctx: PromptContext) => string>> = {
  grilling: ({ artifactDir, userPrompt }) => `…grilling prompt…`,
  spec: ({ artifactDir }) => `…spec prompt…`,
  research: ({ artifactDir }) => `…research prompt…`,
  plan: ({ artifactDir }) => `…plan prompt…`,
  reuse: ({ artifactDir }) => `…reuse prompt…`,
  handoff: ({ artifactDir }) => `…handoff prompt…`,
  loop: ({ artifactDir }) => `…loop prompt…`,
  audit: ({ artifactDir }) => `…audit prompt…`,
  "sign-off": ({ artifactDir }) => `…sign-off prompt…`,
};

const config: WorkflowConfig = {
  mode: "rigorous",
  phases,
  phaseArtifacts: {
    grilling: "requirements.md",
    spec: "spec.md",
    research: "research.md",
    plan: "plan.md",
    reuse: "reuse.md",
    handoff: "handoff.md",
    loop: "loop-complete.md",
    audit: "review.md",
    "sign-off": "acceptance.md",
  },
  prompts,
  // Files that must exist before end() can close the workflow.
  // Config-owned — declare whatever your terminal phase requires.
  closeArtifacts: ["acceptance.md", "sign-off-report.md"],
  statusKey: "rigorous",
  entryType: "rigorous-phase",
  footerLabel: "rigorous",
};

export const rigorousMode: WorkflowModeRegistration = {
  config,
  commandName: "rigorous",
  commandDescription:
    "Run the rigorous workflow (grill → spec → research → plan → reuse → handoff → loop → audit → sign-off)",
};

export default rigorousMode;
```

### 2. Register it in `extension.ts`

Add the mode to the `MODES` array in `src/extensions/workflow/extension.ts`:

```typescript
import { rigorousMode } from "./modes/rigorous.ts";

const MODES = [prototypeMode, quickMode, rigorousMode] as const;
```

That's it. The loader picks it up at boot (`package.json` loads only `./extension.ts`), and the `/rigorous` command is registered automatically. There is no model-facing start/resume or `next` tool — users start and resume through `/rigorous`, phases auto-advance as artifacts land, and only `end_workflow({ mode: "rigorous" })` completes the terminal phase.

## Built-in modes

### `task` — plan → codebase exploration → handoff → build/review loop

Task now follows the same phase shape as the other modes, minus grilling/research/audit: an architect subagent produces a validated `plan.md`, an optional explorer subagent produces `reuse.md`, a recapper subagent produces a validated `handoff.md`, and then a builder↔commentator review loop runs (max 3 blocking rounds). A clean review makes the workflow terminal-ready; `end_workflow({ mode: "task" })` completes it.

Lifecycle: `plan → reuse → handoff → loop (build ↔ review) → terminal-ready → end_workflow({ mode: "task" })`

- `/workflow-task <goal>` — start a new run
- `/workflow-task resume` — list and resume active runs
- `/workflow-task help` — show the lifecycle
- Valid phase artifacts automatically queue the next phase prompt (the workflow does not pause at artifact boundaries)
- No grilling, research, or audit phases
- `reuse.md` is optional; it is skipped automatically when the project has no git history

## Config reference

| Field | Type | Description |
|---|---|---|
| `mode` | `string` | Mode name, echoed in entry payloads and messages. |
| `phases` | `Phase[]` | Ordered phase list. `Phase` is `string` — new phase names are allowed. |
| `phaseArtifacts` | `Partial<Record<Phase, string>>` | The artifact file each phase must produce before advancing. Omit a phase to skip its gate. |
| `prompts` | `Partial<Record<Phase, (ctx) => string>>` | Prompt generator per phase. `ctx = { artifactDir, userPrompt }`. |
| `closeArtifacts` | `string[]` | Files that must exist before `end()` succeeds. Config-owned, no built-in default. |
| `skipRules?` | `{ phase, shouldSkip }[]` | Optional per-phase skip rules. `shouldSkip` is a boolean predicate; when true the engine skips to the next phase. Omit to use the adapter's default (skip `reuse` when the project has no git history). |
| `statusKey` | `string` | Footer status key. |
| `entryType` | `string` | Session-history custom-type. It stores a pointer only; `workflow.json` is canonical. |
| `footerLabel` | `string` | Label shown in the footer (`● label · step/total phase`). |

### Adapter options

The second argument to `createWorkflowExtension`:

| Field | Description |
|---|---|
| `commandName` | The `/<command>` name users type to kick off the workflow. |
| `commandDescription` | Description shown in the command list. |

## Durable runs and explicit resume

Each started workflow receives a UUID artifact directory under `.selesai/artifacts/` and an adjacent `workflow.json`. It stores the mode, phase, armed state, loop round/review path, and timestamps. Writes use a temporary sibling file plus rename, so a crash cannot partially overwrite the canonical record.

Runs are **never** auto-resumed on session start. At most one run can be attached to a Pi instance, but older active runs remain resumable:

- Workflow initiation is user-only: `/workflow-prototype <goal>`, `/workflow-quick <goal>`, or `/workflow-task <goal>`
- `/workflow-prototype resume <id-or-artifact-dir-or-workflow.json>` / `/workflow-quick resume ...` / `/workflow-task resume ...`
- `/workflow-prototype resume`, `/workflow-quick resume`, or `/workflow-task resume` lists active runs (and offers a UI picker when available).
- `/workflow-prototype help`, `/workflow-quick help`, or `/workflow-task help` shows the start, resume, continue, and explicit-completion lifecycle.

Resume validates the selected file is under the artifacts base, belongs to that mode, is active, and matches its containing directory. It reconciles the current expected artifact once before emitting the current prompt, covering a crash after `write_workflow_artifact` writes the file but before the phase-state write. Valid artifact writes queue one hidden engine-controlled continuation using `steer` and terminate the current parent turn; invalid writes stay in the current phase and do not terminate. Prompts injected by start, resume, and continue commands are hidden custom messages rather than visible synthetic user messages. Transition-capable calls (`write_workflow_artifact`, loop commentator transitions, and `end_workflow`) must be the sole tool call in their assistant batch; the adapter fails closed when that cannot be proven. Corrupt records are skipped during discovery. Reloads never auto-resume; the user must explicitly resume through a mode's slash command.

A valid terminal artifact makes a workflow **terminal-ready**; it does not complete the run. Call `end_workflow({ mode })` to write `status: "completed"`, append the done entry, and terminate. This is the only completion path.

## Artifact ownership

Workflow artifacts have one writer: the parent session's `write_workflow_artifact` tool. Every workflow child call uses `output: false` and returns inline. In artifact phases (`plan`, `reuse`, `handoff`, and `audit`), the parent inspects that result, validates any required marker, and immediately passes it to `write_workflow_artifact`. Child output paths and fallback persistence are deliberately disabled; a child result alone cannot create an artifact or advance a phase.

The implement/review loop is the explicit exception to parent persistence, not inline return: the engine persists `loop-review-<round>.md` and `loop-complete.md` from commentator results so it can manage review rounds. Builders only change workspace code.

Every state-machine method returns a `WorkflowEffect` — a discriminated union the adapter switches on:

| Effect | Meaning |
|---|---|
| `started` | `start()` succeeded; first phase prompt + entry + footer. |
| `alreadyActive` | `start()` called while a workflow is active. |
| `advanced` | Phase moved forward (optionally `skipped` a phase). |
| `blocked` | Current phase's artifact is missing. |
| `terminalNeedsArtifacts` | At the last phase; a close artifact is missing. |
| `terminalReady` | At the last phase; all close artifacts present — call `end()`. |
| `closed` | `end()` succeeded; workflow finished. |
| `endBlocked` | `end()` called from the wrong phase or with close artifacts missing. |
| `idle` | No active workflow. |
| `noOp` | Auto-advance checked, nothing to do (not active, not armed, artifact not present, or already advancing). |

The `tool_result` auto-advance hook is one line:

```typescript
const eff = await sm.onArtifactMaybe(deps);
applyEffect(pi, ctx, config, eff);
```

The reentrancy guard lives inside `onArtifactMaybe` — concurrent calls return `noOp`, so a double `write` in one turn cannot double-advance the phase.

## Skip rules

By default the adapter skips the `reuse` phase when the project has no git history. To override, supply `skipRules` in your config:

```typescript
skipRules: [
  { phase: "research", shouldSkip: async () => isWellUnderstoodDomain() },
  { phase: "reuse", shouldSkip: async () => isEmptyProject() },
],
```

`shouldSkip` is a boolean predicate. When it returns `true`, the engine skips to the next phase in `phases` — the mode owns the transition graph, not the adapter.

## Testing a mode

The state machine is tested directly with in-memory stubs — no filesystem, no pi mock, no events:

```typescript
import { WorkflowStateMachine } from "../extensions/workflow/state-machine.ts";

const files = new Set<string>();
const deps = {
  async artifactExists(phase, dir) {
    const file = config.phaseArtifacts[phase];
    return file ? files.has(`${dir}/${file}`) : true;
  },
  async fileExists(path) { return files.has(path); },
  async mkdirArtifactDir() {},
  artifactPathFor: (goal) => `/fake/${goal}`,
};

const sm = new WorkflowStateMachine(config);
const eff = await sm.start("build X", deps);
expect(eff.kind).toBe("started");
```

See `src/__tests__/state-machine.test.ts` for the full set of transition, skip, terminal, rehydrate, and validation tests.