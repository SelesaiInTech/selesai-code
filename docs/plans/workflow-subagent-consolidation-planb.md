# Plan — Plan B: consolidate the workflow extension onto pi-subagents primitives

## Goal

Replace the bundled `workflow` extension's bespoke engine (state machine, `workflow.json`
run state, marker validators, exclusive-transition gating) with pi-subagents' durable
primitives — **missions**, **saved chains**, **checkpoints**, and **verified acceptance** —
while keeping the `/workflow-prototype|quicktype|task|loop` command names and the four
mode shapes.

Executed by a small coding model with no project knowledge. Everything needed is here.

## Decisions (user-confirmed)

- **Disposition = thin-shell.** Keep the `/workflow-*` command surface; delete the engine
  (`state-machine.ts`, `run-state.ts`, `validators.ts`, `adapter.ts`, old `modes/*`), the
  `write_workflow_artifact` / `end_workflow` tools, and the marker validator machinery.
  The four modes become **saved chain templates** launched through pi-subagents.
- **Migration = drop.** Active `workflow.json` runs under `.selesai/artifacts/` are no
  longer resumable. Documented; no read-only shim.

## Design

### The launch seam (verified)

pi-subagents exports `launchSlashSubagent(pi, ctx, params)` from
`src/extensions/pi-subagents/src/slash/slash-commands.ts` (line 620). It takes a
`SubagentParamsLike` (including `{ chain, task, async, agentScope }`), drives the full
slash UX (live result card, snapshots, notifications), and is what `/run-chain`, `/chain`,
and `/parallel` already funnel through. The thin shell reuses it directly — no executor
construction, no new machinery.

```ts
import { launchSlashSubagent } from "../pi-subagents/src/slash/slash-commands.ts";

pi.registerCommand("workflow-task", {
  description: "Run the task workflow (plan → reuse → handoff → build↔review loop) as a pi-subagents chain.",
  handler: async (args, ctx) => {
    const goal = args.trim();
    launchSlashSubagent(pi, ctx, { chain: taskChain, task: goal, async: true, agentScope: "both" });
  },
});
```

`task` becomes the `{task}` template variable for the chain's first step (per the chain
schema: `{task}` = the original request).

### Mode → chain mapping (the design content)

Chain steps use the Selesai agent roster (`architect`, `builder`, `commentator`,
`explorer`, `recapper`, `researcher`). Human gates are `checkpoint` steps (approve /
reject via `approve-checkpoint` / `reject-checkpoint`). Build verification is a chain
`acceptance` gate. **Note:** the `gate: "npm test"` shorthand is `workflowScript`-only; in
a chain step use the `acceptance` field (read
`src/extensions/pi-subagents/src/runs/shared/acceptance.ts` + the `ChainItem` schema in
`schemas.ts` for the exact shape; a verified run is `acceptance: { level: "checked",
evidence: ["commands-run", "changed-files"] }`).

| Mode | Chain steps (agent · gate) |
| --- | --- |
| **task** | `architect` (plan, `{task}`) → `checkpoint` "approve plan?" → `explorer` (reuse) → `recapper` (handoff from `{outputs.plan}`/`{previous}`) → `checkpoint` "approve handoff?" → `builder` (implement, acceptance) → `commentator` (read-only review) → `checkpoint` "approve implementation?" |
| **prototype** | `researcher` (research) → `architect` (plan) → `checkpoint` → `explorer` (reuse) → `recapper` (handoff) → `checkpoint` → `builder` (acceptance) → `commentator` (review) → `checkpoint` → `commentator` (audit of uncommitted diff) |
| **quicktype** | same as prototype **minus** the `researcher` step |
| **loop** | `builder` (acceptance) → `commentator` (review) → `checkpoint` "approve implementation?" (direct build↔review for an already-agreed plan; no plan/reuse/handoff artifacts) |

