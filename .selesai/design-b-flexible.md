# Design B: Maximize Flexibility / Extensibility

## 1. Interface Signature

```typescript
// ─── engine.ts — pure state machine, no fs, no pi ───

/** Phase identifier is open. Modes define their own phase names. */
type Phase = string;

/** Context passed to prompt generators and skip predicates. */
interface PhaseContext {
  artifactDir: string;
  userPrompt: string;
  phase: Phase;
}

/** A single phase descriptor — the unit of mode configuration. */
interface PhaseDescriptor {
  /** Unique phase name within this mode. */
  name: Phase;
  /** Artifact filename (relative to artifactDir) that must exist before advancing.
   *  Omit for phases with no artifact gate (e.g. grilling in some future mode). */
  artifact?: string;
  /** Prompt generator. Receives runtime context. Returns the phase prompt string. */
  prompt: (ctx: PhaseContext) => string;
  /** Skip predicate. If provided and returns true, this phase is skipped during
   *  advance. The engine calls this through the injected `shouldSkip` seam so
   *  the state machine stays pure — but the predicate is declared here per-phase
   *  so the mode owns the rule, not the engine.
   *  Called as: deps.shouldSkip(phase, snapshot) where snapshot is the current
   *  WorkflowSnapshot. The engine delegates to whatever the adapter injects. */
  skip?: PhaseSkipConfig;
}

/** How a phase's skip rule is declared. The engine doesn't evaluate this
 *  directly — it passes the phase name to the injected `shouldSkip` seam.
 *  But declaring it here lets a mode say "this phase is skippable" and
 *  provides metadata the adapter can use to build the skip predicate. */
interface PhaseSkipConfig {
  /** Marker — the adapter checks this to decide whether to call shouldSkip
   *  for this phase. If omitted, the phase is never skipped. */
  skippable: true;
  /** Optional human-readable reason included in the advance outcome. */
  reason?: string;
}

/** Required artifacts for the terminal phase. The engine checks these via
 *  the injected `artifactExists` seam before allowing `end()`.
 *  A mode with a novel terminal (e.g. "sign-off" instead of "audit") sets
 *  its own required artifacts here. */
interface TerminalGate {
  /** The terminal phase name. Must be the last phase in the sequence. */
  phase: Phase;
  /** Artifacts that must exist before the workflow can close.
   *  Each is a filename relative to artifactDir. */
  requiredArtifacts: string[];
}

/** What the engine emits when state changes. The adapter translates these
 *  into pi calls (appendEntry, setStatus, sendUserMessage, notify). */
interface WorkflowEntry {
  mode: string;
  phase: Phase;
  step: number;
  done: boolean;
  userPrompt: string;
  artifactDir: string;
}

interface WorkflowFooter {
  statusKey: string;
  label: string;
  step: number;
  totalSteps: number;
  phase: Phase;
  visible: boolean; // false when inactive → adapter clears status
}

/** Persistable snapshot for session resume. */
interface WorkflowSnapshot {
  active: boolean;
  phase: Phase;
  userPrompt: string;
  artifactDir: string;
  autoArmed: boolean;
}

/** Injected dependencies — the I/O seams. All async, all substitutable. */
interface WorkflowDeps {
  /** Check whether a file exists relative to the artifact directory.
   *  Called as: artifactExists(artifactDir, filename) → boolean. */
  artifactExists: (artifactDir: string, filename: string) => Promise<boolean>;
  /** Check whether a phase should be skipped. Called only for phases whose
   *  descriptor has `skip.skippable === true`. Returns the skip target
   *  (next non-skipped phase) or null if no skip applies.
   *  The adapter implements this using git, environment, or any other signal. */
  shouldSkip: (
    phase: Phase,
    snapshot: WorkflowSnapshot,
  ) => Promise<Phase | null>;
}

/** Full mode configuration. */
interface WorkflowConfig {
  mode: string;
  phases: PhaseDescriptor[];
  terminal: TerminalGate;
  // pi-facing metadata (used by the adapter, not the state machine)
  statusKey: string;
  entryType: string;
  footerLabel: string;
  commandName: string;
  commandDescription: string;
  toolNames: { start: string; next: string; end: string };
  toolLabels: { start: string; next: string; end: string };
  debugTag: string;
}

// ─── Outcome types ───

type BeginOutcome =
  | { status: "started"; phase: Phase; prompt: string; entry: WorkflowEntry; footer: WorkflowFooter }
  | { status: "already_active"; phase: Phase; entry: WorkflowEntry };

type AdvanceOutcome =
  | { status: "advanced"; phase: Phase; prompt: string; skipped?: Phase; entry: WorkflowEntry; footer: WorkflowFooter }
  | { status: "blocked"; phase: Phase; missing: string }
  | { status: "terminal"; phase: Phase; missing?: string; entry: WorkflowEntry; footer: WorkflowFooter }
  | { status: "idle"; phase: Phase };

type EndOutcome =
  | { status: "closed"; phase: Phase; artifactDir: string; entry: WorkflowEntry; footer: WorkflowFooter }
  | { status: "blocked"; phase: Phase; missing: string[]; entry: WorkflowEntry }
  | { status: "not_active" }
  | { status: "wrong_phase"; phase: Phase };

// ─── The state machine class ───

class WorkflowStateMachine {
  constructor(config: WorkflowConfig);

  /** Start a new workflow. Fails if one is already active. */
  begin(goal: string, deps: WorkflowDeps): Promise<BeginOutcome>;

  /** Advance one phase. Checks artifact gate, skip rules, and terminal gate.
   *  Does NOT mutate state if blocked or idle. */
  advance(deps: WorkflowDeps): Promise<AdvanceOutcome>;

  /** Close the workflow. Only succeeds from the terminal phase with all
   *  required artifacts present. */
  end(deps: WorkflowDeps): Promise<EndOutcome>;

  /** Restore state from a persisted snapshot (session resume). */
  rehydrate(snapshot: Partial<WorkflowSnapshot>): void;

  /** Current state for inspection / footer refresh. */
  get snapshot(): WorkflowSnapshot;

  /** Get the prompt for the current phase (for /command continue). */
  get currentPrompt(): string;

  /** Record the current workflow as done (for /command close-and-restart). */
  markDone(): WorkflowEntry;
}
```

