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
// ponytail: auto-advance arm. Re-armed on every phase change so the tool_result
// hook can fire once per phase when the expected artifact lands.
let autoArmed = false;
// ponytail: reentrancy guard. tool_result can fire while an advance is still
// resolving across async boundaries; a second write in the same turn must not
// start a second advancePhase that double-moves the phase forward.
let advancing = false;

const DEBUG = false;
function dbg(tag: string, data: Record<string, unknown>): void {
  if (!DEBUG) return;
  console.log(`[workflow] ${tag}`, data);
}

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
  autoArmed = true;
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
	loop: "loop-complete.md",
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

type AdvanceOutcome =
  | { status: "advanced"; phase: Phase; prompt: string; skipped?: Phase }
  | { status: "blocked"; phase: Phase; missing: string }
  | { status: "terminal"; phase: "audit"; missing?: string }
  | { status: "idle"; phase: Phase };

// ponytail: shared phase-transition logic. Used by next_step (manual) and the
// tool_result auto-advance hook (so the workflow self-drives once an artifact
// lands instead of stalling for the model to remember to call next_step).
async function advancePhase(pi: ExtensionAPI, ctx: ExtensionContext): Promise<AdvanceOutcome> {
  if (!active) return { status: "idle", phase };
  const expected = PHASE_ARTIFACT[phase];
  if (expected && !(await phaseArtifactExists(pi, phase))) {
    return { status: "blocked", phase, missing: expected };
  }
  const next = nextPhase(phase);
  if (!next) {
    // audit terminal: need review.md + audit.md before closing.
    const reviewExists = await phaseArtifactExists(pi, "audit");
    let auditExists = true;
    try {
      auditExists = (await pi.exec("test", ["-f", `${artifactDir}/audit.md`])).code === 0;
    } catch {
      auditExists = false;
    }
    if (!reviewExists || !auditExists) {
      return { status: "terminal", phase: "audit", missing: !reviewExists ? "review.md" : "audit.md" };
    }
    return { status: "terminal", phase: "audit" };
  }
  // ponytail: empty-project cutoff — skip reuse if no git commits.
  if (next === "reuse" && (await isEmptyProject(pi))) {
    setPhase(pi, "handoff");
    updateFooter(pi, ctx);
    return { status: "advanced", phase: "handoff", prompt: phasePrompt("handoff"), skipped: "reuse" };
  }
  setPhase(pi, next);
  updateFooter(pi, ctx);
  return { status: "advanced", phase: next, prompt: phasePrompt(next) };
}

