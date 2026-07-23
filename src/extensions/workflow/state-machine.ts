// ponytail: pure workflow state machine. No node:fs, no pi API, no pi-tui,
// no typebox. Transitions are pure given two injected predicates
// (artifactExists, shouldSkip). Side effects (appendEntry, setStatus,
// sendUserMessage) are NOT called here — every method returns a domain
// Effect the adapter pattern-matches on and applies. The adapter owns
// all pi/fs wiring; this module owns the phase graph + gating + reentrancy.

export type Phase = string;
// ponytail: Plan 4 — semantic gate predicate. The adapter reads the file and
// hands the content here; the SM stays pure (no fs). ok:false carries a human-
// readable reason the adapter surfaces to the model so a missing marker does
// not look like a silent hang.
export type WorkflowArtifactValidator = (
  content: string,
) => { ok: true } | { ok: false; reason: string };
// ponytail: open union. KNOWN_PHASES gives autocomplete for the current set;
// a mode may introduce new phases (deploy, spec, sign-off) without editing
// this file. The closed union was already a lie — config.phases let modes
// pick subsets — so we stop pretending and validate at runtime instead.
export const KNOWN_PHASES = [
  "grilling",
  "research",
  "plan",
  "reuse",
  "handoff",
  "loop",
  "audit",
] as const;
export type KnownPhase = (typeof KNOWN_PHASES)[number];

export interface PromptContext {
  artifactDir: string;
  userPrompt: string;
  // ponytail: loopMaxIterations is passed through to the loop-phase prompt so
  // the prompt text can state the cap without hardcoding a duplicate number.
  loopMaxIterations?: number;
}

export interface SkipRule {
  phase: Phase;
  // ponytail: boolean predicate — the engine skips to the next phase when true.
  // NOT a phase name the adapter picks; the mode owns its transition graph.
  shouldSkip: (ctx: PromptContext) => Promise<boolean>;
}

export interface WorkflowModeRegistration {
  config: WorkflowConfig;
  commandName: string;
  commandDescription: string;
}

export interface WorkflowConfig {
  mode: string;
  phases: Phase[];
  phaseArtifacts: Partial<Record<Phase, string>>;
  prompts: Partial<Record<Phase, (ctx: PromptContext) => string>>;
  // ponytail: per-phase skip rules. Replaces the hardcoded reuse+isEmptyProject.
  skipRules?: SkipRule[];
  // ponytail: terminal close gate — files that must exist before end() succeeds.
  // Config-owned, no engine default that bakes in "audit"/"review.md".
  closeArtifacts: string[];
  // identity strings the adapter reads (never used inside the state machine
  // for logic — only echoed back in entry/footer payloads for the adapter).
  statusKey: string;
  entryType: string;
  footerLabel: string;
  // ponytail: base path for artifact dirs. Adapter injects a real one; tests
  // inject a fake. The state machine computes the path via deps.artifactPathFor.
  artifactsBase?: string;
  // ponytail: Plan 4 — semantic gates. Per-phase artifact validators.
  // Existence is still required (deps.artifactExists), but for a phase listed
  // here the artifact content must also satisfy its validator. Phases absent
  // from this map stay file-existence-only (grilling/research/reuse).
  artifactValidators?: Partial<Record<Phase, WorkflowArtifactValidator>>;
  // ponytail: Plan 4 — close-artifact validators. Map keyed by closeArtifact
  // filename (e.g. "review.md"). Existence required + validator must pass before
  // the terminal phase can close. closeArtifacts without an entry here stay
  // existence-only.
  closeValidators?: Partial<Record<string, WorkflowArtifactValidator>>;
  // ponytail: Plan 3 — engine-owned loop. Max review rounds before the loop
  // stops and asks the user instead of silently passing. Default 3.
  loopMaxIterations?: number;
  // Most workflows pause at artifact boundaries. A mode can opt into queuing
  // the next phase prompt after the parent writes a valid artifact.
  continueAfterArtifact?: boolean;
}