Step tasks reuse the existing mode-prompt language from the current `src/extensions/workflow/modes/*.ts`
(the executor copies the phase instructions into each chain step's `task`), with two changes:
- the `WORKFLOW_*_STATUS` marker contract is dropped (no engine enforces it); the
  `checkpoint` step is the human approval gate instead,
- the `output: false` / `write_workflow_artifact` instructions are dropped (children own
  writes; durable artifacts are child output files + mission artifacts).

### What is intentionally dropped (honest tradeoff)

- The **automatic N-round capped loop** (`loopMaxIterations` + engine-written
  `loop-complete.md`). Replaced by the `builder → commentator → checkpoint` segment: a
  blocking review rejects the checkpoint and the user re-runs `/workflow-<mode>` (or the
  parent uses `append-step` / `resume` for another round). If the auto-loop is a hard
  requirement, `/workflow-loop` can instead be a `workflowScript` (JS round cap + `gate` +
  mission `state`) — an optional variant, not the default.
- The **`grill` phase** (interactive clarification). This is now the parent's pre-launch
  job; it is not a chain step.
- **Marker-gated artifacts** and **parent-owned `write_workflow_artifact`**. Durable
  process state now lives in the auto-created **mission** (per-launch `mission` record with
  `state`, artifacts, decisions, receipts; recover via `mission.list`/`mission.show`);
  resumability is pi-subagents' retained children (`children.list` + `runs.run({ resume })`).

## Prerequisite — resolve the uncommitted "merge" work

The previous session left an **uncommitted** merge-into-shell change (Tasks 1-6 of
`docs/plans/workflow-subagent-scripted-merge.md`). Plan B supersedes it: the adapter/modes
changes are deleted, and the doc/skill edits are reverted/replaced. **Before starting**,
do one of:

- **Option 1 (recommended):** commit the merge as-is as a checkpoint commit
  (`git add -A && git commit -m "wip: merge-into-shell (superseded by plan B)"`), then work
  on a clean tree. Do NOT include `src/extensions/handoff-new.ts` in that commit (it is a
  separate pre-existing change).
- **Option 2:** `git restore` the merge's doc/skill changes
  (`doc-web/.../workflow.mdx`, `.../pi-subagents.mdx`, `doc-web/src/data/capabilities.ts`,
  both `execution-controls.md` copies) and leave the rest to be overwritten by deletion.

The executor must not commit; it leaves changes for the user.

---

## Task 1 — Delete the engine (pure removal)

### 1. Discovery
- Confirm no imports reference these modules outside `src/extensions/workflow/` and
  `src/__tests__/` (verified: none).
- Confirm `src/__tests__/bootstrap.test.ts` does not import the workflow extension
  (verified: it does not; it must still pass because the thin shell remains a valid
  loadable extension package).

### 2. Identification
- **Delete:** `src/extensions/workflow/{adapter.ts, state-machine.ts, run-state.ts,
  validators.ts, modes/loop.ts, modes/task.ts, modes/prototype.ts, modes/quicktype.ts}`.
- **Delete:** `src/__tests__/{adapter.test.ts, state-machine.test.ts,
  workflow-run-state.test.ts, task-workflow.test.ts, loop-workflow.test.ts,
  quicktype-workflow.test.ts}`.
- **Keep:** `src/extensions/workflow/{extension.ts, package.json}` (rewritten in Tasks 2-3).
- **Why only these:** the engine and its tests are self-contained; nothing else references
  them.

### 3. Change
Remove the listed files. Do not touch any other file.

### 4. Verification
- **Success:** `grep -rn "WorkflowStateMachine\|createWorkflowExtension\|write_workflow_artifact\|end_workflow" src --include=*.ts` returns nothing.
- **Failure:** n/a.
- **Regression:** `src/__tests__/bootstrap.test.ts` still passes (the package dir still
  exists with a valid `package.json` + `extension.ts`).

---

## Task 2 — Define the four mode chains

### 1. Discovery
Read the current `src/extensions/workflow/modes/*.ts` before deletion (or from git history)
to harvest the phase prompt language. Read `src/extensions/pi-subagents/src/slash/slash-commands.ts`
for the `ChainStep`/`SubagentParamsLike` shape and
`src/extensions/pi-subagents/src/agents/agents.ts` for the `ChainConfig`/`ChainStepConfig`
types. Read `schemas.ts` `ChainItem` for the `checkpoint`/`message`/`acceptance`/`as`/
`outputSchema` fields.

### 2. Identification
- **Create:** `src/extensions/workflow/modes.ts` (single file; four exported step arrays).
  One file beats a directory — no per-mode files, no loader indirection.
- **Why here:** the mode definitions are the thin shell's only content; pi-subagents owns
  execution.

### 3. Change
Define, in `modes.ts`:

```ts
import type { ChainStep } from "../pi-subagents/src/shared/settings.ts"; // verify path

export const taskChain: ChainStep[] = [
  { agent: "architect", as: "plan", task: "Produce an implementation plan for: {task}. Return the complete plan inline." },
  { checkpoint: "approve-plan", message: "Approve the plan before implementation?" },
  { agent: "explorer", task: "Explore the codebase for reusable patterns relevant to the plan: {previous}." },
  { agent: "recapper", as: "handoff", task: "Compile a self-contained handoff from the plan and reuse findings: {previous}." },
  { checkpoint: "approve-handoff", message: "Approve the handoff before implementation?" },
  { agent: "builder", task: "Implement the plan from the handoff: {previous}. Run relevant checks.", acceptance: { level: "checked", evidence: ["commands-run", "changed-files"] } },
  { agent: "commentator", task: "Independently review the uncommitted diff against the handoff acceptance criteria and report evidence." },
  { checkpoint: "approve-implementation", message: "Approve the implementation and review?" },
];

export const prototypeChain: ChainStep[] = [ /* researcher → architect → checkpoint → explorer → recapper → checkpoint → builder(acceptance) → commentator → checkpoint → commentator(audit) */ ];
export const quicktypeChain: ChainStep[] = [ /* prototypeChain minus researcher */ ];
export const loopChain: ChainStep[] = [ /* builder(acceptance) → commentator → checkpoint */ ];
```

Use `as: "plan"` / `as: "handoff"` so later steps can reference `{outputs.plan}` and
`{outputs.handoff}` instead of relying only on `{previous}`. Copy the substantive
instructions from the current mode prompts (plan/reuse/handoff/loop/audit wording), minus
the marker and `write_workflow_artifact` instructions. The `checkpoint` `message` is the
human-visible approval question.

**Code explicitly not to add:** a `workflowScript` variant for the loop, marker parsing,
any filesystem writes, or a `modes/` directory.

### 4. Verification
- **Success:** `modes.ts` typechecks; each chain uses only real agent names
  (`architect`/`builder`/`commentator`/`explorer`/`recapper`/`researcher`); checkpoint steps
  have a non-empty `checkpoint` + `message`; builder steps carry `acceptance`.
- **Failure:** n/a.
- **Regression:** n/a (new file).

---

## Task 3 — Thin-shell extension (rewrite `extension.ts`)

### 1. Discovery
Read `src/extensions/pi-subagents/src/slash/slash-commands.ts` around line 620
(`launchSlashSubagent`) and confirm its export. Read the old `src/extensions/workflow/extension.ts`
(being replaced) for the command-name/description convention.

### 2. Identification
- **Modify:** `src/extensions/workflow/extension.ts` (keep `package.json` unchanged — it
  still declares `pi.extensions: ["./extension.ts"]`).
- **Why here:** this is the single registration point; `launchSlashSubagent` already owns
  all execution.

### 3. Change
Rewrite `extension.ts` to register four commands. Each handler:

```ts
import { launchSlashSubagent } from "../pi-subagents/src/slash/slash-commands.ts";
import { taskChain, prototypeChain, quicktypeChain, loopChain } from "./modes.ts";

export default function workflowModesExtension(pi: ExtensionAPI): void {
  const register = (name: string, description: string, chain: ChainStep[]) =>
    pi.registerCommand(name, {
      description,
      handler: async (args, ctx) => {
        const goal = args.trim();
        if (!goal) { ctx.ui.notify(`${description}\nUsage: /${name} <goal>`, "info"); return; }
        launchSlashSubagent(pi, ctx, { chain, task: goal, async: true, agentScope: "both" });
      },
    });
  register("workflow-task", "Run the task workflow (plan → reuse → handoff → build↔review loop) as a pi-subagents chain.", taskChain);
  register("workflow-prototype", "Run the full prototype workflow (research → plan → reuse → handoff → loop → audit) as a chain.", prototypeChain);
  register("workflow-quicktype", "Run the quicker prototype workflow without research as a chain.", quicktypeChain);
  register("workflow-loop", "Run direct build↔review rounds for an already-agreed plan as a chain.", loopChain);
}
```

**Code explicitly not to add:** `write_workflow_artifact` / `end_workflow` tools, any state,
any `pi.on("tool_call"/"tool_result")` hooks, or a `resume` subcommand.

### 4. Verification
- **Success:** `/workflow-task <goal>` resolves and launches the `taskChain` via
  `launchSlashSubagent` with `task: goal` and `async: true`.
- **Failure:** empty goal → a usage notify, no launch.
- **Regression:** the package still loads as a bundled extension
  (`src/__tests__/bootstrap.test.ts` green); `/run-chain` and the pi-subagents commands are
  unaffected.

---

## Task 4 — Tests

### 1. Discovery
Read `src/__tests__/bootstrap.test.ts` to see how bundled extensions are loaded, and the
pi-subagents slash test patterns (if any) under `src/extensions/pi-subagents/test/`.

### 2. Identification
- **Create:** `src/__tests__/workflow-modes.test.ts` (replaces the six deleted files).
- **Why here:** the deleted tests lived in `src/__tests__/`; keep the thin shell's tests
  there for consistency. Do not add to pi-subagents' test tree (its own surface is
  unchanged).

