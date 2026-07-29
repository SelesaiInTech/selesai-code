import type {
  Phase,
  PromptContext,
  WorkflowConfig,
  WorkflowModeRegistration,
} from "../state-machine.ts";
import { loopCompleteValidator } from "../validators.ts";

// Direct build↔review mode for work whose plan already exists in the parent
// conversation. The engine persists reviewer feedback and completion; no
// planning or handoff artifact is needed.
const phases: Phase[] = ["loop"];

const prompts: Partial<Record<Phase, (ctx: PromptContext) => string>> = {
  loop: ({ artifactDir, userPrompt, loopMaxIterations }) =>
    `You are in the LOOP phase of a LOOP workflow. The user and parent already discussed the plan; do not grill, research, create a plan, or create a handoff artifact.

Original goal:
${userPrompt}

The workflow ENGINE owns build→review rounds and persists review feedback. Fresh subagents cannot see this conversation, so synthesize the agreed plan, constraints, acceptance criteria, and relevant workspace context into EVERY delegation prompt.

1. Call the subagent tool with { agent: "builder", task: "...", output: false } (do NOT pass a model parameter). Direct it to implement the agreed work in the workspace only, run relevant checks, and return an inline completion summary with checks run.
2. Call the subagent tool with { agent: "commentator", task: "...", output: false }. Give it the same agreed context. Require independent validation: inspect the uncommitted diff, verify agreed acceptance criteria and correctness, run relevant checks where feasible, and report evidence. Its review must end with exactly one machine-readable line:
   WORKFLOW_REVIEW_STATUS: clean
   OR
   WORKFLOW_REVIEW_STATUS: blocking
3. For blocking feedback, call the builder again with the persisted issues and required fixes. Do not declare success yourself. The engine repeats this for up to ${loopMaxIterations ?? 3} blocking review round(s), then pauses for inspection.

When review is clean, the engine writes ${artifactDir}/loop-complete.md and makes the workflow terminal-ready. Do NOT write that file. Verify the result, then call end_workflow with { mode: "loop" } to complete the workflow.`,
};

const config: WorkflowConfig = {
  mode: "loop",
  phases,
  phaseArtifacts: { loop: "loop-complete.md" },
  prompts,
  skipRules: [],
  artifactValidators: { loop: loopCompleteValidator },
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
