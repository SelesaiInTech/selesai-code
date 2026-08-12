// ponytail: thin shell. The four workflow mode shapes are pi-subagents saved
// chains; this extension only registers the /workflow-* commands and launches
// them through pi-subagents' launchSlashSubagent (same seam /run-chain uses).

import type { ExtensionAPI } from "@selesai/code";
import { launchSlashSubagent } from "../pi-subagents/src/slash/slash-commands.ts";
import type { ChainStep } from "../pi-subagents/src/shared/settings.ts";
import { loopChain, prototypeChain, quicktypeChain, taskChain } from "./modes.ts";

export default function workflowModesExtension(pi: ExtensionAPI): void {
	const register = (name: string, description: string, chain: ChainStep[]) =>
		pi.registerCommand(name, {
			description,
			handler: async (args, ctx) => {
				const goal = args.trim();
				if (!goal) {
					ctx.ui.notify(`${description}\nUsage: /${name} <goal>`, "info");
					return;
				}
				launchSlashSubagent(pi, ctx, { chain, task: goal, async: true, agentScope: "both" });
			},
		});

	register(
		"workflow-task",
		"Run the task workflow (plan → reuse → handoff → build↔review loop) as a pi-subagents chain.",
		taskChain,
	);
	register(
		"workflow-prototype",
		"Run the full prototype workflow (research → plan → reuse → handoff → loop → audit) as a chain.",
		prototypeChain,
	);
	register(
		"workflow-quicktype",
		"Run the quicker prototype workflow without research as a chain.",
		quicktypeChain,
	);
	register(
		"workflow-loop",
		"Run direct build↔review rounds for an already-agreed plan as a chain.",
		loopChain,
	);
}
