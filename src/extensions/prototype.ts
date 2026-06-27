import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ponytail: tool result content carries the full phase prompt for the model;
// renderResult shows only a short label so the user sees a clean progression
// (the long instructions are obfuscated from the TUI, not from the model).

// ponytail: tool-driven workflow loop. Agent advances phase by calling next_workflow_step
// (native structured tool call parsed by the framework — no text-marker narration hazard).
// end_workflow returns terminate:true to stop the agent loop and close the workflow.

type Phase =
  | "grilling"
  | "research"
  | "plan"
  | "reuse"
  | "handoff"
  | "loop"
  | "audit";

const PHASE_ORDER: Phase[] = [
  "grilling",
  "research",
  "plan",
  "reuse",
  "handoff",
  "loop",
  "audit",
];
const PHASE_STEP: Record<Phase, number> = {
  grilling: 1,
  research: 2,
  plan: 3,
  reuse: 4,
  handoff: 5,
  loop: 6,
  audit: 7,
};

const STATUS_KEY = "prototype";
const ENTRY_TYPE = "prototype-phase";

const ARTIFACTS_BASE = "./.selesai/artifacts";

// ponytail: module-level state, one workflow at a time (same pattern as plan-mode).
let active = false;
let phase: Phase = "grilling";
let userPrompt = "";
// ponytail: 1 workflow = 1 folder. All workflow-generated docs go here for later review.
let artifactDir = "";

function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "workflow";
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function artifactPathFor(goal: string): string {
  return `${ARTIFACTS_BASE}/${timestamp()}-${slugify(goal)}`;
}

function setPhase(pi: ExtensionAPI, p: Phase): void {
  phase = p;
  // ponytail: persist userPrompt+artifactDir in every entry so session_start resume restores them.
  pi.appendEntry(ENTRY_TYPE, {
    mode: "prototype",
    phase: p,
    step: PHASE_STEP[p],
    done: false,
    userPrompt,
    artifactDir,
  });
}

function updateFooter(pi: ExtensionAPI, ctx: ExtensionContext): void {
  if (!active) {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    return;
  }
  const step = PHASE_STEP[phase];
  ctx.ui.setStatus(
    STATUS_KEY,
    ctx.ui.theme.fg("warning", `● prototype · ${step}/7 ${phase}`),
  );
}

// ponytail: each step has an expected artifact file that must exist before advancing.
// Without this gate the model can call next_step repeatedly without doing any work.
const PHASE_ARTIFACT: Partial<Record<Phase, string>> = {
	grilling: "requirements.md",
	research: "research.md",
	plan: "plan.md",
	reuse: "reuse.md",
	handoff: "handoff.md",
	audit: "review.md",
};

async function phaseArtifactExists(pi: ExtensionAPI, p: Phase): Promise<boolean> {
	const file = PHASE_ARTIFACT[p];
	if (!file) return true;
	try {
		const result = await pi.exec("test", ["-f", `${artifactDir}/${file}`]);
		return result.code === 0;
	} catch {
		return false;
	}
}

function nextPhase(p: Phase): Phase | null {
  const i = PHASE_ORDER.indexOf(p);
  if (i < 0 || i >= PHASE_ORDER.length - 1) return null;
  return PHASE_ORDER[i + 1];
}

