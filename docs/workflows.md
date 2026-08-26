# Adaptive implementation workflow

Selesai uses the built-in [`workflow`](../src/skills/workflow/SKILL.md) skill for implementation orchestration. It is guidance for the parent agent, built on `pi-subagents`' `workflowScript` runtime; it is not a separate extension, slash-command system, or durable workflow engine.

Invoke it inline with `$workflow`, or ask Selesai to orchestrate the implementation.

## Policy

The parent first inspects the task and chooses the smallest flow that can safely finish it:

- localized changes stay local or use one worker and focused validation;
- uncertain code or external dependencies add scoped discovery/research;
- architecture or product tradeoffs are settled before implementation, with an oracle or Council Mode only when warranted;
- substantial work uses one writer, independent read-only review/validation, a scoped fix worker for accepted findings, and another review only after material changes.

Reviewers inspect the shared checkout's actual diff. Sibling transcripts are not shared automatically, so the parent passes a concise synthesis to a later fix worker. Handoffs are optional and reserved for cross-session continuity, milestone boundaries, or durable records.

`pi-subagents` missions and receipts provide recovery evidence for delegated work. They do not turn a static flow into the source of truth or replace parent acceptance.
