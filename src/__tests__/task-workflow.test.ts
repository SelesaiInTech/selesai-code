import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowStateMachine, type WorkflowDeps } from "../extensions/workflow/state-machine.ts";
import { taskMode } from "../extensions/workflow/modes/task.ts";

function makeDeps(files: Set<string>, content = new Map<string, string>()): WorkflowDeps {
  return {
    artifactExists: async (phase, dir) => files.has(`${dir}/${taskMode.config.phaseArtifacts[phase]}`),
    fileExists: async (path) => files.has(path),
    readArtifact: async (phase, dir) => content.get(`${dir}/${taskMode.config.phaseArtifacts[phase]}`),
    readFile: async (path) => content.get(path),
    mkdirArtifactDir: async () => {},
    artifactPathFor: () => "/task-run",
  };
}

async function createHarness() {
  const { __resetWorkflowRegistryForTests, createWorkflowExtension } = await import("../extensions/workflow/adapter.ts");
  __resetWorkflowRegistryForTests();
  const events = new Map<string, (...args: any[]) => any>();
  const eventHandlers = new Map<string, ((...args: any[]) => any)[]>();
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const entries: { customType: string; data: any }[] = [];
  const sent: { text: string; options?: any }[] = [];
  const notifies: { text: string; level: string }[] = [];
  const status = new Map<string, string | undefined>();
  const pi: any = {
    on(name: string, handler: any) {
      events.set(name, handler);
      const handlers = eventHandlers.get(name) ?? [];
      handlers.push(handler);
      eventHandlers.set(name, handlers);
    },
    registerTool(tool: any) { tools.set(tool.name, tool); },
    registerCommand(name: string, command: any) { commands.set(name, command); },
    appendEntry(customType: string, data: any) { entries.push({ customType, data }); },
    sendMessage(message: any, options?: any) { sent.push({ text: message.content, options, message }); },
    exec: async () => ({ code: 0, stdout: "commit\n", stderr: "" }),
  };
  const ctx: any = {
    isIdle: () => false,
    hasUI: false,
    ui: {
      notify(text: string, level: string) { notifies.push({ text, level }); },
      setStatus(key: string, text: string | undefined) { status.set(key, text); },
      theme: { fg: (_color: string, text: string) => text },
    },
  };
  createWorkflowExtension(taskMode.config, taskMode)(pi);
  return { pi, events, eventHandlers, tools, commands, entries, sent, notifies, status, ctx };
}

async function startWorkflow(h: Awaited<ReturnType<typeof createHarness>>, goal = "build X"): Promise<void> {
  await h.commands.get("workflow-task").handler(goal, { ...h.ctx, isIdle: () => true });
  // Start prompt is already being processed in tests that exercise later phases.
  h.sent.length = 0;
}

async function resumeWorkflow(h: Awaited<ReturnType<typeof createHarness>>, run: string): Promise<void> {
  await h.commands.get("workflow-task").handler(`resume ${run}`, { ...h.ctx, isIdle: () => true });
}

