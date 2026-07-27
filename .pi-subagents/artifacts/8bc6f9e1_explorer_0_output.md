# Code Context — Workflow Design Bugs

## Files Retrieved

1. `src/extensions/workflow/adapter.ts` (1-600) — pi wiring: tools, events, tool_result hook, loop orchestration, subagent text fallback, force-output injection
2. `src/extensions/workflow/state-machine.ts` (1-300) — pure phase state machine: transitions, artifact gating, semantic validators, reentrancy guard
3. `src/extensions/workflow/validators.ts` (1-40) — marker regex validators: planValidator, handoffValidator, loopCompleteValidator, reviewValidator
4. `src/extensions/workflow/extension.ts` (1-20) — mounts prototype + quick modes
5. `src/extensions/workflow/modes/prototype.ts` (1-150) — prototype mode config + prompts
6. `src/extensions/workflow/modes/quick.ts` (1-140) — quick mode config + prompts
7. `src/__tests__/state-machine.test.ts` (1-500) — pure SM tests: transitions, skip, terminal, rehydrate, semantic gates
8. `src/__tests__/adapter.test.ts` (1-750) — adapter smoke tests: tools, events, loop, fallback, management-action guard
9. `src/__tests__/workflow-race.test.ts` (1-130) — hook-driven transition tests
10. `docs/workflows.md` — architecture docs

---

## Key Code

### Bug 1: Missing marker causes malfunction

**Validators** (`validators.ts:15-30`):
```typescript
function markerValidator(marker: string, statusWord: string): WorkflowArtifactValidator {
  const re = new RegExp(
    `${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*${statusWord}\\b`,
    "i",
  );
  return (content) => {
    if (re.test(content)) return { ok: true };
    return {
      ok: false,
      reason: `missing required marker \`${marker}: ${statusWord}\` on its own line`,
    };
  };
}
```

**State machine gate** (`state-machine.ts:170-185`):
```typescript
private async artifactSatisfiedFor(p: Phase, deps: WorkflowDeps): Promise<{ exists: boolean; reason?: string }> {
  const file = this.config.phaseArtifacts[p];
  if (!file) return { exists: true };
  if (!(await deps.artifactExists(p, this.artifactDir))) return { exists: false };
  const validator = this.config.artifactValidators?.[p];
  if (!validator) return { exists: true };
  const content = await deps.readArtifact(p, this.artifactDir);
  if (content === undefined) return { exists: false };
  const res = validator(content);
  if (res.ok) return { exists: true };
  return { exists: true, reason: res.reason };
}
```

**Adapter blocked handling** (`adapter.ts:120-125`):
```typescript
case "blocked":
  if (eff.reason) {
    continueAgent(pi, ctx, `Phase ${eff.phase} artifact exists but is not approved: ${eff.reason}. Edit it via write_workflow_artifact to add the required marker, then the workflow will advance.`);
  }
  return;
```

**Subagent text fallback** (`adapter.ts:300-330`): When subagent returns text but didn't write the file, adapter saves it. Uses `shouldReplaceInvalidArtifact` to only replace if fallback content is valid.

**Management action guard** (`adapter.ts:310-312`): `if (typeof event.input?.action !== "string")` — prevents subagent management calls (list/get/doctor) from triggering text fallback.

### Bug 2: Broad tool_result handling queues duplicate tasks

**tool_result handler** (`adapter.ts:280-370`): Fires on EVERY `bash` and `subagent` tool_result. For each:
1. Error path: calls `onArtifactMaybe`, if noOp, re-queues current phase via `continueCurrent()`
2. Subagent text fallback: checks `SUBAGENT_FALLBACK_PHASES`, writes artifact from returned text
3. Loop orchestration: checks `event.input?.agent` for builder/commentator, drives next step
4. Always calls `sm.onArtifactMaybe(deps)` + `applyEffect`

**Reentrancy guard** (`state-machine.ts:230-250`):
```typescript
async onArtifactMaybe(deps: WorkflowDeps): Promise<WorkflowEffect> {
  if (this.advancing) return { kind: "noOp" };
  if (!this.active || !this.autoArmed) return { kind: "noOp" };
  this.advancing = true;
  try {
    // ... check artifact, advance if satisfied
  } finally {
    this.advancing = false;
  }
}
```

**autoArmed lifecycle**: Set `true` on every phase change (`setPhase`). Set `false` after successful advance. Stays `true` if artifact not yet present → every subsequent tool_result re-checks (returns noOp, but still pays the cost).

---

## Architecture

```
tool_result (bash/subagent)
  │
  ├─ isError? → onArtifactMaybe → noOp? → continueCurrent() [re-queue phase]
  │
  ├─ subagent + fallback phase? → text fallback [write artifact from returned text]
  │
  ├─ loop phase + subagent? → loop orchestration [builder→commentator cycle]
  │
  └─ always: onArtifactMaybe() → applyEffect()
        │
        ├─ advanced → send followUp with next phase prompt
        ├─ blocked → send followUp with marker fix instructions
        ├─ terminalReady → end() → closed
        ├─ terminalNeedsArtifacts → send followUp
        └─ noOp → nothing
