import { describe, expect, it } from "vitest";
import {
  WorkflowStateMachine,
  type WorkflowConfig,
  type WorkflowDeps,
  type WorkflowEffect,
} from "../extensions/workflow/state-machine.ts";

// ponytail: pure boundary tests — no fs, no pi, no events, no tmpdir.
// Every transition is driven by an in-memory file Set + stub skip predicate.

const baseConfig: WorkflowConfig = {
  mode: "test",
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
  prompts: {
    grilling: ({ userPrompt }) => `grill: ${userPrompt}`,
    research: () => "research phase",
    plan: () => "plan phase",
    reuse: () => "reuse phase",
    handoff: () => "handoff phase",
    loop: () => "loop phase",
    audit: () => "audit phase",
  },
  closeArtifacts: ["review.md"],
  statusKey: "test",
  entryType: "test-phase",
  footerLabel: "test",
  artifactsBase: "/fake",
};

function makeDeps(files: Set<string>, skip: (p: string) => Promise<boolean> = async () => false): WorkflowDeps {
  return {
    async artifactExists(phase, dir) {
      const file = baseConfig.phaseArtifacts[phase];
      if (!file) return true;
      return files.has(`${dir}/${file}`);
    },
    async fileExists(path) {
      return files.has(path);
    },
    async mkdirArtifactDir(_path) {
      /* no-op in memory */
    },
    artifactPathFor(goal, _base) {
      return `/fake/${goal}`;
    },
  };
}

function skipDeps(files: Set<string>, skip: (p: string) => Promise<boolean>): WorkflowDeps {
  return makeDeps(files, skip);
}

describe("WorkflowStateMachine.start", () => {
  it("starts at the first phase and returns started effect with entry + footer", async () => {
    const sm = new WorkflowStateMachine(baseConfig);
    const eff = await sm.start("build X", makeDeps(new Set()));
    expect(eff.kind).toBe("started");
    const e = eff as Extract<WorkflowEffect, { kind: "started" }>;
    expect(e.phase).toBe("grilling");
    expect(e.step).toBe(1);
    expect(e.prompt).toBe("grill: build X");
    expect(e.entry.phase).toBe("grilling");
    expect(e.entry.step).toBe(1);
    expect(e.entry.done).toBe(false);
    expect(e.entry.mode).toBe("test");
    expect(e.footer.visible).toBe(true);
    expect(sm.snapshot.active).toBe(true);
    expect(sm.snapshot.phase).toBe("grilling");
  });

  it("rejects start when already active", async () => {
    const sm = new WorkflowStateMachine(baseConfig);
    await sm.start("build X", makeDeps(new Set()));
    const eff = await sm.start("build Y", makeDeps(new Set()));
    expect(eff.kind).toBe("alreadyActive");
  });
});

describe("WorkflowStateMachine.next (manual advance)", () => {
  it("is blocked when current phase artifact is missing", async () => {
    const sm = new WorkflowStateMachine(baseConfig);
    await sm.start("build X", makeDeps(new Set()));
    const eff = await sm.next(makeDeps(new Set()));
    expect(eff.kind).toBe("blocked");
    const e = eff as Extract<WorkflowEffect, { kind: "blocked" }>;
    expect(e.phase).toBe("grilling");
    expect(e.missing).toBe("requirements.md");
  });

  it("advances to next phase when artifact exists", async () => {
    const files = new Set<string>();
    const sm = new WorkflowStateMachine(baseConfig);
    await sm.start("build X", makeDeps(files));
    const dir = sm.snapshot.artifactDir;
    files.add(`${dir}/requirements.md`);
    const eff = await sm.next(makeDeps(files));
    expect(eff.kind).toBe("advanced");
    const e = eff as Extract<WorkflowEffect, { kind: "advanced" }>;
    expect(e.phase).toBe("research");
    expect(e.prompt).toBe("research phase");
    expect(e.entry.step).toBe(2);
  });

  it("returns idle when not active", async () => {
    const sm = new WorkflowStateMachine(baseConfig);
    const eff = await sm.next(makeDeps(new Set()));
    expect(eff.kind).toBe("idle");
  });
});

