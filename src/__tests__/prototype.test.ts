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
	const { default: prototypeExtension } = await import("../extensions/prototype.ts");
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
			// git log on empty repo → treat as empty project.
			return { code: 1, stdout: "", stderr: "" };
		},
	};

	prototypeExtension(pi);
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

describe("prototype workflow auto-advance", () => {
	let cwd: string;

	beforeEach(() => {
		cwd = process.cwd();
		const tmp = mkdtempSync(join(tmpdir(), "proto-wf-"));
		process.chdir(tmp);
		vi.resetModules();
	});

	afterEach(() => {
		process.chdir(cwd);
	});

	it("advances phases and queues follow-up prompts as artifacts land", async () => {
		const pi = await createHarness();
		const c = ctx(true); // streaming during tool_result

		// 1. start workflow
		const start = pi.tools.get("start_workflow");
		await start.execute("id-1", { goal: "build X" }, undefined, undefined, c);
		expect(pi.entries.at(-1)?.data.phase).toBe("grilling");
		const dir: string = pi.entries.at(-1)!.data.artifactDir;

		// 2. write requirements.md → tool_result fires → advance to research
		writeFileSync(join(dir, "requirements.md"), "# reqs");
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolCallId: "t1", toolName: "write", input: {}, content: [], isError: false },
			c,
		);

		expect(pi.entries.at(-1)?.data.phase).toBe("research");
		expect(pi.sent.at(-1)?.options?.deliverAs).toBe("followUp");
		expect(pi.sent.at(-1)?.text).toMatch(/research/i);

		// 3. write research.md → advance to plan
		writeFileSync(join(dir, "research.md"), "# research");
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolCallId: "t2", toolName: "write", input: {}, content: [], isError: false },
			c,
		);

		expect(pi.entries.at(-1)?.data.phase).toBe("plan");
		expect(pi.sent.at(-1)?.text).toMatch(/plan\.md/i);

		// 4. tool_result without the expected plan.md → no advance, no new message
		const sentBefore = pi.sent.length;
		await pi.events.get("tool_result")(
			{ type: "tool_result", toolCallId: "t3", toolName: "write", input: {}, content: [], isError: false },
			c,
		);
		expect(pi.sent.length).toBe(sentBefore);
		expect(pi.entries.at(-1)?.data.phase).toBe("plan");
	});

	it("does not double-advance on concurrent tool_result events", async () => {
		const pi = await createHarness();
		const c = ctx(true);
		const start = pi.tools.get("start_workflow");
		await start.execute("id-1", { goal: "build Y" }, undefined, undefined, c);
		const dir: string = pi.entries.at(-1)!.data.artifactDir;
		writeFileSync(join(dir, "requirements.md"), "# reqs");

		// fire two tool_result events concurrently
		const ev = pi.events.get("tool_result");
		await Promise.all([
			ev({ type: "tool_result", toolCallId: "a", toolName: "write", input: {}, content: [], isError: false }, c),
			ev({ type: "tool_result", toolCallId: "b", toolName: "write", input: {}, content: [], isError: false }, c),
		]);

		// phase advanced exactly once to research
		expect(pi.entries.at(-1)?.data.phase).toBe("research");
		expect(pi.sent.filter((m) => /research/i.test(m.text)).length).toBe(1);
	});

	it("uses direct sendUserMessage when idle on /prototype continue", async () => {
		const pi = await createHarness();
		const c = ctx(false); // idle
		const start = pi.tools.get("start_workflow");
		await start.execute("id-1", { goal: "build Z" }, undefined, undefined, c);
		const dir: string = pi.entries.at(-1)!.data.artifactDir;
		writeFileSync(join(dir, "requirements.md"), "# reqs");

		await pi.events.get("tool_result")(
			{ type: "tool_result", toolCallId: "t1", toolName: "write", input: {}, content: [], isError: false },
			c,
		);

		// idle → no deliverAs option (direct send)
		expect(pi.sent.at(-1)?.options?.deliverAs).toBeUndefined();
		expect(pi.sent.at(-1)?.text).toMatch(/research/i);
	});
});