export interface WorkflowDeps {
  // "Does the artifact file for this phase exist?" — adapter wraps node:fs.
  artifactExists: (phase: Phase, artifactDir: string) => Promise<boolean>;
  // "Does this specific named file exist?" — for closeArtifacts (no phase mapping).
  fileExists: (path: string) => Promise<boolean>;
  // "Create the artifact directory." Called once during start().
  mkdirArtifactDir: (path: string) => Promise<void>;
  // Compute the artifact dir path from a goal. Pure but injected for tests.
  artifactPathFor: (goal: string, base: string) => string;
  // ponytail: Plan 4 — read an artifact for semantic validation. Returns the
  // file content, or undefined if the file does not exist / is unreadable.
  // The adapter wraps node:fs; tests stub it. Only read when a validator is
  // configured for the phase so existence-only phases never pay a read.
  readArtifact: (phase: Phase, artifactDir: string) => Promise<string | undefined>;
  // ponytail: Plan 4 — read a close artifact by absolute path for validation.
  readFile: (path: string) => Promise<string | undefined>;
}

// ── Persisted entry (data the adapter writes via pi.appendEntry) ──

export interface WorkflowEntry {
  mode: string;
  phase: Phase;
  step: number;
  done: boolean;
  userPrompt: string;
  artifactDir: string;
}

export type FooterState =
  | { visible: true; statusKey: string; text: string }
  | { visible: false; statusKey: string };

// ── Effects: domain vocabulary only. No toolText/toolDetails — the adapter
// formats messages from phase/missing/config. Every method returns one Effect;
// the adapter does one switch. Variants are exhaustive so adding one is a
// compile error at every apply site.

export type WorkflowEffect =
  | { kind: "started"; phase: Phase; step: number; prompt: string; entry: WorkflowEntry; footer: FooterState }
  | { kind: "alreadyActive"; phase: Phase; step: number }
  | { kind: "advanced"; phase: Phase; step: number; prompt: string; skipped?: Phase; entry: WorkflowEntry; footer: FooterState }
  | { kind: "blocked"; phase: Phase; missing: string; reason?: string }
  | { kind: "terminalNeedsArtifacts"; phase: Phase; missing: string; promptToQueue: string; reason?: string }
  | { kind: "terminalReady"; phase: Phase }
  | { kind: "closed"; phase: Phase; artifactDir: string; entry: WorkflowEntry; footer: FooterState }
  | { kind: "endBlocked"; phase: Phase; missing: string; reason?: string }
  | { kind: "idle"; phase: Phase }
  | { kind: "noOp" };

export interface WorkflowSnapshot {
  active: boolean;
  phase: Phase;
  userPrompt: string;
  artifactDir: string;
  autoArmed: boolean;
}

function validateConfig(config: WorkflowConfig): void {
  // ponytail: runtime config validation — the only safety we lose by opening
  // Phase to string. Runs once at construction.
  const seen = new Set<Phase>();
  for (const p of config.phases) {
    if (seen.has(p)) throw new Error(`WorkflowConfig: duplicate phase "${p}"`);
    seen.add(p);
  }
  for (const p of Object.keys(config.phaseArtifacts)) {
    if (!seen.has(p)) {
      throw new Error(`WorkflowConfig: phaseArtifacts references unknown phase "${p}"`);
    }
  }
  for (const p of Object.keys(config.prompts)) {
    if (!seen.has(p)) {
      throw new Error(`WorkflowConfig: prompts references unknown phase "${p}"`);
    }
  }
  for (const r of config.skipRules ?? []) {
    if (!seen.has(r.phase)) {
      throw new Error(`WorkflowConfig: skipRule references unknown phase "${r.phase}"`);
    }
  }
  // ponytail: Plan 4 — validator keys must reference real phases / real
  // close artifacts, so a typo in a mode config fails fast at construction.
  for (const p of Object.keys(config.artifactValidators ?? {})) {
    if (!seen.has(p)) {
      throw new Error(`WorkflowConfig: artifactValidators references unknown phase "${p}"`);
    }
  }
  for (const file of Object.keys(config.closeValidators ?? {})) {
    if (!config.closeArtifacts.includes(file)) {
      throw new Error(`WorkflowConfig: closeValidators references unknown closeArtifact "${file}"`);
    }
  }
  if (config.loopMaxIterations !== undefined && config.loopMaxIterations < 1) {
    throw new Error("WorkflowConfig: loopMaxIterations must be >= 1");
  }
}