describe("WorkflowStateMachine.onArtifactMaybe (auto-advance)", () => {
  it("returns noOp when artifact not yet present", async () => {
    const sm = new WorkflowStateMachine(baseConfig);
    await sm.start("build X", makeDeps(new Set()));
    const eff = await sm.onArtifactMaybe(makeDeps(new Set()));
    expect(eff.kind).toBe("noOp");
  });

  it("advances when the expected artifact lands", async () => {
    const files = new Set<string>();
    const sm = new WorkflowStateMachine(baseConfig);
    await sm.start("build X", makeDeps(files));
    const dir = sm.snapshot.artifactDir;
    files.add(`${dir}/requirements.md`);
    const eff = await sm.onArtifactMaybe(makeDeps(files));
    expect(eff.kind).toBe("advanced");
    const e = eff as Extract<WorkflowEffect, { kind: "advanced" }>;
    expect(e.phase).toBe("research");
  });

  it("does not double-advance on concurrent calls", async () => {
    const files = new Set<string>();
    const sm = new WorkflowStateMachine(baseConfig);
    await sm.start("build X", makeDeps(files));
    const dir = sm.snapshot.artifactDir;
    files.add(`${dir}/requirements.md`);
    const [a, b] = await Promise.all([
      sm.onArtifactMaybe(makeDeps(files)),
      sm.onArtifactMaybe(makeDeps(files)),
    ]);
    expect(a.kind === "advanced" || b.kind === "advanced").toBe(true);
    expect(a.kind === "noOp" || b.kind === "noOp").toBe(true);
    expect(sm.snapshot.phase).toBe("research");
  });

  it("returns noOp when not active", async () => {
    const sm = new WorkflowStateMachine(baseConfig);
    const eff = await sm.onArtifactMaybe(makeDeps(new Set()));
    expect(eff.kind).toBe("noOp");
  });

  it("auto-advance is the single transition driver: each artifact lands → next phase", async () => {
    // ponytail: with the next tool removed, onArtifactMaybe is the only driver.
    // Writing each phase's artifact advances to the next phase, one at a time.
    const files = new Set<string>();
    const sm = new WorkflowStateMachine(baseConfig);
    await sm.start("build X", makeDeps(files));
    const dir = sm.snapshot.artifactDir;
    for (const [phase, file] of [
      ["grilling", "requirements.md"],
      ["research", "research.md"],
      ["plan", "plan.md"],
      ["reuse", "reuse.md"],
      ["handoff", "handoff.md"],
      ["loop", "loop-complete.md"],
    ] as const) {
      expect(sm.snapshot.phase).toBe(phase);
      files.add(`${dir}/${file}`);
      const eff = await sm.onArtifactMaybe(makeDeps(files));
      expect(eff.kind).toBe("advanced");
    }
    expect(sm.snapshot.phase).toBe("audit");
  });
});

describe("WorkflowStateMachine skip rules", () => {
  it("skips reuse and jumps to handoff when shouldSkip is true", async () => {
    const config: WorkflowConfig = {
      ...baseConfig,
      skipRules: [{ phase: "reuse", shouldSkip: async () => true }],
    };
    const files = new Set<string>();
    const sm = new WorkflowStateMachine(config);
    await sm.start("build X", makeDeps(files));
    const dir = sm.snapshot.artifactDir;
    // advance to plan
    files.add(`${dir}/requirements.md`);
    await sm.next(makeDeps(files));
    files.add(`${dir}/research.md`);
    await sm.next(makeDeps(files));
    // at plan, artifact present → advance to reuse → skip → handoff
    files.add(`${dir}/plan.md`);
    const eff = await sm.next(makeDeps(files));
    expect(eff.kind).toBe("advanced");
    const e = eff as Extract<WorkflowEffect, { kind: "advanced" }>;
    expect(e.phase).toBe("handoff");
    expect(e.skipped).toBe("reuse");
  });

  it("does not skip when shouldSkip is false", async () => {
    const config: WorkflowConfig = {
      ...baseConfig,
      skipRules: [{ phase: "reuse", shouldSkip: async () => false }],
    };
    const files = new Set<string>();
    const sm = new WorkflowStateMachine(config);
    await sm.start("build X", makeDeps(files));
    const dir = sm.snapshot.artifactDir;
    files.add(`${dir}/requirements.md`);
    await sm.next(makeDeps(files));
    files.add(`${dir}/research.md`);
    await sm.next(makeDeps(files));
    files.add(`${dir}/plan.md`);
    const eff = await sm.next(makeDeps(files));
    expect(eff.kind).toBe("advanced");
    const e = eff as Extract<WorkflowEffect, { kind: "advanced" }>;
    expect(e.phase).toBe("reuse");
    expect(e.skipped).toBeUndefined();
  });
});

