// ponytail: four workflow modes as pi-subagents workflowScript builders.
// One-shot-and-sleep: phases run as runs.run steps and the loop auto-repeats
// until the reviewer reports clean. A workflowScript has no checkpoints, so
// there are no human gates.

function js(value: string): string {
  return JSON.stringify(value);
}

const AUTO_LOOP = String.raw`
const autoLoop = async (goal, context) => {
  let round = 1;
  while (true) {
    const build = await runs.run('build-' + round, {
      agent: 'builder',
      task: 'Implement the approved work in the workspace and run relevant checks.\n\nSource of truth (handoff/plan):\n' + context + '\n\nGoal:\n' + goal + (round > 1 ? '\n\nAddress the previous review feedback first.' : ''),
    });
    const review = await runs.run('review-' + round, {
      agent: 'commentator',
      task: 'Independently review the uncommitted diff and report concrete evidence (what you inspected and what you ran). Do not modify the workspace.\n\nAcceptance criteria (source of truth):\n' + context + '\n\nBuilder completion summary:\n' + build.output + '\n\nEnd with exactly one line: WORKFLOW_REVIEW_STATUS: clean OR WORKFLOW_REVIEW_STATUS: blocking.',
    });
    if (/WORKFLOW_REVIEW_STATUS\s*:\s*clean/i.test(review.output)) {
      return { result: 'clean', rounds: round };
    }
    round += 1;
  }
};`;

export function buildLoopScript(goal: string): string {
  return String.raw`const goal = ${js(goal)};
${AUTO_LOOP}
return await autoLoop(goal, goal);`;
}

export function buildTaskScript(goal: string): string {
  return String.raw`const goal = ${js(goal)};
const plan = await runs.run('plan', { agent: 'architect', task: 'Produce a concrete implementation plan for: ' + goal + '. Cover what to build, how, in what order, which files and components, and the finished result. Return inline.' });
const reuse = await runs.run('reuse', { agent: 'explorer', task: 'Explore the codebase for reusable patterns relevant to: ' + plan.output + '. Point at relevant areas and dependencies; skip cleanly if wholly new. Return inline.' });
const handoff = await runs.run('handoff', { agent: 'recapper', task: 'Compile a self-contained handoff from the plan and reuse findings so fresh agents understand the goal, constraints, and acceptance criteria without re-planning.\n\nPlan:\n' + plan.output + '\n\nReuse findings:\n' + reuse.output + '\n\nReturn inline.' });
${AUTO_LOOP}
return await autoLoop(goal, handoff.output);`;
}

export function buildPrototypeScript(goal: string): string {
  return String.raw`const goal = ${js(goal)};
const research = await runs.run('research', { agent: 'researcher', task: 'Research the external, fast-changing knowledge this task depends on (libraries, SDKs, APIs, unfamiliar alternatives). Task: ' + goal + '. Synthesize actionable findings with sources. Return inline.' });
const plan = await runs.run('plan', { agent: 'architect', task: 'Produce a concrete build plan from the research findings.\n\nResearch:\n' + research.output + '\n\nRequest:\n' + goal + '\n\nReturn inline.' });
const reuse = await runs.run('reuse', { agent: 'explorer', task: 'Explore the codebase for reusable patterns relevant to: ' + plan.output + '. Return inline.' });
const handoff = await runs.run('handoff', { agent: 'recapper', task: 'Compile a self-contained handoff from the plan and reuse findings.\n\nPlan:\n' + plan.output + '\n\nReuse:\n' + reuse.output + '\n\nReturn inline.' });
${AUTO_LOOP}
const loop = await autoLoop(goal, handoff.output);
const audit = await runs.run('audit', { agent: 'commentator', task: 'Final audit of the uncommitted changes for correctness, plan adherence, and over-engineering (cut bloat, dead flexibility, reinvented stdlib). Plan:\n' + plan.output + '\n\nReport concrete evidence. Do not modify the workspace.' });
return { ...loop, audited: true };`;
}

export function buildQuicktypeScript(goal: string): string {
  return String.raw`const goal = ${js(goal)};
const plan = await runs.run('plan', { agent: 'architect', task: 'Produce a concrete build plan for: ' + goal + '. Cover what to build, how, in what order, which components, and the finished result. Return inline.' });
const reuse = await runs.run('reuse', { agent: 'explorer', task: 'Explore the codebase for reusable patterns relevant to: ' + plan.output + '. Return inline.' });
const handoff = await runs.run('handoff', { agent: 'recapper', task: 'Compile a self-contained handoff from the plan and reuse findings.\n\nPlan:\n' + plan.output + '\n\nReuse:\n' + reuse.output + '\n\nReturn inline.' });
${AUTO_LOOP}
const loop = await autoLoop(goal, handoff.output);
const audit = await runs.run('audit', { agent: 'commentator', task: 'Final audit of the uncommitted changes for correctness, plan adherence, and over-engineering (cut bloat, dead flexibility, reinvented stdlib). Plan:\n' + plan.output + '\n\nReport concrete evidence. Do not modify the workspace.' });
return { ...loop, audited: true };`;
}