// ponytail: close the workflow. Returns a result tuple for both the
// end_workflow tool and the auto-advance terminal path.
async function endWorkflow(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<{ ok: boolean; text: string; closed?: boolean; artifactDir?: string; phase?: Phase }> {
  if (!active) {
    return { ok: false, text: "No active prototype workflow to end." };
  }
  if (phase !== "audit") {
    return {
      ok: false,
      text: `Cannot end workflow from phase ${phase}. end_workflow is only allowed from audit.`,
      phase,
    };
  }
  const reviewExists = await phaseArtifactExists(pi, "audit");
  let auditExists = true;
  try {
    auditExists = (await pi.exec("test", ["-f", `${artifactDir}/audit.md`])).code === 0;
  } catch {
    auditExists = false;
  }
  if (!reviewExists || !auditExists) {
    return {
      ok: false,
      text: `Audit step is not complete. Write ${artifactDir}/review.md and ${artifactDir}/audit.md first.`,
      phase,
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
  ctx.ui.notify(`Prototype workflow complete. Artifacts: ${artifactDir}`, "info");
  return {
    ok: true,
    closed: true,
    phase,
    artifactDir,
    text: `Workflow ended and closed. It can no longer be used. Artifacts saved at ${artifactDir}.`,
  };
}

function phasePrompt(p: Phase): string {
  switch (p) {
    case "grilling":
      return `Interview the user about this request: ${userPrompt}\n\nAsk clarifying questions one at a time until all requirements are clear. Record a summary of the agreed requirements at ${artifactDir}/requirements.md. The workflow advances automatically once requirements.md exists.`;
    case "research":
      return `Research the requirements gathered during grilling. Explore the codebase and any relevant resources. Write your findings to ${artifactDir}/research.md. The workflow advances automatically once research.md exists.`;
    case "plan":
      return `Create a plan.md file for the prototype based on the research. Write it to ${artifactDir}/plan.md. Use the planger skill.`;
    case "reuse":
      return `Ask the user: "Are there existing files or repositories relevant to this request? List paths or say none." Wait for their response, then explore the codebase for reusable components and knowledge. Write a summary of reusable assets to ${artifactDir}/reuse.md. The workflow advances automatically once reuse.md exists.`;
    case "handoff":
      return `Generate a handoff.md file for a subagent to pick up. Write it to ${artifactDir}/handoff.md. Use the handoff skill if available (it is listed in the system prompt). The workflow advances automatically once handoff.md exists.`;
    case "loop":
      return `Read ${artifactDir}/plan.md and ${artifactDir}/handoff.md. Delegate the whole plan via subagents — don't do the work yourself.\n\n1. Dispatch ONE builder subagent (task tool, subagent_type "general") with the full plan + handoff as context: "Implement every task in plan.md in order. All code changes go in the workspace, never in ${artifactDir}. Return a summary."\n2. Dispatch ONE commentator subagent (same tool) to review the builder's diff against plan.md: "List blocking issues or say 'no issues'."\n3. If blocking issues, dispatch ONE builder subagent with the issues to fix, then re-run the commentator. Repeat until no issues.\n4. Write ${artifactDir}/loop-complete.md with a one-line summary of the finished plan.\n\nThe workflow advances to audit automatically once loop-complete.md exists. Code changes in workspace only, never in ${artifactDir}.`;
    case "audit":
      return `Review all changes from this workflow using ponytail-review (write to ${artifactDir}/review.md), then run a whole-repo over-engineering audit using ponytail-audit (write to ${artifactDir}/audit.md). The workflow closes automatically once both review.md and audit.md exist.`;
    default:
      return "";
  }
}

// ponytail: continuation abstraction. The agent is mid-turn (streaming) when
// the tool_result hook fires, so a bare sendUserMessage() throws
// "Agent is already processing. Specify streamingBehavior...". deliverAs:"followUp"
// is the framework-native continuation: it queues the next-phase prompt as a
// follow-up turn that fires automatically once the current turn ends. In idle
// state (e.g. session resume) it sends a direct turn.
function continueWorkflow(pi: ExtensionAPI, ctx: ExtensionContext, prompt: string): void {
  dbg("continuing agent", { phase, prompt: prompt.slice(0, 60) });
  if (ctx.isIdle()) {
    pi.sendUserMessage(prompt);
  } else {
    pi.sendUserMessage(prompt, { deliverAs: "followUp" });
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
      const out = await advancePhase(pi, ctx);
      if (out.status === "idle") {
        return {
          content: [{ type: "text", text: "No active prototype workflow. Call start_workflow first." }],
          details: { active: false },
        };
      }
      if (out.status === "blocked") {
        return {
          content: [
            {
              type: "text",
              text: `Current step (${out.phase}) is not complete. Write ${artifactDir}/${out.missing} first, then call next_step again.`,
            },
          ],
          details: { phase: out.phase, blocked: out.missing },
        };
      }
      if (out.status === "terminal") {
        if (out.missing) {
          return {
            content: [
              {
                type: "text",
                text: `Audit step is not complete. Write ${artifactDir}/${out.missing} first, then call end_workflow.`,
              },
            ],
            details: { phase: "audit", blocked: out.missing },
          };
        }
        return {
          content: [
            { type: "text", text: `Already at the final phase (audit). Call end_workflow to close the workflow.` },
          ],
          details: { phase: "audit" },
        };
      }
      // advanced
      const label = out.skipped
        ? `Phase advanced to ${out.phase} (skipped ${out.skipped}). ${out.prompt}`
        : `Phase advanced to ${out.phase}. ${out.prompt}`;
      return {
        content: [{ type: "text", text: label }],
        details: { phase: out.phase, skipped: out.skipped },
      };
    },
    renderResult(result, _options, theme) {
      const d = result.details as { phase?: string; skipped?: string; active?: boolean; blocked?: string };
      if (d.active === false) {
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
      const r = await endWorkflow(pi, ctx);
      if (!r.ok) {
        return {
          content: [{ type: "text", text: r.text }],
          details: r.phase ? { phase: r.phase, blocked: "audit artifacts" } : { active: false },
        };
      }
      return {
        content: [{ type: "text", text: r.text }],
        details: { closed: true, phase: r.phase, artifactDir: r.artifactDir },
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
  pi.on("session_start", async (_event: any, ctx: ExtensionContext) => {
    const entries = ctx.sessionManager.getEntries();
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i] as { type: string; customType?: string; data?: any };
      if (e.type === "custom" && e.customType === ENTRY_TYPE && e.data) {
        if (e.data.done) {
          active = false;
        } else {
          active = true;
          phase = e.data.phase as Phase;
          autoArmed = true;
          userPrompt = e.data.userPrompt ?? "";
          artifactDir = e.data.artifactDir ?? "";
        }
        updateFooter(pi, ctx);
        break;
      }
    }
  });

  // ponytail: auto-advance. When a write/edit/bash tool finishes, check whether
  // the current phase's expected artifact has landed. If so, advance the phase
  // and queue the next phase prompt as a follow-up turn so the workflow keeps
  // moving instead of stalling for the model to remember to call next_step.
  // The gate in advancePhase prevents skipping phases even if the model also
  // calls next_step manually. A bare sendUserMessage() cannot be used here:
  // the agent is mid-turn (streaming) while tool_result fires, so prompt()
  // would throw "Agent is already processing" without deliverAs:"followUp".
  pi.on("tool_result", async (event: any, ctx: ExtensionContext) => {
    if (advancing) return;
    if (!active || !autoArmed) return;
    if (event.toolName !== "write" && event.toolName !== "edit" && event.toolName !== "bash") return;
    const expected = PHASE_ARTIFACT[phase];
    if (!expected) return;
    // Acquire the lock synchronously before any await so a concurrent
    // tool_result in the same turn sees `advancing` true and bails out.
    // Without this, both would pass the guard then each await their own
    // phaseArtifactExists and both advance the phase.
    advancing = true;
    try {
      if (!(await phaseArtifactExists(pi, phase))) return;
      autoArmed = false;
      dbg("artifact detected", { phase, artifactDir, expected });
      const from = phase;
      const out = await advancePhase(pi, ctx);
      if (out.status === "advanced") {
        dbg("advancing", { from, to: out.phase });
        continueWorkflow(pi, ctx, out.prompt);
      } else if (out.status === "terminal") {
        if (out.missing) {
          continueWorkflow(
            pi,
            ctx,
            `Audit phase still needs ${artifactDir}/${out.missing}. Write it, then the workflow closes automatically.`,
          );
        } else {
          // Both audit artifacts present — close the workflow directly.
          await endWorkflow(pi, ctx);
        }
      }
      // blocked / idle: nothing to inject.
    } finally {
      advancing = false;
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
          continueWorkflow(pi, ctx, phasePrompt(phase));
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