### 3. Change
Cover, without mocking pi-subagents internals:

- **`modes.ts` shape:** each of the four chains is a non-empty array; `task`/`quicktype`/`loop`
  chain step agents are a subset of the Selesai roster; `prototype` contains a `researcher`
  step and `quicktype` does not; builder steps have `acceptance`; every `checkpoint` step has
  a non-empty `message`.
- **command registration:** importing `extension.ts` (with a minimal fake `pi` capturing
  `registerCommand` calls) registers exactly the four `/workflow-*` names. Keep the fake
  `pi` minimal (only the methods `registerCommand` touches).

**Code explicitly not to add:** end-to-end execution tests (they belong to pi-subagents'
integration suite), or importing `launchSlashSubagent` in tests (it needs a full pi + state).

### 4. Verification
- **Success:** `npx vitest run src/__tests__/workflow-modes.test.ts src/__tests__/bootstrap.test.ts` green.
- **Failure:** n/a.
- **Regression:** the six deleted test files are gone; full unit suite stays green.

---

## Task 5 — Docs

### 1. Discovery
Read `doc-web/src/content/docs/capabilities/delegation/workflow.mdx` (current, including the
prior "Scripted subagent steps" section), `pi-subagents.mdx`, and
`doc-web/src/data/capabilities.ts`.

