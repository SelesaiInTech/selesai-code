import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ponytail: Plan 4 — artifact content helpers. Critical-phase artifacts now
// require a semantic marker; these give every fixture the minimal valid
// content so tests stay focused on their own assertion.
const PLAN_OK = "# Plan\nWORKFLOW_PLAN_STATUS: ready";
const HANDOFF_OK = "# Handoff\nWORKFLOW_HANDOFF_STATUS: ready";
const LOOP_COMPLETE_OK = "# Loop\nWORKFLOW_LOOP_STATUS: clean";
const REVIEW_OK = "# Review\nWORKFLOW_REVIEW_STATUS: clean";
// phase artifact filename -> valid content
const VALID_CONTENT: Record<string, string> = {
	"requirements.md": "# reqs",
	"research.md": "# research",
	"plan.md": PLAN_OK,
	"reuse.md": "# reuse",
	"handoff.md": HANDOFF_OK,
	"loop-complete.md": LOOP_COMPLETE_OK,
	"review.md": REVIEW_OK,
};
function validContent(file: string): string {
	return VALID_CONTENT[file] ?? `# ${file}`;
}

function sentCount(pi: FakePi, needle: string): number {
	return pi.sent.filter((m) => m.text.includes(needle)).length;
}

// ponytail: adapter smoke test — one per call site. Verifies the adapter
// translates WorkflowEffect into pi calls (appendEntry, sendUserMessage,
// setStatus). The transition logic itself is tested in state-machine.test.ts
// with no fs/pi. This is the only test that needs a FakePi + tmpdir.

interface FakePi {
	events: Map<string, (...a: any[]) => any>;
	tools: Map<string, any>;
	commands: Map<string, any>;
	entries: { customType: string; data: any }[];
	sent: { text: string; options?: any }[];
	status: Map<string, string | undefined>;
	notifies: { text: string; level: string }[];
	[key: string]: any;
}

async function createHarness(): Promise<FakePi> {
	const { default: prototypeMode } = await import("../extensions/workflow/modes/prototype.ts");
	const { createWorkflowExtension } = await import("../extensions/workflow/adapter.ts");
	const events = new Map<string, (...a: any[]) => any>();
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const entries: { customType: string; data: any }[] = [];
	const sent: { text: string; options?: any }[] = [];
	const status = new Map<string, string | undefined>();
	const notifies: { text: string; level: string }[] = [];

	const pi: any = {
		on(name: string, h: any) {
			events.set(name, h);
		},
		registerTool(def: any) {
			tools.set(def.name, def);
		},
		registerCommand(name: string, opts: any) {
			commands.set(name, opts);
		},
		appendEntry(customType: string, data: any) {
			entries.push({ customType, data });
		},
		sendUserMessage(text: string, options?: any) {
			sent.push({ text, options });
		},
		async exec(cmd: string, _args: string[]) {
			// git log on empty repo → empty project (reuse skip path).
			return { code: 1, stdout: "", stderr: "" };
		},
	};

	// ponytail: stub setStatus via the ctx.ui passed to handlers; capture here.
	const ctxBase: any = {
		isIdle: () => true,
		ui: {
			notify(text: string, level: string) { notifies.push({ text, level }); },
			setStatus(key: string, text: string | undefined) {
				status.set(key, text);
			},
			select: async () => undefined,
			input: async () => "",
			theme: { fg: (_c: string, t: string) => t },
		},
	};
	pi.__ctxBase = ctxBase;

	createWorkflowExtension(prototypeMode.config, {
		commandName: prototypeMode.commandName,
		commandDescription: prototypeMode.commandDescription,
	})(pi);
	const harness = { events, tools, commands, entries, sent, status, notifies, __ctxBase: ctxBase } as unknown as FakePi;
	return harness;
}

function ctx(harness: FakePi, streaming = false): any {
	return {
		...harness.__ctxBase,
		isIdle: () => !streaming,
	};
}

