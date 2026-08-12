import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loopMode } from "../extensions/workflow/modes/loop.ts";

function writeArtifact(dir: string, file: string, content: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), content, "utf8");
}

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

async function scriptedResult(h: Awaited<ReturnType<typeof createHarness>>, id: string, text: string) {
  return h.events.get("tool_result")({
    toolName: "subagent",
    toolCallId: id,
    input: { workflowScript: "return runs.all([{ key: 'r1', agent: 'commentator', task: 'review' }])" },
    content: [{ type: "text", text }],
    isError: false,
  }, h.ctx);
}

async function reachLoop(h: Awaited<ReturnType<typeof createHarness>>): Promise<string> {
  const dir = await start(h);
  writeArtifact(dir, "handoff.md", "handoff\nWORKFLOW_HANDOFF_STATUS: ready");
  await h.tools.get("write_workflow_artifact").execute("wf-handoff", { content: readFileSync(join(dir, "handoff.md"), "utf8") }, undefined, undefined, h.ctx);
  expect(h.entries.at(-1)?.data).toMatchObject({ mode: "loop", phase: "loop" });
  return dir;
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

  it("starts at handoff and asks for recapper", async () => {
    expect(loopMode.config.phases).toEqual(["handoff", "loop"]);
    expect(loopMode.config.phaseArtifacts).toEqual({ handoff: "handoff.md", loop: "loop-complete.md" });
    expect(loopMode.config.closeArtifacts).toEqual(["loop-complete.md"]);

    const h = await createHarness();
    await start(h);
    expect(h.sent.at(-1)?.text).toContain("HANDOFF phase of a LOOP workflow");
    expect(h.sent.at(-1)?.text).toContain('agent: "recapper"');
    expect(h.sent.at(-1)?.text).toContain("WORKFLOW_HANDOFF_STATUS: ready");
    expect(h.sent.at(-1)?.text).toContain("write_workflow_artifact");
  });

  it("recapper result by itself does not advance or create artifact", async () => {
    const h = await createHarness();
    const dir = await start(h);

    const r = await result(h, "recapper", "recap-1", "concise handoff context\nWORKFLOW_HANDOFF_STATUS: ready");
    expect(r).toBeUndefined();
    expect(existsSync(join(dir, "handoff.md"))).toBe(false);
    expect(h.entries.at(-1)?.data).toMatchObject({ mode: "loop", phase: "handoff" });
  });

  it("blocks when handoff marker is missing and advances once valid", async () => {
    const h = await createHarness();
    const dir = await start(h);

    await h.tools.get("write_workflow_artifact").execute("wf-1", { content: "no marker here" }, undefined, undefined, { ...h.ctx });
    expect(h.entries.at(-1)?.data).toMatchObject({ mode: "loop", phase: "handoff" });

    await h.tools.get("write_workflow_artifact").execute("wf-2", { content: "handoff\nWORKFLOW_HANDOFF_STATUS: ready" }, undefined, undefined, { ...h.ctx });
    expect(h.entries.at(-1)?.data).toMatchObject({ mode: "loop", phase: "loop" });
    expect(readFileSync(join(dir, "handoff.md"), "utf8")).toContain("WORKFLOW_HANDOFF_STATUS: ready");
    expect(h.sent.at(-1)?.text).toContain("handoff.md");
  });

  it("persists a clean review, becomes terminal-ready, then explicitly completes", async () => {
    const h = await createHarness();
    const dir = await start(h);
    writeArtifact(dir, "handoff.md", "handoff\nWORKFLOW_HANDOFF_STATUS: ready");
    const tool = h.tools.get("write_workflow_artifact");
    await tool.execute("wf-handoff", { content: readFileSync(join(dir, "handoff.md"), "utf8") }, undefined, undefined, h.ctx);
    expect(h.entries.at(-1)?.data).toMatchObject({ mode: "loop", phase: "loop" });

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

  it("resumes a pending review telling agents to use handoff.md", async () => {
    const h = await createHarness();
    const dir = await start(h);
    writeArtifact(dir, "handoff.md", "handoff\nWORKFLOW_HANDOFF_STATUS: ready");
    await h.tools.get("write_workflow_artifact").execute("wf-handoff", { content: readFileSync(join(dir, "handoff.md"), "utf8") }, undefined, undefined, h.ctx);
    await result(h, "builder", "builder-1", "implemented");
    const runId = JSON.parse(readFileSync(join(dir, "workflow.json"), "utf8")).id;

    const { createWorkflowExtension } = await import("../extensions/workflow/adapter.ts");
    createWorkflowExtension(loopMode.config, loopMode)(h.pi);
    await h.commands.get("workflow-loop").handler(`resume ${runId}`, { ...h.ctx, isIdle: () => true });

    expect(h.sent.at(-1)?.text).toContain("handoff.md");
    expect(h.sent.at(-1)?.text).not.toContain("parent conversation context");
  });

  it("persists blocking feedback and pauses after three blocking rounds", async () => {
    const h = await createHarness();
    const dir = await start(h);
    writeArtifact(dir, "handoff.md", "handoff\nWORKFLOW_HANDOFF_STATUS: ready");
    await h.tools.get("write_workflow_artifact").execute("wf-handoff", { content: readFileSync(join(dir, "handoff.md"), "utf8") }, undefined, undefined, h.ctx);

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

  it("scripted loop review: clean wave writes loop-review + loop-complete and closes via end_workflow", async () => {
    const h = await createHarness();
    const dir = await reachLoop(h);

    const review = await scriptedResult(h, "wave-1", "aggregated: no blockers\nWORKFLOW_REVIEW_STATUS: clean");

    expect(review).toMatchObject({ terminate: true });
    expect(readFileSync(join(dir, "loop-review-1.md"), "utf8")).toContain("WORKFLOW_REVIEW_STATUS: clean");
    expect(readFileSync(join(dir, "loop-complete.md"), "utf8")).toContain("WORKFLOW_LOOP_STATUS: clean");
    expect(h.entries.at(-1)?.data).toMatchObject({ mode: "loop", phase: "loop", done: false });

    const end = await h.tools.get("end_workflow").execute("end", { mode: "loop" }, undefined, undefined, h.ctx);
    expect(end).toMatchObject({ terminate: true });
    expect(JSON.parse(readFileSync(join(dir, "workflow.json"), "utf8"))).toMatchObject({ mode: "loop", phase: "loop", status: "completed" });
  });

  it("scripted loop review: blocking wave persists feedback and advances to the next round", async () => {
    const h = await createHarness();
    const dir = await reachLoop(h);

    await scriptedResult(h, "wave-1", "found issues\nWORKFLOW_REVIEW_STATUS: blocking");
    expect(existsSync(join(dir, "loop-complete.md"))).toBe(false);
    expect(readFileSync(join(dir, "loop-review-1.md"), "utf8")).toContain("WORKFLOW_REVIEW_STATUS: blocking");
    expect(JSON.parse(readFileSync(join(dir, "workflow.json"), "utf8"))).toMatchObject({
      phase: "loop",
      loopState: { reviewRound: 1, maxIterations: 3, stage: "building", reviewPath: "loop-review-1.md" },
    });

    // next round: builder then a clean scripted wave still completes.
    await result(h, "builder", "builder-2", "fixed");
    await scriptedResult(h, "wave-2", "all good\nWORKFLOW_REVIEW_STATUS: clean");
    expect(existsSync(join(dir, "loop-complete.md"))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "workflow.json"), "utf8"))).toMatchObject({ loopState: { reviewRound: 2, stage: "clean" } });
  });

  it("scripted loop review: three blocking waves hit the cap and notify exactly once", async () => {
    const h = await createHarness();
    const dir = await reachLoop(h);

    for (let round = 1; round <= 3; round++) {
      await result(h, "builder", `builder-${round}`, "implemented fixes");
      await scriptedResult(h, `wave-${round}`, `fix this\nWORKFLOW_REVIEW_STATUS: blocking`);
    }

    expect(existsSync(join(dir, "loop-complete.md"))).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, "workflow.json"), "utf8"))).toMatchObject({
      phase: "loop",
      loopState: { reviewRound: 3, maxIterations: 3, stage: "maxed" },
    });
    const maxedNotifies = h.notifies.filter((n) => /max iterations/i.test(n.text) && n.level === "warning");
    expect(maxedNotifies).toHaveLength(1);
  });

  it("scripted loop review: a scripted call batched with another tool call is blocked", async () => {
    const h = await createHarness();
    await reachLoop(h);
    const batch = (ids: string[]) => ({
      getBranch: () => [{ type: "message", message: { role: "assistant", content: ids.map((id) => ({ type: "toolCall", id })) } }],
    });
    const res = await h.events.get("tool_call")(
      {
        toolName: "subagent",
        toolCallId: "wave",
        input: { workflowScript: "return runs.run('r', { agent: 'commentator', task: 'x' })" },
      },
      { ...h.ctx, sessionManager: batch(["wave", "other"]) },
    );
    expect(res).toMatchObject({ block: true });
    expect(res.reason).toMatch(/called alone/i);
  });

  it("scripted loop review with no marker is treated as blocking", async () => {
    const h = await createHarness();
    const dir = await reachLoop(h);
    await scriptedResult(h, "wave-1", "some review text without a status line");
    expect(existsSync(join(dir, "loop-complete.md"))).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, "workflow.json"), "utf8"))).toMatchObject({
      loopState: { reviewRound: 1, stage: "building" },
    });
  });
});
