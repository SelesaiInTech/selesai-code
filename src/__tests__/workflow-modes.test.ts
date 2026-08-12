import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@selesai/code";
import { buildLoopScript, buildPrototypeScript, buildQuicktypeScript, buildTaskScript } from "../extensions/workflow/modes.ts";
import workflowModesExtension from "../extensions/workflow/extension.ts";

describe("workflow mode script builders", () => {
  it("buildLoopScript contains the auto-loop runs, agents, and marker", () => {
    const script = buildLoopScript("any goal");
    expect(script).toContain("'build-'");
    expect(script).toContain("'review-'");
    expect(script).toContain("agent: 'builder'");
    expect(script).toContain("agent: 'commentator'");
    expect(script).toContain("while (true)");
    expect(script).toContain("WORKFLOW_REVIEW_STATUS");
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
	});
});
