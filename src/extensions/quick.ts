import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { access, mkdir } from "node:fs/promises";

// ponytail: quick workflow — same tool-driven loop as prototype, but shorter:
// grill (max 4 questions) → plan → reuse → handoff → loop → audit.
// No research phase. Handoff and audit stay unchanged.

type Phase =
  | "grilling"
  | "plan"
  | "reuse"
  | "handoff"
  | "loop"
  | "audit";

const PHASE_ORDER: Phase[] = [
  "grilling",
  "plan",
  "reuse",
  "handoff",
  "loop",
  "audit",
];
const PHASE_STEP: Record<Phase, number> = {
  grilling: 1,
  plan: 2,
  reuse: 3,
  handoff: 4,
  loop: 5,
  audit: 6,
};

const STATUS_KEY = "quick";
const ENTRY_TYPE = "quick-phase";

const ARTIFACTS_BASE = "./.selesai/artifacts";

let active = false;
let phase: Phase = "grilling";
let userPrompt = "";
let artifactDir = "";
let autoArmed = false;
let advancing = false;

const DEBUG = false;
function dbg(tag: string, data: Record<string, unknown>): void {
  if (!DEBUG) return;
  console.log(`[quick] ${tag}`, data);
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
  pi.appendEntry(ENTRY_TYPE, {
    mode: "quick",
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
    ctx.ui.theme.fg("warning", `● quick · ${step}/6 ${phase}`),
  );
}

const PHASE_ARTIFACT: Partial<Record<Phase, string>> = {
  grilling: "requirements.md",
  plan: "plan.md",
  reuse: "reuse.md",
  handoff: "handoff.md",
  loop: "loop-complete.md",
  audit: "review.md",
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function phaseArtifactExists(p: Phase): Promise<boolean> {
  const file = PHASE_ARTIFACT[p];
  if (!file) return true;
  return fileExists(`${artifactDir}/${file}`);
}

function nextPhase(p: Phase): Phase | null {
  const i = PHASE_ORDER.indexOf(p);
  if (i < 0 || i >= PHASE_ORDER.length - 1) return null;
  return PHASE_ORDER[i + 1];
}

type AdvanceOutcome =
  | { status: "advanced"; phase: Phase; prompt: string }
  | { status: "blocked"; phase: Phase; missing: string }
  | { status: "terminal"; phase: "audit"; missing?: string }
  | { status: "idle"; phase: Phase };

async function advancePhase(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<AdvanceOutcome> {
  if (!active) return { status: "idle", phase };
  const expected = PHASE_ARTIFACT[phase];
  if (expected && !(await phaseArtifactExists(phase))) {
    return { status: "blocked", phase, missing: expected };
  }
  const next = nextPhase(phase);
  if (!next) {
    const reviewExists = await phaseArtifactExists("audit");
    const auditExists = await fileExists(`${artifactDir}/audit.md`);
    if (!reviewExists || !auditExists) {
      return {
        status: "terminal",
        phase: "audit",
        missing: !reviewExists ? "review.md" : "audit.md",
      };
    }
    return { status: "terminal", phase: "audit" };
  }
  if (next === "reuse" && (await isEmptyProject(pi))) {
    setPhase(pi, "handoff");
    updateFooter(pi, ctx);
    return {
      status: "advanced",
      phase: "handoff",
      prompt: phasePrompt("handoff"),
    };
  }
  setPhase(pi, next);
  updateFooter(pi, ctx);
  return { status: "advanced", phase: next, prompt: phasePrompt(next) };
}

async function endWorkflow(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<{
  ok: boolean;
  text: string;
  closed?: boolean;
  artifactDir?: string;
  phase?: Phase;
}> {
  if (!active) {
    return { ok: false, text: "No active quick workflow to end." };
  }
  if (phase !== "audit") {
    return {
      ok: false,
      text: `Cannot end workflow from phase ${phase}. end_workflow is only allowed from audit.`,
      phase,
    };
  }
  const reviewExists = await phaseArtifactExists("audit");
  const auditExists = await fileExists(`${artifactDir}/audit.md`);
  if (!reviewExists || !auditExists) {
    return {
      ok: false,
      text: `Audit step is not complete. Write ${artifactDir}/review.md and ${artifactDir}/audit.md first.`,
      phase,
    };
  }
  active = false;
  pi.appendEntry(ENTRY_TYPE, {
    mode: "quick",
    phase,
    step: PHASE_STEP[phase],
    done: true,
    userPrompt,
    artifactDir,
  });
  updateFooter(pi, ctx);
  ctx.ui.notify(
    `Quick workflow complete. Artifacts: ${artifactDir}`,
    "info",
  );
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
      return `You are entering the GRILLING phase of a QUICK workflow.

User's initial request:
${userPrompt}

This phase is short: ask AT MOST 4 focused clarifying questions. Ask ONE question at a time, adapt to user answers, and dig into scope, constraints, success criteria, and edge cases.

When you have enough clarity OR when 4 questions have been asked, stop grilling. Show the user a concise requirements summary and ask explicitly whether they approve it. Only once the user approves, write the approved summary to ${artifactDir}/requirements.md. The workflow advances automatically once requirements.md exists.`;
    case "plan":
      return `You are entering the PLAN phase.

This is a QUICK workflow — no separate research phase. Based on ${artifactDir}/requirements.md, produce the concrete build plan: what to build, how, in order, components, and what the finished prototype looks like.

Spawn the ARCHITECT SUB-AGENT to produce the plan. Use the task tool with subagent_type "architect". Do NOT pass a model parameter — let the agent use its configured model. Craft a tailored prompt from ${artifactDir}/requirements.md so the architect knows exactly what to plan for THIS task. The architect writes to ${artifactDir}/plan.md.

The workflow advances automatically once plan.md exists.`;
    case "reuse":
      return `You are entering the REUSE phase.

Purpose: explore the existing codebase for reusable components, patterns, and knowledge this quick prototype should build on.

Spawn an EXPLORER SUB-AGENT to do the exploration. Use the task tool with subagent_type "explorer". Do NOT pass a model parameter — let the agent use its configured model. Craft a specific prompt tailored to THIS task from ${artifactDir}/requirements.md and ${artifactDir}/plan.md, telling the explorer which areas, patterns, and dependencies matter. Instruct the explorer to write findings to ${artifactDir}/reuse.md.

When the explorer returns, synthesize its findings into ${artifactDir}/reuse.md: what is reusable, where, and how the prototype should leverage it.

The workflow advances automatically once reuse.md exists.`;
    case "handoff":
      return `You are entering the HANDOFF phase.

Purpose: compile everything learned so far into a self-contained handoff document so loop-phase sub-agents can understand full project context without re-grilling.

Draw from ALL prior phases:
- ${artifactDir}/requirements.md
- ${artifactDir}/plan.md
- ${artifactDir}/reuse.md

Spawn the RECAPPER SUB-AGENT to compile the handoff. Use the task tool with subagent_type "recapper". Do NOT pass a model parameter — let the agent use its configured model. Craft a tailored prompt that points the recapper at all three artifact files and tells it what the prototype is about, so it writes a coherent handoff tailored to this task. The recapper writes to ${artifactDir}/handoff.md.

The workflow advances automatically once handoff.md exists.`;
    case "loop":
      return `You are entering the LOOP (orchestration) phase. Your job is to DELEGATE the implementation to sub-agents — do not implement the code yourself.

Read ${artifactDir}/plan.md, ${artifactDir}/handoff.md, and ${artifactDir}/reuse.md. Using that full context, GENERATE YOUR OWN delegation prompts:
1. Dispatch ONE builder sub-agent (task tool, subagent_type "builder"). Do NOT pass a model parameter — let the agent use its configured model. Give it the plan + handoff + reuse context, tailored to this specific task, and instruct it to implement every task in plan.md in order. All code changes go in the workspace, never in ${artifactDir}.
2. Dispatch ONE commentator sub-agent (task tool, subagent_type "commentator"). Do NOT pass a model parameter. Review the builder's diff against plan.md. Generate the review prompt YOURSELF.
3. If the commentator reports blocking issues, dispatch the builder again with the issues to fix, then re-run the commentator. Repeat until no issues.
4. Write ${artifactDir}/loop-complete.md with a one-line summary of the finished plan.

The workflow advances to audit automatically once loop-complete.md exists.`;
    case "audit":
      return `You are entering the AUDIT phase.

Purpose: review loop-phase changes and audit for over-engineering across the repo — ACT on findings.

Two sub-agent rounds:

1. Spawn the COMMENTATOR SUB-AGENT (task tool, subagent_type "commentator"). Do NOT pass a model parameter. Craft a tailored prompt from the full diff and plan.md so the commentator reviews correctness and plan-adherence (writing ${artifactDir}/review.md), then runs a whole-repo over-engineering audit (writing ${artifactDir}/audit.md).

2. If review.md or audit.md lists actionable issues, spawn the BUILDER SUB-AGENT (task tool, subagent_type "builder"). Do NOT pass a model parameter. Craft a tailored prompt containing the findings. Instruct the builder to FIX every issue. All fixes go in the workspace, never in ${artifactDir}.

3. After the builder returns, re-dispatch the commentator to confirm fixes resolved findings. Repeat until clean.

4. Update ${artifactDir}/audit.md with the final resolved state (what was found, what the builder fixed, what remains — should be none).

The workflow closes automatically once both review.md and audit.md exist and the commentator reports no outstanding issues.`;
    default:
      return "";
  }
}

function continueWorkflow(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  prompt: string,
): void {
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
  artifactDir = artifactPathFor(userPrompt);
  await mkdir(artifactDir, { recursive: true });
  active = true;
  setPhase(pi, "grilling");
  updateFooter(pi, ctx);
  return phasePrompt("grilling");
}

async function isEmptyProject(pi: ExtensionAPI): Promise<boolean> {
  try {
    const result = await pi.exec("git", ["log", "--oneline", "-1"]);
    return result.code !== 0 || !result.stdout.trim();
  } catch {
    return false;
  }
}

export default function quickExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "start_quick_workflow",
    label: "Start Quick Workflow",
    description:
      "Start the quick workflow for the given goal. Sets up grilling as the first phase and returns the grilling prompt. Do not call if a workflow is already active.",
    promptSnippet:
      "start_quick_workflow(goal) - start the quick workflow; goal is what the user wants to build.",
    promptGuidelines: [
      "Call start_quick_workflow only when the user explicitly asks to start a quick workflow and none is active.",
      "Pass the user's full goal as the goal parameter.",
    ],
    parameters: Type.Object({
      goal: Type.String({
        description:
          "What the user wants the quick prototype to build or accomplish.",
      }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (active) {
        return {
          content: [
            {
              type: "text",
              text: `A quick workflow is already active (phase: ${phase}). Use next_quick_step or end_quick_workflow, not start_quick_workflow.`,
            },
          ],
          details: { phase, alreadyActive: true },
        };
      }
      const prompt = await beginWorkflow(pi, ctx, params.goal);
      return {
        content: [{ type: "text", text: `Quick workflow started. ${prompt}` }],
        details: { phase: "grilling" },
      };
    },
    renderResult(_result, _options, theme) {
      return new Text(
        theme.fg("warning", `● quick workflow started · 1/6 grilling`),
        0,
        0,
      );
    },
  } satisfies ToolDefinition);

  pi.registerTool({
    name: "next_quick_step",
    label: "Next Quick Step",
    description:
      "Advance the quick workflow one step after the current step is complete. Returns the next step's instructions. Do not call until the current step is fully complete.",
    promptSnippet:
      "next_quick_step() - advance the quick workflow one step once the current step is done.",
    promptGuidelines: [
      "Call next_quick_step only when the current quick workflow step is genuinely complete.",
      "From the final step (audit), call end_quick_workflow instead.",
    ],
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      if (!active) {
        return {
          content: [
            {
              type: "text",
              text: "No active quick workflow. Call start_quick_workflow first.",
            },
          ],
          details: { active: false },
        };
      }
      const out = await advancePhase(pi, ctx);
      if (out.status === "idle") {
        return {
          content: [
            {
              type: "text",
              text: "No active quick workflow. Call start_quick_workflow first.",
            },
          ],
          details: { active: false },
        };
      }
      if (out.status === "blocked") {
        return {
          content: [
            {
              type: "text",
              text: `Current step (${out.phase}) is not complete. Write ${artifactDir}/${out.missing} first, then call next_quick_step again.`,
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
                text: `Audit step is not complete. Write ${artifactDir}/${out.missing} first, then call end_quick_workflow.`,
              },
            ],
            details: { phase: "audit", blocked: out.missing },
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `Already at the final phase (audit). Call end_quick_workflow to close the workflow.`,
            },
          ],
          details: { phase: "audit" },
        };
      }
      const label = `Phase advanced to ${out.phase}. ${out.prompt}`;
      return {
        content: [{ type: "text", text: label }],
        details: { phase: out.phase },
      };
    },
    renderResult(result, _options, theme) {
      const d = result.details as {
        phase?: string;
        active?: boolean;
        blocked?: string;
      };
      if (d.active === false) {
        return new Text(theme.fg("dim", "○ no active workflow"), 0, 0);
      }
      if (d.blocked) {
        return new Text(
          theme.fg("warning", `✋ ${d.phase} blocked · missing ${d.blocked}`),
          0,
          0,
        );
      }
      const label = `${PHASE_STEP[d.phase as Phase]}/6 ${d.phase}`;
      return new Text(theme.fg("warning", `▲ ${label}`), 0, 0);
    },
  } satisfies ToolDefinition);

  pi.registerTool({
    name: "end_quick_workflow",
    label: "End Quick Workflow",
    description:
      "Close the quick workflow. Must be called when the final phase (audit) is complete. Marks the workflow finished and stops the agent loop.",
    promptSnippet:
      "end_quick_workflow() - close the finished quick workflow; no further phase transitions allowed.",
    promptGuidelines: [
      "Call end_quick_workflow exactly once, from the audit phase, when both review and audit are complete.",
    ],
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const r = await endWorkflow(pi, ctx);
      if (!r.ok) {
        return {
          content: [{ type: "text", text: r.text }],
          details: r.phase
            ? { phase: r.phase, blocked: "audit artifacts" }
            : { active: false },
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
        theme.fg("success", `✓ quick closed · ${d.artifactDir}`),
        0,
        0,
      );
    },
  } satisfies ToolDefinition);

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

  pi.on("tool_result", async (event: any, ctx: ExtensionContext) => {
    if (advancing) return;
    if (!active || !autoArmed) return;
    if (
      event.toolName !== "write" &&
      event.toolName !== "edit" &&
      event.toolName !== "bash"
    )
      return;
    const expected = PHASE_ARTIFACT[phase];
    if (!expected) return;
    advancing = true;
    try {
      if (!(await phaseArtifactExists(phase))) return;
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
          await endWorkflow(pi, ctx);
        }
      }
    } finally {
      advancing = false;
    }
  });

  pi.registerCommand("quick", {
    description:
      "Run the quick workflow (grill → plan → reuse → handoff → loop → audit)",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      if (!ctx.isIdle()) {
        ctx.ui.notify(
          "Agent is busy. Wait for it to finish before calling /quick.",
          "warning",
        );
        return;
      }

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
        if (choice === undefined) return;
        if (choice.startsWith("Continue")) {
          continueWorkflow(pi, ctx, phasePrompt(phase));
          return;
        }
        if (!goal && ctx.hasUI) {
          goal = (await ctx.ui.input("Goal for the new workflow:")) ?? "";
        }
        if (!goal.trim()) {
          ctx.ui.notify(
            "No goal provided. Keeping current workflow active.",
            "warning",
          );
          return;
        }
        pi.appendEntry(ENTRY_TYPE, {
          mode: "quick",
          phase,
          step: PHASE_STEP[phase],
          done: true,
          userPrompt,
          artifactDir,
        });
        ctx.ui.notify(`Closed quick workflow at ${artifactDir}.`, "info");
        args = goal;
      } else if (!args.trim()) {
        ctx.ui.notify("Usage: /quick <what to build>", "warning");
        return;
      }

      const prompt = await beginWorkflow(pi, ctx, args);
      pi.sendUserMessage(prompt);
    },
  });
}