### 2. Identification
- **Modify:** `doc-web/src/content/docs/capabilities/delegation/workflow.mdx`,
  `.../pi-subagents.mdx`, `doc-web/src/data/capabilities.ts`.
- **Why here:** these are the registered capability pages; the workflow page must stop
  describing a deleted engine.

### 3. Change
- **workflow.mdx:** rewrite to: "the `workflow` extension now ships the four mode shapes as
  pi-subagents saved chains; `/workflow-*` launches them; phases = chain steps; human gates =
  checkpoints; verified acceptance = chain `acceptance`; durable state = missions
  (`mission.list`/`show`); resumability = retained children." Remove all `write_workflow_artifact`
  / `end_workflow` / `workflow.json` / marker content and the prior "Scripted subagent steps"
  section. Add a "Migration" note: active `workflow.json` runs are not resumable (Plan B).
- **pi-subagents.mdx:** update the Limits-and-safety paragraph added by the prior merge to
  reflect that the workflow modes are now chains (not "drives a script"), and note
  `/run-chain <mode>` parity is optional.
- **capabilities.ts:** update the `workflow` `benefit` string to "the four workflow modes as
  pi-subagents saved chains".

### 4. Verification
- **Success:** `npx astro check` (doc-web) and `npm run validate:content` pass; the page no
  longer references `write_workflow_artifact`/`end_workflow`/`workflow.json`.