**Justification for each entry point:**

- **`begin(goal, deps)`** — entry point for `start_*` tool and `/<command>`. Needs deps because it must create the artifact directory (though that's the adapter's job — the state machine only computes the path and emits the entry). Actually, `begin` needs deps because the adapter calls it and then does the `mkdir` itself based on the returned `artifactDir`. The state machine is pure: it computes `artifactDir` from the goal (deterministic slug+timestamp), sets `active=true`, emits the entry + footer + first prompt.

- **`advance(deps)`** — the core transition. Needs `artifactExists` to check the current phase's gate, and `shouldSkip` to evaluate skip rules on the next phase. Returns a rich outcome so the adapter can decide how to present it (tool result content, follow-up prompt, terminal close).

- **`end(deps)`** — terminal close. Needs `artifactExists` to verify all `terminal.requiredArtifacts`. Returns `blocked` with the list of missing files so the adapter can format the error message.

- **`rehydrate(snapshot)`** — session resume. Pure state restoration, no I/O.

- **`snapshot` getter** — read-only state for the adapter (footer refresh, command handler decisions).

- **`currentPrompt` getter** — for `/<command>` continue path, which re-sends the current phase prompt without advancing.

- **`markDone()`** — for `/<command>` close-and-restart, which marks the old workflow as done in the entry log before beginning a new one.

---

## 2. Usage Example

### (a) Prototype mode as config

