# Design C — Optimize for the Most Common Caller

## 1. Interface Signature

```typescript
// ─── Phase: open the union ───────────────────────────────────────────
// The closed Phase union blocks new modes from introducing phases the engine
// doesn't know about (e.g. a future "deploy" phase). Open it to `string & {}`
// (branded string) so modes get autocomplete for the known set but can extend
// without modifying engine.ts.

export type Phase = string & {};  // open — known values below for autocomplete
export const KNOWN_PHASES = [
  "grilling", "research", "plan", "reuse",
  "handoff", "loop", "audit",
] as const;
export type KnownPhase = (typeof KNOWN_PHASES)[number];

// ─── Config ──────────────────────────────────────────────────────────

export interface PromptContext {
  artifactDir: string;
  userPrompt: string;
}

export interface SkipRule {
  /** Phase this rule applies to (e.g. "reuse"). */
  phase: Phase;
  /** Predicate the engine calls before entering that phase. */
  shouldSkip: (ctx: PromptContext) => Promise<boolean>;
  /** Phase to jump to when skipping (e.g. "handoff"). */
  jumpTo: Phase;
}

export interface WorkflowConfig {
  mode: string;
  phases: Phase[];
  phaseArtifacts: Partial<Record<Phase, string>>;
  prompts: Partial<Record<Phase, (ctx: PromptContext) => string>>;
  /** Optional skip rules. Replaces the hardcoded reuse+isEmptyProject rule. */
  skipRules?: SkipRule[];
  // ── identity strings the adapter reads ──
  statusKey: string;
  entryType: string;
  footerLabel: string;
  commandName: string;
  commandDescription: string;
  toolNames: { start: string; next: string; end: string };
  toolLabels: { start: string; next: string; end: string };
  debugTag: string;
  /** Base path for artifact directories. Defaults to "./.selesai/artifacts". */
  artifactsBase?: string;
}

// ─── Injected I/O ────────────────────────────────────────────────────

export interface WorkflowDeps {
  /** "Does the artifact file for this phase exist on disk?" */
  artifactExists: (phase: Phase, artifactDir: string) => Promise<boolean>;
  /** "Does a specific named file exist?" (for audit.md which has no phase-artifact entry) */
  fileExists: (path: string) => Promise<boolean>;
  /** "Create the artifact directory." Called once during start(). */
  mkdirArtifactDir: (path: string) => Promise<void>;
  /** Generate the artifact directory path from a goal. Pure but injected so tests can stub. */
  artifactPathFor: (goal: string, base: string) => string;
}

// ─── Persisted entry (the data the adapter writes via pi.appendEntry) ──

export interface WorkflowEntry {
  mode: string;
  phase: Phase;
  step: number;
  done: boolean;
  userPrompt: string;
  artifactDir: string;
}

// ─── Footer snapshot ─────────────────────────────────────────────────

export type FooterState =
  | { visible: true; statusKey: string; text: string }
  | { visible: false; statusKey: string };

// ─── The Effect union ────────────────────────────────────────────────
// Every state-machine method returns ONE Effect. The adapter pattern-matches
// on `effect.kind` and applies side effects. No method returns "raw state"
// that the adapter must interpret — the effect IS the instruction.

export type WorkflowEffect =
  | { kind: "started"; phase: Phase; step: number; prompt: string;
      entry: WorkflowEntry; footer: FooterState;
      toolText: string; toolDetails: Record<string, unknown> }
  | { kind: "alreadyActive"; phase: Phase; step: number;
      toolText: string; toolDetails: Record<string, unknown> }
  | { kind: "advanced"; phase: Phase; step: number; prompt: string;
      skipped?: Phase;
      entry: WorkflowEntry; footer: FooterState;
      toolText: string; toolDetails: Record<string, unknown> }
  | { kind: "blocked"; phase: Phase; missing: string;
      toolText: string; toolDetails: Record<string, unknown> }
  | { kind: "terminalNeedsArtifacts"; phase: Phase; missing: string;
      promptToQueue: string;  // the follow-up message for the agent
      toolText: string; toolDetails: Record<string, unknown> }
  | { kind: "terminalReady"; phase: Phase;
      toolText: string; toolDetails: Record<string, unknown> }
  | { kind: "closed"; phase: Phase; artifactDir: string;
      entry: WorkflowEntry; footer: FooterState;
      toolText: string; toolDetails: Record<string, unknown> }
  | { kind: "endBlocked"; phase: Phase; missing: string;
      toolText: string; toolDetails: Record<string, unknown> }
  | { kind: "idle"; phase: Phase;
      toolText: string; toolDetails: Record<string, unknown> }
  | { kind: "noOp" };  // auto-advance checked, artifact not yet present, nothing to do

// ─── Snapshot for rehydrate ──────────────────────────────────────────

export interface WorkflowSnapshot {
  active: boolean;
  phase: Phase;
  userPrompt: string;
  artifactDir: string;
  autoArmed: boolean;
}

// ─── The state machine ───────────────────────────────────────────────

export class WorkflowStateMachine {
  constructor(config: WorkflowConfig, deps: WorkflowDeps);

  // ── one method per adapter call site ──

  /** start tool / /<command> new workflow. Returns "started" or "alreadyActive". */
  start(goal: string): Promise<WorkflowEffect>;

  /** next_step tool (manual advance). Returns advanced|blocked|terminalNeedsArtifacts|terminalReady|idle. */
  next(): Promise<WorkflowEffect>;

  /** end_workflow tool. Returns "closed" or "endBlocked" or "idle". */
  end(): Promise<WorkflowEffect>;

  /** tool_result auto-advance hook. Returns advanced|terminalNeedsArtifacts|closed|noOp. */
  onArtifactMaybe(): Promise<WorkflowEffect>;

  /** /<command> "continue current workflow". Returns advanced (re-emit current phase prompt) or idle. */
  continueCurrent(): WorkflowEffect;

  /** Close the current workflow without ending (for /<command> "close and start new"). Returns the "closed" entry data. */
  closeCurrent(): WorkflowEntry | null;

  /** session_start: restore from persisted entry. */
  rehydrate(snapshot: WorkflowSnapshot): void;

  /** Read current snapshot (for testing / adapter inspection). */
  get snapshot(): WorkflowSnapshot;

  /** Read current phase prompt (for /<command> continue). */
  currentPrompt(): string;
}
```

