// ponytail: workflow mode registry over pi-subagents' public workflowScript seam.
// A mode returns launch parameters; the extension owns slash-command plumbing.

import type { SubagentParamsLike } from "../pi-subagents/src/runs/foreground/subagent-executor.ts";

export interface WorkflowMode {
	command: string;
	description: string;
	launch(goal: string): Pick<SubagentParamsLike, "workflowScript" | "chain" | "tasks" | "concurrency">;
}

function js(value: string): string {
	return JSON.stringify(value);
}

// A loop depends on the previous review's output, so it belongs in pi-subagents'
// scripted workflow runtime rather than a fixed native chain.
const AUTO_LOOP = String.raw`
const autoLoop = async (goal, context, progressFile) => {
  emit({ phase: 'start', goal });
  let round = 1;
  let previousReview = '';
  let completed = 0;
  while (true) {
    try {
      const build = await runs.run('build-' + round, {
        agent: 'builder',
        timeoutMs: 45 * 60 * 1000,
        task: 'Implement the next bounded step of the approved work in the workspace and run relevant checks. Work on one small, self-contained slice this round; do not attempt the whole plan.\n\nSource of truth (handoff/plan):\n' + context + '\n\nGoal:\n' + goal + (round > 1 ? '\n\nPrevious review (its findings were addressed in the fix round; use its "Remaining work" notes to pick your next slice, do not re-apply findings):\n' + previousReview : '') + '\n\nRead the progress file first for prior-round context.\n\nProgress ledger: append a "## Round ' + round + '" entry to the progress file at ' + progressFile + ' before finishing. List every file you changed and a short summary of the work.',
      });
      const review = await runs.run('review-' + round, {
        agent: 'commentator',
        timeoutMs: 15 * 60 * 1000,
        task: 'Independently review the builder work for this round and report concrete evidence (what you inspected and what you ran). Do not modify the workspace.\n\nAcceptance criteria (source of truth):\n' + context + '\n\nProgress file (scope your review to its latest round entry; also re-check the files from the immediately preceding fix entry if one exists; fall back to the full uncommitted diff if it is missing or empty):\n' + progressFile + '\n\nBuilder completion summary:\n' + build.output + '\n\nIf the plan is not yet complete, add a "Remaining work:" section listing the next concrete step(s). End with exactly one line: WORKFLOW_REVIEW_STATUS: clean OR WORKFLOW_REVIEW_STATUS: blocking.',
      });
      const hasRemainingWork = /Remaining work\s*:\s*\S/i.test(review.output);
      if (/WORKFLOW_REVIEW_STATUS\s*:\s*clean/i.test(review.output) && !hasRemainingWork) {
        return { result: 'clean', rounds: completed + 1 };
      }
      previousReview = review.output;
      await runs.run('fix-' + round, {
        agent: 'builder',
        timeoutMs: 45 * 60 * 1000,
        task: 'Address ONLY the findings from the review below. The "Remaining work:" section (if present) is for the next round; do not act on it. If the review is clean but has Remaining work, make no changes and record that fact.\n\nProgress ledger: append a "## Round ' + round + ' fix" entry to the progress file at ' + progressFile + ' before finishing. List every file you changed and a short summary of the fixes.\n\nReviewer findings:\n' + review.output,
      });
      completed += 1;
      round += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/Run fan-out limit reached/i.test(message)) {
        return { result: 'budget', rounds: completed, note: 'Run fan-out budget exhausted before the goal was reached. The progress file is current.' };
      }
      throw error;
    }
  }
};`;

const PROGRESS_DIR = ".pi-subagents/progress/";

export function buildLoopScript(goal: string): string {
	return String.raw`const goal = ${js(goal)};
${AUTO_LOOP}
return await autoLoop(goal, goal, ${js(PROGRESS_DIR + "loop.md")});`;
}