```typescript
// modes/prototype.ts
import type { WorkflowConfig, PhaseDescriptor } from "../engine.ts";

const phases: PhaseDescriptor[] = [
  {
    name: "grilling",
    artifact: "requirements.md",
    prompt: ({ artifactDir, userPrompt }) =>
      `You are entering the GRILLING phase of a prototype workflow.\n\nUser's initial request:\n${userPrompt}\n\n... [full prompt as today] ...`,
  },
  {
    name: "research",
    artifact: "research.md",
    prompt: ({ artifactDir }) =>
      `You are entering the RESEARCH phase. This phase is OPTIONAL.\n\n...`,
  },
  {
    name: "plan",
    artifact: "plan.md",
    prompt: ({ artifactDir }) => `You are entering the PLAN phase.\n\n...`,
  },
  {
    name: "reuse",
    artifact: "reuse.md",
    prompt: ({ artifactDir }) => `You are entering the REUSE phase.\n\n...`,
    skip: { skippable: true, reason: "empty project" },
  },
  {
    name: "handoff",
    artifact: "handoff.md",
    prompt: ({ artifactDir }) => `You are entering the HANDOFF phase.\n\n...`,
  },
  {
    name: "loop",
    artifact: "loop-complete.md",
    prompt: ({ artifactDir }) => `You are entering the LOOP phase.\n\n...`,
  },
  {
    name: "audit",
    artifact: "review.md",
    prompt: ({ artifactDir }) => `You are entering the AUDIT phase.\n\n...`,
  },
];

const config: WorkflowConfig = {
  mode: "prototype",
  phases,
  terminal: {
    phase: "audit",
    requiredArtifacts: ["review.md", "audit.md"],
  },
  statusKey: "prototype",
  entryType: "prototype-phase",
  footerLabel: "prototype",
  commandName: "prototype",
  commandDescription:
    "Run the prototype workflow (grill → research → plan → reuse → handoff → loop → audit)",
  toolNames: { start: "start_workflow", next: "next_step", end: "end_workflow" },
  toolLabels: { start: "Start Workflow", next: "Next Step", end: "End Workflow" },
  debugTag: "[workflow]",
};

export default config;
```

The adapter (in `engine.ts` or a new `adapter.ts`) wraps this:

```typescript
// adapter.ts — the pi-facing glue
import { WorkflowStateMachine } from "./state-machine.ts";
import { access } from "node:fs/promises";
import type { WorkflowConfig, WorkflowDeps } from "./state-machine.ts";

export function createWorkflowExtension(config: WorkflowConfig) {
  return function (pi: ExtensionAPI): void {
    const sm = new WorkflowStateMachine(config);

    const deps: WorkflowDeps = {
      artifactExists: async (dir, file) => {
        try { await access(`${dir}/${file}`); return true; } catch { return false; }
      },
      shouldSkip: async (phase, snapshot) => {
        if (phase === "reuse") {
          try {
            const r = await pi.exec("git", ["log", "--oneline", "-1"]);
            if (r.code !== 0 || !r.stdout.trim()) {
              // skip to the phase after reuse
              const idx = config.phases.findIndex(p => p.name === "reuse");
              return config.phases[idx + 1]?.name ?? null;
            }
          } catch {}
        }
        return null;
      },
    };

    pi.registerTool({
      name: config.toolNames.start,
      // ...
      async execute(_id, params, _sig, _onUpd, ctx) {
        const out = await sm.begin(params.goal, deps);
        if (out.status === "already_active") {
          return { content: [{ type: "text", text: "..." }], details: { phase: out.phase, alreadyActive: true } };
        }
        // adapter does the side effects:
        await mkdir(out.entry.artifactDir, { recursive: true });
        pi.appendEntry(config.entryType, out.entry);
        ctx.ui.setStatus(config.statusKey, formatFooter(out.footer, ctx));
        return { content: [{ type: "text", text: `${config.footerLabel} workflow started. ${out.prompt}` }], details: { phase: out.phase } };
      },
      // ...
    });

    pi.registerTool({
      name: config.toolNames.next,
      async execute(_id, _params, _sig, _onUpd, ctx) {
        const out = await sm.advance(deps);
        // adapter translates outcome → tool result + side effects
        if (out.status === "advanced") {
          pi.appendEntry(config.entryType, out.entry);
          ctx.ui.setStatus(config.statusKey, formatFooter(out.footer, ctx));
          continueWorkflow(pi, ctx, out.prompt);
          return { content: [...], details: { phase: out.phase, skipped: out.skipped } };
        }
        if (out.status === "blocked") {
          return { content: [{ type: "text", text: `...${out.missing}...` }], details: { phase: out.phase, blocked: out.missing } };
        }
        if (out.status === "terminal") {
          if (out.missing) {
            return { content: [...], details: { phase: out.phase, blocked: out.missing } };
          }
          // auto-close
          const endOut = await sm.end(deps);
          if (endOut.status === "closed") {
            pi.appendEntry(config.entryType, endOut.entry);
            ctx.ui.setStatus(config.statusKey, undefined);
            return { content: [...], details: { closed: true }, terminate: true };
          }
        }
        return { content: [...], details: { active: false } };
      },
      // ...
    });

    // session_start, tool_result, /command — all delegate to sm
  };
}
```

### (b) Hypothetical third mode with a NEW phase and custom terminal gate

```typescript
// modes/rigorous.ts — a heavyweight workflow with a spec phase and dual sign-off
import type { WorkflowConfig, PhaseDescriptor } from "../engine.ts";