## 2. Usage Example

### Pi adapter — `tool_result` hook (one call, one apply)

```typescript
// adapter.ts — the thin pi wiring layer

import { WorkflowStateMachine, type WorkflowEffect } from "../engine.ts";
import { access, mkdir } from "node:fs/promises";

function createDeps(artifactDir: () => string, config): WorkflowDeps {
  return {
    async artifactExists(phase, dir) {
      const file = config.phaseArtifacts[phase];
      if (!file) return true;
      try { await access(`${dir}/${file}`); return true; } catch { return false; }
    },
    async fileExists(path) {
      try { await access(path); return true; } catch { return false; }
    },
    async mkdirArtifactDir(path) {
      await mkdir(path, { recursive: true });
    },
    artifactPathFor(goal, base) {
      return `${base}/${timestamp()}-${slugify(goal)}`;
    },
  };
}

// Inside the extension factory:
const sm = new WorkflowStateMachine(config, deps);

function applyEffect(pi: ExtensionAPI, ctx: ExtensionContext, eff: WorkflowEffect): void {
  switch (eff.kind) {
    case "noOp":
      return;

    case "started":
    case "advanced":
    case "closed":
      // persist entry
      if ("entry" in eff) pi.appendEntry(config.entryType, eff.entry);
      // set footer
      if ("footer" in eff) {
        if (eff.footer.visible) ctx.ui.setStatus(eff.footer.statusKey, eff.footer.text);
        else ctx.ui.setStatus(eff.footer.statusKey, undefined);
      }
      // continue agent with next-phase prompt
      if ("prompt" in eff && eff.prompt) {
        if (ctx.isIdle()) pi.sendUserMessage(eff.prompt);
        else pi.sendUserMessage(eff.prompt, { deliverAs: "followUp" });
      }
      // notify on close
      if (eff.kind === "closed") {
        ctx.ui.notify(`${config.footerLabel} workflow complete. Artifacts: ${eff.artifactDir}`, "info");
      }
      return;

    case "terminalNeedsArtifacts":
      if (eff.promptToQueue) {
        if (ctx.isIdle()) pi.sendUserMessage(eff.promptToQueue);
        else pi.sendUserMessage(eff.promptToQueue, { deliverAs: "followUp" });
      }
      return;

    case "terminalReady":
      // auto-advance terminal: both artifacts present → close directly
      // (the state machine already closed itself; adapter just notifies)
      // Actually: the state machine returns "closed" from onArtifactMaybe
      // when both are present. "terminalReady" is only from next() tool.
      return;

    // alreadyActive, blocked, idle, endBlocked: no side effects beyond the tool result
    default:
      return;
  }
}

// ── tool_result hook ──
pi.on("tool_result", async (event: any, ctx: ExtensionContext) => {
  if (event.toolName !== "write" && event.toolName !== "edit" && event.toolName !== "bash") return;
  const eff = await sm.onArtifactMaybe();
  applyEffect(pi, ctx, eff);
});
```

