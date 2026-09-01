---
name: workflow
category: orchestration
description: Delegate user work to Selesai subagents. When invoked, decompose the request into subtasks, choose the right child agent for each subtask, and coordinate them with workflowScript. Use when the user asks to use a workflow, asks to orchestrate or delegate a task, or invokes the workflow skill.
---

# Workflow via subagents

This is a parent-only orchestration policy over `pi-subagents`. When this skill is invoked, the parent's job is to delegate the user's request to subagents, not to perform the implementation itself. Read `../pi-subagents/SKILL.md` and the matching references before launching children. Use `workflowScript` for every coordinated launch. Do not inject or follow this skill inside child subagents.

## Delegation policy

- The parent owns classification, scope, decisions, synthesis, and final acceptance.
- Whenever the workflow skill is active, solve the user's request by delegating subtasks to subagents. The parent is a coordinator and reviewer, not the primary implementer.
- Decompose every non-trivial request into narrow subtasks before launch. Read-only subtasks (scout, research, plan, review, validation) are also delegated; do not keep them in the parent just because they are cheap.
- Keep **one writer per checkout/worktree**. Parallelize only read-only subtasks; a single mutation-capable worker should own writes per lane.
- Give each child a narrow role-specific task, source seam, constraints, acceptance evidence, and expected output. Never send clone prompts.

## Choosing subagents

Read `../pi-subagents/SKILL.md` and its references to pick builtin/custom agents. Common mapping:

| Subtask | Agent |
| --- | --- |
| Codebase recon / find seams | `scout` |
| External/uncertain research | `researcher` |
| Scoped implementation | `worker` or `delegate` |
| Independent review | `reviewer` |
| Material architecture/product tradeoffs | `oracle` or Council Mode |

For material architecture/product tradeoffs, resolve them first with an `oracle` or Council Mode before implementation.

## Coordinating with workflowScript

Use `workflowScript` with top-level `await`, `runs.run` for ordered stages, and `runs.all` for independent fanout. Keep async work background by default.

### Single bounded task

```js
const worker = await runs.run("implement", {
  agent: "worker",
  task: "Implement the requested change. Return changed files, checks run, residual risks, and decisions needing approval."
});
return worker.outputReference;
```

### Uncertain task

```js
const scout = await runs.run("scout", {
  agent: "scout",
  task: "Find the code seams, existing helpers, and constraints involved. Do not edit."
});
const worker = await runs.run("implement", {
  agent: "worker",
  reads: [scout.outputReference],
  task: "Implement the requested change from the scout findings. Return changed files, checks run, residual risks, decisions needing approval."
});
const reviews = await runs.all([
  { key: "correctness", agent: "reviewer", reads: [scout.outputReference, worker.outputReference], task: "Inspect the current diff for correctness and regressions. Do not edit." },
  { key: "simplicity", agent: "reviewer", reads: [scout.outputReference, worker.outputReference], task: "Inspect the current diff for unnecessary complexity. Do not edit." }
]);
return { worker: worker.outputReference, reviews: reviews.map((result) => result.outputReference) };
```

### Parallel independent subtasks

Parallelize read-only discovery, research, and review with `runs.all`. If independent mutation subtasks need parallel execution, read the multi-lane guidance in `pi-subagents`, give each worker a managed `worktree: true`, and plan an explicit integration step. Otherwise serialize workers.

```js
const findings = await runs.all([
  { key: "subtask-a-scout", agent: "scout", task: "Investigate subtask A. Do not edit." },
  { key: "subtask-b-scout", agent: "scout", task: "Investigate subtask B. Do not edit." }
]);
const worker = await runs.run("implement", {
  agent: "worker",
  reads: findings.map((result) => result.outputReference),
  task: "Implement the independent subtasks sequentially in this checkout, with focused checks."
});
return worker.outputReference;
```

## Review and fix

The parent synthesizes review findings and sends one scoped fix worker. Do not launch an unbounded fix loop. Classify findings:

- **blocking/actionable in approved scope** → synthesize and send one fix worker;
- **optional, speculative, or scope-expanding** → defer or ask the user;
- **decision needed** → stop and escalate to the user.

Re-review only after a material fix. Default cap: two review rounds; use three only for risky work.

## Final acceptance

The parent inspects the final diff and validation evidence before reporting completion. Treat child completion, tests, and receipts as evidence—not authority to make product, architecture, merge, or release decisions.
