# Workflow Mechanics — Investigation Report

## Architecture Overview

The workflow engine lives in `src/extensions/workflow/` and is a bundled pi extension package (`package.json` → `./extension.ts`). It has three layers:

```
state-machine.ts  →  pure phase graph (no fs, no pi API, no typebox)
adapter.ts        →  pi wiring: tools, commands, events, fs, agent continuation
modes/*.ts        →  pure config: phases, artifacts, prompts, closeArtifacts
```

Two built-in modes: **prototype** (7 phases) and **quick** (6 phases, no research).

---

## 1. Commands and Tools

### Registered tools (per mode)
| Tool | Purpose |
|---|---|
| `start_workflow` / `start_quick_workflow` | Start the workflow with a goal string |
| `end_workflow` / `end_quick_workflow` | Close the workflow from the terminal phase |
| `write_workflow_artifact` | **Shared** — write the current phase artifact file |

**No `next` tool is registered.** The `WorkflowAdapterOptions.toolNames` interface has only `{ start, end }` — no `next` field. Transitions are hook-driven.

Source: `adapter.ts:134-135` — `toolNames: { start: string; end: string }`

### Registered commands
| Command | Description |
|---|---|
| `/prototype` | Start/continue/close the prototype workflow |
| `/quick` | Start/continue/close the quick workflow |

Source: `adapter.ts:445-495` — `pi.registerCommand(options.commandName, ...)`

### Command handler behavior (adapter.ts:445-495)
- If workflow is **active** and user is idle: shows a UI select menu — "Continue current" or "Close and start new"
- If workflow is **inactive**: starts a new one with the provided goal
- If another mode's workflow is active: blocks with a warning

---

## 2. State Machine (`state-machine.ts`)

### Phase graph
- `Phase` is an **open union** (`string`). `KNOWN_PHASES` gives autocomplete but new phase names are allowed at runtime.
- Config validation runs at construction: rejects duplicate phases, unknown phase references in `phaseArtifacts`/`prompts`/`skipRules`.

### State
Instance-local (one workflow at a time per mode). State includes:
- `active: boolean`
- `phase: Phase`
- `userPrompt: string`
- `artifactDir: string`
- `autoArmed: boolean` — re-armed on every phase change
- `advancing: boolean` — reentrancy guard

### Transitions
Every method returns a `WorkflowEffect` discriminated union:

| Effect | Trigger | Meaning |
|---|---|---|
| `started` | `start()` | First phase prompt + entry + footer |
| `alreadyActive` | `start()` while active | Blocked |
| `advanced` | `next()` / `onArtifactMaybe()` | Phase moved forward (optionally `skipped` a phase) |
| `blocked` | `next()` / `advancePhase()` | Current phase artifact missing |
| `terminalNeedsArtifacts` | `advancePhase()` at last phase | Close artifact missing |
| `terminalReady` | `advancePhase()` at last phase | All close artifacts present |
| `closed` | `end()` | Workflow finished |
| `endBlocked` | `end()` from wrong phase or missing artifacts | Blocked |
| `idle` | Any method when not active | No-op |
| `noOp` | `onArtifactMaybe()` | Nothing to do |

### Key methods
- `start(goal, deps)` — creates artifact dir, sets phase to first, returns `started`
- `next(deps)` — manual advance (exists but **not exposed as a tool**)
- `end(deps)` — closes workflow; requires being at terminal phase + all close artifacts present
- `onArtifactMaybe(deps)` — **the primary transition driver**; checks if current phase artifact exists, advances if so. Reentrancy guard prevents double-advance.
- `continueCurrent()` — re-emits current phase prompt without advancing (for `/command` resume)
- `closeCurrent()` — marks workflow done, returns entry for logging (for `/command` close+restart)
- `rehydrate(snapshot)` — restores state from persisted entry

### Skip rules
- Configurable per phase via `skipRules: [{ phase, shouldSkip }]`
- Default: skip `reuse` on empty git projects (no commits)
- When `shouldSkip` returns true, engine skips to the next phase in `phases` array

### Close gate
- `closeArtifacts: string[]` — files that must exist before `end()` succeeds
- Both modes: `closeArtifacts: ["review.md"]`

---

## 3. Adapter Wiring (`adapter.ts`)

### Event hooks

| Event | Handler |
|---|---|
| `session_start` | Rehydrate state machine from persisted entries; re-render footer |
| `tool_call` | Block `write`/`edit` tools while workflow active; force subagent output paths |
| `tool_result` | Auto-advance after `bash`/`subagent` tool results; subagent text fallback |

### Artifact writing path
1. Agent calls `write_workflow_artifact({ content })` — no path parameter
2. Adapter resolves path: `{artifactDir}/{phaseArtifacts[currentPhase]}`
3. Writes file, then calls `sm.onArtifactMaybe(deps)` to check for auto-advance
4. If advanced: `applyEffect()` writes entry, updates footer, sends followUp prompt

### Subagent output forcing (`forceSubagentOutputToArtifactDir`)
- Phases `plan`, `reuse`, `handoff`, `audit` force the subagent tool's `output` parameter to `{artifactDir}/{file}`
- Audit phase restricts to agents `commentator` and `reviewer`
- Respects explicit absolute output paths from the caller

### Subagent text fallback
- If a subagent returns text but did not write the expected artifact file (common with dumb/local models), the adapter saves the returned text as the artifact
- Excludes management actions (`list`/`get`/`models`/`doctor`/`status`/...)