const phases: PhaseDescriptor[] = [
  {
    name: "grilling",
    artifact: "requirements.md",
    prompt: ({ userPrompt, artifactDir }) => `...`,
  },
  {
    name: "spec",                    // ← NEW phase, not in the Phase union
    artifact: "spec.md",
    prompt: ({ artifactDir }) =>
      `You are entering the SPEC phase. Produce a formal specification...`,
  },
  {
    name: "research",
    artifact: "research.md",
    prompt: ({ artifactDir }) => `...`,
    skip: { skippable: true, reason: "well-understood domain" },
  },
  {
    name: "plan",
    artifact: "plan.md",
    prompt: ({ artifactDir }) => `...`,
  },
  {
    name: "reuse",
    artifact: "reuse.md",
    prompt: ({ artifactDir }) => `...`,
    skip: { skippable: true, reason: "empty project" },
  },
  {
    name: "handoff",
    artifact: "handoff.md",
    prompt: ({ artifactDir }) => `...`,
  },
  {
    name: "loop",
    artifact: "loop-complete.md",
    prompt: ({ artifactDir }) => `...`,
  },
  {
    name: "audit",
    artifact: "review.md",
    prompt: ({ artifactDir }) => `...`,
  },
  {
    name: "sign-off",               // ← NEW terminal phase, not "audit"
    artifact: "acceptance.md",
    prompt: ({ artifactDir }) =>
      `You are entering the SIGN-OFF phase. Present the deliverable for acceptance...`,
  },
];

const config: WorkflowConfig = {
  mode: "rigorous",
  phases,
  terminal: {
    phase: "sign-off",              // ← custom terminal phase
    requiredArtifacts: ["acceptance.md", "sign-off-report.md"],  // ← custom gate
  },
  statusKey: "rigorous",
  entryType: "rigorous-phase",
  footerLabel: "rigorous",
  commandName: "rigorous",
  commandDescription: "Run the rigorous workflow (grill → spec → research → plan → reuse → handoff → loop → audit → sign-off)",
  toolNames: { start: "start_rigorous", next: "next_rigorous_step", end: "end_rigorous" },
  toolLabels: { start: "Start Rigorous", next: "Next Rigorous Step", end: "End Rigorous" },
  debugTag: "[rigorous]",
};

export default config;
```

**Zero engine changes.** The state machine iterates `config.phases`, checks `config.terminal`, and never hardcodes a phase name.

### (c) Test driving the state machine with in-memory stubs

```typescript
// state-machine.test.ts
import { WorkflowStateMachine } from "../extensions/workflow/state-machine.ts";
import type { WorkflowConfig, WorkflowDeps } from "../extensions/workflow/state-machine.ts";

const testConfig: WorkflowConfig = {
  mode: "test",
  phases: [
    { name: "grilling", artifact: "requirements.md", prompt: ({ userPrompt }) => `grill: ${userPrompt}` },
    { name: "plan", artifact: "plan.md", prompt: () => `plan phase` },
    { name: "audit", artifact: "review.md", prompt: () => `audit phase` },
  ],
  terminal: { phase: "audit", requiredArtifacts: ["review.md", "audit.md"] },
  statusKey: "test", entryType: "test-phase", footerLabel: "test",
  commandName: "test", commandDescription: "test",
  toolNames: { start: "start_test", next: "next_test", end: "end_test" },
  toolLabels: { start: "S", next: "N", end: "E" },
  debugTag: "[test]",
};

