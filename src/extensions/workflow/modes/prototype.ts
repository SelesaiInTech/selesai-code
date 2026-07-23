import type {
  Phase,
  PromptContext,
  WorkflowConfig,
  WorkflowModeRegistration,
} from "../state-machine.ts";
import {
  handoffValidator,
  loopCompleteValidator,
  planValidator,
  reviewValidator,
} from "../validators.ts";

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
    `You are in the GRILLING phase of a prototype workflow.

User request:
${userPrompt}

Use the question tool to grill the user until requirements are unambiguous. Ask focused clarifying questions ONE question tool call at a time. Adapt each follow-up to what the user reveals. Dig into scope, constraints, success criteria, and edge cases. Use your judgement — no fixed checklist.

For each question tool call:
- Provide a concise question.
- Pass a short context summary when it depends on prior findings.
- Prefer options when choices are known. Give each option a clear label and a brief description.
- Always set allowFreeform=true so the user can type a custom answer.
- Keep allowMultiple=false unless multiple selections genuinely apply.

Example:
  question({
    question: "What should the output format be?",
    context: "The user wants a report generator. We need to pick the default export format.",
    options: [
      { label: "Markdown", description: "Simple, version-control friendly" },
      { label: "PDF", description: "Polished, shareable document" },
    ],
    allowFreeform: true,
  })

When shared understanding is reached, do NOT write the file yet. Show a concise requirements summary draft and ask exactly: "Approve writing this requirements summary to ${artifactDir}/requirements.md?" Allow "keep grilling" or added details.

Artifact target: ${artifactDir}/requirements.md
- Name that exact full path in the approval question.
- Do NOT shorten, translate, censor, sanitize, or invent a different path.
- Only after explicit approval, call write_workflow_artifact with content only. Do not use write.

The workflow advances once ${artifactDir}/requirements.md exists.`,
  research: ({ artifactDir }) =>
    `You are in the RESEARCH phase (optional).

Only research if the task depends on fast-changing external knowledge (libraries, frameworks, languages/SDKs, APIs, or unfamiliar alternatives). Skip what you already know well.

Decide: is research needed?
- If YES: use web_search_exa or webfetch via bash to gather current, authoritative information, then synthesize actionable findings (versions, APIs, pitfalls, recommended approaches).
- If NO: skip real research.

Either way, call write_workflow_artifact with research.md content. If skipped, state briefly why. If researched, record findings the plan can rely on.

The workflow advances once ${artifactDir}/research.md exists.`,
  plan: ({ artifactDir }) =>
    `You are in the PLAN phase.

Produce the concrete build plan for the actual prototype/output — not a plan for research. Use ${artifactDir}/requirements.md and ${artifactDir}/research.md (if it contains real findings). Cover what to build, how, in what order, which components, and what the finished prototype looks like.

If research was skipped, proceed directly — you already understand the user's intent from grilling.

Call the subagent tool with { agent: "architect", task: "...", output: false } (do NOT pass a model parameter). Craft the task from ${artifactDir}/requirements.md and ${artifactDir}/research.md so the architect plans for THIS task. It must return the complete plan inline; do not tell it to write any artifact.

Inspect that result, verify it ends with exactly one machine-readable line on its own:
  WORKFLOW_PLAN_STATUS: ready
Then immediately call write_workflow_artifact with the complete validated plan as content. Only that parent tool call writes ${artifactDir}/plan.md and advances the workflow.`,
  reuse: ({ artifactDir }) =>
    `You are in the REUSE phase (optional).

Decide whether codebase exploration is useful. Skip if the project is empty, the task creates something wholly new, or there is clearly nothing to reuse.

If unsure, ask the user one focused question: "Should I explore the existing codebase for reusable patterns before implementing?" Then follow their answer.

If YES (or user confirms): call the subagent tool with { agent: "explorer", task: "...", output: false } (do NOT pass a model parameter). Craft the task from ${artifactDir}/requirements.md and ${artifactDir}/plan.md pointing it at relevant areas, patterns, and dependencies (e.g., Tailwind setup, state-machine usage). It must return the reuse findings inline; do not tell it to write any artifact. Immediately call write_workflow_artifact with those findings as content for ${artifactDir}/reuse.md.

If NO: call write_workflow_artifact with a brief skip note explaining why.

The workflow advances once ${artifactDir}/reuse.md exists.`,
  handoff: ({ artifactDir }) =>
    `You are in the HANDOFF phase.

Compile a self-contained handoff document so loop-phase sub-agents understand full project context without re-grilling.

Draw from all prior phases:
- ${artifactDir}/requirements.md (grilling outcomes)
- ${artifactDir}/research.md (research, or the skip note)
- ${artifactDir}/plan.md (the build plan)
- ${artifactDir}/reuse.md (codebase exploration findings)

Call the subagent tool with { agent: "recapper", task: "...", output: false } (do NOT pass a model parameter). Craft the task pointing the recapper at all four artifact files and telling it what the prototype is about. It must return the complete handoff inline; do not tell it to write any artifact.

Inspect that result, verify it ends with exactly one machine-readable line on its own:
  WORKFLOW_HANDOFF_STATUS: ready
Then immediately call write_workflow_artifact with the complete validated handoff as content. Only that parent tool call writes ${artifactDir}/handoff.md and advances the workflow.`,
  loop: ({ artifactDir, loopMaxIterations }) =>
    `You are in the LOOP (orchestration) phase. The workflow ENGINE owns the implement→review loop — you do NOT track iterations or decide when the loop is clean.

Use read to inspect ${artifactDir}/plan.md, ${artifactDir}/handoff.md, ${artifactDir}/research.md, and ${artifactDir}/reuse.md. Using that context, GENERATE YOUR OWN delegation prompt (no static template):

Call the subagent tool with { agent: "builder", task: "...", output: false } (do NOT pass a model parameter). Give it plan + handoff + any research/reuse context, tailored to this task. Instruct it to implement every task in plan.md in order. All code changes go in the workspace, never in ${artifactDir}. The builder must return its completion summary inline.

After the builder returns, call the subagent tool with { agent: "commentator", task: "...", output: false }. Craft the review task YOURSELF based on what matters for this task. The commentator must return its review inline. Each commentator review MUST end with exactly one machine-readable line:
  WORKFLOW_REVIEW_STATUS: clean
  OR
  WORKFLOW_REVIEW_STATUS: blocking

If a review is blocking, call the builder again with the recorded issues. This repeats up to ${loopMaxIterations ?? 3} round(s). When a review is clean, the engine writes loop-complete.md and advances to audit. Do NOT write loop-complete.md yourself.`,
  audit: ({ artifactDir }) =>
    `You are in the AUDIT (review) phase.

Review uncommitted changes for correctness, plan adherence, and over-engineering. Use ponytail-review style: cut bloat, unnecessary abstractions, dead flexibility, and reinvented stdlib/native behavior.

1. Call the subagent tool with { agent: "commentator", task: "...", output: false } (do NOT pass a model parameter). Craft the task from the full uncommitted diff and ${artifactDir}/plan.md. It must return the review inline; do not tell it to write any artifact. Verify the review ends with exactly one machine-readable line, WORKFLOW_REVIEW_STATUS: clean or WORKFLOW_REVIEW_STATUS: blocking, then immediately call write_workflow_artifact with that review as content for ${artifactDir}/review.md.
2. If that review lists actionable issues, call the subagent tool with { agent: "builder", task: "...", output: false } (do NOT pass a model parameter). Instruct it to fix every issue in the workspace, never in ${artifactDir}, then return its completion summary inline.
3. Re-dispatch the commentator and overwrite the parent-owned review artifact through write_workflow_artifact until it ends with WORKFLOW_REVIEW_STATUS: clean.

Once ${artifactDir}/review.md exists and ends with the WORKFLOW_REVIEW_STATUS: clean marker, call end_workflow with { mode: "prototype" } to complete the workflow.`,
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
  // ponytail: Plan 4 — semantic gates for the critical phases. Existence
  // is still required, but the file content must also carry its marker line
  // so an empty/stub file cannot silently advance the workflow.
  artifactValidators: {
    plan: planValidator,
    handoff: handoffValidator,
    loop: loopCompleteValidator,
  },
  closeValidators: { "review.md": reviewValidator },
  closeArtifacts: ["review.md"],
  loopMaxIterations: 3,
  statusKey: "prototype",
  entryType: "prototype-phase",
  footerLabel: "prototype",
};

export const prototypeMode: WorkflowModeRegistration = {
  config,
  commandName: "workflow-prototype",
  commandDescription:
    "Run the prototype workflow (grill → research → plan → reuse → handoff → loop → audit)",
};

export default prototypeMode;
