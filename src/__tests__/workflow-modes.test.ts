import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@selesai/code";
import type { ChainStep } from "../extensions/pi-subagents/src/shared/settings.ts";
import { loopChain, prototypeChain, quicktypeChain, taskChain } from "../extensions/workflow/modes.ts";
import workflowModesExtension from "../extensions/workflow/extension.ts";

// The Selesai roster used by the four workflow chains.
const ROSTER = new Set(["architect", "builder", "commentator", "explorer", "recapper", "researcher"]);

function agentsOf(chain: ChainStep[]): string[] {
	return chain
		.filter((step) => "agent" in step && typeof step.agent === "string")
		.map((step) => (step as { agent: string }).agent);
}

function checkpointsOf(chain: ChainStep[]): Array<{ checkpoint: string; message?: string }> {
	return chain.filter((step) => "checkpoint" in step) as Array<{ checkpoint: string; message?: string }>;
}

function buildersOf(chain: ChainStep[]): Array<{ agent: string; acceptance?: unknown }> {
	return chain.filter(
		(step) => "agent" in step && step.agent === "builder",
	) as Array<{ agent: string; acceptance?: unknown }>;
}

describe("workflow mode chains", () => {
	const chains: Record<string, ChainStep[]> = {
		task: taskChain,
		prototype: prototypeChain,
		quicktype: quicktypeChain,
		loop: loopChain,
	};

	it("defines all four chains as non-empty step arrays", () => {
		for (const [name, chain] of Object.entries(chains)) {
			expect(chain.length, name).toBeGreaterThan(0);
		}
	});

	it("uses only Selesai roster agents", () => {
		for (const [name, chain] of Object.entries(chains)) {
			for (const agent of agentsOf(chain)) {
				expect(ROSTER.has(agent), `${name} chain uses unknown agent '${agent}'`).toBe(true);
			}
		}
	});

	it("orders the task chain as plan → reuse → handoff → build → review", () => {
		expect(agentsOf(taskChain)).toEqual(["architect", "explorer", "recapper", "builder", "commentator"]);
		expect(taskChain.map((s) => ("checkpoint" in s ? s.checkpoint : undefined))).toEqual([
			undefined,
			"approve-plan",
			undefined,
			undefined,
			"approve-handoff",
			undefined,
			undefined,
			"approve-implementation",
		]);
	});

	it("has a researcher step in prototype but not in quicktype", () => {
		expect(agentsOf(prototypeChain)).toContain("researcher");
		expect(agentsOf(quicktypeChain)).not.toContain("researcher");
	});

	it("gives every builder step checked acceptance with command/change evidence", () => {
		for (const [name, chain] of Object.entries(chains)) {
			expect(buildersOf(chain).length, `${name} chain must contain a builder`).toBeGreaterThan(0);
			for (const builder of buildersOf(chain)) {
				expect(builder.acceptance).toEqual({ level: "checked", evidence: ["commands-run", "changed-files"] });
			}
		}
	});

	it("gives every checkpoint step a non-empty message", () => {
		for (const [name, chain] of Object.entries(chains)) {
			for (const checkpoint of checkpointsOf(chain)) {
				expect(checkpoint.checkpoint.length, name).toBeGreaterThan(0);
				expect(checkpoint.message?.trim().length ?? 0, `${name} checkpoint '${checkpoint.checkpoint}' has no message`).toBeGreaterThan(0);
			}
		}
	});

	it("ends task and loop chains with an approval checkpoint; prototype/quicktype with the audit reviewer", () => {
		expect(taskChain.at(-1)).toMatchObject({ checkpoint: "approve-implementation" });
		expect(loopChain.at(-1)).toMatchObject({ checkpoint: "approve-implementation" });
		expect(prototypeChain.at(-1)).toMatchObject({ agent: "commentator" });
		expect(quicktypeChain.at(-1)).toMatchObject({ agent: "commentator" });
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