describe("WorkflowStateMachine terminal + end", () => {
  it("returns blocked when review.md is missing at audit", async () => {
    const files = new Set<string>();
    const sm = new WorkflowStateMachine(baseConfig);
    await sm.start("build X", makeDeps(files));
    const dir = sm.snapshot.artifactDir;
    for (const f of ["requirements.md", "research.md", "plan.md", "reuse.md", "handoff.md", "loop-complete.md"]) {
      files.add(`${dir}/${f}`);
      await sm.next(makeDeps(files));
    }
    expect(sm.snapshot.phase).toBe("audit");
    const eff = await sm.next(makeDeps(files));
    expect(eff.kind).toBe("blocked");
    expect((eff as Extract<WorkflowEffect, { kind: "blocked" }>).missing).toBe("review.md");
  });

  it("returns terminalReady when all close artifacts exist", async () => {
    const files = new Set<string>();
    const sm = new WorkflowStateMachine(baseConfig);
    await sm.start("build X", makeDeps(files));
    const dir = sm.snapshot.artifactDir;
    for (const f of ["requirements.md", "research.md", "plan.md", "reuse.md", "handoff.md", "loop-complete.md"]) {
      files.add(`${dir}/${f}`);
      await sm.next(makeDeps(files));
    }
    files.add(`${dir}/review.md`);
    const eff = await sm.next(makeDeps(files));
    expect(eff.kind).toBe("terminalReady");
  });

  it("auto-closes from onArtifactMaybe when both close artifacts are present", async () => {
    const files = new Set<string>();
    const sm = new WorkflowStateMachine(baseConfig);
    await sm.start("build X", makeDeps(files));
    const dir = sm.snapshot.artifactDir;
    for (const f of ["requirements.md", "research.md", "plan.md", "reuse.md", "handoff.md", "loop-complete.md"]) {
      files.add(`${dir}/${f}`);
      await sm.next(makeDeps(files));
    }
    files.add(`${dir}/review.md`);
    const eff = await sm.onArtifactMaybe(makeDeps(files));
    expect(eff.kind).toBe("closed");
    expect(sm.snapshot.active).toBe(false);
  });

  it("end is blocked when not at terminal phase", async () => {
    const sm = new WorkflowStateMachine(baseConfig);
    await sm.start("build X", makeDeps(new Set()));
    const eff = await sm.end(makeDeps(new Set()));
    expect(eff.kind).toBe("endBlocked");
  });

  it("end closes when at terminal and all close artifacts exist", async () => {
    const files = new Set<string>();
    const sm = new WorkflowStateMachine(baseConfig);
    await sm.start("build X", makeDeps(files));
    const dir = sm.snapshot.artifactDir;
    for (const f of ["requirements.md", "research.md", "plan.md", "reuse.md", "handoff.md", "loop-complete.md"]) {
      files.add(`${dir}/${f}`);
      await sm.next(makeDeps(files));
    }
    files.add(`${dir}/review.md`);
    const eff = await sm.end(makeDeps(files));
    expect(eff.kind).toBe("closed");
    const e = eff as Extract<WorkflowEffect, { kind: "closed" }>;
    expect(e.entry.done).toBe(true);
    expect(sm.snapshot.active).toBe(false);
  });

  it("end is blocked when review.md is missing", async () => {
    const files = new Set<string>();
    const sm = new WorkflowStateMachine(baseConfig);
    await sm.start("build X", makeDeps(files));
    const dir = sm.snapshot.artifactDir;
    for (const f of ["requirements.md", "research.md", "plan.md", "reuse.md", "handoff.md", "loop-complete.md"]) {
      files.add(`${dir}/${f}`);
      await sm.next(makeDeps(files));
    }
    const eff = await sm.end(makeDeps(files));
    expect(eff.kind).toBe("endBlocked");
    const e = eff as Extract<WorkflowEffect, { kind: "endBlocked" }>;
    expect(e.missing).toBe("review.md");
  });
});

