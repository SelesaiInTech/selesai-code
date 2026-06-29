import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface SentMsg {
	text: string;
	options?: { deliverAs?: "steer" | "followUp" };
}

interface FakePi {
	events: Map<string, (...a: any[]) => any>;
	tools: Map<string, any>;
	commands: Map<string, any>;
	entries: { customType: string; data: any }[];
	sent: SentMsg[];
	[key: string]: any;
}

async function createHarness(): Promise<FakePi> {
	const { default: quickExtension } = await import("../extensions/quick.ts");
	const events = new Map<string, (...a: any[]) => any>();
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const entries: { customType: string; data: any }[] = [];
	const sent: SentMsg[] = [];

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
		async exec(cmd: string, args: string[]) {
			if (cmd === "mkdir") {
				mkdirSync(args[1], { recursive: true });
				return { code: 0, stdout: "", stderr: "" };
			}
			if (cmd === "test") {
				return { code: existsSync(args[1]) ? 0 : 1, stdout: "", stderr: "" };
			}
			return { code: 1, stdout: "", stderr: "" };
		},
	};

	quickExtension(pi);
	return { events, tools, commands, entries, sent } as unknown as FakePi;
}

function ctx(streaming: boolean) {
	return {
		isIdle: () => !streaming,
		ui: {
			notify() {},
			setStatus() {},
			theme: { fg: (_c: string, t: string) => t },
		},
	} as any;
}

describe("quick workflow auto-advance", () => {
	let cwd: string;

	beforeEach(() => {
		cwd = process.cwd();
		const tmp = mkdtempSync(join(tmpdir(), "quick-wf-"));
		process.chdir(tmp);
		vi.resetModules();
	});

	afterEach(() => {
		process.chdir(cwd);
	});

	it("starts at grilling and records quick-phase entry", async () => {
		const pi = await createHarness();
		const start = pi.tools.get("start_quick_workflow");
		await start.execute("id-1", { goal: "build X" }, undefined, undefined, ctx(true));
		expect(pi.entries.at(-1)?.customType).toBe("quick-phase");
		expect(pi.entries.at(-1)?.data.phase).toBe("grilling");
		expect(pi.entries.at(-1)?.data.step).toBe(1);
		expect(pi.entries.at(-1)?.data.mode).toBe("quick");
	});

	it("advances from requirements.md directly to plan", async () => {
		const pi = await createHarness();
		const c = ctx(true);
		const start = pi.tools.get("start_quick_workflow");
		await start.execute("id-1", { goal: "build X" }, undefined, undefined, c);
		const dir: string = pi.entries.at(-1)!.data.artifactDir;

		writeFileSync(join(dir, "requirements.md"), "# reqs");
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolCallId: "t1", toolName: "write", input: {}, content: [], isError: false },
			c,
		);

		expect(pi.entries.at(-1)?.data.phase).toBe("plan");
		expect(pi.entries.at(-1)?.data.step).toBe(2);
		expect(pi.sent.at(-1)?.options?.deliverAs).toBe("followUp");
		expect(pi.sent.at(-1)?.text).toMatch(/plan\.md/i);
		expect(pi.sent.at(-1)?.text).not.toMatch(/research\.md/);
	});

	it("advances through all six phases as artifacts land", async () => {
		const pi = await createHarness();
		const c = ctx(true);
		const start = pi.tools.get("start_quick_workflow");
		await start.execute("id-1", { goal: "build Y" }, undefined, undefined, c);
		const dir: string = pi.entries.at(-1)!.data.artifactDir;

		const files = [
			"requirements.md",
			"plan.md",
			"reuse.md",
			"handoff.md",
			"loop-complete.md",
		];

		for (const file of files) {
			writeFileSync(join(dir, file), `# ${file}`);
			await pi.events.get("tool_result")(
				{ type: "tool_result", toolCallId: `t-${file}`, toolName: "write", input: {}, content: [], isError: false },
				c,
			);
		}

		expect(pi.entries.at(-1)?.data.phase).toBe("audit");
		expect(pi.entries.at(-1)?.data.step).toBe(6);
	});

	it("does not double-advance on concurrent tool_result events", async () => {
		const pi = await createHarness();
		const c = ctx(true);
		const start = pi.tools.get("start_quick_workflow");
		await start.execute("id-1", { goal: "build Z" }, undefined, undefined, c);
		const dir: string = pi.entries.at(-1)!.data.artifactDir;
		writeFileSync(join(dir, "requirements.md"), "# reqs");

		const ev = pi.events.get("tool_result");
		await Promise.all([
			ev({ type: "tool_result", toolCallId: "a", toolName: "write", input: {}, content: [], isError: false }, c),
			ev({ type: "tool_result", toolCallId: "b", toolName: "write", input: {}, content: [], isError: false }, c),
		]);

		expect(pi.entries.at(-1)?.data.phase).toBe("plan");
		expect(pi.sent.filter((m) => /plan/i.test(m.text)).length).toBe(1);
	});

	it("uses direct sendUserMessage when idle", async () => {
		const pi = await createHarness();
		const c = ctx(false);
		const start = pi.tools.get("start_quick_workflow");
		await start.execute("id-1", { goal: "build W" }, undefined, undefined, c);
		const dir: string = pi.entries.at(-1)!.data.artifactDir;
		writeFileSync(join(dir, "requirements.md"), "# reqs");

		await pi.events.get("tool_result")(
			{ type: "tool_result", toolCallId: "t1", toolName: "write", input: {}, content: [], isError: false },
			c,
		);

		expect(pi.sent.at(-1)?.options?.deliverAs).toBeUndefined();
		expect(pi.sent.at(-1)?.text).toMatch(/plan\.md/i);
	});

	it("next_quick_step is blocked when required artifact missing", async () => {
		const pi = await createHarness();
		const c = ctx(true);
		const start = pi.tools.get("start_quick_workflow");
		await start.execute("id-1", { goal: "build B" }, undefined, undefined, c);
		const next = pi.tools.get("next_quick_step");
		const res = await next.execute("id-2", {}, undefined, undefined, c);
		expect(res.details.blocked).toBe("requirements.md");
		expect(res.content[0].text).toMatch(/requirements\.md/);
	});

	it("skips reuse phase when project has no git history", async () => {
		const pi = await createHarness();
		const c = ctx(true);
		const start = pi.tools.get("start_quick_workflow");
		await start.execute("id-1", { goal: "empty repo prototype" }, undefined, undefined, c);
		const dir: string = pi.entries.at(-1)!.data.artifactDir;

		writeFileSync(join(dir, "requirements.md"), "# reqs");
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolCallId: "t1", toolName: "write", input: {}, content: [], isError: false },
			c,
		);

		expect(pi.entries.at(-1)?.data.phase).toBe("plan");
		writeFileSync(join(dir, "plan.md"), "# plan");
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolCallId: "t2", toolName: "write", input: {}, content: [], isError: false },
			c,
		);

		expect(pi.entries.at(-1)?.data.phase).toBe("handoff");
		expect(pi.entries.at(-1)?.data.step).toBe(4);
	});
});
