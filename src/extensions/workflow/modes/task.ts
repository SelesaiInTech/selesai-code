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
} from "../validators.ts";

// ponytail: task workflow is now plan → reuse → handoff → loop. Each parent-
// owned artifact (plan.md, reuse.md, handoff.md) advances automatically, and
// the loop's clean marker makes the workflow terminal-ready. The explicit end
// tool is the only completion.
const phases: Phase[] = ["plan", "reuse", "handoff", "loop"];

const prompts: Partial<Record<Phase, (ctx: PromptContext) => string>> = {
  plan: ({ artifactDir, userPrompt }) =>
    `You are in the PLAN phase of a TASK workflow.

User request:
${userPrompt}

Produce a concrete implementation plan: what to build, how, in what order, which files, components, and what the finished result looks like.

Call the subagent tool with { agent: "architect", task: "...", output: false } (do NOT pass a model parameter). Craft the task so the architect plans for THIS request. It must return the complete plan inline; do not tell it to write any artifact.

Inspect that result, verify it ends with exactly one machine-readable line on its own:
  WORKFLOW_PLAN_STATUS: ready
Then immediately call write_workflow_artifact with the complete validated plan as content. Only that parent tool call writes ${artifactDir}/plan.md and advances the workflow.`,
  reuse: ({ artifactDir }) =>
    `You are in the REUSE phase of a TASK workflow (optional).

The adapter automatically skips this phase when the project has no git history, so codebase exploration is only useful when commits already exist. Decide whether exploration is still useful; skip if the task creates something wholly new or there is clearly nothing to reuse.

If unsure, ask the user one focused question: "Should I explore the existing codebase for reusable patterns before implementing?" Then follow their answer.

If YES (or user confirms): call the subagent tool with { agent: "explorer", task: "...", output: false } (do NOT pass a model parameter). Craft the task from ${artifactDir}/plan.md pointing it at relevant areas, patterns, and dependencies. It must return the reuse findings inline; do not tell it to write any artifact. Immediately call write_workflow_artifact with those findings as content for ${artifactDir}/reuse.md.

If NO: call write_workflow_artifact with a brief skip note explaining why.

The workflow advances once ${artifactDir}/reuse.md exists.`,
  handoff: ({ artifactDir }) =>
    `You are in the HANDOFF phase of a TASK workflow.

Compile a self-contained handoff document so loop-phase sub-agents understand full project context without re-grilling.

Draw from all prior phases:
- ${artifactDir}/plan.md
- ${artifactDir}/reuse.md

Call the subagent tool with { agent: "recapper", task: "...", output: false } (do NOT pass a model parameter). Craft the task pointing the recapper at both artifact files and telling it what the task is about. It must return the complete handoff inline; do not tell it to write any artifact.

Inspect that result, verify it ends with exactly one machine-readable line on its own:
  WORKFLOW_HANDOFF_STATUS: ready
Then immediately call write_workflow_artifact with the complete validated handoff as content. Only that parent tool call writes ${artifactDir}/handoff.md and advances the workflow.`,
  loop: ({ artifactDir, loopMaxIterations }) =>
    `You are in the LOOP (orchestration) phase of a TASK workflow. The workflow ENGINE owns the implement→review loop — you do NOT track iterations or decide when the loop is clean.

Use read to inspect ${artifactDir}/plan.md, ${artifactDir}/reuse.md, and ${artifactDir}/handoff.md. Using that context, GENERATE YOUR OWN delegation prompt:

Call the subagent tool with { agent: "builder", task: "...", output: false } (do NOT pass a model parameter). Give it plan + reuse + handoff context, tailored to this task. Instruct it to implement every task in plan.md in order. All code changes go in the workspace, never in ${artifactDir}. The builder must return its completion summary inline.

After the builder returns, call the subagent tool with { agent: "commentator", task: "...", output: false }. Craft the review task YOURSELF. The commentator must return its review inline. Each commentator review MUST end with exactly one machine-readable line:
  WORKFLOW_REVIEW_STATUS: clean
  OR
  WORKFLOW_REVIEW_STATUS: blocking

If a review is blocking, call the builder again with the recorded issues. This repeats up to ${loopMaxIterations ?? 3} round(s). When a review is clean, the engine writes loop-complete.md and the workflow becomes terminal-ready. Do NOT write loop-complete.md yourself. Call end_task_workflow to complete the workflow.`,
};

const config: WorkflowConfig = {
  mode: "task",
  phases,
  phaseArtifacts: {
    plan: "plan.md",
    reuse: "reuse.md",
    handoff: "handoff.md",
    loop: "loop-complete.md",
  },
  prompts,
  skipRules: [],
  artifactValidators: {
    plan: planValidator,
    handoff: handoffValidator,
    loop: loopCompleteValidator,
  },
  closeValidators: { "loop-complete.md": loopCompleteValidator },
  closeArtifacts: ["loop-complete.md"],
  loopMaxIterations: 3,
  // Each parent-owned artifact automatically queues the next phase prompt.
  continueAfterArtifact: true,
  statusKey: "task",
  entryType: "task-phase",
  footerLabel: "task",
};

export const taskMode: WorkflowModeRegistration = {
  config,
  commandName: "workflow-task",
  commandDescription:
    "Run the task workflow (plan → reuse → handoff → build↔review loop)",
  toolNames: {
    start: "start_task_workflow",
    resume: "resume_task_workflow",
    end: "end_task_workflow",
  },
  toolLabels: {
    start: "Start Task Workflow",
    resume: "Resume Task Workflow",
    end: "End Task Workflow",
  },
};

export default taskMode;