### Prompt-only enforcement
- `tool_call` handler blocks `write`/`edit` tools with reason: "Use write_workflow_artifact for workflow artifacts; workspace edits must be delegated to subagents."
- This is the only prompt-only enforcement point — agents are instructed via prompts to use `write_workflow_artifact` but the tool_call hook enforces it.

---

## 4. Persistence and Resume

### Entry format
```typescript
interface WorkflowEntry {
  mode: string;       // "prototype" | "quick"
  phase: Phase;
  step: number;
  done: boolean;
  userPrompt: string;
  artifactDir: string;
}
```

### Write path
- `applyEntry()` calls `pi.appendEntry(config.entryType, entry)`
- `entryType`: `"prototype-phase"` or `"quick-phase"`
- Written on every phase transition (`started`, `advanced`, `closed`)

### Resume path
- `session_start` handler iterates session entries in reverse
- Finds last entry matching `config.entryType`
- If `done: true` → rehydrate as inactive
- If `done: false` → rehydrate as active with `autoArmed: true`
- Re-renders footer from snapshot

### Artifact dir path
- Base: `config.artifactsBase ?? "./.selesai/artifacts"`
- Full: `{base}/{timestamp}-{slugified(goal)}`
- Slug: lowercase, non-alphanumeric → dash, max 40 chars
- Example: `./.selesai/artifacts/20260708-143022-build-x`

---

## 5. Phase Artifacts

### Prototype (7 phases)
| Phase | Artifact file |
|---|---|
| grilling | `requirements.md` |
| research | `research.md` |
| plan | `plan.md` |
| reuse | `reuse.md` |
| handoff | `handoff.md` |
| loop | `loop-complete.md` |
| audit | `review.md` |

### Quick (6 phases, no research)
| Phase | Artifact file |
|---|---|
| grilling | `requirements.md` |
| plan | `plan.md` |
| reuse | `reuse.md` |
| handoff | `handoff.md` |
| loop | `loop-complete.md` |
| audit | `review.md` |

### Close artifacts (both modes)
`["review.md"]` — must exist before `end()` succeeds.

---

## 6. Contradictions Found

### Contradiction 1: `next` tool in docs vs code
- **Docs** (`docs/workflows.md:18, 88-97, 117, 139`): References a `next` tool in `toolNames` (`{ start, next, end }`), in the rigorous mode example (`next_rigorous_step`), and in the adapter description ("One state-machine method per call site (`start` tool, `next` tool, `end` tool...)").
- **Code** (`adapter.ts:134-135`): `WorkflowAdapterOptions.toolNames` has only `{ start: string; end: string }`. No `next` tool is registered. The `next` method exists on the state machine but is **not exposed as a tool**.
- **Severity**: Medium. Docs are stale — the `next` tool was removed in favor of hook-driven auto-advance via `onArtifactMaybe`. The rigorous mode example in docs would not work as written.

### Contradiction 2: `WorkflowModeRegistration` has `toolNames` with `next` but adapter ignores it
- **Code** (`state-machine.ts:36-43`): `WorkflowModeRegistration.toolNames` still declares `{ start: string; end: string }` — no `next`.
- **Code** (`modes/prototype.ts:152`, `modes/quick.ts:134`): Both modes only define `start` and `end` tool names.
- **Severity**: Low. The interface is consistent with the adapter; the docs are the only stale part.

### Contradiction 3: Docs example uses `createWorkflowExtension` directly but actual modes export `WorkflowModeRegistration`
- **Docs** (`docs/workflows.md:100`): Example mode exports `createWorkflowExtension(config, options)` directly.
- **Code** (`modes/prototype.ts:149-155`, `modes/quick.ts:131-137`): Both modes export a `WorkflowModeRegistration` object, and `extension.ts` calls `createWorkflowExtension(mode.config, ...)`.
- **Severity**: Low. Both approaches work; the docs show a valid alternative pattern.

---

## 7. Residual Risks

1. **Docs are stale**: The `workflows.md` documentation references a `next` tool that no longer exists. Anyone following the docs to add a new mode would get a compile error on the `next` field in `toolNames`.
2. **No `next` tool means no manual phase advance**: Agents cannot manually advance the workflow — they must write the artifact file. If the artifact-writing path is broken (e.g., `write_workflow_artifact` tool not found), the workflow is stuck.
3. **Subagent text fallback is fragile**: The fallback writes subagent return text as the artifact file, but only for execution calls (not management actions). If a subagent returns text that is not the intended artifact, the workflow advances incorrectly.
4. **Single active workflow per mode**: The global registry (`Symbol.for("selesai.workflow.registry.v1")`) allows one active workflow per mode. Starting a second mode's workflow while another is active is blocked.
5. **Artifact dir path uses `./.selesai/artifacts/`**: This is relative to the process cwd, which may not be the project root in all scenarios.

---

## 8. Summary

The workflow engine is a pure state machine with a thin pi adapter. Transitions are **hook-driven** — writing the expected artifact file via `write_workflow_artifact` triggers auto-advance via `onArtifactMaybe`. The `next` tool was removed; the docs are stale. Two modes exist (prototype, quick), both with `closeArtifacts: ["review.md"]`. Prompt-only enforcement blocks `write`/`edit` tools during active workflows. Persistence uses `pi.appendEntry` with custom entry types; resume rehydrates from the last entry on `session_start`.