```

---

## Bug 1: AI/subagent generates artifact without required marker

### Current behavior
- Prompts in `modes/prototype.ts` and `modes/quick.ts` tell the AI to include markers (e.g., `WORKFLOW_PLAN_STATUS: ready`)
- Validators in `validators.ts` check for these markers via regex
- When marker is missing, `artifactSatisfiedFor` returns `{ exists: true, reason: "..." }`
- State machine returns `blocked` effect with reason
- Adapter sends followUp telling the model which marker is missing
- The `write_workflow_artifact` tool also surfaces the blocked reason in its result

### Likely root causes
1. **AI model ignores prompt instructions** — the prompts say "MUST end with exactly one machine-readable line" but there's no enforcement at the AI level. The validator catches it, but the workflow stalls until the model self-corrects.
2. **Subagent text fallback writes content without marker** — if a subagent returns text that lacks the marker, the fallback writes it anyway. The `shouldReplaceInvalidArtifact` check only replaces if the *fallback* content is valid, so an invalid subagent output can leave a bad artifact in place.
3. **Loop-complete.md is engine-written** (`adapter.ts:355`) — the engine writes it with the marker, so this path is safe. But if a parent/agent writes it manually, the validator catches it.

### Files/functions that own fixes
- **`validators.ts:15-30`** — `markerValidator()` — the regex is correct, no change needed
- **`state-machine.ts:170-185`** — `artifactSatisfiedFor()` — correctly returns reason
- **`adapter.ts:120-125`** — `applyEffect()` blocked case — surfaces reason to model
- **`adapter.ts:300-330`** — subagent text fallback — `shouldReplaceInvalidArtifact` logic could be more aggressive (replace invalid artifact even when fallback is also invalid, to avoid silent stalling)
- **`modes/prototype.ts` and `modes/quick.ts`** — prompts that instruct the AI — could be more explicit about the marker requirement

### Existing patterns/tests to reuse
- `state-machine.test.ts:418-500` — semantic gate tests (blocked, advance, recover, end blocked)
- `adapter.test.ts:700-750` — write_workflow_artifact blocked reason tests
- `adapter.test.ts:537-600` — management action guard tests (regression for accidental text fallback)

### Severity: **high** — workflow stalls silently if marker is missing; model must self-correct

---

## Bug 2: Broad tool_result handling queues duplicate/same workflow tasks

### Current behavior
- Every `bash` or `subagent` tool_result fires the handler
- Each handler call independently checks `onArtifactMaybe`
- If artifact exists but is invalid (blocked), each call sends a followUp telling the model to fix it
- If artifact doesn't exist yet, each call returns noOp (wasteful but not harmful)
- In loop phase, every subagent tool_result triggers loop orchestration logic

### Likely root causes
1. **No dedup on tool_result** — the handler doesn't track which tool_call_ids it has already processed. If parallel subagents return around the same time, each triggers a separate `onArtifactMaybe` + `applyEffect` cycle.
2. **Reentrancy guard is per-async-turn only** — `advancing` flag prevents concurrent calls within the same microtask, but sequential tool_results (e.g., bash result A, then bash result B) each get a fresh check.
3. **autoArmed stays true until advance** — if the phase artifact doesn't exist yet, every tool_result re-checks. For long phases (loop with many bash calls), this is O(n) wasted checks.
4. **Loop orchestration has no agent dedup** — if the model calls subagent for a non-builder/commentator agent during loop, the handler falls through to `onArtifactMaybe` (noOp), but the loop state machine doesn't track which agent calls it has already processed.

### Files/functions that own fixes
- **`adapter.ts:280-370`** — `tool_result` handler — the main culprit. Needs:
  - Dedup by `toolCallId` to avoid processing the same result twice
  - Skip non-phase-relevant tool results (e.g., bash calls that aren't writing artifacts)
  - Loop orchestration should only fire for builder/commentator agents, not all subagent results
- **`state-machine.ts:230-250`** — `onArtifactMaybe()` — reentrancy guard is correct but narrow
- **`adapter.ts:340-370`** — loop orchestration — the `if (agent === "builder")` / `else if (agent === "commentator")` guards are correct, but non-matching agents still fall through to `onArtifactMaybe`

### Existing patterns/tests to reuse
- `state-machine.test.ts:120-130` — concurrent call test (verifies reentrancy guard)
- `adapter.test.ts:175-195` — tool_result failure re-queue test
- `adapter.test.ts:340-370` — loop orchestration tests (builder→commentator cycle)
- `workflow-race.test.ts` — hook-driven transition tests

### Severity: **medium** — causes duplicate followUp messages and wasted checks; not data-corrupting but noisy

---

## Start Here

Open `src/extensions/workflow/adapter.ts` — it owns both bugs:
- Bug 1: the subagent text fallback (`adapter.ts:300-330`) and blocked handling (`adapter.ts:120-125`)
- Bug 2: the broad tool_result handler (`adapter.ts:280-370`) that fires on every bash/subagent result

The state machine (`state-machine.ts`) is pure and correct; the adapter is where the wiring leaks.

---

## Acceptance Report