describe("prototype adapter (pi wiring smoke)", () => {
	let cwd: string;
	let tmp: string;

	beforeEach(() => {
		cwd = process.cwd();
		tmp = mkdtempSync(join(tmpdir(), "adapter-wf-"));
		process.chdir(tmp);
		vi.resetModules();
	});

	afterEach(() => {
		process.chdir(cwd);
		rmSync(tmp, { recursive: true, force: true });
	});

	it("registers shared lifecycle tools + /workflow-prototype command (no aliases or next tool)", async () => {
		const pi = await createHarness();
		expect(pi.tools.has("start_workflow")).toBe(true);
		expect(pi.tools.has("resume_workflow")).toBe(true);
		expect(pi.tools.has("end_workflow")).toBe(true);
		expect(pi.tools.has("start_quick_workflow")).toBe(false);
		expect(pi.tools.has("start_task_workflow")).toBe(false);
		expect(pi.tools.has("next_step")).toBe(false);
		expect(pi.tools.has("write_workflow_artifact")).toBe(true);
		expect(pi.commands.has("workflow-prototype")).toBe(true);
		for (const name of ["start_workflow", "resume_workflow", "end_workflow", "write_workflow_artifact"]) {
			expect(pi.tools.get(name).promptSnippet).toBeUndefined();
			expect(pi.tools.get(name).promptGuidelines).toBeUndefined();
		}
	});

	it("/workflow-prototype help and an empty command explain starts, resume, and explicit completion", async () => {
		const pi = await createHarness();
		for (const args of ["help", ""]) {
			await pi.commands.get("workflow-prototype").handler(args, ctx(pi));
			const help = pi.notifies.at(-1)!;
			expect(help.level).toBe("info");
			expect(help.text).toContain("/workflow-prototype resume");
			expect(help.text).toContain("end_workflow");
		}
	});

	it("start tool writes canonical workflow.json before prompting", async () => {
		const pi = await createHarness();
		const start = pi.tools.get("start_workflow");
		const res = await start.execute("id-1", { mode: "prototype", goal: "build X" }, undefined, undefined, ctx(pi));
		const entry = pi.entries.at(-1)!;
		const statePath = join(entry.data.artifactDir, "workflow.json");
		expect(res.details.phase).toBe("grilling");
		expect(entry.customType).toBe("prototype-phase");
		expect(entry.data.workflowStatePath).toBe(statePath);
		expect(JSON.parse(readFileSync(statePath, "utf8"))).toMatchObject({ version: 1, mode: "prototype", status: "active", phase: "grilling", autoArmed: true });
		expect(typeof res.content[0].text).toBe("string");
		expect(pi.status.get("prototype")).toContain("1/7");
	});

	it("uses unique UUID artifact directories for rapid same-goal starts", async () => {
		const first = await createHarness();
		const second = await createHarness();
		await first.tools.get("start_workflow").execute("one", { mode: "prototype", goal: "same goal" }, undefined, undefined, ctx(first));
		await second.tools.get("start_workflow").execute("two", { mode: "prototype", goal: "same goal" }, undefined, undefined, ctx(second));
		expect(first.entries.at(-1)?.data.artifactDir).not.toBe(second.entries.at(-1)?.data.artifactDir);
	});

	it("persists each artifact-driven phase transition", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id", { mode: "prototype", goal: "build X" }, undefined, undefined, c);
		const statePath = pi.entries.at(-1)!.data.workflowStatePath;
		await pi.tools.get("write_workflow_artifact").execute("write", { content: "# reqs" }, undefined, undefined, c);
		expect(JSON.parse(readFileSync(statePath, "utf8"))).toMatchObject({ phase: "research", autoArmed: true, status: "active" });
	});

	it("explicit resume reconciles an artifact written before its phase save", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id", { mode: "prototype", goal: "build X" }, undefined, undefined, c);
		const entry = pi.entries.at(-1)!;
		writeFileSync(join(entry.data.artifactDir, "requirements.md"), "# reqs");
		const resumedPi = await createHarness();
		const result = await resumedPi.tools.get("resume_workflow").execute("resume", { mode: "prototype", run: entry.data.runId }, undefined, undefined, ctx(resumedPi));
		expect(result.details.phase).toBe("research");
		expect(resumedPi.entries.at(-1)?.data.phase).toBe("research");
	});

	it("resume rejects paths outside the artifact base", async () => {
		const pi = await createHarness();
		const result = await pi.tools.get("resume_workflow").execute("resume", { mode: "prototype", run: "../../outside" }, undefined, undefined, ctx(pi));
		expect(result.details.rejected).toBe(true);
	});

	it("resuming a terminal-ready run prompts explicit end without re-running audit", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id", { mode: "prototype", goal: "build X" }, undefined, undefined, c);
		const entry = pi.entries.at(-1)!;
		const dir = entry.data.artifactDir;
		// Walk to audit through the parent-owned artifact writer.
		for (const f of ["requirements.md", "research.md", "plan.md", "reuse.md", "handoff.md", "loop-complete.md", "review.md"]) {
			await pi.tools.get("write_workflow_artifact").execute(f, { content: validContent(f) }, undefined, undefined, c);
		}
		expect(JSON.parse(readFileSync(entry.data.workflowStatePath, "utf8"))).toMatchObject({ phase: "audit", autoArmed: false, status: "active" });
		const resumed = await createHarness();
		await resumed.tools.get("resume_workflow").execute("resume", { mode: "prototype", run: entry.data.runId }, undefined, undefined, ctx(resumed));
		expect(resumed.sent.at(-1)?.text).toMatch(/terminal-ready.*end_workflow/i);
		expect(resumed.sent.at(-1)?.text).not.toMatch(/You are in the AUDIT phase/);
	});

	it("artifact completion advances state but stops the parent turn at the phase boundary", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { mode: "prototype", goal: "build X" }, undefined, undefined, c);
		const result = await pi.tools.get("write_workflow_artifact").execute("w1", { content: "# reqs" }, undefined, undefined, c);
		expect(pi.entries.at(-1)?.data.phase).toBe("research");
		expect(pi.sent).toHaveLength(0);
		expect(result.terminate).toBe(true);
		expect(result.content[0].text).toMatch(/wait for the user/i);
	});

	it("tool-result of a non-workflow tool does not advance parent-owned phases", async () => {
		const pi = await createHarness();
		const c = ctx(pi, false);
		await pi.tools.get("start_workflow").execute("id-1", { mode: "prototype", goal: "build X" }, undefined, undefined, c);
		const dir = pi.entries.at(-1)!.data.artifactDir;
		writeFileSync(join(dir, "requirements.md"), "# reqs");
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "bash", toolCallId: "artifact", input: {}, content: [], isError: false }, c,
		);
		// Only write_workflow_artifact (not a raw tool_result) drives parent phases.
		expect(pi.entries.at(-1)?.data.phase).toBe("grilling");
		expect(pi.sent).toHaveLength(0);
	});

	it("ignores ordinary tool results while no workflow is active", async () => {
		const pi = await createHarness();
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "ordinary", input: { agent: "explorer" }, content: [], isError: false },
			ctx(pi),
		);
		expect(pi.notifies).toHaveLength(0);
	});

	it("tool_result failure relies on normal tool-result continuation, not a queued follow-up", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true); // streaming
		await pi.tools.get("start_workflow").execute("id-1", { mode: "prototype", goal: "build X" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w1", { content: "# reqs" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w2", { content: "# research" }, undefined, undefined, c);
		expect(pi.entries.at(-1)?.data.phase).toBe("plan");
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "tc-fail", input: { agent: "architect" }, content: [{ type: "text", text: "architect failed" }], isError: true },
			c,
		);
		expect(pi.entries.at(-1)?.data.phase).toBe("plan");
		expect(pi.sent).toHaveLength(0);
	});

	it("quick mode registers under quick tool names and entry type", async () => {
		vi.resetModules();
		const { default: prototypeMode } = await import("../extensions/workflow/modes/prototype.ts");
		const { default: quickMode } = await import("../extensions/workflow/modes/quick.ts");
		const { createWorkflowExtension } = await import("../extensions/workflow/adapter.ts");
		const tools = new Map<string, any>();
		const commands = new Map<string, any>();
		const entries: { customType: string; data: any }[] = [];
		const events = new Map<string, (...a: any[]) => any>();
		const sent: { text: string; options?: any }[] = [];
		const pi: any = {
			on(n: string, h: any) { events.set(n, h); },
			registerTool(d: any) { tools.set(d.name, d); },
			registerCommand(n: string, o: any) { commands.set(n, o); },
			appendEntry(ct: string, d: any) { entries.push({ customType: ct, data: d }); },
			sendUserMessage(t: string, o?: any) { sent.push({ text: t, options: o }); },
			async exec() { return { code: 1, stdout: "", stderr: "" }; },
		};
		createWorkflowExtension(prototypeMode.config, prototypeMode)(pi);
		createWorkflowExtension(quickMode.config, quickMode)(pi);
		expect(tools.has("start_workflow")).toBe(true);
		expect(tools.has("resume_workflow")).toBe(true);
		expect(tools.has("write_workflow_artifact")).toBe(true);
		expect(commands.has("workflow-quick")).toBe(true);
		const c: any = {
			isIdle: () => true,
			ui: { notify() {}, setStatus() {}, theme: { fg: (_c: string, t: string) => t } },
		};
		const res = await tools.get("start_workflow").execute("id", { mode: "quick", goal: "build Q" }, undefined, undefined, c);
		expect(res.details.phase).toBe("grilling");
		expect(entries.at(-1)?.customType).toBe("quick-phase");
		expect(entries.at(-1)?.data.mode).toBe("quick");
	});

	// ── Plan 5: subagent workflow contract tests ──

	it("tool_call forces subagent child output to false during plan phase", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { mode: "prototype", goal: "build X" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w1", { content: "# reqs" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w2", { content: "# research" }, undefined, undefined, c);
		expect(pi.entries.at(-1)?.data.phase).toBe("plan");
		const input: any = { agent: "architect", task: "plan the thing", output: resolve(tmp, "elsewhere", "plan.md") };
		await pi.events.get("tool_call")(
			{ type: "tool_call", toolCallId: "tc1", toolName: "subagent", input },
			c,
		);
		expect(input.output).toBe(false);
	});

	it("tool_call does not force a context default on workflow subagent calls", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { mode: "prototype", goal: "build X" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w1", { content: "# reqs" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w2", { content: "# research" }, undefined, undefined, c);
		const input: any = { agent: "architect", task: "plan" };
		await pi.events.get("tool_call")(
			{ type: "tool_call", toolCallId: "tc1", toolName: "subagent", input },
			c,
		);
		expect(input.context).toBeUndefined();
		expect(input.output).toBe(false);
	});

	it("tool_call respects an explicit caller context and does not override it", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { mode: "prototype", goal: "build X" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w1", { content: "# reqs" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w2", { content: "# research" }, undefined, undefined, c);
		const input: any = { agent: "architect", task: "plan", context: "fork" };
		await pi.events.get("tool_call")(
			{ type: "tool_call", toolCallId: "tc1", toolName: "subagent", input },
			c,
		);
		expect(input.context).toBe("fork");
		expect(input.output).toBe(false);
	});

	it("tool_call allows model override, parallel, and chain calls without blocking", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { mode: "prototype", goal: "build X" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w1", { content: "# reqs" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w2", { content: "# research" }, undefined, undefined, c);

		const modelOverride: any = { agent: "architect", task: "plan", model: "anthropic/claude-opus" };
		let res = await pi.events.get("tool_call")(
			{ type: "tool_call", toolCallId: "tc1", toolName: "subagent", input: modelOverride }, c,
		);
		expect(res).toBeUndefined();
		expect(modelOverride.output).toBe(false);

		const parallel: any = { tasks: [{ agent: "architect", task: "plan" }] };
		res = await pi.events.get("tool_call")(
			{ type: "tool_call", toolCallId: "tc2", toolName: "subagent", input: parallel }, c,
		);
		expect(res).toBeUndefined();
		expect(parallel.tasks[0].output).toBe(false);
	});

	it("tool_call forces subagent child output to false during loop phase", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { mode: "prototype", goal: "build X" }, undefined, undefined, c);
		const dir = pi.entries.at(-1)!.data.artifactDir;
		for (const f of ["requirements.md", "research.md", "plan.md", "reuse.md", "handoff.md"]) {
			await pi.tools.get("write_workflow_artifact").execute(f, { content: validContent(f) }, undefined, undefined, c);
		}
		expect(pi.entries.at(-1)?.data.phase).toBe("loop");
		const input: any = { tasks: [{ agent: "builder", task: "implement" }] };
		const res = await pi.events.get("tool_call")(
			{ type: "tool_call", toolCallId: "tc1", toolName: "subagent", input },
			c,
		);
		expect(res).toBeUndefined();
		expect(input.tasks[0].output).toBe(false);
		expect(input.tasks[0].context).toBeUndefined();
	});

	it("tool_call ignores subagent management actions (list/get/doctor)", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { mode: "prototype", goal: "build X" }, undefined, undefined, c);
		const input: any = { action: "list" };
		const res = await pi.events.get("tool_call")(
			{ type: "tool_call", toolCallId: "tc1", toolName: "subagent", input },
			c,
		);
		expect(res).toBeUndefined();
		expect(input.context).toBeUndefined();
		expect(input.output).toBeUndefined();
	});

	it("tool_call blocks write/edit while workflow is active", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { mode: "prototype", goal: "build X" }, undefined, undefined, c);
		const input: any = { path: "src/main.ts", content: "code" };
		const res = await pi.events.get("tool_call")(
			{ type: "tool_call", toolCallId: "tc1", toolName: "write", input },
			c,
		);
		expect(res.block).toBe(true);
		expect(res.reason).toContain("write_workflow_artifact");
	});

	// ── tool_result regressions ──

	it("invalid artifacts do not queue repair turns automatically", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { mode: "prototype", goal: "build X" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w1", { content: "# reqs" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w2", { content: "# research" }, undefined, undefined, c);
		expect(pi.entries.at(-1)?.data.phase).toBe("plan");
		await pi.tools.get("write_workflow_artifact").execute("w3", { content: "# draft plan" }, undefined, undefined, c);
		expect(sentCount(pi, "WORKFLOW_PLAN_STATUS: ready")).toBe(0);
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "bash", toolCallId: "tc-unrelated-bash", input: { command: "echo hi" }, content: [{ type: "text", text: "ok" }], isError: false },
			c,
		);
		expect(sentCount(pi, "WORKFLOW_PLAN_STATUS: ready")).toBe(0);
	});

	it("unrelated subagent error does not re-queue the current phase prompt", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { mode: "prototype", goal: "build X" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w1", { content: "# reqs" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w2", { content: "# research" }, undefined, undefined, c);
		expect(pi.entries.at(-1)?.data.phase).toBe("plan");
		expect(sentCount(pi, "You are in the PLAN phase")).toBe(0);
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "tc-list", input: { action: "list" }, content: [{ type: "text", text: "list failed" }], isError: true },
			c,
		);
		expect(sentCount(pi, "You are in the PLAN phase")).toBe(0);
	});

	// Parent-owned phases: the parent must call write_workflow_artifact.
	// Subagent text results must not silently write phase artifacts.

	it("subagent text result in plan phase does not write plan.md or advance", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { mode: "prototype", goal: "build X" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w1", { content: "# reqs" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w2", { content: "# research" }, undefined, undefined, c);
		expect(pi.entries.at(-1)?.data.phase).toBe("plan");
		const dir = pi.entries.at(-1)!.data.artifactDir;
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "tc1", input: { agent: "architect" }, content: [{ type: "text", text: PLAN_OK }], isError: false },
			c,
		);
		expect(existsSync(join(dir, "plan.md"))).toBe(false);
		expect(pi.entries.at(-1)?.data.phase).toBe("plan");
	});

	it("subagent text result in audit phase does not write review.md or advance", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { mode: "prototype", goal: "build X" }, undefined, undefined, c);
		const dir = pi.entries.at(-1)!.data.artifactDir;
		for (const f of ["requirements.md", "research.md", "plan.md", "reuse.md", "handoff.md", "loop-complete.md"]) {
			await pi.tools.get("write_workflow_artifact").execute(f, { content: validContent(f) }, undefined, undefined, c);
		}
		expect(pi.entries.at(-1)?.data.phase).toBe("audit");
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "tc1", input: { agent: "commentator" }, content: [{ type: "text", text: REVIEW_OK }], isError: false },
			c,
		);
		expect(existsSync(join(dir, "review.md"))).toBe(false);
		expect(pi.entries.at(-1)?.data.phase).toBe("audit");
	});

	// ── Plan 3: engine-owned loop orchestration ──

	async function walkToLoop(pi: FakePi, c: any): Promise<string> {
		await pi.tools.get("start_workflow").execute("id-1", { mode: "prototype", goal: "build X" }, undefined, undefined, c);
		const dir = pi.entries.at(-1)!.data.artifactDir;
		for (const f of ["requirements.md", "research.md", "plan.md", "reuse.md", "handoff.md"]) {
			await pi.tools.get("write_workflow_artifact").execute(f, { content: validContent(f) }, undefined, undefined, c);
		}
		expect(pi.entries.at(-1)?.data.phase).toBe("loop");
		return dir;
	}

	it("duplicate toolCallId is processed once", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await walkToLoop(pi, c);
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "dup-builder", input: { agent: "builder" }, content: [{ type: "text", text: "done" }], isError: false },
			c,
		);
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "dup-builder", input: { agent: "builder" }, content: [{ type: "text", text: "done again" }], isError: false },
			c,
		);
		expect(sentCount(pi, 'Call the subagent tool now with { agent: "commentator"')).toBe(0);
	});

	it("loop: builder result persists reviewing state without queuing a follow-up", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await walkToLoop(pi, c);
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "tc1", input: { agent: "builder" }, content: [{ type: "text", text: "done" }], isError: false },
			c,
		);
		expect(pi.sent).toHaveLength(0);
		const state = JSON.parse(readFileSync(join((pi.entries.at(-1)?.data.artifactDir)!, "workflow.json"), "utf8"));
		expect(state.loopState).toMatchObject({ reviewRound: 0, stage: "reviewing" });
		const resumed = await createHarness();
		await resumed.tools.get("resume_workflow").execute("resume", { mode: "prototype", run: state.id }, undefined, undefined, ctx(resumed));
		expect(resumed.sent.at(-1)?.text).toMatch(/Resume the loop.*commentator/i);
	});

	it("loop: clean commentator review writes loop-complete.md and advances to audit", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		const dir = await walkToLoop(pi, c);
		// builder round 1
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "tc1", input: { agent: "builder" }, content: [{ type: "text", text: "built" }], isError: false },
			c,
		);
		// commentator clean review
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "tc2", input: { agent: "commentator" }, content: [{ type: "text", text: "Review good.\nWORKFLOW_REVIEW_STATUS: clean" }], isError: false },
			c,
		);
		expect(existsSync(join(dir, "loop-complete.md"))).toBe(true);
		expect(pi.entries.at(-1)?.data.phase).toBe("audit");
	});

	it("loop: blocking commentator review prompts a builder fix round, does not advance", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		const dir = await walkToLoop(pi, c);
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "tc1", input: { agent: "builder" }, content: [{ type: "text", text: "built" }], isError: false },
			c,
		);
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "tc2", input: { agent: "commentator" }, content: [{ type: "text", text: "Issues found.\nWORKFLOW_REVIEW_STATUS: blocking" }], isError: false },
			c,
		);
		expect(existsSync(join(dir, "loop-complete.md"))).toBe(false);
		expect(pi.entries.at(-1)?.data.phase).toBe("loop");
		const state = JSON.parse(readFileSync(join(dir, "workflow.json"), "utf8"));
		expect(state.loopState).toMatchObject({ reviewRound: 1, stage: "building", reviewPath: "loop-review-1.md" });
		expect(readFileSync(join(dir, "loop-review-1.md"), "utf8")).toMatch(/blocking/);
		expect(pi.sent).toHaveLength(0);
		const resumed = await createHarness();
		await resumed.tools.get("resume_workflow").execute("resume", { mode: "prototype", run: state.id }, undefined, undefined, ctx(resumed));
		expect(resumed.sent.at(-1)?.text).toMatch(/loop-review-1\.md/);
	});

	it("loop: max iterations without a clean review notifies and does not advance", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		const dir = await walkToLoop(pi, c);
		const maxIt = 3;
		for (let i = 0; i < maxIt; i++) {
			await pi.events.get("tool_result")(
				{ type: "tool_result", toolName: "subagent", toolCallId: `b${i}`, input: { agent: "builder" }, content: [{ type: "text", text: "built" }], isError: false },
				c,
			);
			await pi.events.get("tool_result")(
				{ type: "tool_result", toolName: "subagent", toolCallId: `r${i}`, input: { agent: "commentator" }, content: [{ type: "text", text: "WORKFLOW_REVIEW_STATUS: blocking" }], isError: false },
				c,
			);
		}
		expect(existsSync(join(dir, "loop-complete.md"))).toBe(false);
		expect(pi.entries.at(-1)?.data.phase).toBe("loop");
		expect(pi.notifies.some((n) => /max iterations/i.test(n.text) && n.level === "warning")).toBe(true);
	});

	it("loop: a clean review on a later round still advances even after earlier blocking rounds", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		const dir = await walkToLoop(pi, c);
		// round 1 blocking
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "b1", input: { agent: "builder" }, content: [{ type: "text", text: "built" }], isError: false },
			c,
		);
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "r1", input: { agent: "commentator" }, content: [{ type: "text", text: "WORKFLOW_REVIEW_STATUS: blocking" }], isError: false },
			c,
		);
		// round 2 clean
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "b2", input: { agent: "builder" }, content: [{ type: "text", text: "fixed" }], isError: false },
			c,
		);
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "r2", input: { agent: "commentator" }, content: [{ type: "text", text: "WORKFLOW_REVIEW_STATUS: clean" }], isError: false },
			c,
		);
		expect(existsSync(join(dir, "loop-complete.md"))).toBe(true);
		expect(pi.entries.at(-1)?.data.phase).toBe("audit");
	});

	// ── Plan 4: semantic gates (adapter surface) ──

	it("write_workflow_artifact surfaces blocked reason when plan.md lacks the marker", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { mode: "prototype", goal: "build X" }, undefined, undefined, c);
		// advance to plan
		await pi.tools.get("write_workflow_artifact").execute("w1", { content: "# reqs" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w2", { content: "# research" }, undefined, undefined, c);
		expect(pi.entries.at(-1)?.data.phase).toBe("plan");
		// write plan.md without the marker → blocked, not advanced
		const res = await pi.tools.get("write_workflow_artifact").execute("w3", { content: "# a plan with no marker" }, undefined, undefined, c);
		expect(res.details.blocked).toBe(true);
		expect(res.details.reason).toMatch(/WORKFLOW_PLAN_STATUS: ready/);
		expect(pi.entries.at(-1)?.data.phase).toBe("plan");
		// The tool result itself surfaces the marker; no autonomous repair turn is queued.
		expect(pi.sent).toHaveLength(0);
	});

	it("write_workflow_artifact can recover after a gated artifact was written without its marker", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { mode: "prototype", goal: "build X" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w1", { content: "# reqs" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w2", { content: "# research" }, undefined, undefined, c);
		expect(pi.entries.at(-1)?.data.phase).toBe("plan");
		expect((await pi.tools.get("write_workflow_artifact").execute("w3", { content: "# invalid" }, undefined, undefined, c)).details.blocked).toBe(true);
		const res = await pi.tools.get("write_workflow_artifact").execute("w4", { content: PLAN_OK }, undefined, undefined, c);
		expect(res.details.blocked).toBeUndefined();
		expect(pi.entries.at(-1)?.data.phase).toBe("handoff");
	});

	it("write_workflow_artifact advances plan when the marker is present", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { mode: "prototype", goal: "build X" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w1", { content: "# reqs" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w2", { content: "# research" }, undefined, undefined, c);
		const res = await pi.tools.get("write_workflow_artifact").execute("w3", { content: PLAN_OK }, undefined, undefined, c);
		expect(res.details.blocked).toBeUndefined();
		// ponytail: the harness's fake git returns code:1 (empty project), so the
		// reuse skip rule fires and plan advances straight to handoff.
		expect(pi.entries.at(-1)?.data.phase).toBe("handoff");
	});

	it("engine-written loop-complete.md carries the WORKFLOW_LOOP_STATUS: clean marker", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		const dir = await walkToLoop(pi, c);
		// builder then commentator clean → engine writes loop-complete.md
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "tc1", input: { agent: "builder" }, content: [{ type: "text", text: "built" }], isError: false },
			c,
		);
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "tc2", input: { agent: "commentator" }, content: [{ type: "text", text: "Review good.\nWORKFLOW_REVIEW_STATUS: clean" }], isError: false },
			c,
		);
		const text = readFileSync(join(dir, "loop-complete.md"), "utf8");
		expect(text).toMatch(/WORKFLOW_LOOP_STATUS: clean/);
		expect(pi.entries.at(-1)?.data.phase).toBe("audit");
	});

	it("end tool surfaces reason when review.md exists but lacks the clean marker", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { mode: "prototype", goal: "build X" }, undefined, undefined, c);
		// walk to audit with valid markers
		for (const f of ["requirements.md", "research.md", "plan.md", "reuse.md", "handoff.md", "loop-complete.md"]) {
			await pi.tools.get("write_workflow_artifact").execute(f, { content: validContent(f) }, undefined, undefined, c);
		}
		expect(pi.entries.at(-1)?.data.phase).toBe("audit");
		// write review.md without the clean marker
		writeFileSync(join(pi.entries.at(-1)!.data.artifactDir, "review.md"), "# review with no marker");
		const res = await pi.tools.get("end_workflow").execute("e1", { mode: "prototype" }, undefined, undefined, c);
		expect(res.details.blocked).toBe("review.md");
		expect(res.details.reason).toMatch(/WORKFLOW_REVIEW_STATUS: clean/);
		expect(pi.entries.at(-1)?.data.done).toBe(false);
	});
});
