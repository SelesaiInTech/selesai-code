import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ponytail: with the next tool removed, the tool_result hook is the single
// transition driver. It must fire on the agent's own writes (write/edit/bash)
// AND on the subagent tool — subagent-driven phases (plan/reuse/handoff/audit)
// delegate artifact writing to child agents whose writes don't bubble here,
// so we re-check when the subagent tool returns to the parent.

async function createQuickHarness() {
	vi.resetModules();
	const { default: quickExtension } = await import("../extensions/workflow/modes/quick.ts");
	const events = new Map<string, (...a: any[]) => any>();
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const entries: { customType: string; data: any }[] = [];
	const sent: { text: string; options?: any }[] = [];
	const status = new Map<string, string | undefined>();
	const pi: any = {
		on(n: string, h: any) { events.set(n, h); },
		registerTool(d: any) { tools.set(d.name, d); },
		registerCommand(n: string, o: any) { commands.set(n, o); },
		appendEntry(ct: string, d: any) { entries.push({ customType: ct, data: d }); },
		sendUserMessage(t: string, o?: any) { sent.push({ text: t, options: o }); },
		async exec() { return { code: 0, stdout: "abc123 initial commit\n", stderr: "" }; },
	};
	const ctxBase: any = {
		isIdle: () => false, // streaming — followUp path, the real scenario
		ui: {
			notify() {},
			setStatus(key: string, text: string | undefined) { status.set(key, text); },
			theme: { fg: (_c: string, t: string) => t },
		},
	};
	quickExtension(pi);
	return { events, tools, commands, entries, sent, status, ctxBase };
}

describe("workflow hook-driven transitions (next tool removed)", () => {
	let cwd: string;
	let tmp: string;

	beforeEach(() => {
		cwd = process.cwd();
		tmp = mkdtempSync(join(tmpdir(), "wf-race-"));
		process.chdir(tmp);
		vi.resetModules();
	});

	afterEach(() => {
		process.chdir(cwd);
		rmSync(tmp, { recursive: true, force: true });
	});

	it("does not register a next tool", async () => {
		const h = await createQuickHarness();
		expect(h.tools.has("next_quick_step")).toBe(false);
		expect(h.tools.has("start_quick_workflow")).toBe(true);
		expect(h.tools.has("end_quick_workflow")).toBe(true);
	});

	it("hook advances grilling→plan when requirements.md is written and queues the plan prompt", async () => {
		const h = await createQuickHarness();
		await h.tools.get("start_quick_workflow").execute(
			"id-1", { goal: "build X" }, undefined, undefined, { ...h.ctxBase },
		);
		const dir = h.entries.at(-1)!.data.artifactDir;
		writeFileSync(join(dir, "requirements.md"), "# reqs");
		await h.events.get("tool_result")(
			{ type: "tool_result", toolName: "write", toolCallId: "t1", input: {}, content: [], isError: false },
			{ ...h.ctxBase },
		);
		expect(h.entries.at(-1)?.data.phase).toBe("plan");
		expect(h.sent.at(-1)?.options?.deliverAs).toBe("followUp");
		expect(h.sent.at(-1)?.text).toMatch(/PLAN phase/i);
	});

	it("hook rescues an artifact written to the repo root and advances", async () => {
		const h = await createQuickHarness();
		const c = { ...h.ctxBase };
		await h.tools.get("start_quick_workflow").execute(
			"id-1", { goal: "build X" }, undefined, undefined, c,
		);
		const dir = h.entries.at(-1)!.data.artifactDir;
		// ponytail: the agent ignores the artifactDir path and writes requirements.md
		// to the project root (cwd) instead — a common instruction-following slip.
		writeFileSync(join(process.cwd(), "requirements.md"), "# reqs");
		await h.events.get("tool_result")(
			{ type: "tool_result", toolName: "write", toolCallId: "t1", input: { path: "requirements.md" }, content: [], isError: false },
			c,
		);
		// the rescue copies it into the artifactDir; the phase advances.
		expect(existsSync(join(dir, "requirements.md"))).toBe(true);
		expect(h.entries.at(-1)?.data.phase).toBe("plan");
		expect(h.sent.at(-1)?.text).toMatch(/PLAN phase/i);
		// cleanup the stray root file
		rmSync(join(process.cwd(), "requirements.md"), { force: true });
	});

	it("hook fires on the subagent tool so a subagent-written plan.md advances plan→reuse", async () => {
		const h = await createQuickHarness();
		const c = { ...h.ctxBase };
		await h.tools.get("start_quick_workflow").execute(
			"id-1", { goal: "build X" }, undefined, undefined, c,
		);
		const dir = h.entries.at(-1)!.data.artifactDir;
		// walk to plan: write requirements.md, fire hook
		writeFileSync(join(dir, "requirements.md"), "# reqs");
		await h.events.get("tool_result")(
			{ type: "tool_result", toolName: "write", toolCallId: "t1", input: {}, content: [], isError: false }, c,
		);
		expect(h.entries.at(-1)?.data.phase).toBe("plan");
		// subagent (architect) writes plan.md out-of-band; the parent's hook only
		// re-checks when the subagent tool returns. Simulate that tool_result.
		writeFileSync(join(dir, "plan.md"), "# plan");
		await h.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "t2", input: {}, content: [], isError: false }, c,
		);
		expect(h.entries.at(-1)?.data.phase).toBe("reuse");
		expect(h.sent.at(-1)?.text).toMatch(/REUSE phase/i);
	});
});