function makeDeps(artifacts: Set<string>): WorkflowDeps {
  return {
    artifactExists: async (dir, file) => artifacts.has(file),
    shouldSkip: async () => null,  // no skips in this test
  };
}

it("begins at the first phase and emits an entry", async () => {
  const sm = new WorkflowStateMachine(testConfig);
  const out = await sm.begin("build X", makeDeps(new Set()));
  expect(out.status).toBe("started");
  expect(out.phase).toBe("grilling");
  expect(out.prompt).toBe("grill: build X");
  expect(out.entry.phase).toBe("grilling");
  expect(out.entry.step).toBe(1);
  expect(out.footer.step).toBe(1);
  expect(out.footer.totalSteps).toBe(3);
});

it("blocks advance when current artifact is missing", async () => {
  const sm = new WorkflowStateMachine(testConfig);
  await sm.begin("build X", makeDeps(new Set()));
  const out = await sm.advance(makeDeps(new Set()));  // no requirements.md
  expect(out.status).toBe("blocked");
  if (out.status === "blocked") {
    expect(out.missing).toBe("requirements.md");
  }
});

it("advances when artifact exists", async () => {
  const sm = new WorkflowStateMachine(testConfig);
  await sm.begin("build X", makeDeps(new Set()));
  const out = await sm.advance(makeDeps(new Set(["requirements.md"])));
  expect(out.status).toBe("advanced");
  if (out.status === "advanced") {
    expect(out.phase).toBe("plan");
    expect(out.prompt).toBe("plan phase");
    expect(out.entry.step).toBe(2);
  }
});

it("returns terminal when at last phase with missing artifacts", async () => {
  const sm = new WorkflowStateMachine(testConfig);
  await sm.begin("build X", makeDeps(new Set()));
  // advance to plan
  await sm.advance(makeDeps(new Set(["requirements.md"])));
  // advance to audit
  await sm.advance(makeDeps(new Set(["plan.md"])));
  // at audit, no review.md → terminal with missing
  const out = await sm.advance(makeDeps(new Set()));
  expect(out.status).toBe("terminal");
  if (out.status === "terminal") {
    expect(out.missing).toBe("review.md");
  }
});

it("ends successfully when all terminal artifacts exist", async () => {
  const sm = new WorkflowStateMachine(testConfig);
  await sm.begin("build X", makeDeps(new Set()));
  await sm.advance(makeDeps(new Set(["requirements.md"])));
  await sm.advance(makeDeps(new Set(["plan.md"])));
  await sm.advance(makeDeps(new Set()));  // terminal, review.md missing

  const deps = makeDeps(new Set(["review.md", "audit.md"]));
  const out = await sm.end(deps);
  expect(out.status).toBe("closed");
  if (out.status === "closed") {
    expect(out.entry.done).toBe(true);
  }
});

it("skips a phase when shouldSkip returns a target", async () => {
  const configWithSkip: WorkflowConfig = {
    ...testConfig,
    phases: [
      { name: "grilling", artifact: "requirements.md", prompt: () => `grill` },
      { name: "research", artifact: "research.md", prompt: () => `research`, skip: { skippable: true } },
      { name: "plan", artifact: "plan.md", prompt: () => `plan` },
      { name: "audit", artifact: "review.md", prompt: () => `audit` },
    ],
  };
  const sm = new WorkflowStateMachine(configWithSkip);
  await sm.begin("build X", makeDeps(new Set()));

  const deps: WorkflowDeps = {
    artifactExists: async (_d, f) => f === "requirements.md",
    shouldSkip: async (phase) => phase === "research" ? "plan" : null,
  };
  const out = await sm.advance(deps);
  expect(out.status).toBe("advanced");
  if (out.status === "advanced") {
    expect(out.phase).toBe("plan");
    expect(out.skipped).toBe("research");
  }
});

it("rehydrates from snapshot", async () => {
  const sm = new WorkflowStateMachine(testConfig);
  sm.rehydrate({ active: true, phase: "plan", userPrompt: "build X", artifactDir: "/tmp/x", autoArmed: true });
  expect(sm.snapshot.phase).toBe("plan");
  expect(sm.snapshot.active).toBe(true);
});

