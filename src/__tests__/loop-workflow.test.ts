import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loopMode } from "../extensions/workflow/modes/loop.ts";

async function createHarness() {
  const { __resetWorkflowRegistryForTests, createWorkflowExtension } = await import("../extensions/workflow/adapter.ts");
  __resetWorkflowRegistryForTests();
  const events = new Map<string, (...args: any[]) => any>();
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const entries: { customType: string; data: any }[] = [];
  const sent: { text: string; options?: any; message?: any }[] = [];
  const notifies: { text: string; level: string }[] = [];
  const pi: any = {
    on(name: string, handler: any) { events.set(name, handler); },
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
      setStatus() {},
      theme: { fg: (_color: string, text: string) => text },
    },
  };
  createWorkflowExtension(loopMode.config, loopMode)(pi);
  return { pi, events, tools, commands, entries, sent, notifies, ctx };
}

async function start(h: Awaited<ReturnType<typeof createHarness>>): Promise<string> {
  await h.commands.get("workflow-loop").handler("implement agreed change", { ...h.ctx, isIdle: () => true });
  return h.entries.at(-1)!.data.artifactDir;
}

async function result(h: Awaited<ReturnType<typeof createHarness>>, agent: string, id: string, text: string) {
  return h.events.get("tool_result")({
    toolName: "subagent",
    toolCallId: id,
    input: { agent },
    content: [{ type: "text", text }],
    isError: false,
  }, h.ctx);
}

describe("loop workflow", () => {
  let cwd: string;
  let tmp: string;

  beforeEach(() => {
    cwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), "loop-workflow-"));
    process.chdir(tmp);
  });

  afterEach(async () => {
    const { __resetWorkflowRegistryForTests } = await import("../extensions/workflow/adapter.ts");
    __resetWorkflowRegistryForTests();
    process.chdir(cwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("is a direct, single-phase workflow", async () => {
    expect(loopMode.config.phases).toEqual(["loop"]);
    expect(loopMode.config.phaseArtifacts).toEqual({ loop: "loop-complete.md" });
    expect(loopMode.config.closeArtifacts).toEqual(["loop-complete.md"]);

    const h = await createHarness();
    await start(h);
    expect(h.sent.at(-1)?.text).toContain("do not grill, research, create a plan, or create a handoff artifact");
    expect(h.sent.at(-1)?.text).toContain("Fresh subagents cannot see this conversation");
  });

  it("persists a clean review, becomes terminal-ready, then explicitly completes", async () => {
    const h = await createHarness();
    const dir = await start(h);

    await result(h, "builder", "builder-1", "implemented; tests passed");
    const review = await result(h, "commentator", "review-1", "validated diff and tests\nWORKFLOW_REVIEW_STATUS: clean");

    expect(review).toMatchObject({ terminate: true });
    expect(readFileSync(join(dir, "loop-review-1.md"), "utf8")).toContain("WORKFLOW_REVIEW_STATUS: clean");
    expect(readFileSync(join(dir, "loop-complete.md"), "utf8")).toContain("WORKFLOW_LOOP_STATUS: clean");
    expect(h.entries.at(-1)?.data).toMatchObject({ mode: "loop", phase: "loop", done: false });

    const end = await h.tools.get("end_workflow").execute("end", { mode: "loop" }, undefined, undefined, h.ctx);
    expect(end).toMatchObject({ terminate: true });
    expect(JSON.parse(readFileSync(join(dir, "workflow.json"), "utf8"))).toMatchObject({ mode: "loop", phase: "loop", status: "completed" });
  });

  it("resumes a pending review using parent context, not a nonexistent plan artifact", async () => {
    const h = await createHarness();
    const dir = await start(h);
    await result(h, "builder", "builder-1", "implemented");
    const runId = JSON.parse(readFileSync(join(dir, "workflow.json"), "utf8")).id;

    const { createWorkflowExtension } = await import("../extensions/workflow/adapter.ts");
    createWorkflowExtension(loopMode.config, loopMode)(h.pi);
    await h.commands.get("workflow-loop").handler(`resume ${runId}`, { ...h.ctx, isIdle: () => true });

    expect(h.sent.at(-1)?.text).toContain("parent conversation context");
    expect(h.sent.at(-1)?.text).not.toContain("plan.md");
  });

  it("persists blocking feedback and pauses after three blocking rounds", async () => {
    const h = await createHarness();
    const dir = await start(h);

    for (let round = 1; round <= 3; round++) {
      await result(h, "builder", `builder-${round}`, "implemented fixes");
      await result(h, "commentator", `review-${round}`, "fix this\nWORKFLOW_REVIEW_STATUS: blocking");
    }

    expect(existsSync(join(dir, "loop-complete.md"))).toBe(false);
    expect(readFileSync(join(dir, "loop-review-3.md"), "utf8")).toContain("WORKFLOW_REVIEW_STATUS: blocking");
    expect(JSON.parse(readFileSync(join(dir, "workflow.json"), "utf8"))).toMatchObject({
      phase: "loop",
      loopState: { reviewRound: 3, maxIterations: 3, stage: "maxed" },
    });
    expect(h.notifies.at(-1)?.text).toContain("max iterations (3)");
  });
});
