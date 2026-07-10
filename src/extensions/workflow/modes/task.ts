import type {
  Phase,
  PromptContext,
  WorkflowConfig,
  WorkflowModeRegistration,
} from "../state-machine.ts";
import { loopCompleteValidator, planValidator } from "../validators.ts";

// ponytail: task workflow is only plan → build↔review; the loop's clean marker
// makes it terminal-ready, and the explicit end tool is the only completion.
const phases: Phase[] = ["plan", "loop"];

const prompts: Partial<Record<Phase, (ctx: PromptContext) => string>> = {
  plan: ({ artifactDir, userPrompt }) =>
    `You are in the PLAN phase of a TASK workflow.

User request:
${userPrompt}

Produce a concrete implementation plan: what to build, how, in what order, which files, components, and what the finished result looks like.

Call the subagent tool with { agent: "architect", task: "..." } (do NOT pass a model parameter). Craft the task so the architect plans for THIS request. The architect returns the plan; the workflow saves it to ${artifactDir}/plan.md.

The plan MUST end with exactly one machine-readable line on its own:
  WORKFLOW_PLAN_STATUS: ready
The workflow will NOT advance until ${artifactDir}/plan.md contains that marker.`,
  loop: ({ artifactDir, loopMaxIterations }) =>
    `You are in the LOOP (orchestration) phase of a TASK workflow. The workflow ENGINE owns the implement→review loop — you do NOT track iterations or decide when the loop is clean.

Use read to inspect ${artifactDir}/plan.md. Using that context, GENERATE YOUR OWN delegation prompt:

Call the subagent tool with { agent: "builder", task: "..." } (do NOT pass a model parameter). Give it the plan context, tailored to this task. Instruct it to implement every task in plan.md in order. All code changes go in the workspace, never in ${artifactDir}.

After the builder returns, the workflow engine will automatically prompt you to call the commentator. Craft the review task YOURSELF. Each commentator review MUST end with exactly one machine-readable line:
  WORKFLOW_REVIEW_STATUS: clean
  OR
  WORKFLOW_REVIEW_STATUS: blocking

If a review is blocking, the engine prompts you to call the builder again with the issues. This repeats up to ${loopMaxIterations ?? 3} round(s). When a review is clean, the engine writes loop-complete.md and the workflow becomes terminal-ready. Do NOT write loop-complete.md yourself. Call end_task_workflow to complete the workflow.`,
};

const config: WorkflowConfig = {
  mode: "task",
  phases,
  phaseArtifacts: {
    plan: "plan.md",
    loop: "loop-complete.md",
  },
  prompts,
  skipRules: [],
  artifactValidators: {
    plan: planValidator,
    loop: loopCompleteValidator,
  },
  closeValidators: { "loop-complete.md": loopCompleteValidator },
  closeArtifacts: ["loop-complete.md"],
  loopMaxIterations: 3,
  statusKey: "task",
  entryType: "task-phase",
  footerLabel: "task",
};

export const taskMode: WorkflowModeRegistration = {
  config,
  commandName: "task",
  commandDescription: "Run the task workflow (plan → build↔review loop)",
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
