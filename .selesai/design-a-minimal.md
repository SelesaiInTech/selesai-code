# Design A: Minimal Interface (≤3 entry points)

## 1. Interface signature

```typescript
// ── state-machine.ts ──────────────────────────────────────────────
// No imports from node:fs, pi API, or pi-tui. Pure logic + injected predicates.

export type Phase = string;
// Open: Phase = string. See justification in §5.

export interface PromptContext {
  artifactDir: string;
  userPrompt: string;
}

export interface WorkflowModeConfig {
  mode: string;
  phases: Phase[];
  phaseArtifacts: Partial<Record<Phase, string>>;
  prompts: Partial<Record<Phase, (ctx: PromptContext) => string>>;
  // Phases whose artifact file, if present alongside the phase's own artifact,
  // must also exist before the terminal audit can close.
  // Default: { audit: ["review.md", "audit.md"] } — but expressed as:
  closeArtifacts?: Partial<Record<Phase, string[]>>;
  // Phases eligible for skip and the predicate to decide.
  // The engine calls skip(phase) only for phases listed here.
  skipPhases?: Phase[];
  // Cosmetic / identity — used in entry payloads and footer strings.
  // The state machine does NOT call setStatus or appendEntry;
  // it returns the payloads so the adapter can.
  statusKey: string;
  entryType: string;
  footerLabel: string;
}

// ── Output types ───────────────────────────────────────────────────

export interface EntryPayload {
  customType: string;
  data: {
    mode: string;
    phase: Phase;
    step: number;
    done: boolean;
    userPrompt: string;
    artifactDir: string;
  };
}

export interface FooterPayload {
  statusKey: string;
  text: string | undefined; // undefined = clear status
}

export type TransitionOutput =
  | {
      kind: "advanced";
      phase: Phase;
      prompt: string;
      skipped?: Phase;
      entry: EntryPayload;
      footer: FooterPayload;
    }
  | {
      kind: "blocked";
      phase: Phase;
      missing: string;
      entry: EntryPayload;
      footer: FooterPayload;
    }
  | {
      kind: "terminal";
      phase: Phase;
      missing?: string;
      entry: EntryPayload;
      footer: FooterPayload;
    };

export type BeginOutput = {
  kind: "advanced";
  phase: Phase;
  prompt: string;
  entry: EntryPayload;
  footer: FooterPayload;
};

export type EndOutput =
  | {
      kind: "closed";
      phase: Phase;
      artifactDir: string;
      entry: EntryPayload;
      footer: FooterPayload;
    }
  | {
      kind: "blocked";
      phase: Phase;
      missing: string;
      entry: EntryPayload;
      footer: FooterPayload;
    };

export interface WorkflowSnapshot {
  active: boolean;
  phase: Phase;
  userPrompt: string;
  artifactDir: string;
}

// ── Injected I/O seams ─────────────────────────────────────────────

export interface TransitionDeps {
  // (1) Does the expected artifact for this phase exist?
  artifactExists: (phase: Phase) => Promise<boolean>;
  // (2) Should this phase be skipped? Only called for phases in config.skipPhases.
  skip: (phase: Phase) => Promise<boolean>;
}

// ── The class: exactly 3 public methods ─────────────────────────────

export class WorkflowStateMachine {
  constructor(config: WorkflowModeConfig);

  // Entry point 1: start a new workflow from a goal string.
  // Returns the first-phase prompt + entry/footer payloads.
  // Throws if already active.
  begin(goal: string): BeginOutput;

  // Entry point 2: attempt to advance one phase.
  // Checks artifact gate for the *current* phase, then transitions.
  // If next phase is skippable and skip() returns true, jumps past it.
  // If at terminal phase, returns terminal with missing artifacts if any.
  // Returns idle-state transition if not active.
  advance(deps: TransitionDeps): Promise<TransitionOutput>;

  // Entry point 3: close the workflow from the terminal (audit) phase.
  // Checks closeArtifacts for the terminal phase.
  // Returns closed or blocked.
  end(deps: TransitionDeps): Promise<EndOutput>;

  // ── rehydrate is NOT a 4th entry point: it's the constructor ──
  // Constructor accepts an optional snapshot for rehydrate:
  // new WorkflowStateMachine(config)           → fresh
  // new WorkflowStateMachine(config, snapshot) → rehydrated
  //
  // Alternative: static factory. But constructor overload is simpler
  // and keeps the count at 3 *methods* (constructor isn't counted as
  // an entry point — it's initialization, not a transition).

  // Read-only accessor for the current snapshot.
  // This is a getter, not a method — not counted as an entry point.
  get snapshot(): WorkflowSnapshot;
}
```

