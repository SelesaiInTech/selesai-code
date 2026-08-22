# Workflows

Selesai's built-in workflows are thin slash-command adapters over the **pi-subagents** orchestration runtime. They do not have a separate state machine, artifact protocol, or `workflow.json` format.

## Run a workflow

```text
/workflow-task <goal>
/workflow-prototype <goal>
/workflow-quicktype <goal>
/workflow-loop <goal>
```

Each command starts an async pi-subagents mission. Recover a completed, paused, or confusing run with the pi-subagents mission and status controls (`/subagents`, `/subagents-doctor`, or the corresponding `subagent` tool actions); there is no `/workflow-* resume` command.

## Built-in modes

| Command | Shape |
| --- | --- |
| `/workflow-task` | plan → reuse → handoff → build/review/fix loop |
| `/workflow-prototype` | parallel research + codebase exploration → plan → handoff → build/review/fix loop → audit |
| `/workflow-quicktype` | plan → reuse → handoff → build/review/fix loop → audit |
| `/workflow-loop` | direct build/review/fix loop for an already-agreed plan |

The prototype mode uses `runs.all` for its independent research and codebase-exploration work. All modes use `runs.run` for ordered handoffs. The build/review/fix loop uses `workflowScript` because its next step depends on the reviewer result; a blocking review gets a scoped fix round, while `clean` plus no remaining work ends the run.

## Extending workflows

The extension seam is `src/extensions/workflow/modes.ts`.

Add one `WorkflowMode` entry to `WORKFLOW_MODES`:

```ts
{
  command: "workflow-rigorous",
  description: "Run the rigorous workflow.",
  launch: (goal) => ({
    workflowScript: `const goal = ${JSON.stringify(goal)};
return runs.run("plan", { agent: "architect", task: "Plan: " + goal });`,
  }),
}
```

`launch(goal)` returns pi-subagents public execution fields. Prefer the native execution shapes where the mode is static:

- `chain` for a fixed ordered sequence, including human checkpoints.
- `tasks` for independent, read-only parallel work.
- `workflowScript` only when the orchestration is conditional, iterative, needs dynamic fan-out, or combines native run operations.

`extension.ts` automatically registers every entry in `WORKFLOW_MODES`; no new command plumbing is needed. The mode owns task wording and execution shape. The extension owns only argument validation, async launch, agent scope, and mission creation.

## Constraints

- `workflowScript`, `chain`, and `tasks` are alternative top-level pi-subagents execution modes. A mode that needs an auto-loop and preceding/following phases should use `workflowScript` and call `runs.run` / `runs.all` within it.
- Keep one writer at a time. Parallel lanes should be research or review unless they are isolated in worktrees.
- Workflow progress ledgers are under `.pi-subagents/progress/` and are local runtime artifacts, not durable workflow state.
- The outer mission and pi-subagents run artifacts are the recovery record.
