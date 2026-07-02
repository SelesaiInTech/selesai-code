import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
			notify() {},
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
		toolNames: prototypeMode.toolNames,
		toolLabels: prototypeMode.toolLabels,
		commandName: prototypeMode.commandName,
		commandDescription: prototypeMode.commandDescription,
	})(pi);
	const harness = { events, tools, commands, entries, sent, status, __ctxBase: ctxBase } as unknown as FakePi;
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

	it("registers start/end tools + /prototype command (no next tool)", async () => {
		const pi = await createHarness();
		expect(pi.tools.has("start_workflow")).toBe(true);
		expect(pi.tools.has("next_step")).toBe(false);
		expect(pi.tools.has("end_workflow")).toBe(true);
		expect(pi.tools.has("write_workflow_artifact")).toBe(true);
		expect(pi.commands.has("prototype")).toBe(true);
	});

	it("start tool appends entry, sets footer, and returns the grilling prompt", async () => {
		const pi = await createHarness();
		const start = pi.tools.get("start_workflow");
		const res = await start.execute("id-1", { goal: "build X" }, undefined, undefined, ctx(pi));
		expect(res.details.phase).toBe("grilling");
		expect(pi.entries.at(-1)?.customType).toBe("prototype-phase");
		expect(pi.entries.at(-1)?.data.phase).toBe("grilling");
		expect(pi.entries.at(-1)?.data.step).toBe(1);
		expect(pi.entries.at(-1)?.data.mode).toBe("prototype");
		expect(typeof res.content[0].text).toBe("string");
		expect(pi.status.get("prototype")).toContain("1/7");
	});

	it("auto-advance hook advances and queues a follow-up when streaming", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true); // streaming
		await pi.tools.get("start_workflow").execute("id-1", { goal: "build X" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w1", { content: "# reqs" }, undefined, undefined, c);
		expect(pi.entries.at(-1)?.data.phase).toBe("research");
		expect(pi.sent.at(-1)?.options?.deliverAs).toBe("followUp");
		expect(pi.sent.at(-1)?.text).toMatch(/research/i);
	});

	it("tool_result auto-advance advances and queues a follow-up when streaming", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true); // streaming
		await pi.tools.get("start_workflow").execute("id-1", { goal: "build X" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w1", { content: "# reqs" }, undefined, undefined, c);
		expect(pi.entries.at(-1)?.data.phase).toBe("research");
		expect(pi.sent.at(-1)?.options?.deliverAs).toBe("followUp");
		expect(pi.sent.at(-1)?.text).toMatch(/research/i);
	});

	it("tool_result auto-advance sends a direct message when idle", async () => {
		const pi = await createHarness();
		const c = ctx(pi, false); // idle
		await pi.tools.get("start_workflow").execute("id-1", { goal: "build X" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w1", { content: "# reqs" }, undefined, undefined, c);
		expect(pi.sent.at(-1)?.options?.deliverAs).toBeUndefined();
		expect(pi.sent.at(-1)?.text).toMatch(/research/i);
	});

	it("quick mode registers under quick tool names and entry type", async () => {
		vi.resetModules();
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
		createWorkflowExtension(quickMode.config, {
			toolNames: quickMode.toolNames,
			toolLabels: quickMode.toolLabels,
			commandName: quickMode.commandName,
			commandDescription: quickMode.commandDescription,
		})(pi);
		expect(tools.has("start_quick_workflow")).toBe(true);
		expect(tools.has("write_workflow_artifact")).toBe(true);
		expect(commands.has("quick")).toBe(true);
		const c: any = {
			isIdle: () => true,
			ui: { notify() {}, setStatus() {}, theme: { fg: (_c: string, t: string) => t } },
		};
		const res = await tools.get("start_quick_workflow").execute("id", { goal: "build Q" }, undefined, undefined, c);
		expect(res.details.phase).toBe("grilling");
		expect(entries.at(-1)?.customType).toBe("quick-phase");
		expect(entries.at(-1)?.data.mode).toBe("quick");
	});

	it("tool_call forces subagent output to the workflow artifactDir during plan phase", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { goal: "build X" }, undefined, undefined, c);
		const dir = pi.entries.at(-1)!.data.artifactDir;
		await pi.tools.get("write_workflow_artifact").execute("w1", { content: "# reqs" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w2", { content: "# research" }, undefined, undefined, c);
		expect(pi.entries.at(-1)?.data.phase).toBe("plan");
		const input: any = { agent: "architect", task: "plan the thing" };
		await pi.events.get("tool_call")(
			{ type: "tool_call", toolCallId: "tc1", toolName: "subagent", input },
			c,
		);
		expect(input.output).toBe(resolve(dir, "plan.md"));
	});

	it("tool_call respects an explicit absolute caller output", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { goal: "build X" }, undefined, undefined, c);
		const dir = pi.entries.at(-1)!.data.artifactDir;
		await pi.tools.get("write_workflow_artifact").execute("w1", { content: "# reqs" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w2", { content: "# research" }, undefined, undefined, c);
		const pinned = join(tmp, "elsewhere", "plan.md");
		const input: any = { agent: "architect", task: "plan", output: pinned };
		await pi.events.get("tool_call")(
			{ type: "tool_call", toolCallId: "tc1", toolName: "subagent", input },
			c,
		);
		expect(input.output).toBe(pinned);
	});

	it("tool_call does not force output during loop phase", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { goal: "build X" }, undefined, undefined, c);
		const dir = pi.entries.at(-1)!.data.artifactDir;
		for (const f of ["requirements.md", "research.md", "plan.md", "reuse.md", "handoff.md"]) {
			writeFileSync(join(dir, f), "# " + f);
			await pi.events.get("tool_result")(
				{ type: "tool_result", toolName: f === "requirements.md" || f === "research.md" ? "bash" : "subagent", toolCallId: f, input: { path: join(dir, f) }, content: [], isError: false },
				c,
			);
		}
		expect(pi.entries.at(-1)?.data.phase).toBe("loop");
		const input: any = { agent: "builder", task: "implement" };
		await pi.events.get("tool_call")(
			{ type: "tool_call", toolCallId: "tc1", toolName: "subagent", input },
			c,
		);
		expect(input.output).toBeUndefined();
	});

	it("tool_call blocks write/edit while workflow is active", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { goal: "build X" }, undefined, undefined, c);
		const input: any = { path: "src/main.ts", content: "code" };
		const res = await pi.events.get("tool_call")(
			{ type: "tool_call", toolCallId: "tc1", toolName: "write", input },
			c,
		);
		expect(res.block).toBe(true);
		expect(res.reason).toContain("write_workflow_artifact");
	});

	// ── subagent text fallback tests ──

	it("subagent text fallback saves plan.md when subagent returns text but no file", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { goal: "build X" }, undefined, undefined, c);
		// advance to plan: write requirements.md and research.md
		await pi.tools.get("write_workflow_artifact").execute("w1", { content: "# reqs" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w2", { content: "# research" }, undefined, undefined, c);
		expect(pi.entries.at(-1)?.data.phase).toBe("plan");
		const dir = pi.entries.at(-1)!.data.artifactDir;
		// subagent returns text but does not write plan.md
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "tc1", input: {}, content: [{ type: "text", text: "# Plan for X" }], isError: false },
			c,
		);
		expect(existsSync(join(dir, "plan.md"))).toBe(true);
		expect(pi.entries.at(-1)?.data.phase).toBe("handoff");
	});

	it("subagent text fallback does not overwrite existing artifact", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { goal: "build X" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w1", { content: "# reqs" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w2", { content: "# research" }, undefined, undefined, c);
		expect(pi.entries.at(-1)?.data.phase).toBe("plan");
		const dir = pi.entries.at(-1)!.data.artifactDir;
		writeFileSync(join(dir, "plan.md"), "original plan");
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "tc1", input: {}, content: [{ type: "text", text: "should not overwrite" }], isError: false },
			c,
		);
		expect(readFileSync(join(dir, "plan.md"), "utf8")).toBe("original plan");
	});

	it("subagent text fallback does not fire for loop phase", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { goal: "build X" }, undefined, undefined, c);
		const dir = pi.entries.at(-1)!.data.artifactDir;
		// walk to loop
		for (const f of ["requirements.md", "research.md", "plan.md", "reuse.md", "handoff.md"]) {
			writeFileSync(join(dir, f), "# " + f);
			await pi.events.get("tool_result")(
				{ type: "tool_result", toolName: f === "requirements.md" || f === "research.md" ? "bash" : "subagent", toolCallId: f, input: { path: join(dir, f) }, content: [], isError: false },
				c,
			);
		}
		expect(pi.entries.at(-1)?.data.phase).toBe("loop");
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "tc1", input: {}, content: [{ type: "text", text: "try to write loop artifact" }], isError: false },
			c,
		);
		expect(existsSync(join(dir, "loop-complete.md"))).toBe(false);
	});

	it("subagent text fallback saves review.md in audit phase and closes", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { goal: "build X" }, undefined, undefined, c);
		const dir = pi.entries.at(-1)!.data.artifactDir;
		// walk to audit
		for (const f of ["requirements.md", "research.md", "plan.md", "reuse.md", "handoff.md", "loop-complete.md"]) {
			writeFileSync(join(dir, f), "# " + f);
			await pi.events.get("tool_result")(
				{ type: "tool_result", toolName: f === "requirements.md" || f === "research.md" || f === "loop-complete.md" ? "bash" : "subagent", toolCallId: f, input: { path: join(dir, f) }, content: [], isError: false },
				c,
			);
		}
		expect(pi.entries.at(-1)?.data.phase).toBe("audit");
		// subagent (commentator) returns review text but does not write review.md
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "tc1", input: {}, content: [{ type: "text", text: "# Review: all good" }], isError: false },
			c,
		);
		expect(existsSync(join(dir, "review.md"))).toBe(true);
		expect(pi.entries.at(-1)?.data.done).toBe(true);
	});

	// regression: subagent management actions (list/get/models/...) return
	// text but must not be treated as the architect/recapper/... execution
	// result. Before the fix, subagent {action:"list"} in the plan phase
	// wrote the agent-listing text to plan.md and advanced the workflow.
	it("subagent management action 'list' does not trigger text fallback in plan phase", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { goal: "build X" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w1", { content: "# reqs" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w2", { content: "# research" }, undefined, undefined, c);
		expect(pi.entries.at(-1)?.data.phase).toBe("plan");
		const dir = pi.entries.at(-1)!.data.artifactDir;
		const agentListing = "Executable agents:\n- architect (user): plans things\n- builder (user): builds things\n\nChains:\n- (none)";
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "tc1", input: { action: "list" }, content: [{ type: "text", text: agentListing }], isError: false },
			c,
		);
		expect(existsSync(join(dir, "plan.md"))).toBe(false);
		expect(pi.entries.at(-1)?.data.phase).toBe("plan");
	});

	it("subagent management action 'get' does not trigger text fallback in plan phase", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { goal: "build X" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w1", { content: "# reqs" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w2", { content: "# research" }, undefined, undefined, c);
		expect(pi.entries.at(-1)?.data.phase).toBe("plan");
		const dir = pi.entries.at(-1)!.data.artifactDir;
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "tc1", input: { action: "get", agent: "architect" }, content: [{ type: "text", text: "architect details..." }], isError: false },
			c,
		);
		expect(existsSync(join(dir, "plan.md"))).toBe(false);
		expect(pi.entries.at(-1)?.data.phase).toBe("plan");
	});

	it("subagent execution call (with agent) still triggers text fallback in plan phase", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { goal: "build X" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w1", { content: "# reqs" }, undefined, undefined, c);
		await pi.tools.get("write_workflow_artifact").execute("w2", { content: "# research" }, undefined, undefined, c);
		expect(pi.entries.at(-1)?.data.phase).toBe("plan");
		const dir = pi.entries.at(-1)!.data.artifactDir;
		// execution call: has agent, no action
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "tc1", input: { agent: "architect" }, content: [{ type: "text", text: "# Plan for X" }], isError: false },
			c,
		);
		expect(existsSync(join(dir, "plan.md"))).toBe(true);
		expect(readFileSync(join(dir, "plan.md"), "utf8")).toBe("# Plan for X");
	});
});