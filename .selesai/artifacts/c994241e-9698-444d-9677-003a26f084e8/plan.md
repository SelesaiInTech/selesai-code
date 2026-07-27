## Plan: refresh RTK-mutated bash args in TUI

### 1. Discovery completed

Findings:

- RTK extension: `src/extensions/rtk.ts`
  - Mutates `event.input.command` in `tool_call`.
- Upstream ordering intentionally:
  - `tool_execution_start` emitted before `beforeToolCall`/extension `tool_call`.
  - Must not reorder.
- Session forwards tool execution updates unchanged:
  - `src/core/agent-session.ts` forwards `event.args` for `tool_execution_update`.
  - JSON/RPC listeners receive this event.
- TUI bug owner:
  - `src/modes/interactive/interactive-mode.ts`, `tool_execution_update` branch.
  - Existing branch updates result only; ignores the update’s `event.args`.
- Existing reusable display API:
  - `ToolExecutionComponent.updateArgs(args)` in `src/modes/interactive/components/tool-execution.ts`.
  - Re-renders call renderer with new args.
- Bash emits an initial `tool_execution_update` immediately when execution begins, so RTK-mutated arguments arrive without adding an event or changing lifecycle order.

### 2. Identification

Modify:

1. `src/modes/interactive/interactive-mode.ts`
   - Owns delivery of `AgentSessionEvent` updates to pending TUI tool rows.
   - Minimal owner for stale displayed header.

2. Add `src/modes/interactive/interactive-mode.test.ts`
   - Tests event-to-component handoff without RTK binary, model, or full TUI startup.

Do not modify:

- `src/extensions/rtk.ts`: rewrite behavior already works.
- `src/core/agent-session.ts`: already forwards `tool_execution_update.args`.
- `src/core/extensions/types.ts`: no new event/type required.
- `ToolExecutionComponent`: `updateArgs` already exists and correctly refreshes renderer.
- Docs, package configuration, extension manifests.

### 3. Implementation tasks

#### Task 1 — Apply args from execution updates

File: `src/modes/interactive/interactive-mode.ts`

In `handleEvent`, `case "tool_execution_update"`:

1. Keep current pending-tool lookup.
2. Before `component.updateResult(...)`, call:
   ```ts
   component.updateArgs(event.args);
   ```
3. Keep `updateResult({ ...event.partialResult, isError: false }, true)` and `ui.requestRender()` unchanged.

Effect:

- Initial `tool_execution_start` remains first and may display original LLM command briefly.
- RTK’s later `tool_call` mutation reaches bash execution.
- Bash’s existing update carries executed/mutated args.
- TUI call renderer refreshes header from `ls -la` to `rtk ls -la`.
- JSON/RPC/subagent event consumers retain existing forwarded `tool_execution_update.args`; no duplicate/synthetic event.

Do not:

- Move `tool_execution_start`.
- Emit a second start event.
- Add an RTK-specific code path.
- Add argument maps, timers, custom events, or mutation metadata.

#### Task 2 — Add focused regression test

File: `src/modes/interactive/interactive-mode.test.ts`

Create a narrow Vitest test using `Object.create(InteractiveMode.prototype)`:

1. Set only fields used by `handleEvent` update branch:
   - `pendingTools`: map containing tool call id and fake component.
   - `ui.requestRender`: `vi.fn()`.
2. Fake component methods:
   - `updateArgs`
   - `updateResult`
3. Treat fake component’s existing initial header as raw command (`{ command: "ls -la" }`).
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
   - `updateResult` called with partial result plus `isError: false`, `true`.
   - `requestRender` called once.

This fails before Task 1 because `updateArgs` is never called. It verifies forwarded mutated args reach rendered tool component while avoiding an RTK executable dependency.

### 4. Verification

Run:

```bash
npx vitest run src/modes/interactive/interactive-mode.test.ts
npm test -- --run
npm run build
git diff --check
git status --short
```

Success cases:

- Rewritten `tool_execution_update.args.command` refreshes pending bash row.
- Normal streaming tool updates still update result and render.
- Existing `tool_execution_start -> tool_call` ordering remains unchanged.
- JSON/RPC output remains existing raw session event stream, including already-forwarded update args.

Failure/regression cases:

- Missing pending tool: no component calls; existing no-op behavior preserved.
- Non-RTK tool updates: latest args continue to render normally.
- Empty partial bash update: header still refreshes; blank result behavior unchanged.
- No extra lifecycle events, duplicate tool rows, extension registrations, or dependencies.

WORKFLOW_PLAN_STATUS: ready