### Pi adapter — `next_step` tool

```typescript
pi.registerTool({
  name: config.toolNames.next,
  // ...
  async execute(_id, _params, _signal, _onUpdate, ctx) {
    const eff = await sm.next();
    // Apply side effects (footer, entry, continuation) for advanced/terminal
    if (eff.kind === "advanced") applyEffect(pi, ctx, eff);
    // Return tool result
    return {
      content: [{ type: "text", text: eff.toolText }],
      details: eff.toolDetails,
    };
  },
});
```

### Pi adapter — `start` tool

```typescript
pi.registerTool({
  name: config.toolNames.start,
  // ...
  async execute(_id, params, _signal, _onUpdate, ctx) {
    const eff = await sm.start(params.goal);
    if (eff.kind === "started") applyEffect(pi, ctx, eff);
    return {
      content: [{ type: "text", text: eff.toolText }],
      details: eff.toolDetails,
    };
  },
});
```

### Direct test — no fs, no pi, no events

```typescript
import { WorkflowStateMachine } from "../extensions/workflow/engine.ts";

// in-memory stub
function makeDeps(files: Set<string>): WorkflowDeps {
  return {
    async artifactExists(phase, dir) {
      const file = config.phaseArtifacts[phase];
      if (!file) return true;
      return files.has(`${dir}/${file}`);
    },
    async fileExists(path) { return files.has(path); },
    async mkdirArtifactDir(_path) { /* no-op in memory */ },
    artifactPathFor(goal, _base) { return `/fake/${goal}`; },
  };
}

const config: WorkflowConfig = {
  mode: "test",
  phases: ["grilling", "plan", "audit"],
  phaseArtifacts: { grilling: "requirements.md", plan: "plan.md", audit: "review.md" },
  prompts: {
    grilling: ({ artifactDir }) => `grill prompt ${artifactDir}`,
    plan: () => "plan prompt",
    audit: () => "audit prompt",
  },
  // ... identity strings ...
  artifactsBase: "/fake",
};

it("starts at first phase and returns started effect", async () => {
  const files = new Set<string>();
  const sm = new WorkflowStateMachine(config, makeDeps(files));
  const eff = await sm.start("build X");
  expect(eff.kind).toBe("started");
  expect(eff.phase).toBe("grilling");
  expect(eff.step).toBe(1);
  expect(eff.prompt).toMatch(/grill prompt/);
  expect(eff.entry.phase).toBe("grilling");
  expect(eff.entry.done).toBe(false);
  expect(eff.footer.visible).toBe(true);
});

it("auto-advances from grilling to plan when requirements.md lands", async () => {
  const files = new Set<string>();
  const sm = new WorkflowStateMachine(config, makeDeps(files));
  await sm.start("build X");
  const dir = sm.snapshot.artifactDir;

  // artifact not present → noOp
  let eff = await sm.onArtifactMaybe();
  expect(eff.kind).toBe("noOp");

  // artifact lands
  files.add(`${dir}/requirements.md`);
  eff = await sm.onArtifactMaybe();
  expect(eff.kind).toBe("advanced");
  expect(eff.phase).toBe("plan");
  expect(eff.prompt).toBe("plan prompt");
  expect(eff.entry.phase).toBe("plan");
  expect(eff.footer.visible).toBe(true);
});

it("blocks next() when artifact missing", async () => {
  const files = new Set<string>();
  const sm = new WorkflowStateMachine(config, makeDeps(files));
  await sm.start("build X");
  const eff = await sm.next();
  expect(eff.kind).toBe("blocked");
  expect(eff.missing).toBe("requirements.md");
  expect(eff.toolText).toMatch(/requirements\.md/);
});

it("does not double-advance on concurrent onArtifactMaybe calls", async () => {
  const files = new Set<string>();
  const sm = new WorkflowStateMachine(config, makeDeps(files));
  await sm.start("build X");
  const dir = sm.snapshot.artifactDir;
  files.add(`${dir}/requirements.md`);
  const [a, b] = await Promise.all([
    sm.onArtifactMaybe(),
    sm.onArtifactMaybe(),
  ]);
  expect(a.kind).toBe("advanced");
  expect(b.kind).toBe("noOp");
  expect(sm.snapshot.phase).toBe("plan");
});

it("rehydrates from snapshot and resumes correctly", async () => {
  const files = new Set<string>();
  const sm = new WorkflowStateMachine(config, makeDeps(files));
  sm.rehydrate({
    active: true,
    phase: "plan",
    userPrompt: "build X",
    artifactDir: "/fake/build-x",
    autoArmed: true,
  });
  files.add(`/fake/build-x/plan.md`);
  const eff = await sm.onArtifactMaybe();
  expect(eff.kind).toBe("advanced");
  expect(eff.phase).toBe("audit");
});
```

