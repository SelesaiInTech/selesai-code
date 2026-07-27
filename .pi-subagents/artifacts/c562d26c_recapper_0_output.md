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
- `src/modes/interactive/interactive-mode.ts` (line ~3060) — `case "tool_execution_update"` branch: currently calls `component.updateResult(...)` but **not** `component.updateArgs(event.args)`.
- `src/modes/interactive/components/tool-execution.ts` — `updateArgs(args)` method exists and re-renders the call renderer with new args.
- `src/core/agent-session.ts` — forwards `event.args` in `tool_execution_update` events.
- `src/modes/interactive/interactive-mode.test.ts` — does not exist yet; needs creation.
- `plan.md` at `/Users/andrewanggada/Documents/workdir/js_proj/selesai/.selesai/artifacts/c994241e-9698-444d-9677-003a26f084e8/plan.md`
- `reuse.md` at same dir.

## Remaining Work

### Task 1 — Apply args from execution updates

File: `src/modes/interactive/interactive-mode.ts`

In `handleEvent`, `case "tool_execution_update"`:

1. Keep current pending-tool lookup.
2. Before `component.updateResult(...)`, add:
   ```ts
   component.updateArgs(event.args);
   ```
3. Keep `updateResult({ ...event.partialResult, isError: false }, true)` and `ui.requestRender()` unchanged.

### Task 2 — Add focused regression test

File: `src/modes/interactive/interactive-mode.test.ts` (new)

Create a narrow Vitest test using `Object.create(InteractiveMode.prototype)`:

1. Set only fields used by `handleEvent` update branch:
   - `pendingTools`: map containing tool call id and fake component.
   - `ui.requestRender`: `vi.fn()`.
2. Fake component methods: `updateArgs`, `updateResult`.
3. Initial header = `{ command: "ls -la" }`.
4. Invoke private handler through `as any` with:
   ```ts
   {
     type: "tool_execution_update",
     toolCallId: "...",
     toolName: "bash",
     args: { command: "rtk ls -la" },
     partialResult: { content: [], details: undefined },
   }
   ```
5. Assert:
   - `updateArgs` called once with rewritten args.
   - `updateResult` called with partial result + `isError: false`, `true`.
   - `requestRender` called once.

## Validation and Risks

Run:
```bash
npx vitest run src/modes/interactive/interactive-mode.test.ts
npm test -- --run
npm run build
git diff --check
git status --short
```

Residual risks:
- Header refresh depends on tool emitting `tool_execution_update`; built-in bash does emit an initial update before output.
- Missing pending tool: no component calls; existing no-op behavior preserved.
- Non-RTK tool updates: latest args continue to render normally.
- Empty partial bash update: header still refreshes; blank result behavior unchanged.

WORKFLOW_HANDOFF_STATUS: ready

⧉ copy assistant: /cp 6e944e