export class WorkflowStateMachine {
  private readonly config: WorkflowConfig;
  private readonly totalSteps: number;
  private readonly PHASE_STEP: Record<Phase, number>;

  // ponytail: one workflow at a time. State is instance-local, so multiple
  // modes in one process don't collide (the old engine used module-level lets).
  private active = false;
  private phase: Phase;
  private userPrompt = "";
  private artifactDir = "";
  // ponytail: auto-advance arm. Re-armed on every phase change so onArtifactMaybe
  // fires once per phase when the expected artifact lands.
  private autoArmed = false;
  // ponytail: reentrancy guard moved INSIDE the state machine (from Design C).
  // tool_result can fire while an advance is still resolving across async
  // boundaries; a second call in the same turn sees `advancing` and returns noOp.
  private advancing = false;

  constructor(config: WorkflowConfig) {
    validateConfig(config);
    this.config = config;
    this.totalSteps = config.phases.length;
    this.PHASE_STEP = Object.fromEntries(
      config.phases.map((p, i) => [p, i + 1]),
    ) as Record<Phase, number>;
    this.phase = config.phases[0];
  }

  get snapshot(): WorkflowSnapshot {
    return {
      active: this.active,
      phase: this.phase,
      userPrompt: this.userPrompt,
      artifactDir: this.artifactDir,
      autoArmed: this.autoArmed,
    };
  }

  rehydrate(snapshot: WorkflowSnapshot): void {
    this.active = snapshot.active;
    this.phase = snapshot.phase;
    this.userPrompt = snapshot.userPrompt;
    this.artifactDir = snapshot.artifactDir;
    this.autoArmed = snapshot.autoArmed;
    this.advancing = false;
  }

  private promptFor(p: Phase): string {
    const fn = this.config.prompts[p];
    return fn ? fn({ artifactDir: this.artifactDir, userPrompt: this.userPrompt, loopMaxIterations: this.config.loopMaxIterations }) : "";
  }

  private entryFor(p: Phase, done: boolean): WorkflowEntry {
    return {
      mode: this.config.mode,
      phase: p,
      step: this.PHASE_STEP[p],
      done,
      userPrompt: this.userPrompt,
      artifactDir: this.artifactDir,
    };
  }

  private footerFor(): FooterState {
    if (!this.active) {
      return { visible: false, statusKey: this.config.statusKey };
    }
    const step = this.PHASE_STEP[this.phase];
    return {
      visible: true,
      statusKey: this.config.statusKey,
      text: `● ${this.config.footerLabel} · ${step}/${this.totalSteps} ${this.phase}`,
    };
  }

  private nextPhase(p: Phase): Phase | null {
    const i = this.config.phases.indexOf(p);
    if (i < 0 || i >= this.config.phases.length - 1) return null;
    return this.config.phases[i + 1];
  }

