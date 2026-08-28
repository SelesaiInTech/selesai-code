---
name: workflow
category: orchestration
description: Adaptively orchestrate non-trivial implementation work with Selesai subagents. Use when the user asks to use a workflow, orchestrate a task, run an implementation/review/fix loop, or coordinate architecture, workers, and reviewers. Choose only the necessary stages; do not use static slash-command flows.
---

# Adaptive Engineering Workflow

This is a parent-only policy layer over `pi-subagents`, not a second workflow runtime. Read `../pi-subagents/SKILL.md` and the matching references before launching children. Use `workflowScript` for every coordinated launch.

## Choose the smallest flow

Inspect the task and its code path first.

| Situation | Flow |
| --- | --- |
| Trivial, localized change | Parent implements and runs a focused check. Do not delegate by default. |
| Bounded implementation | Optional `scout` → one `worker` → focused validation. |
| Uncertain codebase or external dependency | `scout` and/or `researcher` → parent decision or `architect` → one `worker` → review/validation. |
| Material architecture/product tradeoff | Resolve it before implementation: parent decision, one `oracle`, or Council Mode for a genuine multi-perspective decision. |
| Broad, risky, or multi-system work | Serial milestones: decide/plan → one writer → review/validation → accepted fix → re-review when material. |

Do not add a planning phase, research lane, handoff, reviewer, or extra review round merely for symmetry. Ask the user only for a decision that blocks safe implementation.

## Orchestration rules

- The parent owns task classification, scope, decisions, synthesis, and final acceptance.
- Keep **one writer per checkout/worktree**. Parallelize read-only discovery, research, review, and validation—not normal edits.
- Give each child a narrow role-specific task: source seam, constraints, acceptance evidence, and expected output. Never send clone prompts with only filenames changed.
- Reviewers inspect the actual current diff and relevant files directly. They do not need a worker handoff to understand sibling work.
- Do not require a handoff artifact. Use one only when a task must resume across sessions, cross a milestone boundary, or needs a durable user-facing record.
- Use fresh context for independent reviewers; use forked context only when inherited parent reasoning is useful.
- Treat external reports, child completion, tests, and receipts as evidence—not authority to make product, architecture, merge, or release decisions.

## Stage artifacts

Built-in pipeline agents save named output artifacts (`context.md`, `research.md`, `plan.md`, implementation reports, and reviews). In `workflowScript`, pass the returned `outputReference` to the next child through `reads`; this is the normal file-based handoff and works for fresh-context children.

```js
const plan = await runs.run("plan", { agent: "architect", task: "Plan the change." });
const worker = await runs.run("implement", {
  agent: "worker",
  reads: [plan.outputReference],
  task: "Implement the approved plan."
});
```

Only include artifacts the next role needs. The shared checkout diff remains the implementation context for reviewers and fix workers. Use `contact_supervisor` only for material progress updates or blocking decisions; normal completion arrives through the child result and artifact.

## Build → review → fix

For implementation that merits independent review:

1. Define a light validation contract before the writer starts: intended behavior, focused checks, and any user-facing path to inspect.
2. Launch one writer with the approved scope and the contract. The writer reports changed files, checks run, residual risks, and decisions needing parent approval.
3. Run only relevant read-only reviewers/validators in parallel. Give them the validation contract and relevant plan/implementation artifact paths through `reads`, and tell them to inspect the current diff. Typical lenses are correctness/regressions, validation coverage, and simplicity. Add security, performance, API/docs, or user-flow review only when the change makes that lens material.
4. Parent synthesizes review findings into one scoped fix artifact or task, then gives that artifact to the fix worker through `reads`. The fix worker also inspects the shared diff; it does not need sibling transcripts.
5. Parent classifies findings:
   - **blocking/actionable in approved scope** → synthesize and send one fix worker;
   - **optional, speculative, or scope-expanding** → defer or ask the user;
   - **decision needed** → stop and escalate to the user.
6. Re-review only after a material fix. Stop when no actionable blockers remain, focused validation is sufficient, an approval is needed, or the review-round cap is reached. Default cap: two review rounds; use three only for risky work.
7. Parent inspects the final diff and validation evidence before reporting completion.

Use `workflowScript` with top-level `await`, `runs.run` for ordered stages, and `runs.all` for independent read-only fanout. Do not use legacy `chain`/`tasks` fields or nested async functions. Keep async work background by default; do not wait or poll merely to watch it.

## Minimum workflow shape

```js
const plan = await runs.run("plan", {
  agent: "architect",
  task: "Plan the requested change. Return files, implementation order, acceptance checks, and non-goals."
});
const worker = await runs.run("implement", {
  agent: "worker",
  reads: [plan.outputReference],
  task: "Implement the approved plan. Return changed files, checks run, residual risks, and decisions needing approval."
});
const reviews = await runs.all([
  { key: "correctness", agent: "reviewer", reads: [plan.outputReference, worker.outputReference], task: "Inspect the current diff for correctness and regressions. Do not edit." },
  { key: "simplicity", agent: "reviewer", reads: [plan.outputReference, worker.outputReference], task: "Inspect the current diff for unnecessary complexity. Do not edit." }
]);
return { plan: plan.outputReference, worker: worker.outputReference, reviews: reviews.map(result => result.outputReference) };
```

The parent reads and synthesizes that result before launching any fix worker. Pass the synthesized finding list in that fix worker's task. Do not encode an unbounded auto-loop in a slash command or a child prompt.