**Public entry points: `begin`, `advance`, `end`.** Constructor + `snapshot` getter are initialization/read, not transitions.

---

## 2. Usage example

### (a) Mode file — `modes/prototype.ts`

```typescript
import type { WorkflowModeConfig } from "../state-machine.ts";
import { createWorkflowAdapter } from "../adapter.ts";

const config: WorkflowModeConfig = {
  mode: "prototype",
  phases: ["grilling", "research", "plan", "reuse", "handoff", "loop", "audit"],
  phaseArtifacts: {
    grilling: "requirements.md",
    research: "research.md",
    plan: "plan.md",
    reuse: "reuse.md",
    handoff: "handoff.md",
    loop: "loop-complete.md",
    audit: "review.md",
  },
  closeArtifacts: { audit: ["review.md", "audit.md"] },
  skipPhases: ["reuse"],
  prompts: {
    grilling: ({ artifactDir, userPrompt }) => `…full prompt…`,
    research: ({ artifactDir }) => `…`,
    // …all 7 phases…
  },
  statusKey: "prototype",
  entryType: "prototype-phase",
  footerLabel: "prototype",
};

export default createWorkflowAdapter(config, {
  toolNames: { start: "start_workflow", next: "next_step", end: "end_workflow" },
  toolLabels: { start: "Start Workflow", next: "Next Step", end: "End Workflow" },
  commandName: "prototype",
  commandDescription: "Run the prototype workflow (grill → research → plan → reuse → handoff → loop → audit)",
});
```

### (b) Test — `state-machine.test.ts` (no fs, no FakePi)

```typescript
import { WorkflowStateMachine } from "../extensions/workflow/state-machine.ts";
import { describe, expect, it } from "vitest";

const config = {
  mode: "test",
  phases: ["grilling", "plan", "audit"] as const,
  phaseArtifacts: { grilling: "requirements.md", plan: "plan.md", audit: "review.md" },
  closeArtifacts: { audit: ["review.md", "audit.md"] },
  skipPhases: [],
  prompts: {
    grilling: ({ userPrompt }) => `grill: ${userPrompt}`,
    plan: () => "plan phase",
    audit: () => "audit phase",
  },
  statusKey: "test",
  entryType: "test-phase",
  footerLabel: "test",
};

describe("WorkflowStateMachine", () => {
  it("begins at first phase and returns prompt + entry payload", () => {
    const sm = new WorkflowStateMachine(config);
    const out = sm.begin("build X");
    expect(out.kind).toBe("advanced");
    expect(out.phase).toBe("grilling");
    expect(out.prompt).toBe("grill: build X");
    expect(out.entry.data.phase).toBe("grilling");
    expect(out.entry.data.step).toBe(1);
    expect(out.entry.data.done).toBe(false);
    expect(out.footer.text).toContain("1/3");
  });

  it("is blocked when current phase artifact does not exist", async () => {
    const sm = new WorkflowStateMachine(config);
    sm.begin("build X");
    const out = await sm.advance({
      artifactExists: async () => false, // requirements.md missing
      skip: async () => false,
    });
    expect(out.kind).toBe("blocked");
    expect(out.missing).toBe("requirements.md");
    expect(out.phase).toBe("grilling");
  });

  it("advances to next phase when artifact exists", async () => {
    const sm = new WorkflowStateMachine(config);
    sm.begin("build X");
    const out = await sm.advance({
      artifactExists: async (p) => p === "grilling", // only requirements.md exists
      skip: async () => false,
    });
    expect(out.kind).toBe("advanced");
    expect(out.phase).toBe("plan");
    expect(out.prompt).toBe("plan phase");
    expect(out.entry.data.step).toBe(2);
  });

  it("skips a phase when skip predicate returns true", async () => {
    const skipConfig = { ...config, skipPhases: ["plan"] };
    const sm = new WorkflowStateMachine(skipConfig);
    sm.begin("build X");
    const out = await sm.advance({
      artifactExists: async (p) => p === "grilling",
      skip: async (p) => p === "plan", // skip plan
    });
    expect(out.kind).toBe("advanced");
    expect(out.phase).toBe("audit"); // jumped past plan
    expect(out.skipped).toBe("plan");
  });

  it("rehydrates from snapshot and continues", async () => {
    const sm1 = new WorkflowStateMachine(config);
    sm1.begin("build X");
    const snap = sm1.snapshot;
    const sm2 = new WorkflowStateMachine(config, snap); // rehydrate
    expect(sm2.snapshot.phase).toBe("grilling");
    expect(sm2.snapshot.active).toBe(true);
    const out = await sm2.advance({
      artifactExists: async () => true,
      skip: async () => false,
    });
    expect(out.kind).toBe("advanced");
    expect(out.phase).toBe("plan");
  });

  it("returns terminal when at last phase with missing close artifacts", async () => {
    const sm = new WorkflowStateMachine(config);
    sm.begin("build X");
    // advance to audit
    await sm.advance({ artifactExists: async () => true, skip: async () => false });
    await sm.advance({ artifactExists: async () => true, skip: async () => false });
    // now at audit, try to advance
    const out = await sm.advance({
      artifactExists: async (p) => p === "audit", // review.md exists but audit.md doesn't
      skip: async () => false,
    });
    expect(out.kind).toBe("terminal");
    expect(out.missing).toBe("audit.md");
  });

  it("ends successfully when all close artifacts exist", async () => {
    const sm = new WorkflowStateMachine(config);
    sm.begin("build X");
    await sm.advance({ artifactExists: async () => true, skip: async () => false });
    await sm.advance({ artifactExists: async () => true, skip: async () => false });
    const out = await sm.end({
      artifactExists: async () => true, // both review.md and audit.md exist
      skip: async () => false,
    });
    expect(out.kind).toBe("closed");
    expect(out.entry.data.done).toBe(true);
    expect(sm.snapshot.active).toBe(false);
  });
});
```