function phasePrompt(p: Phase): string {
  switch (p) {
    case "grilling":
      return `Interview the user about this request: ${userPrompt}\n\nAsk clarifying questions one at a time until all requirements are clear. Record a summary of the agreed requirements at ${artifactDir}/requirements.md. When grilling is complete, call the next_step tool to advance to research.`;
    case "research":
      return `Research the requirements gathered during grilling. Explore the codebase and any relevant resources. Write your findings to ${artifactDir}/research.md. When research is complete, call the next_step tool.`;
    case "plan":
      return `Create a plan.md file for the prototype based on the research. Write it to ${artifactDir}/plan.md. Use the planger skill if available (it is listed in the system prompt). When plan.md is written, call the next_step tool.`;
    case "reuse":
      return `Ask the user: "Are there existing files or repositories relevant to this request? List paths or say none." Wait for their response, then explore the codebase for reusable components and knowledge. Write a summary of reusable assets to ${artifactDir}/reuse.md. When done, call the next_step tool.`;
    case "handoff":
      return `Generate a handoff.md file for a subagent to pick up. Write it to ${artifactDir}/handoff.md. Use the handoff skill if available (it is listed in the system prompt). When handoff.md is written, call the next_step tool.`;
    case "loop":
      return `You are the orchestrator. Read ${artifactDir}/plan.md and ${artifactDir}/handoff.md. For each task in plan.md, run a agent loop using subagent chain: builder -> commentator. Use the subagent tool in chain mode with agents: builder, commentator. If commentator has feedback, use worker to fix, then retry the loop until commentator result has no issue. Honor the order in plan.md. Actual code changes go in the workspace, not the artifacts folder. When the loop is complete, call the next_step tool.`;
    case "audit":
      return `Review all changes from this workflow using ponytail-review (write to ${artifactDir}/review.md), then run a whole-repo over-engineering audit using ponytail-audit (write to ${artifactDir}/audit.md). When both are complete, call the end_workflow tool to close the workflow.`;
    default:
      return "";
  }
}

async function beginWorkflow(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  goal: string,
): Promise<string> {
  userPrompt = goal.trim();
  // ponytail: 1 workflow = 1 folder under ./.selesai/artifacts/. Timestamp prefix avoids collisions.
  artifactDir = artifactPathFor(userPrompt);
  await pi.exec("mkdir", ["-p", artifactDir]);
  active = true;
  setPhase(pi, "grilling");
  updateFooter(pi, ctx);
  return phasePrompt("grilling");
}

// ponytail: empty-project check during plan→reuse transition. Skip reuse if no git commits.
async function isEmptyProject(pi: ExtensionAPI): Promise<boolean> {
  try {
    const result = await pi.exec("git", ["log", "--oneline", "-1"]);
    return result.code !== 0 || !result.stdout.trim();
  } catch {
    return false;
  }
}