## 3. Hidden Complexity

**What the state machine absorbs so each call site is one call:**

- **Phase ordering + step calculation.** `PHASE_STEP` map built from `config.phases`. The adapter never computes steps or looks up phase indices.
- **Artifact gating.** "Does the current phase's expected artifact exist?" is checked inside `next()` and `onArtifactMaybe()`. The adapter doesn't call `artifactExists` itself — it's injected as a dep, the state machine calls it.
- **Skip rules.** The hardcoded `reuse` + `isEmptyProject` check becomes `config.skipRules[]`. The state machine evaluates them during `advancePhase`. The adapter doesn't know skip rules exist.
- **Auto-advance arm + reentrancy guard.** `autoArmed` and `advancing` live inside the state machine. `onArtifactMaybe()` returns `noOp` when: not active, not armed, artifact not present, or already advancing. The adapter's `tool_result` hook is literally `const eff = await sm.onArtifactMaybe(); applyEffect(pi, ctx, eff);`.
- **Entry construction.** Every transition that needs persistence includes a fully-built `WorkflowEntry` in the effect. The adapter just calls `pi.appendEntry(config.entryType, eff.entry)`.
- **Footer construction.** Every transition includes a `FooterState`. The adapter calls `ctx.ui.setStatus(...)` with the provided values. No string formatting in the adapter.
- **Tool text + tool details.** Every effect carries `toolText` and `toolDetails` — the exact strings and objects the adapter returns from the tool's `execute()`. The adapter doesn't construct error messages or success labels.
- **Terminal logic.** The audit-phase "need both review.md and audit.md" check is inside the state machine. `next()` returns `terminalNeedsArtifacts` (with the missing filename) or `terminalReady`. `onArtifactMaybe()` returns `closed` when both artifacts are present. The adapter doesn't inspect which files are missing.
- **Artifact directory path generation.** `start()` calls `deps.artifactPathFor()` and `deps.mkdirArtifactDir()` internally. The adapter doesn't create directories.

**What the `apply` adapter still owns:**

- **Pi registration.** `pi.registerTool()`, `pi.registerCommand()`, `pi.on()` — wiring the state machine methods to pi's extension surface.
- **Side-effect execution.** `pi.appendEntry()`, `ctx.ui.setStatus()`, `pi.sendUserMessage()` (with the `deliverAs:"followUp"` vs direct logic based on `ctx.isIdle()`), `ctx.ui.notify()`.
- **Tool result shaping.** Wrapping `eff.toolText` and `eff.toolDetails` into the `{ content, details, terminate? }` return shape. The `terminate: true` flag for `end_workflow` is set by the adapter when `eff.kind === "closed"`.
- **`/<command>` UI flow.** The `ctx.ui.select()` / `ctx.ui.input()` interaction for "continue vs close and start new" is adapter-level — it's UI, not state logic. The adapter calls `sm.continueCurrent()` or `sm.closeCurrent()` + `sm.start(goal)` based on the user's choice.
- **`renderResult`.** The TUI rendering (`new Text(theme.fg(...))`) stays in the adapter — it reads `result.details` which the adapter populated from `eff.toolDetails`.

## 4. Dependency Strategy

**Category: In-process (state machine) + local-substitutable (I/O seams).**

The state machine itself is pure in-process logic — phase transitions, step computation, entry/footer construction, auto-advance arming, reentrancy guarding. No fs, no pi, no network.

The two I/O seams are injected via `WorkflowDeps`:

| Seam | Production impl | Test impl |
|---|---|---|
| `artifactExists(phase, dir)` | `access()` against real filesystem | `Set<string>.has()` |
| `fileExists(path)` | `access()` against real filesystem | `Set<string>.has()` |
| `mkdirArtifactDir(path)` | `mkdir(path, { recursive: true })` | no-op |
| `artifactPathFor(goal, base)` | `slugify + timestamp` | returns a deterministic fake path |

The `skipRules` are also injected — each rule carries a `shouldSkip` predicate. In production, the `reuse` skip rule wraps `pi.exec("git", ["log", "--oneline", "-1"])`. In tests, the predicate is `async () => true` or `async () => false`.