- **Failure:** n/a.
- **Regression:** `pi-subagents.mdx` retains its unrelated content; capabilities.ts categories
  and `manifestEntry: "./workflow"` are unchanged.

---

## Task 6 — Skill doctrine (3-way sync)

### 1. Discovery
Read the "Durable-shell integration" note added by the prior merge in
`src/extensions/pi-subagents/skills/pi-subagents/references/execution-controls.md`
(canonical copy), and confirm the three copies are currently byte-identical.

### 2. Identification
- **Modify:** all three copies of `references/execution-controls.md`:
  `src/extensions/pi-subagents/skills/pi-subagents` ↔ `src/skills/pi-subagents` ↔
  `~/.selesai/agent/skills`.

### 3. Change
Replace the "Durable-shell integration" note (which describes the now-deleted merge) with a
short "Workflow modes as saved chains" note: the bundled `workflow` extension ships the four
mode shapes as chains launched via `/workflow-*`; human gates are checkpoints; verified
acceptance is chain `acceptance`; durable state is the auto-created mission. Apply the
identical diff to all three copies.

### 4. Verification
- **Success:** `diff -q` across the three copies reports identical; the old
  "Durable-shell integration" text is gone.
- **Failure:** n/a.
- **Regression:** all other `execution-controls.md` sections byte-identical.

---

## Task order and dependencies

1. Task 1 (delete engine) — first, unblocks everything.
2. Task 2 (mode chains) — independent content work.
3. Task 3 (thin shell) — depends on 2.
4. Task 4 (tests) — depends on 2-3.
5. Tasks 5-6 (docs/skill) — after behavior is stable; can run in parallel.

## Definition of done

- `npx vitest run src/__tests__/workflow-modes.test.ts src/__tests__/bootstrap.test.ts` green.
- Full unit suite green (the six deleted workflow tests are gone; pi-subagents integration
  suite unaffected: `npm run test:integration` in `src/extensions/pi-subagents` with clean
  `SELESAI_SUBAGENT_*` env, expecting 737/0).
- Typecheck clean: `npx tsc --noEmit` (pi-subagents) + `npx tsgo -p tsconfig.build.json --noEmit`.
- `npx astro check` + `npm run validate:content` (doc-web) clean.
- `diff -q` clean across the 3-way skill sync.
- `grep -rn "WorkflowStateMachine\|write_workflow_artifact\|end_workflow\|WORKFLOW_PLAN_STATUS" src` returns nothing.
- `git status` shows: deletions of the 8 engine files + 6 test files; new `modes.ts`,
  `workflow-modes.test.ts`; modified `extension.ts`, two `.mdx`, `capabilities.ts`, three
  `execution-controls.md`; `src/extensions/handoff-new.ts` untouched; nothing committed.

## Final review checklist (planger)

- [x] Discovery: seam (`launchSlashSubagent`), agent roster, chain schema, saved-chain
      format, test locations, and the uncommitted-merge prerequisite all verified.
- [x] Ownership: pi-subagents owns execution/missions/checkpoints/gates; the thin shell owns
      only the four chain definitions + command registration.
- [x] Simplest acceptable: one exported seam reused, one new `modes.ts`, one rewritten
      `extension.ts`, one test file; no new abstractions, deps, or state.
- [x] Reuse: `launchSlashSubagent`, the Selesai agent roster, the existing mode-prompt
      language, `acceptance`/`checkpoint` chain fields.
- [x] Scope: deletes only the engine + its tests; keeps command names; drops old runs as
      decided.
- [x] Verification: success/failure/regression per task + Definition of done.
- [x] Executable without assumptions: exact paths, the exported seam, the chain mapping, and
      the one prerequisite resolution step.
