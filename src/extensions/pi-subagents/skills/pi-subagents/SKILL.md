---
name: pi-subagents
description: |
  Delegate work to builtin or custom subagents with single-agent, chain,
  parallel, scripted, async, forked-context, mission-backed, and
  intercom-coordinated workflows. Use for advisory review, implementation
  handoffs, and multi-step tasks where a single agent stays in control while
  other agents contribute context, planning, or execution.
---

# Selesai Subagents

This skill is for the main parent orchestrator only. Do not inject or follow it inside spawned child subagents. The parent session owns delegation, orchestration, review fanout, and final fix-worker launches. Ordinary children should not run their own subagent workflows; the explicit exception is a delegated fanout child whose resolved builtin `tools` includes `subagent`, and that child may use `subagent` only for the fanout work the parent assigned.

Use this skill when the parent orchestrator needs one specialized child or composed orchestration. The `subagent` tool has four first-class execution modes:

- **SINGLE** — `{ agent, task }` for one child (omit `task` for a self-contained agent).
- **CHAIN** — `{ chain: [{ agent, task }, ...] }` for sequential steps with `{previous}`, `{outputs.name}`, `phase`/`label`, `outputSchema`, and `{ checkpoint: "name" }` human gates.
- **PARALLEL** — `{ tasks: [{ agent, task }, ...], concurrency? }` for top-level parallel children, plus in-chain `{ parallel: [...] }` groups and dynamic `expand`/`collect` fanout.
- **SCRIPTED WORKFLOW** — `{ workflowScript }` with `runs.run`/`runs.all` and ordinary JavaScript for sequence, parallelism, branching, retries, gate monitors, and aggregation. Use `return runs.run("main", { agent, task })` for one child and `runs.all([...])` for coordinated waves. Scripts start asynchronously by default; pass `async:false` only for a small foreground run.

Prefer the declarative modes when the shape is known up front; reach for `workflowScript` when coordination needs dynamic branching or aggregation. Saved `.chain.md` / `.chain.json` workflows (run with `/run-chain`) make repeatable multi-agent flows shareable without rewriting the chain each time.

## How to use this router

Read the matching reference file before acting. Paths are relative to this `SKILL.md`; resolve them against `skills/pi-subagents/` and load them with the read tool.

| Task | Read |
| --- | --- |
| Decide whether to delegate, choose agents, compare tool versus slash commands, apply prompt techniques, or understand builtin roles | `references/prompting-and-roles.md` |
| Run single, chain, parallel, scripted, async, scheduled, mission-backed, forked, worktree, watchdog, clarify, oracle, or intercom-coordinated workflows | `references/execution-controls.md` |
| List/create/update/delete/eject/disable agents or chains, edit agent files, use prompt-template integration, or expose extension RPC | `references/management-authoring-rpc.md` |
| Check safety constraints, best practices, standard workflows, or error handling | `references/constraints-and-recipes.md` |

For broad or uncertain requests, read more than one reference. For complex work, start with `references/prompting-and-roles.md` and `references/execution-controls.md`, then consult `references/constraints-and-recipes.md` before launching or reviewing child work.

## Always-on constraints

- Keep the parent as orchestrator and final decision-maker.
- Use one writer per cwd/worktree unless isolated worktrees are intentional.
- For cross-codebase work, record the target repo, explicit `cwd`, authority boundary, and expected output before launch. Do not assume the parent session cwd is the child repo.
- For parallel fanout, compare child prompts before launch. Do not send clone prompts with only issue numbers, titles, or broad file globs swapped; each child needs a lane-specific task, source seam, prior evidence, and decision that remains distinct without the item number. Launch that fanout as one async `workflowScript` or parallel `tasks` group with stable keys and aggregate output unless there is truly only one child.
- Prefer fresh-context review/validation fanout, then synthesize and apply fixes in the parent.
- Use async/background by default when work can proceed independently; do not poll just to wait. For planned human gates, use `{ checkpoint: "name", message?: "..." }` chain steps and approve or reject paused checkpoints with `approve-checkpoint` / `reject-checkpoint`. For adaptive gates, branch in `workflowScript`.
- Preserve capability ceilings, including child tool restrictions and session-scoped allowed-agent restrictions.
- Escalate unresolved product, architecture, authority, release, merge, or safety decisions upward instead of letting a child decide silently.
- Treat receipts, CI, review bots, and external-run records as evidence, not authority to merge, close, comment, publish, or release.
- As a conservative orchestration policy, do not pass `turnBudget`, a hard `toolBudget`, or a tight `usageBudget` to mutation-capable workers. The default tool budget blocks read/search tools rather than mutation tools, and reported usage has no reservation model. If a worker is interrupted after a tool call starts, checkpoint after the current tool returns with changed files, build/test state, and commit or PR state.