describe("WorkflowStateMachine rehydrate + continueCurrent + closeCurrent", () => {
  it("rehydrates from a snapshot and resumes transitions", async () => {
    const files = new Set<string>();
    const sm = new WorkflowStateMachine(baseConfig);
    await sm.start("build X", makeDeps(files));
    const snap = sm.snapshot;
    const sm2 = new WorkflowStateMachine(baseConfig);
    sm2.rehydrate(snap);
    expect(sm2.snapshot).toEqual(snap);
    const dir = sm2.snapshot.artifactDir;
    files.add(`${dir}/requirements.md`);
    const eff = await sm2.next(makeDeps(files));
    expect(eff.kind).toBe("advanced");
    const e = eff as Extract<WorkflowEffect, { kind: "advanced" }>;
    expect(e.phase).toBe("research");
  });

  it("continueCurrent re-emits the current phase prompt without advancing", async () => {
    const sm = new WorkflowStateMachine(baseConfig);
    await sm.start("build X", makeDeps(new Set()));
    const eff = sm.continueCurrent();
    expect(eff.kind).toBe("advanced");
    const e = eff as Extract<WorkflowEffect, { kind: "advanced" }>;
    expect(e.phase).toBe("grilling");
    expect(e.prompt).toBe("grill: build X");
    // phase unchanged
    expect(sm.snapshot.phase).toBe("grilling");
  });

  it("continueCurrent returns idle when not active", () => {
    const sm = new WorkflowStateMachine(baseConfig);
    const eff = sm.continueCurrent();
    expect(eff.kind).toBe("idle");
  });

  it("closeCurrent marks the workflow done and returns the entry", async () => {
    const sm = new WorkflowStateMachine(baseConfig);
    await sm.start("build X", makeDeps(new Set()));
    const entry = sm.closeCurrent();
    expect(entry).not.toBeNull();
    expect(entry!.done).toBe(true);
    expect(sm.snapshot.active).toBe(false);
  });

  it("closeCurrent returns null when not active", () => {
    const sm = new WorkflowStateMachine(baseConfig);
    expect(sm.closeCurrent()).toBeNull();
  });
});

describe("WorkflowStateMachine config validation", () => {
  it("rejects duplicate phase names", () => {
    expect(
      () =>
        new WorkflowStateMachine({
          ...baseConfig,
          phases: ["grilling", "grilling", "audit"],
        }),
    ).toThrow(/duplicate phase/);
  });

  it("rejects phaseArtifacts referencing an unknown phase", () => {
    expect(
      () =>
        new WorkflowStateMachine({
          ...baseConfig,
          phases: ["grilling", "audit"],
          phaseArtifacts: { grilling: "requirements.md", bogus: "x.md" },
        }),
    ).toThrow(/unknown phase/);
  });

  it("rejects skipRule referencing an unknown phase", () => {
    expect(
      () =>
        new WorkflowStateMachine({
          ...baseConfig,
          phases: ["grilling", "audit"],
          skipRules: [{ phase: "nope", shouldSkip: async () => true }],
        }),
    ).toThrow(/unknown phase/);
  });
});