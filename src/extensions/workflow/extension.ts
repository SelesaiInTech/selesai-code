// ponytail: thin shell. Registers the four /workflow-* commands and launches
// each mode's scripted workflow through pi-subagents' launchSlashSubagent.

import type { ExtensionAPI } from "@selesai/code";
import { launchSlashSubagent } from "../pi-subagents/src/slash/slash-commands.ts";
import { buildLoopScript, buildPrototypeScript, buildQuicktypeScript, buildTaskScript } from "./modes.ts";

export default function workflowModesExtension(pi: ExtensionAPI): void {
  const register = (name: string, description: string, build: (goal: string) => string) =>
    pi.registerCommand(name, {
      description,
      handler: async (args, ctx) => {
        const goal = args.trim();
        if (!goal) {
          ctx.ui.notify(`${description}\nUsage: /${name} <goal>`, "info");
          return;
        }
        launchSlashSubagent(pi, ctx, { workflowScript: build(goal), async: true, agentScope: "both", mission: { title: goal } });
      },
    });

  register("workflow-task", "Run the task workflow (plan → reuse → handoff → auto build→review→fix loop) as a scripted workflow.", buildTaskScript);
  register("workflow-prototype", "Run the full prototype workflow (research → plan → reuse → handoff → auto loop → audit) as a scripted workflow.", buildPrototypeScript);
  register("workflow-quicktype", "Run the quicker prototype workflow without research (plan → reuse → handoff → auto loop → audit) as a scripted workflow.", buildQuicktypeScript);
  register("workflow-loop", "Run a direct auto build→review→fix loop for an already-agreed plan as a scripted workflow.", buildLoopScript);
}
