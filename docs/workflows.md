# Workflows

Selesai ships a workflow engine under `src/extensions/workflow/`. It powers the built-in `prototype` and `quick` workflows and is designed so you can add a new workflow mode as a thin config file — no engine changes.

## How it fits together

```
src/extensions/workflow/
  package.json          pi package manifest; loads ./extension.ts as the single entry
  state-machine.ts      pure phase state machine (no fs, no pi API)
  adapter.ts            pi wiring: tools, commands, events, fs, agent continuation
  extension.ts          single pi extension that mounts every workflow mode
  modes/
    prototype.ts        mode config + registration object (exported as `prototypeMode`)
    quick.ts            mode config + registration object (exported as `quickMode`)
```

- **`state-machine.ts`** is the deep module. It owns the phase graph, artifact gating, skip rules, the terminal close gate, and the reentrancy guard. It imports nothing external — no `node:fs`, no pi API, no `pi-tui`, no `typebox`. Every method returns a `WorkflowEffect` (a discriminated union in domain vocabulary) that the adapter pattern-matches on.
- **`adapter.ts`** is the thin glue. One state-machine method per call site (`start` tool, `end` tool, `tool_result` auto-advance, `/<command>`) plus one `applyEffect` switch. It owns all pi/fs wiring and the git-based `reuse` skip predicate. There is no `next` tool — phase advance is automatic once the phase artifact lands, and terminal close is via the `end` tool.
- **`extension.ts`** imports each mode's registration object and calls `createWorkflowExtension(config, options)(pi)` for each, so one extension load resolves a single shared writer tool + one start/end tool pair per mode.
- **A mode file** is pure data: the phase list, the per-phase artifact filenames, the per-phase prompt generators, the terminal close artifacts, and identity strings (tool names, command name, status key, entry type). Prompts are functions that receive `{ artifactDir, userPrompt }` and return a string. Each mode exports a `WorkflowModeRegistration` object (e.g. `prototypeMode`, `quickMode`); it does not call `createWorkflowExtension` itself.

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
  toolNames: {
    start: "start_rigorous_workflow",
    end: "end_rigorous_workflow",
  },
  toolLabels: {
    start: "Start Rigorous Workflow",
    end: "End Rigorous Workflow",
  },
};

export default rigorousMode;
```

### 2. Register it in `extension.ts`

Add the mode to the `MODES` array in `src/extensions/workflow/extension.ts`:

```typescript
import { rigorousMode } from "./modes/rigorous.ts";

const MODES = [prototypeMode, quickMode, rigorousMode] as const;
```

That's it. The loader picks it up at boot (`package.json` loads only `./extension.ts`); the two tools (`start_rigorous_workflow`, `end_rigorous_workflow`) and the `/rigorous` command are registered automatically. There is no `next` tool — phases auto-advance as artifacts land and the `end` tool closes the terminal phase.

## Config reference

| Field | Type | Description |
|---|---|---|
| `mode` | `string` | Mode name, echoed in entry payloads and messages. |
| `phases` | `Phase[]` | Ordered phase list. `Phase` is `string` — new phase names are allowed. |
| `phaseArtifacts` | `Partial<Record<Phase, string>>` | The artifact file each phase must produce before advancing. Omit a phase to skip its gate. |
| `prompts` | `Partial<Record<Phase, (ctx) => string>>` | Prompt generator per phase. `ctx = { artifactDir, userPrompt }`. |
| `closeArtifacts` | `string[]` | Files that must exist before `end()` succeeds. Config-owned, no built-in default. |
| `skipRules?` | `{ phase, shouldSkip }[]` | Optional per-phase skip rules. `shouldSkip` is a boolean predicate; when true the engine skips to the next phase. Omit to use the adapter's default (skip `reuse` on empty projects). |
| `statusKey` | `string` | Footer status key. |
| `entryType` | `string` | Persisted entry custom-type, used for session resume. |
| `footerLabel` | `string` | Label shown in the footer (`● label · step/total phase`). |

### Adapter options

The second argument to `createWorkflowExtension`:

| Field | Description |
|---|---|
| `toolNames` | `{ start, end }` — the two registered tool names. There is no `next` tool; phases auto-advance as artifacts land. |
| `toolLabels` | Human-readable labels for the tools. |
| `commandName` | The `/<command>` name users type to kick off the workflow. |
| `commandDescription` | Description shown in the command list. |

## How transitions work

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