---

## 3. Hidden complexity

The module absorbs internally:

1. **Phase ordering and step numbering** — `PHASE_STEP` map computed from `config.phases` order. No external code needs to know phase indices.
2. **Artifact gating** — checking `config.phaseArtifacts[phase]` against the injected `artifactExists` predicate. The adapter never sees the artifact filename; it only provides the existence check.
3. **Skip logic** — after determining the next phase, if it's in `config.skipPhases`, calls the injected `skip` predicate. If true, computes the phase *after* the skipped one and jumps there. The `skipped` field in the output tells the adapter what was bypassed. The skip target is `nextPhase(skippedPhase)` — if that's also skippable, the engine does NOT cascade-skip (one skip per advance call; a second advance will check again). This matches current behavior.
4. **Terminal/close-artifact gating** — when `advance` is called at the last phase, it checks `closeArtifacts[terminalPhase]` (defaulting to `["review.md", "audit.md"]` for audit). Returns `terminal` with the first missing filename, or `terminal` without `missing` when all exist. The adapter translates this into "call `end`" or "write the missing file."
5. **Rehydrate** — constructor accepts an optional `WorkflowSnapshot`. Restores `active`, `phase`, `userPrompt`, `artifactDir` in one step. No separate `rehydrate()` method needed.
6. **Prompt resolution** — calls `config.prompts[phase]({ artifactDir, userPrompt })`. The prompt functions are pure; the engine just dispatches.
7. **Entry payload computation** — builds `{ customType, data: { mode, phase, step, done, userPrompt, artifactDir } }` on every transition. The adapter calls `pi.appendEntry(payload.customType, payload.data)`.
8. **Footer payload computation** — builds `{ statusKey, text: "● label · step/total phase" }` or `{ statusKey, text: undefined }` (clear). The adapter calls `ctx.ui.setStatus(payload.statusKey, payload.text)`.
9. **`begin` validation** — throws if already active. The adapter catches and returns an error tool result.
10. **`end` validation** — returns `blocked` if not at terminal phase, or if close artifacts are missing. No throw — the adapter translates to a user-facing error message.

What the module does NOT absorb (stays in the adapter):
- `mkdir` for the artifact directory (the adapter creates it in `begin` before calling `sm.begin`)
- `sendUserMessage` / `deliverAs: "followUp"` (the adapter decides based on `ctx.isIdle()`)
- `pi.exec("git", …)` for `isEmptyProject` (the adapter implements the `skip` predicate)
- Tool/command/event registration
- The reentrancy guard (`advancing` flag) — this is an adapter concern because it's about event-loop concurrency, not state-machine correctness

---

## 4. Dependency strategy

**In-process** — the state machine itself. Pure transitions over in-memory state (`active`, `phase`, `userPrompt`, `artifactDir`). No I/O, no side effects, no network. Deepenable directly: the module is tested with zero external dependencies.

**Local-substitutable** — the two injected I/O seams:

