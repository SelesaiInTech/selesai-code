import type {
  Phase,
  PromptContext,
  WorkflowConfig,
  WorkflowModeRegistration,
} from "../state-machine.ts";

// ponytail: quick workflow — same tool-driven loop as prototype, but shorter:
// grill (max 4 questions) → plan → reuse → handoff → loop → audit.
// No research phase. skipRules + closeArtifacts wired by the adapter.

const phases: Phase[] = [
  "grilling",
  "plan",
  "reuse",
  "handoff",
  "loop",
  "audit",
];

const prompts: Partial<Record<Phase, (ctx: PromptContext) => string>> = {
  grilling: ({ artifactDir, userPrompt }) =>
    `You are entering the GRILLING phase of a QUICK workflow.

User's initial request:
${userPrompt}

This phase is short: ask AT MOST 4 focused clarifying questions. Ask ONE question at a time, adapt to user answers, and dig into scope, constraints, success criteria, and edge cases.

When you have enough clarity OR when 4 questions have been asked, stop grilling. Show the user a concise requirements summary, then ask exactly: "Approve writing this requirements summary to ${artifactDir}/requirements.md?"

Artifact target for this phase: ${artifactDir}/requirements.md
- In the approval question, name exactly that full path.
- Do NOT shorten, translate, censor, sanitize, or invent a different path.
- Only once the user approves, call write_workflow_artifact with content only. Do not call write for this artifact.

The workflow advances automatically once ${artifactDir}/requirements.md exists.`,
  plan: ({ artifactDir }) =>
    `You are entering the PLAN phase.

This is a QUICK workflow — no separate research phase. Based on ${artifactDir}/requirements.md, produce the concrete build plan: what to build, how, in order, components, and what the finished prototype looks like.

Spawn the ARCHITECT SUB-AGENT to produce the plan. Use the task tool with subagent_type "architect". Do NOT pass a model parameter — let the agent use its configured model. Craft a tailored prompt from ${artifactDir}/requirements.md so the architect knows exactly what to plan for THIS task. The architect should return the plan content as its final answer; the workflow will save it to ${artifactDir}/plan.md.

The workflow advances automatically once ${artifactDir}/plan.md exists.`,
  reuse: ({ artifactDir }) =>
    `You are entering the REUSE phase.

Purpose: explore the existing codebase for reusable components, patterns, and knowledge this quick prototype should build on.

Spawn an EXPLORER SUB-AGENT to do the exploration. Use the task tool with subagent_type "explorer". Do NOT pass a model parameter — let the agent use its configured model. Craft a specific prompt tailored to THIS task from ${artifactDir}/requirements.md and ${artifactDir}/plan.md, telling the explorer which areas, patterns, and dependencies matter. The explorer should return its findings as its final answer; the workflow will save them to ${artifactDir}/reuse.md.

When the explorer returns, synthesize its findings into ${artifactDir}/reuse.md: what is reusable, where, and how the prototype should leverage it.

The workflow advances automatically once ${artifactDir}/reuse.md exists.`,
  handoff: ({ artifactDir }) =>
    `You are entering the HANDOFF phase.

Purpose: compile everything learned so far into a self-contained handoff document so loop-phase sub-agents can understand full project context without re-grilling.

Draw from ALL prior phases:
- ${artifactDir}/requirements.md
- ${artifactDir}/plan.md
- ${artifactDir}/reuse.md

Spawn the RECAPPER SUB-AGENT to compile the handoff. Use the task tool with subagent_type "recapper". Do NOT pass a model parameter — let the agent use its configured model. Craft a tailored prompt that points the recapper at all three artifact files and tells it what the prototype is about, so it writes a coherent handoff tailored to this task. The recapper should return the handoff content as its final answer; the workflow will save it to ${artifactDir}/handoff.md.

The workflow advances automatically once ${artifactDir}/handoff.md exists.`,
  loop: ({ artifactDir }) =>
    `You are entering the LOOP (orchestration) phase. Your job is to DELEGATE the implementation to sub-agents — do not implement the code yourself.

Read ${artifactDir}/plan.md, ${artifactDir}/handoff.md, and ${artifactDir}/reuse.md. Using that full context, GENERATE YOUR OWN delegation prompts:
1. Dispatch ONE builder sub-agent (task tool, subagent_type "builder"). Do NOT pass a model parameter — let the agent use its configured model. Give it the plan + handoff + reuse context, tailored to this specific task, and instruct it to implement every task in plan.md in order. All code changes go in the workspace, never in ${artifactDir}.
2. Dispatch ONE commentator sub-agent (task tool, subagent_type "commentator"). Do NOT pass a model parameter. Review the builder's diff against plan.md. Generate the review prompt YOURSELF.
3. If the commentator reports blocking issues, dispatch the builder again with the issues to fix, then re-run the commentator. Repeat until no issues.
4. Call write_workflow_artifact with a one-line summary of the finished plan.

The workflow advances to audit automatically once ${artifactDir}/loop-complete.md exists.`,
  audit: ({ artifactDir }) =>
    `You are entering the REVIEW phase.

Purpose: review uncommitted changes for correctness, plan adherence, and over-engineering. Use ponytail-review style: cut bloat, unnecessary abstractions, dead flexibility, and reinvented stdlib/native behavior.

1. Spawn the COMMENTATOR SUB-AGENT (task tool, subagent_type "commentator"). Do NOT pass a model parameter. Craft a tailored prompt from the full uncommitted diff and ${artifactDir}/plan.md. The commentator should return its review as its final answer; the workflow will save it to ${artifactDir}/review.md.

2. If ${artifactDir}/review.md lists actionable issues, spawn the BUILDER SUB-AGENT (task tool, subagent_type "builder"). Do NOT pass a model parameter. Instruct it to fix every issue in the workspace, never in ${artifactDir}.

3. Re-dispatch the commentator until ${artifactDir}/review.md says the review is clean and no issues remain.

The workflow closes automatically once ${artifactDir}/review.md exists and the commentator reports no outstanding issues.`,
};

const config: WorkflowConfig = {
  mode: "quick",
  phases,
  phaseArtifacts: {
    grilling: "requirements.md",
    plan: "plan.md",
    reuse: "reuse.md",
    handoff: "handoff.md",
    loop: "loop-complete.md",
    audit: "review.md",
  },
  prompts,
  closeArtifacts: ["review.md"],
  statusKey: "quick",
  entryType: "quick-phase",
  footerLabel: "quick",
};

export const quickMode: WorkflowModeRegistration = {
  config,
  commandName: "quick",
  commandDescription:
    "Run the quick workflow (grill → plan → reuse → handoff → loop → audit)",
  toolNames: { start: "start_quick_workflow", end: "end_quick_workflow" },
  toolLabels: { start: "Start Quick Workflow", end: "End Quick Workflow" },
};

export default quickMode;
