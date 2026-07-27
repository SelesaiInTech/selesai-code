# Handoff

## Goal and Current State

Fix stale TUI bash command header after RTK extension mutates `event.input.command` in `tool_call`. The TUI renders the original LLM-generated command (e.g. `ls -la`) instead of the rewritten command (e.g. `rtk ls -la`). Execution is correct — only the displayed header is stale.

## Decisions and Constraints

- **Do not** reorder `tool_execution_start` / `tool_call` lifecycle.
- **Do not** add new events, types, RTK-specific code paths, timers, or mutation metadata.
- **Do not** modify `src/extensions/rtk.ts`, `src/core/agent-session.ts`, `src/core/extensions/types.ts`, `ToolExecutionComponent`, docs, or package config.
- Fix is a one-line call to existing `ToolExecutionComponent.updateArgs(args)` in the `tool_execution_update` handler in `interactive-mode.ts`.
- Bash emits an initial `tool_execution_update` immediately when execution begins, so RTK-mutated args arrive without any new event.

## Evidence / Artifacts

- `src/extensions/rtk.ts` — RTK extension, mutates `event.input.command` in `tool_call` handler.
- `src/modes/interactive/interactive-mode.ts` — `case "tool_execution_update"` calls `component.updateResult(...)` but not `component.updateArgs(event.args)`.
- `src/modes/interactive/components/tool-execution.ts` — `updateArgs(args)` exists and re-renders call renderer.
- `src/core/agent-session.ts` — forwards `event.args` in `tool_execution_update` events.

## Remaining Work

1. In `src/modes/interactive/interactive-mode.ts`, call `component.updateArgs(event.args)` immediately before `component.updateResult(...)` in `tool_execution_update`.
2. Add focused regression test covering mutated update args reaching component `updateArgs`, preserving result update and render request.

## Validation

```bash
npx vitest run src/modes/interactive/interactive-mode.test.ts
npm test -- --run
npm run build
git diff --check
git status --short
```

## Risks

- Header refresh depends on `tool_execution_update`; built-in bash emits initial update.
- Preserve missing pending-tool no-op behavior and normal tool result updates.

WORKFLOW_HANDOFF_STATUS: ready