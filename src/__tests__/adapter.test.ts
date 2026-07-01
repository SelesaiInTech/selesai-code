import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
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
	const { default: prototypeExtension } = await import("../extensions/workflow/modes/prototype.ts");
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

	prototypeExtension(pi);
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
		const dir = pi.entries.at(-1)!.data.artifactDir;
		writeFileSync(join(dir, "requirements.md"), "# reqs");
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "write", toolCallId: "t1", input: {}, content: [], isError: false },
			c,
		);
		expect(pi.entries.at(-1)?.data.phase).toBe("research");
		expect(pi.sent.at(-1)?.options?.deliverAs).toBe("followUp");
		expect(pi.sent.at(-1)?.text).toMatch(/research/i);
	});

	it("tool_result auto-advance advances and queues a follow-up when streaming", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true); // streaming
		await pi.tools.get("start_workflow").execute("id-1", { goal: "build X" }, undefined, undefined, c);
		const dir = pi.entries.at(-1)!.data.artifactDir;
		writeFileSync(join(dir, "requirements.md"), "# reqs");
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolCallId: "t1", toolName: "write", input: {}, content: [], isError: false },
			c,
		);
		expect(pi.entries.at(-1)?.data.phase).toBe("research");
		expect(pi.sent.at(-1)?.options?.deliverAs).toBe("followUp");
		expect(pi.sent.at(-1)?.text).toMatch(/research/i);
	});

	it("tool_result auto-advance sends a direct message when idle", async () => {
		const pi = await createHarness();
		const c = ctx(pi, false); // idle
		await pi.tools.get("start_workflow").execute("id-1", { goal: "build X" }, undefined, undefined, c);
		const dir = pi.entries.at(-1)!.data.artifactDir;
		writeFileSync(join(dir, "requirements.md"), "# reqs");
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolCallId: "t1", toolName: "write", input: {}, content: [], isError: false },
			c,
		);
		expect(pi.sent.at(-1)?.options?.deliverAs).toBeUndefined();
		expect(pi.sent.at(-1)?.text).toMatch(/research/i);
	});

	it("quick mode registers under quick tool names and entry type", async () => {
		vi.resetModules();
		const { default: quickExtension } = await import("../extensions/workflow/modes/quick.ts");
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
		quickExtension(pi);
		expect(tools.has("start_quick_workflow")).toBe(true);
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
		writeFileSync(join(dir, "requirements.md"), "# reqs");
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "write", toolCallId: "t1", input: { path: join(dir, "requirements.md") }, content: [], isError: false },
			c,
		);
		writeFileSync(join(dir, "research.md"), "# research");
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "write", toolCallId: "t2", input: { path: join(dir, "research.md") }, content: [], isError: false },
			c,
		);
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
		writeFileSync(join(dir, "requirements.md"), "# reqs");
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "write", toolCallId: "t1", input: { path: join(dir, "requirements.md") }, content: [], isError: false },
			c,
		);
		writeFileSync(join(dir, "research.md"), "# research");
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolName: "write", toolCallId: "t2", input: { path: join(dir, "research.md") }, content: [], isError: false },
			c,
		);
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
				{ type: "tool_result", toolName: "write", toolCallId: f, input: { path: join(dir, f) }, content: [], isError: false },
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

	it("tool_call redirects a mangled write path (.selesai-requirements.md) to artifactDir", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { goal: "build X" }, undefined, undefined, c);
		const dir = pi.entries.at(-1)!.data.artifactDir;
		const input: any = { path: "./.selesai-requirements.md", content: "# reqs" };
		await pi.events.get("tool_call")(
			{ type: "tool_call", toolCallId: "tc1", toolName: "write", input },
			c,
		);
		expect(input.path).toBe(resolve(dir, "requirements.md"));
	});

	it("tool_call leaves a write path that is already inside artifactDir untouched", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { goal: "build X" }, undefined, undefined, c);
		const dir = pi.entries.at(-1)!.data.artifactDir;
		const correct = join(dir, "requirements.md");
		const input: any = { path: correct, content: "# reqs" };
		await pi.events.get("tool_call")(
			{ type: "tool_call", toolCallId: "tc1", toolName: "write", input },
			c,
		);
		expect(input.path).toBe(correct);
	});

	it("tool_call leaves an unrelated write path untouched", async () => {
		const pi = await createHarness();
		const c = ctx(pi, true);
		await pi.tools.get("start_workflow").execute("id-1", { goal: "build X" }, undefined, undefined, c);
		const input: any = { path: "src/main.ts", content: "code" };
		await pi.events.get("tool_call")(
			{ type: "tool_call", toolCallId: "tc1", toolName: "write", input },
			c,
		);
		expect(input.path).toBe("src/main.ts");
	});
});