**Testing strategy:**

- **Old tests to delete:** Both `prototype.test.ts` and `quick.test.ts` in their current form (FakePi harness + tmpdir + synthetic events + real fs writes). They test the adapter's plumbing, not the state machine's logic. Once the state machine has boundary tests, these become redundant.
- **New boundary tests to write:**
  - `state-machine.test.ts` — tests against `WorkflowStateMachine` directly with in-memory `WorkflowDeps`. Covers: start, auto-advance, manual next, blocked, skip rules, terminal logic, end/close, rehydrate, concurrent onArtifactMaybe. No pi mock, no fs, no events. ~15 focused tests.
  - `adapter.test.ts` — one smoke test per call site: verify the adapter calls the right state-machine method and applies the effect correctly (appends entry, sets footer, sends message with correct `deliverAs`). Uses a minimal FakePi. ~5 tests.
- **Test environment needs:** None beyond vitest. No tmpdir, no `process.chdir`, no real filesystem.

## 5. Trade-offs

**Where the Effect-union approach wins:**

- **Adapter call sites collapse to one call + one switch.** The `tool_result` hook goes from ~30 lines of guard logic + `advancePhase` + branching on 4 outcome statuses + calling `continueWorkflow`/`endWorkflow` → 2 lines. The `next_step` tool goes from ~40 lines of outcome branching → 3 lines.
- **Testability without infrastructure.** The state machine tests need no FakePi, no tmpdir, no event system, no `vi.resetModules()`. They call methods and assert on returned `Effect` values. This is the single biggest win — the current tests take 90 lines of harness setup to verify a phase transition.
- **Exhaustiveness.** The `switch (eff.kind)` in `applyEffect` gets a TypeScript error if a new effect variant is added and not handled. The current `if (out.status === "blocked")` chain has no such guarantee.
- **Skip rules become mode config, not engine logic.** The hardcoded `reuse` + `isEmptyProject` check is the single most mode-specific thing in the engine. Moving it to `config.skipRules[]` means a mode can define skip rules for *any* phase, and the engine has zero knowledge of `reuse` specifically.

**Where it's worse:**

- **Effect set growth.** If the workflow needs new kinds of side effects (e.g. "notify the user mid-phase", "write a file"), the union grows. Each new variant requires updating `applyEffect`'s switch. This is a real cost but bounded — the workflow's side effects are stable (persist entry, set footer, continue agent, notify, terminate). New variants are rare and the exhaustiveness check makes them safe.
- **Verbosity of the Effect type.** The union has 10 variants. Each carries `toolText` + `toolDetails` which are adapter concerns. This is the main coupling risk — the state machine now needs to know what text the tool should return. Mitigation: `toolText` and `toolDetails` are data, not behavior. They're computed from config strings (mode name, tool names, phase name) — the state machine already has all of this. The alternative (adapter constructs messages from raw outcome data) is what exists today and it's *more* code in the adapter, not less.
- **Coupling to adapter concerns.** The state machine returns `toolText` and `toolDetails` — strings and objects the pi tool returns. If the tool return shape changes (e.g. pi adds a new field), the Effect type changes. This is acceptable: the Effect union is *the contract* between the state machine and the adapter. It's supposed to reflect what the adapter needs. The alternative (state machine returns raw transitions, adapter interprets them) is the current code — and it's the reason every call site is 30+ lines.
- **`onArtifactMaybe` returns `noOp` vs `idle`.** `noOp` (active but artifact not present) and `idle` (not active) are both "do nothing" for the adapter. The distinction exists for testability — tests can assert which path was taken. A simpler design would collapse them into one `noOp` variant. Kept separate because the cost is one extra variant and the test clarity is worth it.

**Position on the `Phase` closed union:** Open it to `string & {}`. The closed union is the single biggest barrier to a new mode. The engine doesn't switch on specific phase names anywhere except the `reuse` skip (which becomes a `SkipRule`) and the audit terminal check (which should also be configurable — see below). Opening the union means `KNOWN_PHASES` provides autocomplete but modes can add `"deploy"` or `"stress-test"` without editing `engine.ts`.

**Residual design question (not blocking, flag for parent):** The audit terminal logic (`review.md` + `audit.md` both must exist) is still engine-baked. The cleanest path is to make the terminal phase's required artifacts part of config — e.g. `config.terminalArtifacts: string[]` defaulting to `["review.md", "audit.md"]`. This design doesn't include it because the constraint said "don't widen scope", but it's the natural next step.