import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    sendUserMessage(text: string, options?: any) { sent.push({ text, options }); },
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

  it("requires a ready plan, then a clean loop completion before explicit end", async () => {
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
    expect(await sm.next(deps)).toMatchObject({ kind: "advanced", phase: "loop", step: 2 });
    expect(await sm.end(deps)).toMatchObject({ kind: "endBlocked" });

    files.add("/task-run/loop-complete.md");
    content.set("/task-run/loop-complete.md", "WORKFLOW_LOOP_STATUS: clean");
    expect(await sm.next(deps)).toMatchObject({ kind: "terminalReady", phase: "loop" });
    expect(await sm.end(deps)).toMatchObject({ kind: "closed", phase: "loop" });
  });

  it("registers task tools and forces architect output to its plan artifact", async () => {
    const h = await createHarness();
    expect(h.tools.has("start_task_workflow")).toBe(true);
    expect(h.tools.has("resume_task_workflow")).toBe(true);
    expect(h.tools.has("end_task_workflow")).toBe(true);
    expect(h.tools.get("start_task_workflow").description).toContain("plan as the first phase");
    expect(h.commands.has("workflow-task")).toBe(true);

    await h.tools.get("start_task_workflow").execute("start", { goal: "build X" }, undefined, undefined, h.ctx);
    const dir = h.entries.at(-1)!.data.artifactDir;
    const input: Record<string, unknown> = { agent: "architect", task: "plan it" };
    await h.events.get("tool_call")({ toolName: "subagent", input }, h.ctx);
    expect(input.output).toBe(join(dir, "plan.md"));
    expect(h.status.get("task")).toContain("1/2 plan");
  });

  it("reload ignores its stale task handler; explicit task resume reconciles the durable plan", async () => {
    const h = await createHarness();
    await h.tools.get("start_task_workflow").execute("start", { goal: "build X" }, undefined, undefined, h.ctx);
    const dir = h.entries.at(-1)!.data.artifactDir;
    const statePath = join(dir, "workflow.json");
    writeFileSync(join(dir, "plan.md"), "# Plan\nWORKFLOW_PLAN_STATUS: ready");

    const { createWorkflowExtension } = await import("../extensions/workflow/adapter.ts");
    createWorkflowExtension(taskMode.config, taskMode)(h.pi); // same ExtensionAPI after reload

    await h.eventHandlers.get("tool_result")![0]!({
      toolName: "subagent", toolCallId: "stale", input: { agent: "architect" }, content: [], isError: false,
    }, h.ctx);
    expect(JSON.parse(readFileSync(statePath, "utf8"))).toMatchObject({ phase: "plan", status: "active" });
    expect(h.notifies).toHaveLength(0);

    const resumed = await h.tools.get("resume_task_workflow").execute("resume", { run: JSON.parse(readFileSync(statePath, "utf8")).id }, undefined, undefined, h.ctx);
    expect(resumed.details.phase).toBe("loop");
    expect(JSON.parse(readFileSync(statePath, "utf8"))).toMatchObject({ phase: "loop", status: "active" });
  });

  it("falls back to architect text, persists clean loop completion, and closes explicitly", async () => {
    const h = await createHarness();
    await h.tools.get("start_task_workflow").execute("start", { goal: "build X" }, undefined, undefined, h.ctx);
    const dir = h.entries.at(-1)!.data.artifactDir;

    await h.events.get("tool_result")({
      toolName: "subagent",
      toolCallId: "architect",
      input: { agent: "architect" },
      content: [{ type: "text", text: "# Plan\nWORKFLOW_PLAN_STATUS: ready" }],
      isError: false,
    }, h.ctx);
    expect(h.entries.at(-1)?.data.phase).toBe("loop");
    expect(existsSync(join(dir, "plan.md"))).toBe(true);

    await h.events.get("tool_result")({
      toolName: "subagent",
      toolCallId: "builder",
      input: { agent: "builder" },
      content: [{ type: "text", text: "implemented" }],
      isError: false,
    }, h.ctx);
    await h.events.get("tool_result")({
      toolName: "subagent",
      toolCallId: "commentator",
      input: { agent: "commentator" },
      content: [{ type: "text", text: "No blockers\nWORKFLOW_REVIEW_STATUS: clean" }],
      isError: false,
    }, h.ctx);

    expect(readFileSync(join(dir, "loop-complete.md"), "utf8")).toContain("WORKFLOW_LOOP_STATUS: clean");
    expect(h.entries.at(-1)?.data).toMatchObject({ phase: "loop", done: false });
    const end = await h.tools.get("end_task_workflow").execute("end", {}, undefined, undefined, h.ctx);
    expect(end.terminate).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "workflow.json"), "utf8"))).toMatchObject({ status: "completed", phase: "loop" });
  });

  it("pauses durably after three blocking reviews", async () => {
    const h = await createHarness();
    await h.tools.get("start_task_workflow").execute("start", { goal: "build X" }, undefined, undefined, h.ctx);
    await h.events.get("tool_result")({
      toolName: "subagent", toolCallId: "architect", input: { agent: "architect" },
      content: [{ type: "text", text: "WORKFLOW_PLAN_STATUS: ready" }], isError: false,
    }, h.ctx);
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
    const resumed = await h.tools.get("resume_task_workflow").execute("resume", { run: JSON.parse(readFileSync(join(dir, "workflow.json"), "utf8")).id }, undefined, undefined, h.ctx);
    expect(resumed.details.phase).toBe("loop");
    expect(h.notifies.at(-1)?.text).toContain("paused after 3/3");
    expect(h.notifies.at(-1)?.text).toContain("loop-review-3.md");
  });
});
