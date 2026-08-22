// ponytail: thin slash-command adapter for the pi-subagents workflow runtime.

import type { ExtensionAPI } from "@selesai/code";
import { launchSlashSubagent } from "../pi-subagents/src/slash/slash-commands.ts";
import { WORKFLOW_MODES, type WorkflowMode } from "./modes.ts";

export default function workflowModesExtension(pi: ExtensionAPI): void {
	const register = (mode: WorkflowMode) => pi.registerCommand(mode.command, {
		description: mode.description,
		handler: async (args, ctx) => {
			const goal = args.trim();
			if (!goal) {
				ctx.ui.notify(`${mode.description}\nUsage: /${mode.command} <goal>`, "info");
				return;
			}
			launchSlashSubagent(pi, ctx, {
				...mode.launch(goal),
				async: true,
				agentScope: "both",
				mission: { title: goal },
			});
		},
	});

	for (const mode of WORKFLOW_MODES) register(mode);
}
