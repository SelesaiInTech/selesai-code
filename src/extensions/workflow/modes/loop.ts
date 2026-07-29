import type {
  Phase,
  PromptContext,
  WorkflowConfig,
  WorkflowModeRegistration,
} from "../state-machine.ts";
import { handoffValidator, loopCompleteValidator } from "../validators.ts";

// Direct build↔review mode with a parent-persisted handoff artifact. The handoff
// lets fresh builder/commentator subagents work from a self-contained document
// instead of relying on the parent conversation.
const phases: Phase[] = ["handoff", "loop"];

const prompts: Partial<Record<Phase, (ctx: PromptContext) => string>> = {
  handoff: ({ artifactDir, userPrompt }) =>
    `You are in the HANDOFF phase of a LOOP workflow.

Original goal:
${userPrompt}

Compile a self-contained handoff document so loop-phase sub-agents understand the goal, constraints, acceptance criteria, and relevant workspace context without re-grilling or re-planning.

Call the subagent tool with { agent: "recapper", task: "...", output: false } (do NOT pass a model parameter). Point it at the original goal above and instruct it to use the inherited conversation to produce a concise, self-contained handoff for fresh agents. It must return the complete handoff inline; do not tell it to write any artifact.

Inspect that result, verify it ends with exactly one machine-readable line on its own:
  WORKFLOW_HANDOFF_STATUS: ready
Then immediately call write_workflow_artifact with the complete validated handoff as content. Only that parent tool call writes ${artifactDir}/handoff.md and advances the workflow.`,
  loop: ({ artifactDir, userPrompt, loopMaxIterations }) =>
    `You are in the LOOP phase of a LOOP workflow. The workflow ENGINE owns build→review rounds and persists review feedback.

Original goal:
${userPrompt}

Use read to inspect ${artifactDir}/handoff.md. Using that handoff context — not the parent conversation — generate your own delegation prompt.

1. Call the subagent tool with { agent: "builder", task: "...", output: false } (do NOT pass a model parameter). Give it the handoff context. Instruct it to implement the agreed work in the workspace only, run relevant checks, and return an inline completion summary with checks run. If a previous blocking review exists (e.g. ${artifactDir}/loop-review-1.md), direct the builder to read the persisted review and address every issue before returning.
2. Call the subagent tool with { agent: "commentator", task: "...", output: false }. Give it the handoff context. Require independent validation: inspect the current uncommitted diff, verify the handoff acceptance criteria and correctness, run relevant checks where feasible, and report evidence. Its review must end with exactly one machine-readable line:
   WORKFLOW_REVIEW_STATUS: clean
   OR
   WORKFLOW_REVIEW_STATUS: blocking
3. For blocking feedback, call the builder again with the persisted issues and required fixes. Do not declare success yourself. The engine repeats this for up to ${loopMaxIterations ?? 3} blocking review round(s), then pauses for inspection.

When review is clean, the engine writes ${artifactDir}/loop-complete.md and makes the workflow terminal-ready. Do NOT write that file. Verify the result, then call end_workflow with { mode: "loop" } to complete the workflow.`,
};

const config: WorkflowConfig = {
  mode: "loop",
  phases,
  phaseArtifacts: {
    handoff: "handoff.md",
    loop: "loop-complete.md",
  },
  prompts,
  skipRules: [],
  artifactValidators: {
    handoff: handoffValidator,
    loop: loopCompleteValidator,
  },
  closeValidators: { "loop-complete.md": loopCompleteValidator },
  closeArtifacts: ["loop-complete.md"],
  loopMaxIterations: 3,
  statusKey: "loop",
  entryType: "loop-phase",
  footerLabel: "loop",
};

export const loopMode: WorkflowModeRegistration = {
  config,
  commandName: "workflow-loop",
  commandDescription:
    "Run the direct build↔review workflow for an already-agreed plan",
};

export default loopMode;
