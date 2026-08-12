# Workflow auto-loop reference (implement exactly)

> **Superseded:** the 3-round cap was later removed — the loop now runs until
> clean. See `src/extensions/workflow/modes.ts` for the final implementation.

Convert the four `/workflow-*` modes from static chains to pi-subagents
`workflowScript` auto-loops. One-shot-and-sleep: the phases run as `runs.run`
steps and the build↔review phase auto-repeats until the commentator reports
clean or the cap (3) is hit. A `workflowScript` has no checkpoints, so there are
no human gates — intentional.

## Files

- Rewrite `src/extensions/workflow/modes.ts` → `build*Script(goal)` builders.
- Rewrite `src/extensions/workflow/extension.ts` → launch `workflowScript`.
- Rewrite `src/__tests__/workflow-modes.test.ts` → test the builders.
- Update docs: `doc-web/src/content/docs/capabilities/delegation/workflow.mdx`
  (EN), `.../id/capabilities/delegation/workflow.mdx` (ID),
  `.../pi-subagents.mdx`, `doc-web/src/data/capabilities.ts`,
  `doc-web/src/data/extension-customization.json`.
- Update skill `references/execution-controls.md` (3 copies, byte-identical):
  `src/extensions/pi-subagents/skills/pi-subagents` ↔ `src/skills/pi-subagents`
  ↔ `~/.selesai/agent/skills`.

## Correctness rules (must hold)

1. Every script template uses `String.raw` so `\n` and the regex `\s` stay
   literal in the generated JS.
2. The goal is injected with `JSON.stringify(goal)` (safe JS string literal).
3. `runs.run` keys are UNIQUE per round (`build-1`, `review-1`, `build-2`, …)
   because `runs.run` fingerprint-dedupes by key and throws on a reused key with
   different params.
4. Clean detection is the marker regex on `review.output` (not line-anchored, so
   it works in any rendering).
5. Cap = 3; no `gate` (the commentator's independent review is the gate, matching
   the old engine). Launch with `async: true`.

## New `src/extensions/workflow/modes.ts`

```ts
// ponytail: four workflow modes as pi-subagents workflowScript builders.
// One-shot-and-sleep: phases run as runs.run steps and the loop auto-repeats
// until clean or the cap. A workflowScript has no checkpoints, so there are no
// human gates.
const MAX_ROUNDS = 3;

function js(value: string): string {
  return JSON.stringify(value);
}

const AUTO_LOOP = String.raw`
const autoLoop = async (goal, context) => {
  const maxRounds = ${MAX_ROUNDS};
  for (let round = 1; round <= maxRounds; round++) {
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
  }
  return { result: 'maxed', rounds: maxRounds };
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
```

## New `src/extensions/workflow/extension.ts`

```ts
// ponytail: thin shell. Registers the four /workflow-* commands and launches
// each mode's scripted workflow through pi-subagents' launchSlashSubagent.

import type { ExtensionAPI } from "@selesai/code";
import { launchSlashSubagent } from "../pi-subagents/src/slash/slash-commands.ts";
import { buildLoopScript, buildPrototypeScript, buildQuicktypeScript, buildTaskScript } from "./modes.ts";

export default function workflowModesExtension(pi: ExtensionAPI): void {
  const register = (name: string, description: string, build: (goal: string) => string) =>
    pi.registerCommand(name, {
      description,
      handler: async (args, ctx) => {
        const goal = args.trim();
        if (!goal) {
          ctx.ui.notify(`${description}\nUsage: /${name} <goal>`, "info");
          return;
        }
        launchSlashSubagent(pi, ctx, { workflowScript: build(goal), async: true, agentScope: "both" });
      },
    });

  register("workflow-task", "Run the task workflow (plan → reuse → handoff → auto build↔review loop) as a scripted workflow.", buildTaskScript);
  register("workflow-prototype", "Run the full prototype workflow (research → plan → reuse → handoff → auto loop → audit) as a scripted workflow.", buildPrototypeScript);
  register("workflow-quicktype", "Run the quicker prototype workflow without research (plan → reuse → handoff → auto loop → audit) as a scripted workflow.", buildQuicktypeScript);
  register("workflow-loop", "Run a direct auto build↔review loop for an already-agreed plan as a scripted workflow.", buildLoopScript);
}
```

## Tests (`src/__tests__/workflow-modes.test.ts`)

Replace the chain-shape tests with builder tests (no pi-subagents mocking; only
the pure builder functions):

- `buildLoopScript(goal)` returns a string containing `'build-'`, `'review-'`,
  `agent: 'builder'`, `agent: 'commentator'`, `maxRounds = 3`, and the
  `WORKFLOW_REVIEW_STATUS` marker.
- Goal injection: `buildLoopScript('it\'s "quoted"')` contains the goal as a
  valid JS literal (JSON.stringify'd) and does not break on quotes/backslashes.
- `buildTaskScript` contains `'plan'`, `'reuse'`, `'handoff'` runs and NO
  `'research'`/`'audit'` keys.
- `buildPrototypeScript` contains `'research'` AND `'audit'`.
- `buildQuicktypeScript` contains `'audit'` and NO `'research'`.
- `buildLoopScript` contains NO `'plan'`/`'handoff'`/`'audit'` keys.
- Import `extension.ts` with a minimal fake `pi` (capture `registerCommand`) →
  registers exactly the four names; empty goal → usage notify.

## Docs

- `workflow.mdx` (EN + ID): describe the modes as scripted auto-loop workflows
  (no checkpoints; loop capped at 3; `async`/background; recover via
  `mission.list`/`status`; the old `workflow.json` resume note stays as the
  migration note). Remove chain/checkpoint-specific wording.
- `pi-subagents.mdx`: update the workflow-modes paragraph (scripted auto-loop,
  not chains/checkpoints).
- `capabilities.ts`: benefit string → "scripted auto-loop workflows".
- `extension-customization.json`: the workflow record already points at
  `modes.ts` + `extension.ts`; update any wording that says "chain/checkpoint" to
  "scripted workflow".

## Skill (`references/execution-controls.md`, 3 copies)

Replace the "Workflow modes as saved chains" note with: the bundled workflow
extension ships the four modes as `workflowScript` auto-loops (`/workflow-*`);
each mode runs its phases as `runs.run` steps and loops build↔review until clean
or the 3-round cap; no checkpoints (one-shot-and-sleep); durable state is the
auto-created mission; recover via `mission.list`/`status`.

## Verification

1. `npx vitest run src/__tests__/workflow-modes.test.ts src/__tests__/bootstrap.test.ts`
2. `npx tsc --noEmit` (repo root) + `npx tsc --noEmit` (pi-subagents) + `npx tsgo -p tsconfig.build.json --noEmit`
3. `npx astro check` + `npm run validate:content` (doc-web)
4. `diff -q` across the 3-way skill sync (byte-identical)

## Constraints

- Do NOT modify `src/extensions/pi-intercom/`, `src/extensions/handoff-new.ts`,
  `src/extensions/inline-skills.ts`, `src/extensions/inline-skills.test.ts` (the
  user's parallel work). Leave them exactly as-is.
- Do NOT commit or push. Leave all changes uncommitted.
- ponytail: smallest diff; no new deps/abstractions; reuse `launchSlashSubagent`.