  private async artifactSatisfiedFor(
    p: Phase,
    deps: WorkflowDeps,
  ): Promise<{ exists: boolean; reason?: string }> {
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

  // ponytail: Plan 4 — validate a close artifact (existence + optional
  // semantic gate). Returns {exists, reason}. Used by terminal + end().
  private async closeSatisfiedFor(
    file: string,
    deps: WorkflowDeps,
  ): Promise<{ exists: boolean; reason?: string }> {
    const path = `${this.artifactDir}/${file}`;
    if (!(await deps.fileExists(path))) return { exists: false };
    const validator = this.config.closeValidators?.[file];
    if (!validator) return { exists: true };
    const content = await deps.readFile(path);
    if (content === undefined) return { exists: false };
    const res = validator(content);
    if (res.ok) return { exists: true };
    return { exists: true, reason: res.reason };
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.autoArmed = true;
  }

  // ponytail: the core transition. Shared by next() and onArtifactMaybe().
  // Pure given deps. Returns the Effect; does NOT mutate if blocked/idle.
  private async advancePhase(deps: WorkflowDeps, currentPhaseSatisfied = false): Promise<WorkflowEffect> {
    if (!this.active) return { kind: "idle", phase: this.phase };
    if (!currentPhaseSatisfied) {
      const sat = await this.artifactSatisfiedFor(this.phase, deps);
      if (!sat.exists) {
        const missing = this.config.phaseArtifacts[this.phase]!;
        return { kind: "blocked", phase: this.phase, missing };
      }
      if (sat.reason) {
        const missing = this.config.phaseArtifacts[this.phase]!;
        return { kind: "blocked", phase: this.phase, missing, reason: sat.reason };
      }
    }
    const next = this.nextPhase(this.phase);
    if (!next) {
      // ponytail: terminal. Need all closeArtifacts satisfied (existence +
      // optional semantic gate) before end() can close.
      for (const file of this.config.closeArtifacts) {
        const sat = await this.closeSatisfiedFor(file, deps);
        if (!sat.exists) {
          return {
            kind: "terminalNeedsArtifacts",
            phase: this.phase,
            missing: file,
            promptToQueue: `Terminal phase still needs ${this.artifactDir}/${file}. Write it, then call the explicit end workflow tool.`, 
          };
        }
        if (sat.reason) {
          return {
            kind: "terminalNeedsArtifacts",
            phase: this.phase,
            missing: file,
            reason: sat.reason,
            promptToQueue: `Terminal artifact ${this.artifactDir}/${file} is incomplete: ${sat.reason}. Fix it, then call the explicit end workflow tool.`, 
          };
        }
      }
      return { kind: "terminalReady", phase: this.phase };
    }
    // ponytail: skip rule — boolean predicate, engine skips to the next phase.
    // The mode owns the graph; the adapter only supplies the predicate.
    const rule = (this.config.skipRules ?? []).find((r) => r.phase === next);
    if (rule && await rule.shouldSkip({ artifactDir: this.artifactDir, userPrompt: this.userPrompt })) {
      const skipTo = this.nextPhase(next) ?? next;
      this.setPhase(skipTo);
      return {
        kind: "advanced",
        phase: skipTo,
        step: this.PHASE_STEP[skipTo],
        prompt: this.promptFor(skipTo),
        skipped: next,
        entry: this.entryFor(skipTo, false),
        footer: this.footerFor(),
      };
    }
    this.setPhase(next);
    return {
      kind: "advanced",
      phase: next,
      step: this.PHASE_STEP[next],
      prompt: this.promptFor(next),
      entry: this.entryFor(next, false),
      footer: this.footerFor(),
    };
  }

  // ── Public methods: one per adapter call site ──

  async start(goal: string, deps: WorkflowDeps): Promise<WorkflowEffect> {
    if (this.active) {
      return { kind: "alreadyActive", phase: this.phase, step: this.PHASE_STEP[this.phase] };
    }
    this.userPrompt = goal.trim();
    const base = this.config.artifactsBase ?? "./.selesai/artifacts";
    this.artifactDir = deps.artifactPathFor(this.userPrompt, base);
    await deps.mkdirArtifactDir(this.artifactDir);
    this.active = true;
    this.setPhase(this.config.phases[0]);
    const prompt = this.promptFor(this.config.phases[0]);
    return {
      kind: "started",
      phase: this.config.phases[0],
      step: 1,
      prompt,
      entry: this.entryFor(this.config.phases[0], false),
      footer: this.footerFor(),
    };
  }

  async next(deps: WorkflowDeps): Promise<WorkflowEffect> {
    if (!this.active) return { kind: "idle", phase: this.phase };
    return this.advancePhase(deps);
  }

  async end(deps: WorkflowDeps): Promise<WorkflowEffect> {
    if (!this.active) return { kind: "idle", phase: this.phase };
    const last = this.config.phases[this.config.phases.length - 1];
    if (this.phase !== last) {
      return { kind: "endBlocked", phase: this.phase, missing: `not at terminal (${last})` };
    }
    for (const file of this.config.closeArtifacts) {
      const sat = await this.closeSatisfiedFor(file, deps);
      if (!sat.exists) {
        return { kind: "endBlocked", phase: this.phase, missing: file };
      }
      if (sat.reason) {
        return { kind: "endBlocked", phase: this.phase, missing: file, reason: sat.reason };
      }
    }
    this.active = false;
    const entry = this.entryFor(this.phase, true);
    return {
      kind: "closed",
      phase: this.phase,
      artifactDir: this.artifactDir,
      entry,
      footer: this.footerFor(),
    };
  }

  // ponytail: the tool_result auto-advance hook. One call, one apply.
  // Reentrancy guard + autoArmed + artifact gate all live in here — the
  // adapter's hook is `const eff = await sm.onArtifactMaybe(deps); apply(...)`.
  async onArtifactMaybe(deps: WorkflowDeps): Promise<WorkflowEffect> {
    if (this.advancing) return { kind: "noOp" };
    if (!this.active || !this.autoArmed) return { kind: "noOp" };
    const expected = this.config.phaseArtifacts[this.phase];
    if (!expected) return { kind: "noOp" };
    // Acquire synchronously before any await so a concurrent call sees advancing=true.
    this.advancing = true;
    try {
      // ponytail: Plan 4 — distinguish "not yet written" (keep waiting, noOp)
      // from "written but semantically invalid" (block + surface reason so the
      // model learns which marker is missing instead of stalling silently).
      const sat = await this.artifactSatisfiedFor(this.phase, deps);
      if (!sat.exists) return { kind: "noOp" };
      if (sat.reason) {
        // Keep armed: the artifact exists but failed the semantic gate. The
        // next corrected write/subagent result must be able to advance this
        // same phase; disarming here leaves the workflow stuck forever.
        const missing = this.config.phaseArtifacts[this.phase]!;
        return { kind: "blocked", phase: this.phase, missing, reason: sat.reason };
      }
      this.autoArmed = false;
      const out = await this.advancePhase(deps, true);
      if (out.kind === "terminalNeedsArtifacts") {
        // Keep listening: audit/review may land in separate writes.
        this.autoArmed = true;
      }
      return out;
    } finally {
      this.advancing = false;
    }
  }

  // ponytail: /<command> "continue current workflow" — re-emit the current
  // phase prompt without advancing. Fixes Design A's rehydrate regression:
  // no adapter caching; the prompt is recomputed from config on demand.
  continueCurrent(): WorkflowEffect {
    if (!this.active) return { kind: "idle", phase: this.phase };
    return {
      kind: "advanced",
      phase: this.phase,
      step: this.PHASE_STEP[this.phase],
      prompt: this.promptFor(this.phase),
      entry: this.entryFor(this.phase, false),
      footer: this.footerFor(),
    };
  }

  // ponytail: /<command> "close current and start a new one" — mark the old
  // workflow done in the entry log before start() overwrites state.
  closeCurrent(): WorkflowEntry | null {
    if (!this.active) return null;
    const entry = this.entryFor(this.phase, true);
    this.active = false;
    this.autoArmed = false;
    return entry;
  }
}