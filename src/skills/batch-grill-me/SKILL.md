---
name: batch-grill-me
description: A relentless interview that asks every frontier question at once, round by round.
disable-model-invocation: true
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled — the questions you can ask *now* without guessing at answers you haven't heard yet.

For every non-empty frontier, call the `question` tool **exactly once** with its `questions` array; never print frontier questions as plain chat text. Give every item a stable `id`, short `label`, concise `question`, and `context` containing the recommended answer and why. Provide options when known and set `allowFreeform: true` when the user may need another answer. The batch UI lets the user revisit pages before pressing Enter on its final review page to submit all answers. Wait for that tool result, map returned `answers` by `id`, then recompute the next frontier.

Each round the user answers reshapes the tree — settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a *later* round, not this one.

Finding *facts* is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it — don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report — ask the rest of the frontier now. The *decisions* are the user's — put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