export default function prototypeExtension(pi: ExtensionAPI): void {
  // start_workflow: begin a workflow from natural language ("start a prototype workflow to build X").
  pi.registerTool({
    name: "start_workflow",
    label: "Start Workflow",
    description:
      "Start the prototype workflow for the given goal. Sets up grilling as the first phase and returns the grilling prompt. Do not call if a workflow is already active.",
    promptSnippet:
      "start_workflow(goal) - start the prototype workflow; goal is what the user wants to build.",
    promptGuidelines: [
      "Call start_workflow only when the user explicitly asks to start a prototype workflow and none is active.",
      "Pass the user's full goal as the goal parameter.",
    ],
    parameters: Type.Object({
      goal: Type.String({
        description:
          "What the user wants the prototype to build or accomplish.",
      }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (active) {
        return {
          content: [
            {
              type: "text",
              text: `A prototype workflow is already active (phase: ${phase}). Use next_step or end_workflow, not start_workflow.`,
            },
          ],
          details: { phase, alreadyActive: true },
        };
      }
      const prompt = await beginWorkflow(pi, ctx, params.goal);
      return {
        content: [{ type: "text", text: `Workflow started. ${prompt}` }],
        details: { phase: "grilling" },
      };
    },
    renderResult(_result, _options, theme) {
      return new Text(
        theme.fg("warning", `● workflow started · 1/7 grilling`),
        0,
        0,
      );
    },
  } satisfies ToolDefinition);

  // next_step: advance the workflow one step; tool result drives the next step in the same run.
  pi.registerTool({
    name: "next_step",
    label: "Next Step",
    description:
      "Advance the prototype workflow one step after the current step is complete. Returns the next step's instructions. Do not call until the current step is fully complete.",
    promptSnippet: "next_step() - advance the prototype workflow one step once the current step is done.",
    promptGuidelines: [
      "Call next_step only when the current workflow step is genuinely complete.",
      "From the final step (audit), call end_workflow instead.",
    ],
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      if (!active) {
        return {
          content: [
            {
              type: "text",
              text: "No active prototype workflow. Call start_workflow first.",
            },
          ],
          details: { active: false },
        };
      }
      // ponytail: gate — don't advance until the current step's artifact exists.
      const expected = PHASE_ARTIFACT[phase];
      if (expected && !(await phaseArtifactExists(pi, phase))) {
        return {
          content: [
            {
              type: "text",
              text: `Current step (${phase}) is not complete. Write ${artifactDir}/${expected} first, then call next_step again.`,
            },
          ],
          details: { phase, blocked: expected },
        };
      }
      const next = nextPhase(phase);
      if (!next) {
        return {
          content: [
            {
              type: "text",
              text: `Already at the final phase (${phase}). Call end_workflow to close the workflow.`,
            },
          ],
          details: { phase },
        };
      }
      // ponytail: empty-project cutoff — skip reuse if no git commits.
      if (next === "reuse") {
        if (await isEmptyProject(pi)) {
          setPhase(pi, "handoff");
          updateFooter(pi, ctx);
          return {
            content: [
              {
                type: "text",
                text: `Empty repo — reuse phase skipped. ${phasePrompt("handoff")}`,
              },
            ],
            details: { phase: "handoff", skipped: "reuse" },
          };
        }
      }
      setPhase(pi, next);
      updateFooter(pi, ctx);
      return {
        content: [
          {
            type: "text",
            text: `Phase advanced to ${next}. ${phasePrompt(next)}`,
          },
        ],
        details: { phase: next },
      };
    },
    renderResult(result, _options, theme) {
      const d = result.details as { phase?: string; skipped?: string; active?: boolean; blocked?: string };
      if (!d.active) {
        return new Text(theme.fg("dim", "○ no active workflow"), 0, 0);
      }
      if (d.blocked) {
        return new Text(theme.fg("warning", `✋ ${d.phase} blocked · missing ${d.blocked}`), 0, 0);
      }
      const label = d.skipped
        ? `${PHASE_STEP[d.phase as Phase]}/7 ${d.phase} (skipped ${d.skipped})`
        : `${PHASE_STEP[d.phase as Phase]}/7 ${d.phase}`;
      return new Text(theme.fg("warning", `▲ ${label}`), 0, 0);
    },
  } satisfies ToolDefinition);

  // end_workflow: close the workflow and stop the agent loop.
  pi.registerTool({
    name: "end_workflow",
    label: "End Workflow",
    description:
      "Close the prototype workflow. Must be called when the final phase (audit) is complete. Marks the workflow finished and stops the agent loop.",
    promptSnippet:
      "end_workflow() - close the finished prototype workflow; no further phase transitions allowed.",
    promptGuidelines: [
      "Call end_workflow exactly once, from the audit phase, when both review and audit are complete.",
    ],
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      if (!active) {
        return {
          content: [
            { type: "text", text: "No active prototype workflow to end." },
          ],
          details: { active: false },
        };
      }
      // ponytail: gate — only allow ending from audit phase with review.md + audit.md present.
      // Prevents the model from prematurely closing the workflow and leaving next_step orphaned.
      if (phase !== "audit") {
        return {
          content: [
            {
              type: "text",
              text: `Cannot end workflow from phase ${phase}. end_workflow is only allowed from audit. Call next_step to advance instead.`,
            },
          ],
          details: { phase, blocked: "not audit" },
        };
      }
      const reviewOk = await phaseArtifactExists(pi, "audit");
      let auditOk = true;
      try {
        auditOk = (await pi.exec("test", ["-f", `${artifactDir}/audit.md`])).code === 0;
      } catch {
        auditOk = false;
      }
      if (!reviewOk || !auditOk) {
        return {
          content: [
            {
              type: "text",
              text: `Audit step is not complete. Write ${artifactDir}/review.md and ${artifactDir}/audit.md first, then call end_workflow.`,
            },
          ],
          details: { phase, blocked: "audit artifacts" },
        };
      }
      active = false;
      pi.appendEntry(ENTRY_TYPE, {
        mode: "prototype",
        phase,
        step: PHASE_STEP[phase],
        done: true,
        userPrompt,
        artifactDir,
      });
      updateFooter(pi, ctx);
      ctx.ui.notify(
        `Prototype workflow complete. Artifacts: ${artifactDir}`,
        "info",
      );
      return {
        content: [
          {
            type: "text",
            text: `Workflow ended and closed. It can no longer be used. Artifacts saved at ${artifactDir}.`,
          },
        ],
        details: { closed: true, phase, artifactDir },
        terminate: true,
      };
    },
    renderResult(result, _options, theme) {
      const d = result.details as { closed?: boolean; artifactDir?: string };
      if (!d.closed) {
        return new Text(theme.fg("dim", "○ no workflow to end"), 0, 0);
      }
      return new Text(
        theme.fg("success", `✓ workflow closed · ${d.artifactDir}`),
        0,
        0,
      );
    },
  } satisfies ToolDefinition);

  // session_start: restore state from persisted entries.
  pi.on("session_start", async (_event, ctx) => {
    const entries = ctx.sessionManager.getEntries();
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i] as { type: string; customType?: string; data?: any };
      if (e.type === "custom" && e.customType === ENTRY_TYPE && e.data) {
        if (e.data.done) {
          active = false;
        } else {
          active = true;
          phase = e.data.phase as Phase;
          userPrompt = e.data.userPrompt ?? "";
          artifactDir = e.data.artifactDir ?? "";
        }
        updateFooter(pi, ctx);
        break;
      }
    }
  });

  // /prototype: human kickoff. If a workflow is active, ask whether to continue it
  // or close it and start a new one. Otherwise start a new workflow from args.
  pi.registerCommand("prototype", {
    description:
      "Run the prototype workflow (grill → research → plan → reuse → handoff → loop → audit)",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      if (!ctx.isIdle()) {
        ctx.ui.notify(
          "Agent is busy. Wait for it to finish before calling /prototype.",
          "warning",
        );
        return;
      }

      // ponytail: when a workflow is already active, ask the user how to proceed.
      if (active) {
        let goal = args.trim();
        const choice = ctx.hasUI
          ? await ctx.ui.select(
              `Workflow already active (phase: ${phase}). What do you want to do?`,
              [
                `Continue current workflow at ${phase}`,
                "Close current and start a new one",
              ],
            )
          : undefined;
        if (choice === undefined) return; // cancelled or no UI
        if (choice.startsWith("Continue")) {
          pi.sendUserMessage(phasePrompt(phase));
          return;
        }
        // Close + start new: require a goal before touching state.
        if (!goal && ctx.hasUI) {
          goal = (await ctx.ui.input("Goal for the new workflow:")) ?? "";
        }
        if (!goal.trim()) {
          ctx.ui.notify("No goal provided. Keeping current workflow active.", "warning");
          return;
        }
        // ponytail: record old workflow as done, then beginWorkflow overwrites all state.
        pi.appendEntry(ENTRY_TYPE, {
          mode: "prototype",
          phase,
          step: PHASE_STEP[phase],
          done: true,
          userPrompt,
          artifactDir,
        });
        ctx.ui.notify(`Closed workflow at ${artifactDir}.`, "info");
        args = goal;
      } else if (!args.trim()) {
        ctx.ui.notify("Usage: /prototype <what to build>", "warning");
        return;
      }

      const prompt = await beginWorkflow(pi, ctx, args);
      pi.sendUserMessage(prompt);
    },
  });

  }