describe("task workflow", () => {
  let cwd: string;
  let tmp: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), "task-workflow-"));
    process.chdir(tmp);
  });

  afterEach(async () => {
    const { __resetWorkflowRegistryForTests } = await import("../extensions/workflow/adapter.ts");
    __resetWorkflowRegistryForTests();
    process.chdir(cwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("has four phases (plan, reuse, handoff, loop)", () => {
    expect(taskMode.config.phases).toEqual(["plan", "reuse", "handoff", "loop"]);
    expect(Object.keys(taskMode.config.phaseArtifacts)).toEqual(["plan", "reuse", "handoff", "loop"]);
  });

  it("requires a ready plan, then advances through reuse and handoff before looping", async () => {
    const files = new Set<string>();
    const content = new Map<string, string>();
    const deps = makeDeps(files, content);
    const sm = new WorkflowStateMachine(taskMode.config);

    expect(await sm.start("build X", deps)).toMatchObject({ kind: "started", phase: "plan", step: 1 });
    expect(sm.snapshot.phase).toBe("plan");
    expect((await sm.next(deps)).kind).toBe("blocked");

    files.add("/task-run/plan.md");
    content.set("/task-run/plan.md", "# Plan");
    await expect(sm.next(deps)).resolves.toMatchObject({
      kind: "blocked",
      reason: expect.stringContaining("WORKFLOW_PLAN_STATUS: ready"),
    });

    content.set("/task-run/plan.md", "# Plan\nWORKFLOW_PLAN_STATUS: ready");
    expect(await sm.next(deps)).toMatchObject({ kind: "advanced", phase: "reuse", step: 2 });
    expect(sm.snapshot.phase).toBe("reuse");

    files.add("/task-run/reuse.md");
    content.set("/task-run/reuse.md", "skip");
    expect(await sm.next(deps)).toMatchObject({ kind: "advanced", phase: "handoff", step: 3 });

    files.add("/task-run/handoff.md");
    content.set("/task-run/handoff.md", "# Handoff");
    await expect(sm.next(deps)).resolves.toMatchObject({
      kind: "blocked",
      reason: expect.stringContaining("WORKFLOW_HANDOFF_STATUS: ready"),
    });

    content.set("/task-run/handoff.md", "# Handoff\nWORKFLOW_HANDOFF_STATUS: ready");
    expect(await sm.next(deps)).toMatchObject({ kind: "advanced", phase: "loop", step: 4 });
    expect(await sm.end(deps)).toMatchObject({ kind: "endBlocked" });

    files.add("/task-run/loop-complete.md");
    content.set("/task-run/loop-complete.md", "WORKFLOW_LOOP_STATUS: clean");
    expect(await sm.next(deps)).toMatchObject({ kind: "terminalReady", phase: "loop" });
    expect(await sm.end(deps)).toMatchObject({ kind: "closed", phase: "loop" });
  });

  it("keeps task initiation user-only and suppresses plan/reuse/handoff/build child file output", async () => {
    const h = await createHarness();
    expect(h.tools.has("start_workflow")).toBe(false);
    expect(h.tools.has("resume_workflow")).toBe(false);
    expect(h.tools.has("end_workflow")).toBe(true);
    expect(h.commands.has("workflow-task")).toBe(true);

    await startWorkflow(h, "build X");
    const dir = h.entries.at(-1)!.data.artifactDir;

    const planInput: Record<string, unknown> = { agent: "architect", task: "plan it", output: join(dir, "plan.md") };
    await h.events.get("tool_call")({ toolName: "subagent", input: planInput }, h.ctx);
    expect(planInput.output).toBe(false);
    expect(h.status.get("task")).toContain("1/4 plan");

    await h.tools.get("write_workflow_artifact").execute(
      "write-plan",
      { content: "# Plan\nWORKFLOW_PLAN_STATUS: ready" },
      undefined,
      undefined,
      h.ctx,
    );

    const reuseInput: Record<string, unknown> = { agent: "explorer", task: "explore", output: join(dir, "reuse.md") };
    await h.events.get("tool_call")({ toolName: "subagent", input: reuseInput }, h.ctx);
    expect(reuseInput.output).toBe(false);
    expect(h.status.get("task")).toContain("2/4 reuse");

    await h.tools.get("write_workflow_artifact").execute(
      "write-reuse",
      { content: "skip" },
      undefined,
      undefined,
      h.ctx,
    );

    const handoffInput: Record<string, unknown> = { agent: "recapper", task: "recap", output: join(dir, "handoff.md") };
    await h.events.get("tool_call")({ toolName: "subagent", input: handoffInput }, h.ctx);
    expect(handoffInput.output).toBe(false);
    expect(h.status.get("task")).toContain("3/4 handoff");

    await h.tools.get("write_workflow_artifact").execute(
      "write-handoff",
      { content: "# Handoff\nWORKFLOW_HANDOFF_STATUS: ready" },
      undefined,
      undefined,
      h.ctx,
    );

    const builderInput: Record<string, unknown> = { agent: "builder", task: "build it", output: join(dir, "builder.md") };
    await h.events.get("tool_call")({ toolName: "subagent", input: builderInput }, h.ctx);
    expect(builderInput.output).toBe(false);
    expect(h.status.get("task")).toContain("4/4 loop");
  });

  it("fails closed when transition-capable calls are not proven exclusive", async () => {
    const h = await createHarness();
    await startWorkflow(h, "build X");
    const batch = (ids: string[]) => ({
      getBranch: () => [{ type: "message", message: { role: "assistant", content: ids.map((id) => ({ type: "toolCall", id })) } }],
    });
    const mixed = { ...h.ctx, sessionManager: batch(["writer", "other"]) };
    const blocked = await h.events.get("tool_call")({ toolName: "write_workflow_artifact", toolCallId: "writer", input: {} }, mixed);
    expect(blocked).toMatchObject({ block: true });
    expect(blocked.reason).toMatch(/called alone/i);

    const unknown = await h.events.get("tool_call")({ toolName: "end_workflow", toolCallId: "end", input: { mode: "task" } }, h.ctx);
    expect(unknown).toMatchObject({ block: true });

    const sole = { ...h.ctx, sessionManager: batch(["writer"]) };
    expect(await h.events.get("tool_call")({ toolName: "write_workflow_artifact", toolCallId: "writer", input: {} }, sole)).toBeUndefined();

    await h.tools.get("write_workflow_artifact").execute("plan", { content: "WORKFLOW_PLAN_STATUS: ready" }, undefined, undefined, h.ctx);
    await h.tools.get("write_workflow_artifact").execute("reuse", { content: "skip" }, undefined, undefined, h.ctx);
    await h.tools.get("write_workflow_artifact").execute("handoff", { content: "WORKFLOW_HANDOFF_STATUS: ready" }, undefined, undefined, h.ctx);
    const commentator = await h.events.get("tool_call")(
      { toolName: "subagent", toolCallId: "commentator", input: { agent: "commentator" } },
      { ...h.ctx, sessionManager: batch(["commentator", "other"]) },
    );
    expect(commentator).toMatchObject({ block: true });
  });

  it("reload ignores its stale task handler; explicit task resume reconciles through handoff", async () => {
    const h = await createHarness();
    await startWorkflow(h, "build X");
    const dir = h.entries.at(-1)!.data.artifactDir;
    const statePath = join(dir, "workflow.json");
    writeFileSync(join(dir, "plan.md"), "# Plan\nWORKFLOW_PLAN_STATUS: ready");
    writeFileSync(join(dir, "reuse.md"), "skip");
    writeFileSync(join(dir, "handoff.md"), "# Handoff\nWORKFLOW_HANDOFF_STATUS: ready");

    const { createWorkflowExtension } = await import("../extensions/workflow/adapter.ts");
    createWorkflowExtension(taskMode.config, taskMode)(h.pi);

    await h.eventHandlers.get("tool_result")![0]!({
      toolName: "subagent", toolCallId: "stale", input: { agent: "architect" }, content: [], isError: false,
    }, h.ctx);
    expect(JSON.parse(readFileSync(statePath, "utf8"))).toMatchObject({ phase: "plan", status: "active" });
    expect(h.notifies).toHaveLength(0);

    await resumeWorkflow(h, JSON.parse(readFileSync(statePath, "utf8")).id);
    expect(JSON.parse(readFileSync(statePath, "utf8"))).toMatchObject({ phase: "loop", status: "active" });
    expect(h.sent.at(-1)?.text).toContain("LOOP (orchestration) phase");
  });

  it("queues each next phase as a hidden steer and terminates at artifact boundaries", async () => {
    const h = await createHarness();
    await startWorkflow(h, "build X");

    let result = await h.tools.get("write_workflow_artifact").execute(
      "write-plan",
      { content: "# Plan\nWORKFLOW_PLAN_STATUS: ready" },
      undefined,
      undefined,
      h.ctx,
    );
    expect(result.terminate).toBe(true);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ options: { triggerTurn: true, deliverAs: "steer" }, message: { display: false } });
    expect(h.sent[0]?.text).toContain("REUSE phase");

    result = await h.tools.get("write_workflow_artifact").execute(
      "write-reuse",
      { content: "skip" },
      undefined,
      undefined,
      h.ctx,
    );
    expect(result.terminate).toBe(true);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]?.text).toContain("HANDOFF phase");

    result = await h.tools.get("write_workflow_artifact").execute(
      "write-handoff",
      { content: "# Handoff\nWORKFLOW_HANDOFF_STATUS: ready" },
      undefined,
      undefined,
      h.ctx,
    );
    expect(result.terminate).toBe(true);
    expect(h.sent).toHaveLength(3);
    expect(h.sent[2]?.text).toContain("LOOP (orchestration) phase");
  });

  it("requires a valid handoff marker before entering the loop", async () => {
    const h = await createHarness();
    await startWorkflow(h, "build X");
    const dir = h.entries.at(-1)!.data.artifactDir;

    await h.tools.get("write_workflow_artifact").execute(
      "write-plan",
      { content: "# Plan\nWORKFLOW_PLAN_STATUS: ready" },
      undefined,
      undefined,
      h.ctx,
    );
    await h.tools.get("write_workflow_artifact").execute(
      "write-reuse",
      { content: "skip" },
      undefined,
      undefined,
      h.ctx,
    );

    const badHandoff = await h.tools.get("write_workflow_artifact").execute(
      "write-handoff",
      { content: "# Incomplete handoff" },
      undefined,
      undefined,
      h.ctx,
    );
    expect(badHandoff.details.blocked).toBe(true);
    expect(badHandoff.terminate).not.toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "workflow.json"), "utf8")).phase).toBe("handoff");

    const goodHandoff = await h.tools.get("write_workflow_artifact").execute(
      "write-handoff",
      { content: "# Handoff\nWORKFLOW_HANDOFF_STATUS: ready" },
      undefined,
      undefined,
      h.ctx,
    );
    expect(goodHandoff.details.blocked).toBeFalsy();
    expect(JSON.parse(readFileSync(join(dir, "workflow.json"), "utf8")).phase).toBe("loop");
  });

  it("requires the parent to persist architect/explorer/recapper output before entering the loop", async () => {
    const h = await createHarness();
    await startWorkflow(h, "build X");
    const dir = h.entries.at(-1)!.data.artifactDir;

    // Architect result alone does not create plan.md or advance the workflow.
    await h.events.get("tool_result")({
      toolName: "subagent",
      toolCallId: "architect",
      input: { agent: "architect", output: false },
      content: [{ type: "text", text: "# Plan\nWORKFLOW_PLAN_STATUS: ready" }],
      isError: false,
    }, h.ctx);
    expect(h.entries.at(-1)?.data.phase).toBe("plan");
    expect(existsSync(join(dir, "plan.md"))).toBe(false);

    await h.tools.get("write_workflow_artifact").execute(
      "write-plan",
      { content: "# Plan\nWORKFLOW_PLAN_STATUS: ready" },
      undefined,
      undefined,
      h.ctx,
    );
    expect(h.entries.at(-1)?.data.phase).toBe("reuse");
    expect(existsSync(join(dir, "plan.md"))).toBe(true);

    await h.tools.get("write_workflow_artifact").execute(
      "write-reuse",
      { content: "Explored\nno reusable code" },
      undefined,
      undefined,
      h.ctx,
    );
    expect(h.entries.at(-1)?.data.phase).toBe("handoff");
    expect(existsSync(join(dir, "reuse.md"))).toBe(true);

    // Recapper result alone does not create handoff.md or advance the workflow.
    await h.events.get("tool_result")({
      toolName: "subagent",
      toolCallId: "recapper",
      input: { agent: "recapper", output: false },
      content: [{ type: "text", text: "# Handoff\nWORKFLOW_HANDOFF_STATUS: ready" }],
      isError: false,
    }, h.ctx);
    expect(h.entries.at(-1)?.data.phase).toBe("handoff");
    expect(existsSync(join(dir, "handoff.md"))).toBe(false);

    await h.tools.get("write_workflow_artifact").execute(
      "write-handoff",
      { content: "# Handoff\nWORKFLOW_HANDOFF_STATUS: ready" },
      undefined,
      undefined,
      h.ctx,
    );
    expect(h.entries.at(-1)?.data.phase).toBe("loop");
    expect(existsSync(join(dir, "handoff.md"))).toBe(true);
    expect(h.sent.at(-1)?.text).toContain("LOOP (orchestration) phase");

    await h.events.get("tool_result")({
      toolName: "subagent",
      toolCallId: "builder",
      input: { agent: "builder" },
      content: [{ type: "text", text: "implemented" }],
      isError: false,
    }, h.ctx);
    const reviewResult = await h.events.get("tool_result")({
      toolName: "subagent",
      toolCallId: "commentator",
      input: { agent: "commentator" },
      content: [{ type: "text", text: "No blockers\nWORKFLOW_REVIEW_STATUS: clean" }],
      isError: false,
    }, h.ctx);

    expect(reviewResult).toMatchObject({ terminate: true });
    expect(h.sent.at(-1)?.options).toMatchObject({ triggerTurn: true, deliverAs: "steer" });
    expect(h.sent.at(-1)?.message).toMatchObject({ display: false });
    expect(readFileSync(join(dir, "loop-complete.md"), "utf8")).toContain("WORKFLOW_LOOP_STATUS: clean");
    expect(h.entries.at(-1)?.data).toMatchObject({ phase: "loop", done: false });
    const end = await h.tools.get("end_workflow").execute("end", { mode: "task" }, undefined, undefined, h.ctx);
    expect(end.terminate).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "workflow.json"), "utf8"))).toMatchObject({ status: "completed", phase: "loop" });
  });

  it("reads reviewer status from an intercom output artifact", async () => {
    const h = await createHarness();
    await startWorkflow(h, "build X");
    await h.tools.get("write_workflow_artifact").execute("plan", { content: "WORKFLOW_PLAN_STATUS: ready" }, undefined, undefined, h.ctx);
    await h.tools.get("write_workflow_artifact").execute("reuse", { content: "skip" }, undefined, undefined, h.ctx);
    await h.tools.get("write_workflow_artifact").execute("handoff", { content: "WORKFLOW_HANDOFF_STATUS: ready" }, undefined, undefined, h.ctx);
    const outputPath = join(tmp, "commentator-output.md");
    writeFileSync(outputPath, "No blockers\nWORKFLOW_REVIEW_STATUS: clean");

    await h.events.get("tool_result")({
      toolName: "subagent",
      toolCallId: "commentator-intercom",
      input: { agent: "commentator" },
      content: [{ type: "text", text: "Delivered single subagent result via intercom." }],
      details: { results: [{ artifactPaths: { outputPath } }] },
      isError: false,
    }, h.ctx);

    const dir = h.entries.at(-1)!.data.artifactDir;
    expect(readFileSync(join(dir, "loop-complete.md"), "utf8")).toContain("WORKFLOW_LOOP_STATUS: clean");
  });

  it("pauses durably after three blocking reviews", async () => {
    const h = await createHarness();
    await startWorkflow(h, "build X");
    await h.tools.get("write_workflow_artifact").execute(
      "write-plan",
      { content: "WORKFLOW_PLAN_STATUS: ready" },
      undefined,
      undefined,
      h.ctx,
    );
    await h.tools.get("write_workflow_artifact").execute(
      "write-reuse",
      { content: "skip" },
      undefined,
      undefined,
      h.ctx,
    );
    await h.tools.get("write_workflow_artifact").execute(
      "write-handoff",
      { content: "WORKFLOW_HANDOFF_STATUS: ready" },
      undefined,
      undefined,
      h.ctx,
    );
    const dir = h.entries.at(-1)!.data.artifactDir;

    for (let round = 1; round <= 3; round++) {
      await h.events.get("tool_result")({
        toolName: "subagent", toolCallId: `builder-${round}`, input: { agent: "builder" },
        content: [{ type: "text", text: "implemented" }], isError: false,
      }, h.ctx);
      await h.events.get("tool_result")({
        toolName: "subagent", toolCallId: `commentator-${round}`, input: { agent: "commentator" },
        content: [{ type: "text", text: `fix this\nWORKFLOW_REVIEW_STATUS: blocking` }], isError: false,
      }, h.ctx);
    }

    expect(existsSync(join(dir, "loop-review-3.md"))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "workflow.json"), "utf8"))).toMatchObject({
      phase: "loop",
      loopState: { reviewRound: 3, maxIterations: 3, stage: "maxed" },
    });
    expect(h.notifies.at(-1)?.text).toContain("max iterations (3)");

    const { createWorkflowExtension } = await import("../extensions/workflow/adapter.ts");
    createWorkflowExtension(taskMode.config, taskMode)(h.pi);
    await resumeWorkflow(h, JSON.parse(readFileSync(join(dir, "workflow.json"), "utf8")).id);
    expect(h.notifies.some(({ text }) => text.includes("paused after 3/3") && text.includes("loop-review-3.md"))).toBe(true);
  });

  it("rolls back durable state to the pre-reconcile checkpoint when a later reconcile step fails", async () => {
    // Simulate a save failure on the third reconcile persist. Because the
    // adapter re-imports run-state statically, mock it before re-evaluating
    // the adapter module for this test.
    let count = 0;
    vi.doMock("../extensions/workflow/run-state.ts", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../extensions/workflow/run-state.ts")>();
      return {
        ...actual,
        saveWorkflowRun: async (run: any) => {
          count++;
          if (count === 3) throw new Error("disk full");
          return actual.saveWorkflowRun(run);
        },
      };
    });
    vi.resetModules();

    const h = await createHarness();
    await startWorkflow(h, "build X");
    const dir = h.entries.at(-1)!.data.artifactDir;
    const statePath = join(dir, "workflow.json");
    const runId = JSON.parse(readFileSync(statePath, "utf8")).id as string;

    writeFileSync(join(dir, "plan.md"), "# Plan\nWORKFLOW_PLAN_STATUS: ready");
    writeFileSync(join(dir, "reuse.md"), "skip");
    writeFileSync(join(dir, "handoff.md"), "# Handoff\nWORKFLOW_HANDOFF_STATUS: ready");

    // Simulate a crash that left workflow.json at plan before the state caught up.
    writeFileSync(
      statePath,
      JSON.stringify({ ...JSON.parse(readFileSync(statePath, "utf8")), phase: "plan", autoArmed: true }, null, 2),
    );

    // The previous user start command leaves an active controller attached.
    // Detach it so resume can load the run fresh, matching real usage where
    // start and resume are separate parent turns.
    const { __resetWorkflowRegistryForTests, createWorkflowExtension } = await import("../extensions/workflow/adapter.ts");
    __resetWorkflowRegistryForTests();
    createWorkflowExtension(taskMode.config, taskMode)(h.pi);

    await resumeWorkflow(h, runId);
    expect(h.notifies.at(-1)).toMatchObject({ level: "warning", text: expect.stringMatching(/could not be persisted/i) });
    expect(JSON.parse(readFileSync(statePath, "utf8")).phase).toBe("plan");

    vi.doUnmock("../extensions/workflow/run-state.ts");
    vi.resetModules();
    const h2 = await createHarness();

    await resumeWorkflow(h2, runId);
    expect(JSON.parse(readFileSync(statePath, "utf8")).phase).toBe("loop");
  });

  it("scripted subagent call in a non-loop phase is ignored by the engine; parent still writes the artifact", async () => {
    const h = await createHarness();
    await startWorkflow(h, "build X");
    const dir = h.entries.at(-1)!.data.artifactDir;

    await h.events.get("tool_result")({
      toolName: "subagent",
      toolCallId: "scripted-plan",
      input: { workflowScript: "return runs.all([{ key: 'p', agent: 'architect', task: 'plan' }])" },
      content: [{ type: "text", text: "# Plan\nWORKFLOW_PLAN_STATUS: ready" }],
      isError: false,
    }, h.ctx);
    expect(h.entries.at(-1)?.data.phase).toBe("plan");
    expect(existsSync(join(dir, "plan.md"))).toBe(false);

    await h.tools.get("write_workflow_artifact").execute("write-plan", { content: "# Plan\nWORKFLOW_PLAN_STATUS: ready" }, undefined, undefined, h.ctx);
    expect(h.entries.at(-1)?.data.phase).toBe("reuse");
    expect(existsSync(join(dir, "plan.md"))).toBe(true);
  });

  it("clean scripted review wave makes the task loop terminal-ready and end_workflow closes it", async () => {
    const h = await createHarness();
    await startWorkflow(h, "build X");
    await h.tools.get("write_workflow_artifact").execute("write-plan", { content: "WORKFLOW_PLAN_STATUS: ready" }, undefined, undefined, h.ctx);
    await h.tools.get("write_workflow_artifact").execute("write-reuse", { content: "skip" }, undefined, undefined, h.ctx);
    await h.tools.get("write_workflow_artifact").execute("write-handoff", { content: "WORKFLOW_HANDOFF_STATUS: ready" }, undefined, undefined, h.ctx);
    const dir = h.entries.at(-1)!.data.artifactDir;
    expect(h.entries.at(-1)?.data.phase).toBe("loop");

    await h.events.get("tool_result")({
      toolName: "subagent", toolCallId: "builder", input: { agent: "builder" },
      content: [{ type: "text", text: "implemented" }], isError: false,
    }, h.ctx);
    const reviewResult = await h.events.get("tool_result")({
      toolName: "subagent", toolCallId: "scripted-wave",
      input: { workflowScript: "return runs.all([{ key: 'r', agent: 'commentator', task: 'review' }])" },
      content: [{ type: "text", text: "No blockers\nWORKFLOW_REVIEW_STATUS: clean" }], isError: false,
    }, h.ctx);

    expect(reviewResult).toMatchObject({ terminate: true });
    expect(readFileSync(join(dir, "loop-complete.md"), "utf8")).toContain("WORKFLOW_LOOP_STATUS: clean");
    expect(h.entries.at(-1)?.data).toMatchObject({ phase: "loop", done: false });

    const end = await h.tools.get("end_workflow").execute("end", { mode: "task" }, undefined, undefined, h.ctx);
    expect(end.terminate).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "workflow.json"), "utf8"))).toMatchObject({ status: "completed", phase: "loop" });
  });
});
