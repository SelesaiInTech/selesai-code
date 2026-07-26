---
description: Review/fix loop until clean
---

Run a parent-orchestrated review loop for the requested work.

Use the `subagent` tool. Keep the parent session as the loop controller and final decision-maker. Child subagents must receive concrete role-specific tasks; they must not run subagents or manage the loop themselves unless the parent intentionally selected an explicit fanout agent whose builtin `tools` includes `subagent` for that assigned fanout.

Default to a maximum of 3 review rounds unless I specify a different cap. Count a review round each time fresh-context commentators inspect the current diff after a builder pass. Stop early when commentators find no blockers or fixes worth doing now.

If the invocation includes an implementation request, first launch one async `builder` to implement the approved scope. If the current diff is already the target, start with review. The sequence can be launched up front as an async/background chain when the workflow is already clear, or continued as follow-up subagent runs after each async completion. For an initial chain, pass `async: true` so the main chat is unblocked; do not set `clarify: true` unless I explicitly want the foreground clarify UI. Use only one writer against the active worktree at a time unless I explicitly ask for isolated worktrees.

As a conservative orchestration policy, do not set `turnBudget` or a hard `toolBudget` on implementation or fix builders. A default tool budget blocks read/search tools rather than mutation tools, but count limits still do not measure delivery safety. Give each writer a narrow delivery slice and an outer elapsed deadline with enough margin. Before that deadline, request a checkpoint after the current tool returns with changed files, build/test state, remaining work, and commit or PR state. An elapsed timeout is not a mutation-safe boundary and must not be the checkpoint trigger.

For each review round, launch fresh-context `commentator` agents in parallel. Reviewers must inspect the repository, relevant instructions, and current diff directly from files and commands. They must not rely on the main conversation history and must not edit files.

Choose review angles from the actual change. Common angles are correctness/regressions, tests/validation, and simplicity/maintainability. Add security, performance, docs/API contracts, or user-flow validation when the work calls for it. Prefer three strong commentators over many vague commentators.

After commentators return, synthesize their feedback into:
- blockers or scope/product/architecture decisions that need user approval;
- fixes worth doing now;
- optional improvements;
- feedback to ignore or defer, with a short reason.

Do not blindly apply every commentator suggestion. If commentators surface an unapproved product, scope, or architecture decision, pause and ask me before launching a fix builder.

When an async implementation builder completes, treat its handoff as the transition into review, not as final completion, unless I explicitly asked for builder-only work, review-only output, or to stop after implementation.

When there are fixes worth doing now and the workflow is implementation-authorized, launch one async forked `builder` without hard turn or tool-call caps to apply only those synthesized fixes. Ask it to preserve the approved scope, run focused validation, and report changed files, commands run with exit codes, validation evidence, surprises, and anything left undone.

After a fix builder returns, run another review round only when it made material changes or addressed non-trivial findings. Do not keep looping for optional polish, speculative improvements, or findings already deferred by the parent.

Stop and summarize when one of these is true:
- commentators find no blockers or fixes worth doing now;
- remaining feedback is optional, speculative, or intentionally deferred;
- commentators surface an unapproved decision that needs me;
- the max review-round cap is reached.

On completion, inspect the final diff yourself, run or confirm focused validation where appropriate, and summarize the loop: rounds run, fixes applied, validation, remaining deferred items, and why the loop stopped.

Additional target, implementation request, max-iteration cap, or review focus from the slash command invocation:

$@
