import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ponytail: with the next tool removed, write_workflow_artifact is the only
// parent-owned artifact transition. The loop is the sole engine-owned writer.

async function createQuicktypeHarness() {
	vi.resetModules();
	const { default: quicktypeMode } = await import("../extensions/workflow/modes/quicktype.ts");
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
		sendMessage(message: any, o?: any) { sent.push({ text: message.content, options: o, message }); },
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
	createWorkflowExtension(quicktypeMode.config, {
		commandName: quicktypeMode.commandName,
		commandDescription: quicktypeMode.commandDescription,
	})(pi);
	return { events, tools, commands, entries, sent, status, ctxBase };
}

async function startWorkflow(h: Awaited<ReturnType<typeof createQuicktypeHarness>>, goal = "build X"): Promise<void> {
	await h.commands.get("workflow-quicktype").handler(goal, { ...h.ctxBase, isIdle: () => true });
	// Start prompt is already being processed in tests that exercise later phases.
	h.sent.length = 0;
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

	it("keeps initiation user-only and does not register a next tool", async () => {
		const h = await createQuicktypeHarness();
		expect(h.tools.has("next_quicktype_step")).toBe(false);
		expect(h.tools.has("start_workflow")).toBe(false);
		expect(h.tools.has("resume_workflow")).toBe(false);
		expect(h.tools.has("end_workflow")).toBe(true);
		expect(h.tools.has("write_workflow_artifact")).toBe(true);
	});

	it("/workflow-quicktype command sends the grilling prompt once", async () => {
		const h = await createQuicktypeHarness();
		await h.commands.get("workflow-quicktype").handler("build X", {
			...h.ctxBase,
			isIdle: () => true,
		});
		expect(h.sent).toHaveLength(1);
		expect(h.sent[0].text).toMatch(/GRILLING phase/i);
		expect(h.sent[0].options).toMatchObject({ triggerTurn: true, deliverAs: "steer" });
		expect(h.sent[0].message).toMatchObject({ display: false });
	});

	it("artifact completion advances grilling→plan without queuing the plan agent", async () => {
		const h = await createQuicktypeHarness();
		await startWorkflow(h, "build X");
		const result = await h.tools.get("write_workflow_artifact").execute("w1", { content: "# reqs" }, undefined, undefined, { ...h.ctxBase });
		expect(h.entries.at(-1)?.data.phase).toBe("plan");
		expect(h.sent).toHaveLength(1);
		expect(h.sent[0].text).toMatch(/PLAN phase/i);
		expect(h.sent[0].options).toMatchObject({ triggerTurn: true, deliverAs: "steer" });
		expect(h.sent[0].message).toMatchObject({ display: false });
		expect(result.terminate).toBe(true);
	});

	it("tool_call blocks write while workflow is active", async () => {
		const h = await createQuicktypeHarness();
		const c = { ...h.ctxBase };
		await startWorkflow(h, "build X");
		const res = await h.events.get("tool_call")(
			{ type: "tool_call", toolName: "write", toolCallId: "tc1", input: { path: "./.[密钥].md", content: "# reqs" } },
			c,
		);
		expect(res.block).toBe(true);
		expect(res.reason).toContain("write_workflow_artifact");
	});

	it("requires the parent writer to advance plan→reuse", async () => {
		const h = await createQuicktypeHarness();
		const c = { ...h.ctxBase };
		await startWorkflow(h, "build X");
		const dir = h.entries.at(-1)!.data.artifactDir;
		await h.tools.get("write_workflow_artifact").execute("w1", { content: "# reqs" }, undefined, undefined, c);
		expect(h.entries.at(-1)?.data.phase).toBe("plan");
		expect(h.sent).toHaveLength(1);

		await h.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "t2", input: { agent: "architect", output: false }, content: [{ type: "text", text: "# plan\nWORKFLOW_PLAN_STATUS: ready" }], isError: false }, c,
		);
		expect(h.entries.at(-1)?.data.phase).toBe("plan");
		expect(() => readFileSync(join(dir, "plan.md"), "utf8")).toThrow();

		await h.tools.get("write_workflow_artifact").execute("w2", { content: "# plan\nWORKFLOW_PLAN_STATUS: ready" }, undefined, undefined, c);
		expect(h.entries.at(-1)?.data.phase).toBe("reuse");
		expect(h.sent).toHaveLength(2);
		expect(h.sent.at(-1)?.text).toMatch(/REUSE phase/i);
	});

	it("terminal becomes ready once review.md lands and closes only on explicit end", async () => {
		const h = await createQuicktypeHarness();
		const c = { ...h.ctxBase };
		await startWorkflow(h, "build X");
		const dir = h.entries.at(-1)!.data.artifactDir;
		await h.tools.get("write_workflow_artifact").execute("requirements", { content: "# requirements" }, undefined, undefined, c);
		await h.tools.get("write_workflow_artifact").execute("plan", { content: "# plan\nWORKFLOW_PLAN_STATUS: ready" }, undefined, undefined, c);
		await h.tools.get("write_workflow_artifact").execute("reuse", { content: "# reuse" }, undefined, undefined, c);
		await h.tools.get("write_workflow_artifact").execute("handoff", { content: "# handoff\nWORKFLOW_HANDOFF_STATUS: ready" }, undefined, undefined, c);
		await h.events.get("tool_result")(
			{ type: "tool_result", toolName: "subagent", toolCallId: "clean-loop", input: { agent: "commentator" }, content: [{ type: "text", text: "Clean\nWORKFLOW_REVIEW_STATUS: clean" }], isError: false }, c,
		);
		await h.tools.get("write_workflow_artifact").execute("review", { content: "# review\nWORKFLOW_REVIEW_STATUS: clean" }, undefined, undefined, c);
		expect(h.entries.at(-1)?.data.done).toBe(false);
		const end = await h.tools.get("end_workflow").execute("end", { mode: "quicktype" }, undefined, undefined, c);
		expect(end.terminate).toBe(true);
		expect(h.entries.at(-1)?.data.done).toBe(true);
		expect(JSON.parse(readFileSync(join(dir, "workflow.json"), "utf8"))).toMatchObject({ status: "completed", phase: "audit" });
	});
});
