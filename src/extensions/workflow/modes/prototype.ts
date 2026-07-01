import type {
  Phase,
  PromptContext,
  WorkflowConfig,
} from "../state-machine.ts";
import { createWorkflowExtension } from "../adapter.ts";

// ponytail: prototype workflow — full 7-phase tool-driven loop:
// grill → research → plan → reuse → handoff → loop → audit.
// skipRules + closeArtifacts are wired by the adapter (git reuse-skip is
// shared by every mode today); this file is pure phase/prompt config.

const phases: Phase[] = [
  "grilling",
  "research",
  "plan",
  "reuse",
  "handoff",
  "loop",
  "audit",
];

const prompts: Partial<Record<Phase, (ctx: PromptContext) => string>> = {
  grilling: ({ artifactDir, userPrompt }) =>
    `You are entering the GRILLING phase of a prototype workflow.

User's initial request:
${userPrompt}

The purpose of this phase is NOT to start solving — it is to INTERVIEW the user until the requirements are unambiguous. You are the interviewer: drive the conversation. Ask focused clarifying questions ONE at a time, and adapt each question to what the user reveals. Dig into scope, constraints, success criteria, edge cases, and anything ambiguous. Use your own judgement to decide what still needs clarifying — do not follow a fixed checklist. Provide rich context in your questions so the user understands why each matters.

When you and the user have reached shared understanding, DO NOT write the file yet. First show the user a concise draft of the requirements summary and ask explicitly whether they approve committing it, want to keep grilling, or just remembered something to add.

Artifact target for this phase: ${artifactDir}/requirements.md
- In the approval question, name exactly that full path.
- Do NOT shorten it to requirements.md, ./requirements.md, ./.requirements.md, or any other path.
- Only once the user explicitly approves, call the write tool with path exactly ${artifactDir}/requirements.md.

The workflow advances automatically once ${artifactDir}/requirements.md exists.`,
  research: ({ artifactDir }) =>
    `You are entering the RESEARCH phase. This phase is OPTIONAL.

Research is only needed when the task depends on external knowledge that changes fast: libraries, frameworks, languages/SDKs, APIs, or alternative approaches you are not already confident about. Do NOT research things you already know well enough, and do not waste tokens on unnecessary lookups.

First decide: is research needed here?
- If YES: use web search tools (webfetch / web_search_exa) to gather current, authoritative information on the relevant libraries/frameworks/approaches, then synthesize actionable findings (versions, APIs, pitfalls, recommended approaches).
- If NO: skip real research.

Either way, write ${artifactDir}/research.md. If you skipped, state briefly WHY research was unnecessary so downstream phases know. If you researched, record findings the plan can rely on.

The workflow advances automatically once ${artifactDir}/research.md exists.`,
  plan: ({ artifactDir }) =>
    `You are entering the PLAN phase.

This plan is for the ACTUAL prototype/output the user wants — not a plan for research. Based on ${artifactDir}/requirements.md (and ${artifactDir}/research.md if it contains real research), produce the concrete build plan: what to build, how, in what order, which components, and what the finished prototype looks like.

If research was skipped, that is fine — proceed directly. You already understand the user's intent from grilling.

Spawn the ARCHITECT SUB-AGENT to produce the plan. Use the task tool with subagent_type "architect". Do NOT pass a model parameter — let the agent use its configured model. Craft a tailored prompt from ${artifactDir}/requirements.md and ${artifactDir}/research.md so the architect knows exactly what to plan for THIS task. The architect writes to ${artifactDir}/plan.md.

The workflow advances automatically once ${artifactDir}/plan.md exists.`,
  reuse: ({ artifactDir }) =>
    `You are entering the REUSE phase.

Purpose: explore the existing codebase for reusable components, patterns, and knowledge this prototype should build on, so you do not reinvent what already exists.

Spawn an EXPLORER SUB-AGENT to do the exploration. Use the task tool with subagent_type "explorer". Do NOT pass a model parameter — let the agent use its configured model. Do NOT send a generic exploration prompt — CRAFT a specific prompt tailored to THIS task: from ${artifactDir}/requirements.md and ${artifactDir}/plan.md, tell the explorer exactly which areas of the codebase, which patterns, and which dependencies are relevant. For example, if the user wants Tailwind, have the explorer determine how Tailwind is already set up and used here and what conventions to follow. Instruct the explorer to write its findings to ${artifactDir}/reuse.md.

When the explorer returns, synthesize its findings into ${artifactDir}/reuse.md: what is reusable, where, and how the prototype should leverage it.

The workflow advances automatically once ${artifactDir}/reuse.md exists.`,
  handoff: ({ artifactDir }) =>
    `You are entering the HANDOFF phase.

Purpose: compile everything you have learned so far into a self-contained handoff document so the sub-agents in the loop phase can understand the full project context without re-grilling.

Draw from ALL prior phases:
- ${artifactDir}/requirements.md (grilling outcomes)
- ${artifactDir}/research.md (research, or the skip note)
- ${artifactDir}/plan.md (the build plan)
- ${artifactDir}/reuse.md (codebase exploration findings)

Spawn the RECAPPER SUB-AGENT to compile the handoff. Use the task tool with subagent_type "recapper". Do NOT pass a model parameter — let the agent use its configured model. Craft a tailored prompt that points the recapper at all four artifact files and tells it what the prototype is about, so it can write a coherent handoff tailored to this task. The recapper writes to ${artifactDir}/handoff.md.

The workflow advances automatically once ${artifactDir}/handoff.md exists.`,
  loop: ({ artifactDir }) =>
    `You are entering the LOOP (orchestration) phase. Your job is to DELEGATE the implementation to sub-agents — do not implement the code yourself.

Read ${artifactDir}/plan.md, ${artifactDir}/handoff.md, ${artifactDir}/research.md, and ${artifactDir}/reuse.md. Using that full context, GENERATE YOUR OWN delegation prompts (do not use a static template):
1. Dispatch ONE builder sub-agent (task tool, subagent_type "builder"). Do NOT pass a model parameter — let the agent use its configured model. Craft a prompt: give it the plan + handoff + any research/reuse context it needs, tailored to this specific task, and instruct it to implement every task in plan.md in order. All code changes go in the workspace, never in ${artifactDir}.
2. Dispatch ONE commentator sub-agent (task tool, subagent_type "commentator"). Do NOT pass a model parameter. Review the builder's diff against plan.md. Generate the review prompt YOURSELF based on what matters for this task.
3. If the commentator reports blocking issues, dispatch the builder again with the issues to fix, then re-run the commentator. Repeat until no issues.
4. Write ${artifactDir}/loop-complete.md with a one-line summary of the finished plan.

Generate the prompts with full awareness of the task — tailored, not generic. The workflow advances to audit automatically once ${artifactDir}/loop-complete.md exists.`,
  audit: ({ artifactDir }) =>
    `You are entering the AUDIT phase.

Purpose: review the changes made during the loop phase, then audit for over-engineering across the repo — and ACT on findings so no tech debt ships.

Two sub-agent rounds:

1. Spawn the COMMENTATOR SUB-AGENT (task tool, subagent_type "commentator"). Do NOT pass a model parameter — let the agent use its configured model. Craft a tailored prompt from the full diff and ${artifactDir}/plan.md so the commentator reviews correctness and plan-adherence (writing ${artifactDir}/review.md), then runs a whole-repo over-engineering audit (writing ${artifactDir}/audit.md). Give the commentator the diff context and tell it which files matter.

2. If ${artifactDir}/review.md or ${artifactDir}/audit.md lists any actionable issues, spawn the BUILDER SUB-AGENT (task tool, subagent_type "builder"). Do NOT pass a model parameter. Craft a tailored prompt containing the commentator's findings. Instruct the builder to FIX every issue: trim over-engineering, delete dead code, remove unnecessary abstractions, correct plan deviations. All fixes go in the workspace, never in ${artifactDir}. Do not leave findings unresolved — no tech debt carries past this phase.

3. After the builder returns, re-dispatch the commentator to confirm the fixes resolved the findings and no new issues appeared. Repeat commentator→builder until the commentator reports a clean review.

4. Update ${artifactDir}/audit.md with the final resolved state (what was found, what the builder fixed, what remains — should be none).

The workflow closes automatically once both ${artifactDir}/review.md and ${artifactDir}/audit.md exist and the commentator reports no outstanding issues.`,
};

const config: WorkflowConfig = {
  mode: "prototype",
  phases,
  phaseArtifacts: {
    grilling: "requirements.md",
    research: "research.md",
    plan: "plan.md",
    reuse: "reuse.md",
    handoff: "handoff.md",
    loop: "loop-complete.md",
    audit: "review.md",
  },
  prompts,
  closeArtifacts: ["review.md", "audit.md"],
  statusKey: "prototype",
  entryType: "prototype-phase",
  footerLabel: "prototype",
};

export default createWorkflowExtension(config, {
  commandName: "prototype",
  commandDescription:
    "Run the prototype workflow (grill → research → plan → reuse → handoff → loop → audit)",
  toolNames: { start: "start_workflow", next: "next_step", end: "end_workflow" },
  toolLabels: {
    start: "Start Workflow",
    next: "Next Step",
    end: "End Workflow",
  },
});