| Seam | Production implementation | Test implementation |
|------|--------------------------|---------------------|
| `artifactExists(phase)` | `async (p) => fileExists(artifactDir + "/" + config.phaseArtifacts[p])` | `async (p) => existingPhases.has(p)` — an in-memory `Set<Phase>` |
| `skip(phase)` | `async (p) => isEmptyProject(pi)` — runs `pi.exec("git", ["log", "--oneline", "-1"])` | `async (p) => p === "reuse"` — a stub returning a boolean |

Both are **injected per-call** via `TransitionDeps` on `advance` and `end`. The state machine has no reference to `node:fs`, `node:fs/promises`, `@earendil-works/pi-coding-agent`, or `@earendil-works/pi-tui`. It imports nothing except its own type definitions.

The adapter (a separate file, `adapter.ts`) owns the **ports & adapters** boundary: it wraps `WorkflowStateMachine` in the pi extension factory, injecting real fs predicates in production. The adapter is tested with one smoke test via `FakePi` (the existing test harness pattern) — it only verifies that adapter correctly translates `TransitionOutput` → `pi.appendEntry` + `pi.sendUserMessage` + `ctx.ui.setStatus`.

**Mock** — not needed. There are no true-external (third-party) dependencies. `pi.exec` for git is the adapter's concern, not the state machine's.

---

## 5. Trade-offs

### What this minimal design gives up:

**1. No "get current prompt" without a transition.**
The adapter cannot ask "what's the prompt for the current phase?" without calling `begin` or `advance`. The current engine's `phasePrompt(phase)` is internal. The `/prototype` command's "continue current workflow" path needs the current phase's prompt — the adapter must either cache it from the last transition output, or the interface needs a 4th method (`currentPrompt()`). This design caches in the adapter: `advance`/`begin` return the prompt, the adapter stores it, and "continue" replays the cached value. Trade-off: if the adapter is rehydrated from session-start without a prior transition in this process, the cached prompt is empty. The adapter must call `advance` with a no-op artifact check to force a prompt, or we accept that "continue after rehydrate" shows a generic "you are at phase X" message instead of the full prompt. This is an acceptable degradation — the user can just type `/prototype` again.

**2. No multi-skip in one advance call.**
If two consecutive phases are both skippable and both predicates return true, `advance` only skips one per call. The adapter must call `advance` again (which the `tool_result` auto-advance loop does naturally). This matches current behavior (the engine skips `reuse` once, lands on `handoff`). Trade-off: a mode with `skipPhases: ["research", "reuse"]` would require two auto-advance cycles to skip both. This is fine — the auto-advance loop already fires on every `tool_result`, so it self-cascades.

**3. No direct phase-set method.**
The adapter cannot jump to an arbitrary phase (e.g., for a "rewind to plan" feature). All movement is `advance` (forward one, with skip). Trade-off: a future "rewind" feature would need a 4th method or a `setPhase` on the class. Not needed today — neither prototype nor quick supports rewind.

**4. The adapter owns the reentrancy guard.**
The `advancing` flag that prevents double-advance from concurrent `tool_result` events is an adapter concern, not a state-machine concern. The state machine is single-threaded synchronous (within one `advance` call); the concurrency issue is that the *adapter's event handler* can be called twice before the first `advance` resolves. Trade-off: if someone writes a new adapter, they must remember to add the guard. This is acceptable — it's a property of the event system, not the state machine.

**5. `Phase = string` loses type-safety on phase names.**
The closed union `grilling|research|plan|reuse|handoff|loop|audit` gave compile-time catches for typos in mode configs. Opening to `string` means a mode can declare `phases: ["griling", "plan", "audit"]` and the typo won't surface until runtime (the prompt for `griling` is `undefined` → empty string). Trade-off: acceptable because (a) the current `WorkflowConfig.phases: Phase[]` already lets modes choose subsets, meaning the closed union was never enforced at the config level — it only constrained which strings are *legal*, not which are *used*; (b) a future mode wanting a new phase (e.g. `"deploy"`) would have to modify the engine's type definition under the closed approach, defeating the "extensible without touching engine" goal; (c) the mode config is written once and tested — a typo shows up immediately in the first test run as an empty prompt. The practical safety loss is minimal.

**6. `closeArtifacts` is a config field, not hardcoded.**
The current engine hardcodes that audit needs `review.md` + `audit.md`. This design makes it configurable via `closeArtifacts`. Trade-off: a mode could forget to set it and the terminal phase wouldn't gate on anything. Mitigated by a default: if `closeArtifacts` is absent, the engine defaults to `{ audit: ["review.md", "audit.md"] }` — matching current behavior. A mode that wants different close artifacts must explicitly override.