export function buildTaskScript(goal: string): string {
	return String.raw`const goal = ${js(goal)};
const plan = await runs.run('plan', { agent: 'architect', task: 'Produce a concrete implementation plan for: ' + goal + '. Cover what to build, how, in what order, which files and components, and the finished result. Return inline.' });
const reuse = await runs.run('reuse', { agent: 'explorer', task: 'Explore the codebase for reusable patterns relevant to: ' + plan.output + '. Point at relevant areas and dependencies; skip cleanly if wholly new. Return inline.' });
const handoff = await runs.run('handoff', { agent: 'recapper', task: 'Compile a self-contained handoff from the plan and reuse findings so fresh agents understand the goal, constraints, and acceptance criteria without re-planning.\n\nPlan:\n' + plan.output + '\n\nReuse findings:\n' + reuse.output + '\n\nReturn inline.' });
${AUTO_LOOP}
return await autoLoop(goal, handoff.output, ${js(PROGRESS_DIR + "task.md")});`;
}

export function buildPrototypeScript(goal: string): string {
	return String.raw`const goal = ${js(goal)};
const discovery = await runs.all([
  { key: 'research', agent: 'researcher', task: 'Research the external, fast-changing knowledge this task depends on (libraries, SDKs, APIs, unfamiliar alternatives). Task: ' + goal + '. Synthesize actionable findings with sources. Return inline.' },
  { key: 'explore', agent: 'explorer', task: 'Map existing code, dependencies, and reusable patterns relevant to: ' + goal + '. Return inline.' },
]);
const research = discovery.find(result => result.key === 'research');
const reuse = discovery.find(result => result.key === 'explore');
const plan = await runs.run('plan', { agent: 'architect', task: 'Produce a concrete build plan from the research and codebase findings.\n\nResearch:\n' + research.output + '\n\nCodebase findings:\n' + reuse.output + '\n\nRequest:\n' + goal + '\n\nReturn inline.' });
const handoff = await runs.run('handoff', { agent: 'recapper', task: 'Compile a self-contained handoff from the plan and reuse findings.\n\nPlan:\n' + plan.output + '\n\nReuse:\n' + reuse.output + '\n\nReturn inline.' });
${AUTO_LOOP}
const loop = await autoLoop(goal, handoff.output, ${js(PROGRESS_DIR + "prototype.md")});
const audit = await runs.run('audit', { agent: 'commentator', task: 'Final audit of the uncommitted changes for correctness, plan adherence, and over-engineering (cut bloat, dead flexibility, reinvented stdlib). Plan:\n' + plan.output + '\n\nReport concrete evidence. Do not modify the workspace.' });
return { ...loop, audited: true };`;
}

export function buildQuicktypeScript(goal: string): string {
	return String.raw`const goal = ${js(goal)};
const plan = await runs.run('plan', { agent: 'architect', task: 'Produce a concrete build plan for: ' + goal + '. Cover what to build, how, in what order, which components, and the finished result. Return inline.' });
const reuse = await runs.run('reuse', { agent: 'explorer', task: 'Explore the codebase for reusable patterns relevant to: ' + plan.output + '. Return inline.' });
const handoff = await runs.run('handoff', { agent: 'recapper', task: 'Compile a self-contained handoff from the plan and reuse findings.\n\nPlan:\n' + plan.output + '\n\nReuse:\n' + reuse.output + '\n\nReturn inline.' });
${AUTO_LOOP}
const loop = await autoLoop(goal, handoff.output, ${js(PROGRESS_DIR + "quicktype.md")});
const audit = await runs.run('audit', { agent: 'commentator', task: 'Final audit of the uncommitted changes for correctness, plan adherence, and over-engineering (cut bloat, dead flexibility, reinvented stdlib). Plan:\n' + plan.output + '\n\nReport concrete evidence. Do not modify the workspace.' });
return { ...loop, audited: true };`;
}

export const WORKFLOW_MODES: readonly WorkflowMode[] = [
	{ command: "workflow-task", description: "Run the task workflow (plan → reuse → handoff → build/review/fix loop).", launch: (goal) => ({ workflowScript: buildTaskScript(goal) }) },
	{ command: "workflow-prototype", description: "Run the prototype workflow (parallel research/reuse → plan → handoff → loop → audit).", launch: (goal) => ({ workflowScript: buildPrototypeScript(goal) }) },
	{ command: "workflow-quicktype", description: "Run the quicker prototype workflow (plan → reuse → handoff → loop → audit).", launch: (goal) => ({ workflowScript: buildQuicktypeScript(goal) }) },
	{ command: "workflow-loop", description: "Run a direct build/review/fix loop for an already-agreed plan.", launch: (goal) => ({ workflowScript: buildLoopScript(goal) }) },
];
