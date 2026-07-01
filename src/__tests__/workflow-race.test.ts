import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ponytail: with the next tool removed, write_workflow_artifact advances
// parent-written artifacts; subagent-driven phases advance when the subagent
// tool returns and the forced output file exists.

async function createQuickHarness() {
	vi.resetModules();
	const { default: quickMode } = await import("../extensions/workflow/modes/quick.ts");
	const { createWorkflowExtension } = await import("../extensions/workflow/adapter.ts");
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
	createWorkflowExtension(quickMode.config, {
		toolNames: quickMode.toolNames,
		toolLabels: quickMode.toolLabels,
		commandName: quickMode.commandName,
		commandDescription: quickMode.commandDescription,
	})(pi);
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
		expect(h.tools.has("write_workflow_artifact")).toBe(true);
	});

	it("/quick command sends the grilling prompt once", async () => {
		const h = await createQuickHarness();
		await h.commands.get("quick").handler("build X", {
			...h.ctxBase,
			isIdle: () => true,
		});
		expect(h.sent).toHaveLength(1);
		expect(h.sent[0].text).toMatch(/GRILLING phase/i);
	});

	it("hook advances grilling→plan when requirements.md is written and queues the plan prompt", async () => {
		const h = await createQuickHarness();
		await h.tools.get("start_quick_workflow").execute(
			"id-1", { goal: "build X" }, undefined, undefined, { ...h.ctxBase },
		);
		await h.tools.get("write_workflow_artifact").execute("w1", { content: "# reqs" }, undefined, undefined, { ...h.ctxBase });
		expect(h.entries.at(-1)?.data.phase).toBe("plan");
		expect(h.sent.at(-1)?.options?.deliverAs).toBe("followUp");
		expect(h.sent.at(-1)?.text).toMatch(/PLAN phase/i);
	});

	it("tool_call blocks write while workflow is active", async () => {
		const h = await createQuickHarness();
		const c = { ...h.ctxBase };
		await h.tools.get("start_quick_workflow").execute(
			"id-1", { goal: "build X" }, undefined, undefined, c,
		);
		const res = await h.events.get("tool_call")(
			{ type: "tool_call", toolName: "write", toolCallId: "tc1", input: { path: "./.[密钥].md", content: "# reqs" } },
			c,
		);
		expect(res.block).toBe(true);
		expect(res.reason).toContain("write_workflow_artifact");
	});

	it("hook fires on the subagent tool so a subagent-written plan.md advances plan→reuse", async () => {
		const h = await createQuickHarness();
		const c = { ...h.ctxBase };
		await h.tools.get("start_quick_workflow").execute(
			"id-1", { goal: "build X" }, undefined, undefined, c,
		);
		const dir = h.entries.at(-1)!.data.artifactDir;
		await h.tools.get("write_workflow_artifact").execute("w1", { content: "# reqs" }, undefined, undefined, c);
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

	it("terminal closes once review.md lands", async () => {
		const h = await createQuickHarness();
		const c = { ...h.ctxBase };
		await h.tools.get("start_quick_workflow").execute(
			"id-1", { goal: "build X" }, undefined, undefined, c,
		);
		const dir = h.entries.at(-1)!.data.artifactDir;
		for (const f of ["requirements.md", "plan.md", "reuse.md", "handoff.md", "loop-complete.md", "review.md"]) {
			writeFileSync(join(dir, f), `# ${f}`);
			await h.events.get("tool_result")(
				{ type: "tool_result", toolName: f === "requirements.md" || f === "loop-complete.md" ? "bash" : "subagent", toolCallId: f, input: { path: join(dir, f) }, content: [], isError: false }, c,
			);
		}
		expect(h.entries.at(-1)?.data.done).toBe(true);
	});
});