it("rejects begin when already active", async () => {
  const sm = new WorkflowStateMachine(testConfig);
  await sm.begin("build X", makeDeps(new Set()));
  const out = await sm.begin("build Y", makeDeps(new Set()));
  expect(out.status).toBe("already_active");
});
```

No `FakePi`, no `mkdtempSync`, no `writeFileSync`, no event firing, no `process.chdir`. Pure transition logic tested directly.

---

## 3. Hidden Complexity

**The engine (state machine) owns:**
- Phase ordering and step numbering (derived from `config.phases` array index)
- The advance state machine: artifact gate check → skip evaluation → phase transition → terminal detection
- The terminal gate: verifying all `terminal.requiredArtifacts` exist before `end()` succeeds
- Entry/footer payload construction (pure data — `{ mode, phase, step, done, userPrompt, artifactDir }` and `{ statusKey, label, step, totalSteps, phase, visible }`)
- Artifact directory path computation (deterministic `slugify` + `timestamp`)
- Snapshot management (get/set/rehydrate)
- The `autoArmed` flag and the `advancing` reentrancy guard
- Prompt resolution: looking up `config.phases[i].prompt` and calling it with `{ artifactDir, userPrompt, phase }`
- Skip-chain: if `shouldSkip` returns a target, jump directly there (not just one phase ahead — a mode could skip multiple)

**A mode supplies:**
- The phase list (names, artifacts, prompts, skip declarations) — pure data
- The terminal phase + required artifacts — pure data
- pi-facing metadata (tool names, command name, status key, entry type, labels)

**The adapter supplies:**
- `WorkflowDeps.artifactExists` — wraps `node:fs/promises.access`
- `WorkflowDeps.shouldSkip` — wraps `pi.exec("git", ...)` and returns the skip target phase name
- Tool/command/event registration with pi
- `mkdir` for the artifact directory (using `artifactDir` from the begin outcome)
- `pi.appendEntry` calls (using `entry` from outcomes)
- `ctx.ui.setStatus` calls (using `footer` from outcomes)
- `pi.sendUserMessage` / `deliverAs:"followUp"` (using `prompt` from outcomes)
- `ctx.ui.notify` calls
- `ctx.ui.select` / `ctx.ui.input` for the `/<command>` handler
- Session-start entry scanning → `sm.rehydrate()`
- The `tool_result` event hook → `sm.advance(deps)` + reentrancy guard

**What disappears from the engine:**
- All `import { ... } from "node:fs/promises"` — moved to adapter
- All `import { ... } from "@earendil-works/pi-coding-agent"` — moved to adapter
- All `import { Text } from "@earendil-works/pi-tui"` — moved to adapter
- All `import { Type } from "typebox"` — moved to adapter
- The hardcoded `"reuse"` skip check — replaced by per-phase `skip` config + injected `shouldSkip`
- The hardcoded `"audit"` terminal check — replaced by `config.terminal`
- The hardcoded `review.md` + `audit.md` gate — replaced by `config.terminal.requiredArtifacts`
- The `Phase` closed union — opened to `string`

---

## 4. Dependency Strategy

Per REFERENCE.md:

| Seam | Category | Test strategy |
|------|----------|---------------|
| `artifactExists` | **In-process** (the state machine receives it as a function; tests inject an in-memory `Set<string>`) | Tests pass a `Set` of filenames. No filesystem. |
| `shouldSkip` | **In-process** (same — tests inject a pure function returning a phase name or null) | Tests inject `(phase) => phase === "research" ? "plan" : null`. No git, no `pi.exec`. |
| pi API (tools, commands, events, `appendEntry`, `sendUserMessage`, `setStatus`) | **True external** (the pi framework API) | The adapter is a thin glue layer with one smoke test using the existing `FakePi` harness. The state machine itself never touches pi. |
| `mkdir` for artifact dir | **Local-substitutable** | The adapter calls `mkdir` only in the `begin` tool's execute handler. The state machine computes the path; the adapter creates the directory. Tests of the state machine never touch the filesystem. |

**Old tests to delete:** `prototype.test.ts` and `quick.test.ts` in their current form (FakePi + tmpdir + writeFileSync + event firing). They test the adapter, not the state machine.

**New tests to write:**
- `state-machine.test.ts` — pure transition tests with in-memory stubs (as shown in §2c). ~8–10 tests covering: begin, advance (blocked/advanced/terminal/skipped), end (closed/blocked/wrong_phase/not_active), rehydrate, already-active rejection, concurrent-advance safety.
- `adapter.test.ts` — one smoke test per tool (start/next/end) verifying the adapter correctly translates state-machine outcomes into pi calls. Reuses the existing FakePi pattern but is much thinner — it asserts that `appendEntry` was called with the right payload, `sendUserMessage` was called with the right prompt, etc. No filesystem needed if `artifactExists` is injected.

---

## 5. Trade-offs

**The cost of the rich surface:**

1. **Config size grows.** Each phase is now a `PhaseDescriptor` object with `name`, `artifact`, `prompt`, and optional `skip`. The current `prototype.ts` mode file goes from ~130 lines of config to ~200 because prompts are nested inside phase descriptors rather than in a parallel `prompts` map. This is actually more readable (phase metadata is co-located), but it's more lines.

2. **Two-module split.** The adapter (`adapter.ts`) and the state machine (`state-machine.ts`) are separate files. A developer must understand both to trace a tool call end-to-end. The current engine is one file — you read it top to bottom. The split is justified by testability but adds a navigation hop.

3. **`WorkflowDeps` is a new abstraction.** Two injected functions where there used to be direct `access()` and `pi.exec()` calls. A developer debugging a skip-rule issue must trace through the adapter's `shouldSkip` implementation, not just grep for `"reuse"`. This is the classic indirection cost — it buys testability and extensibility at the price of traceability.

4. **`Phase = string` loses type safety.** A typo in a mode config (`name: "grlling"`) compiles fine. The current closed union catches this at compile time. Mitigation: a `validateConfig(config)` function in the state machine constructor that checks every `terminal.requiredArtifacts` phase exists in `phases`, every `skip.skippable` phase exists, and no duplicate phase names. This is a runtime check, not a compile-time one — strictly worse for typos, strictly better for extensibility.

5. **`shouldSkip` returning a phase name (not just boolean) is a semantic choice.** It means the skip target is determined by the adapter, not the mode config. This gives maximum flexibility (a skip could jump to any phase, not just "next") but it means the mode doesn't fully own its transition graph — the adapter's `shouldSkip` implementation decides where a skip lands. An alternative (returning just `boolean` and letting the engine skip to the next phase) would be simpler but less flexible. This design chooses flexibility, accepting that the adapter and mode must agree on skip targets.

6. **Over-abstraction risk for two modes.** Today there are exactly two modes (prototype, quick) and they differ only in phase list and prompt text. This design adds a state machine class, a deps interface, an adapter, and richer config types — all to support a hypothetical third mode. If no third mode ever materializes, this is gold-plating. The counterargument: the current engine is already 490 lines of fused concerns that require a full FakePi harness to test; the split pays for itself in testability alone, regardless of future modes.

**Where this design is worse than a minimal interface:**

- **Onboarding a new developer who just wants to fix a prompt typo:** They must now understand `PhaseDescriptor.prompt` (a function, not a string), find the mode file, locate the phase, and edit the function body. Today it's a flat `prompts: { grilling: "..." }` map. Marginally more indirection.

- **Debugging a failing transition in production:** The developer must check (a) the state machine's `advance` logic, (b) the adapter's `deps.artifactExists` implementation, (c) the adapter's `deps.shouldSkip` implementation, (d) the mode's phase config. Today it's all in one function (`advancePhase` in `engine.ts`). The split makes the debugging path longer but each step is simpler.

- **Config validation is runtime, not compile-time.** A misconfigured mode (terminal phase not in phase list, duplicate phase names, missing prompt) is only caught when the state machine constructor runs. Today the type system catches most of these (closed `Phase` union, `Partial<Record<Phase, ...>>` indexing). This is the fundamental trade-off of opening `Phase` to `string`.