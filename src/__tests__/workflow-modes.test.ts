import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@selesai/code";
import { buildLoopScript, buildPrototypeScript, buildQuicktypeScript, buildTaskScript } from "../extensions/workflow/modes.ts";

vi.mock("../extensions/pi-subagents/src/slash/slash-commands.ts", () => ({
	launchSlashSubagent: vi.fn(),
}));

import { launchSlashSubagent } from "../extensions/pi-subagents/src/slash/slash-commands.ts";
import workflowModesExtension from "../extensions/workflow/extension.ts";

describe("workflow mode script builders", () => {
  it("buildLoopScript contains the auto-loop runs, agents, and marker", () => {
    const script = buildLoopScript("any goal");
    expect(script).toContain("'build-'");
    expect(script).toContain("'review-'");
    expect(script).toContain("'fix-'");
    expect(script).toContain("agent: 'builder'");
    expect(script).toContain("agent: 'commentator'");
    expect(script).toContain("while (true)");
    expect(script).toContain("WORKFLOW_REVIEW_STATUS");
    expect(script).toContain("emit({ phase: 'start', goal })");
  });

  it("injects the goal as a JSON.stringify'd JS literal without breaking on quotes/backslashes", () => {
    const goal = 'it\'s "quoted" \\ path';
    const script = buildLoopScript(goal);
    expect(script).toContain(`const goal = ${JSON.stringify(goal)};`);
    const match = script.match(/const goal = (.*);\n/);
    expect(match).not.toBeNull();
    expect(JSON.parse(match![1])).toBe(goal);
  });

  it("buildTaskScript has plan/reuse/handoff runs and no research/audit keys", () => {
    const script = buildTaskScript("any goal");
    expect(script).toContain("'plan'");
    expect(script).toContain("'reuse'");
    expect(script).toContain("'handoff'");
    expect(script).not.toContain("'research'");
    expect(script).not.toContain("'audit'");
  });

  it("buildPrototypeScript has research and audit runs", () => {
    const script = buildPrototypeScript("any goal");
    expect(script).toContain("'research'");
    expect(script).toContain("'audit'");
  });

  it("buildQuicktypeScript has audit but no research", () => {
    const script = buildQuicktypeScript("any goal");
    expect(script).toContain("'audit'");
    expect(script).not.toContain("'research'");
  });

  it("buildLoopScript has no plan/handoff/audit keys", () => {
    const script = buildLoopScript("any goal");
    expect(script).not.toContain("'plan'");
    expect(script).not.toContain("'handoff'");
    expect(script).not.toContain("'audit'");
  });

  it("injects a per-mode progress file into the auto loop", () => {
    expect(buildLoopScript("g")).toContain(".pi-subagents/progress/loop.md");
    expect(buildTaskScript("g")).toContain(".pi-subagents/progress/task.md");
    expect(buildPrototypeScript("g")).toContain(".pi-subagents/progress/prototype.md");
    expect(buildQuicktypeScript("g")).toContain(".pi-subagents/progress/quicktype.md");
    expect(buildLoopScript("g")).not.toContain("progress/task.md");
    expect(buildTaskScript("g")).not.toContain("progress/loop.md");
  });

  it("passes previous review feedback to the next builder round and scopes the reviewer to the progress file", () => {
    const script = buildLoopScript("g");
    expect(script).toContain("previousReview");
    expect(script).toContain("Previous review (its findings were addressed in the fix round");
    expect(script).toContain("Progress ledger");
    expect(script).toContain("Progress file (scope your review");
    expect(script).toContain("WORKFLOW_REVIEW_STATUS");
  });

  it("runs a fix round after a blocking review, scoped to the reviewer findings only", () => {
    const script = buildLoopScript("g");
    expect(script).toContain("'fix-' + round");
    expect(script).toContain("Address ONLY the findings from the review below");
    expect(script).toContain("Reviewer findings:");
    expect(script).toContain("Remaining work");
    expect(script).toContain("timeoutMs: 45 * 60 * 1000");
  });

  it("exits gracefully with a budget marker instead of crashing when the fan-out budget is exhausted", () => {
    const script = buildLoopScript("g");
    expect(script).toContain("try {");
    expect(script).toContain("Run fan-out limit reached");
    expect(script).toContain("result: 'budget'");
    expect(script).toContain("The progress file is current");
    expect(script).toContain("throw error");
  });

  it("generated scripts compile as a function body", () => {
    for (const script of [buildLoopScript("g"), buildTaskScript("g"), buildPrototypeScript("g"), buildQuicktypeScript("g")]) {
      expect(() => new Function(`return (async () => {\n${script}\n})`)).not.toThrow();
    }
  });
});

describe("workflow extension registration", () => {
	interface CapturedCommand {
		name: string;
		description?: string;
		handler: (args: string, ctx: { ui: { notify: ReturnType<typeof vi.fn> } }) => Promise<void>;
	}

	it("registers exactly the four /workflow-* commands", () => {
		const captured: CapturedCommand[] = [];
		const pi = {
			registerCommand: (name: string, options: { description?: string; handler: CapturedCommand["handler"] }) => {
				captured.push({ name, description: options.description, handler: options.handler });
			},
		} as unknown as ExtensionAPI;

		workflowModesExtension(pi);

		expect(captured.map((c) => c.name).sort()).toEqual([
			"workflow-loop",
			"workflow-prototype",
			"workflow-quicktype",
			"workflow-task",
		]);
	});

	it("notifies usage instead of launching on an empty goal", async () => {
		const captured: CapturedCommand[] = [];
		const pi = {
			registerCommand: (name: string, options: { description?: string; handler: CapturedCommand["handler"] }) => {
				captured.push({ name, description: options.description, handler: options.handler });
			},
		} as unknown as ExtensionAPI;
		workflowModesExtension(pi);

		const notify = vi.fn();
		const ctx = { ui: { notify } };
		for (const command of captured) {
			await command.handler("   ", ctx);
			expect(notify).toHaveBeenCalledWith(expect.stringContaining(`Usage: /${command.name} <goal>`), "info");
		}
		expect(launchSlashSubagent).not.toHaveBeenCalled();
	});

	it("launches the workflow with a goal", async () => {
		const captured: CapturedCommand[] = [];
		const pi = {
			registerCommand: (name: string, options: { description?: string; handler: CapturedCommand["handler"] }) => {
				captured.push({ name, description: options.description, handler: options.handler });
			},
		} as unknown as ExtensionAPI;
		workflowModesExtension(pi);

		const ctx = { ui: { notify: vi.fn() } };
		for (const command of captured) {
			await command.handler("implement the feature", ctx);
		}
		expect(launchSlashSubagent).toHaveBeenCalledTimes(4);
		for (const call of (launchSlashSubagent as any).mock.calls) {
			expect(call[2]).toMatchObject({ async: true, agentScope: "both" });
			expect(call[2].mission).toEqual({ title: "implement the feature" });
			expect(typeof call[2].workflowScript).toBe("string");
			expect(call[2].workflowScript.length).toBeGreaterThan(0);
		}
	});
});
