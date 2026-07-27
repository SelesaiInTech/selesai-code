 Now I have a clear picture. Let me summarize the work needed:

1. **Blocker at `src/core/agent-session.ts:564`**: `_extensionMode` may be default `print` before `_emitAgentSettled`. Need to either prove it is set via `bindExtensions` before settled, or replace the guard with a reliable interactive capability check. Looking at the runtime flow, `bindExtensions` is called by mode setup before any prompts run. In interactive mode, `rebindCurrentSession` calls `bindExtensions({ mode: "tui" })`. Print and RPC modes bind similarly. So in real interactive sessions, `_extensionMode` is set to `tui` before any agent run. However, the test stubs `_extensionMode` directly and calls `_checkAutoHandoff` directly, not via `_emitAgentSettled`. The fix is: add a test that calls `_emitAgentSettled()` (the actual dispatch path) rather than only private helper, and ensure the guard is reliable. The guard `this._extensionMode !== "tui"` is actually reliable because the mode is bound before any run. But to be more robust, we could guard on `this._extensionRunner.hasUI()` or use `this._extensionMode !== "tui"`. The reviewer says "either prove/cover that extension mode is set before `_emitAgentSettled`, or replace it with the correct reliable interactive capability check". I think the simplest correct fix is to keep the mode guard but add a test that calls `_emitAgentSettled()` and also perhaps document/prove the binding order. But to be extra safe and make it not depend on private field initialization order, we could use a capability check: auto handoff requires TUI-specific command context actions (newSession, fork etc.) and UI. The `handoff-new` command itself checks `ctx.mode !== "tui"`. So even if we didn't guard in `_checkAutoHandoff`, the command would safely do nothing in non-TUI mode. But calling `getCommand("handoff-new")` and `createCommandContext()` in RPC mode would still create a context with `mode: "rpc"` and `hasUI: true` (RPC has UI dialogs), and then `handoff-new` would just notify error. That's not ideal. Better to guard on `this._extensionMode !== "tui"`. The issue is the default. We can prove that `_extensionMode` is set via `bindExtensions` before settled in real runs. The test should exercise `_emitAgentSettled`. I'll update the guard to check `this._extensionMode` but a reliability improvement is to cache the mode after bind. Actually the field is already updated in `bindExtensions` before `_applyExtensionBindings`. Good.

2. **Warning text at `src/extensions/context-compaction-reminder.ts:5`**: Hardcoded "128k" while Auto Handoff threshold is configurable. The reminder itself has an independent fixed threshold of 128k. We should fix the message to not hardcode 128k, or correctly distinguish the reminder's independent fixed threshold. The reviewer says: "Fix the warning text so it does not misleadingly hardcode 128k when configurable Auto Handoff threshold differs (or correctly distinguish the reminder’s independent fixed threshold)." Best fix: compute the message using `CONTEXT_COMPACTION_REMINDER_THRESHOLD` variable or format with it, so it always matches. That also handles if the threshold constant changes. Use template literal.

3. **RPC consistency (`src/modes/rpc/rpc-mode.ts:563`)**: No RPC threshold state/read/write. Need to expose both enabled and threshold in state, and support setting threshold with validation/persistence, plus client API/types/tests. So add:
   - `autoHandoffThresholdTokens` to `RpcSessionState` and `get_state`
   - `set_auto_handoff_threshold` command with number token, using `settingsManager.setAutoHandoffThresholdTokens`
   - Client `setAutoHandoffThresholdTokens(tokens: number): Promise<void>`
   - Type in `RpcCommand` and `RpcResponse`
   - Possibly test in RPC mode.

4. **Test at `src/core/agent-session-auto-handoff.test.ts`**: Private-field stubbing fails to exercise settled dispatch. Need to add a test that calls `_emitAgentSettled()`/actual settled dispatch, not only `_checkAutoHandoff()`.

Let's also check the `ExtensionRunner` has a `getMode`? No. But we don't need it.

For the mode reliability, I'll keep the `this._extensionMode !== "tui"` guard but add a ponytail comment explaining bind order. Actually I might replace it with `this._extensionMode !== "tui"` but the reviewer suggests replacing with "correct reliable interactive capability check". The capability check could be `this._extensionMode === "tui" && this._extensionCommandContextActions !== undefined`. Because `commandContextActions` are only provided in interactive mode (TUI). Wait, RPC mode also provides commandContextActions in `bindExtensions`. Print mode too. Let's check: `print-mode.ts` provides commandContextActions. RPC mode too. So that doesn't distinguish. The UI context distinguishes better: TUI passes a real UI context, RPC passes `createExtensionUIContext()` which has dialog support, print passes none? Print mode `bindExtensions` doesn't show uiContext, so `_extensionUIContext` remains undefined. `ExtensionRunner.setUIContext(undefined, "print")` sets `uiContext` to noOpUIContext and `hasUI()` false. In RPC, `setUIContext(uiContext, "rpc")` has a UI context with dialogs, `hasUI()` true. So a reliable interactive-only check for handoff-new (which needs TUI editor/dialog) might be `this._extensionMode !== "tui"`. The command itself already checks ctx.mode. So the guard is appropriate.

The concern is default. In tests, `_extensionMode` defaults to `print` unless set. In production, `bindExtensions` is called before any agent run. We can add a comment and a test proving it.

Actually, to make it more robust, we could check both mode and that commandContextActions are bound? But that's also bound in all modes. The most robust is `this._extensionMode !== "tui"` because only TUI sets it. To avoid the default issue, we can change default to undefined? But that changes semantics. Or we can add a getter `get isTuiMode(): boolean { return this._extensionMode === "tui"; }`. Not helpful.

I'll add a test for `_emitAgentSettled` path and keep mode guard, with a comment. The reviewer said "either prove/cover ... or replace". I'll cover and replace? The prompt says "either prove/cover that extension mode is set before `_emitAgentSettled`, or replace it with the correct reliable interactive capability check". So doing one is enough. I'll do both maybe: comment proving binding order and a test for `_emitAgentSettled`, and keep the guard. To be safe and simple.

Now let's fix the warning message. Use template literal with `CONTEXT_COMPACTION_REMINDER_THRESHOLD`. Format number as human readable with k. e.g.:
```ts
export const CONTEXT_COMPACTION_REMINDER_MESSAGE =
	`Conversation context has reached ${CONTEXT_COMPACTION_REMINDER_THRESHOLD.toLocaleString()} tokens...`
```
But tests assert exact message. So update the test too. The reviewer wants the warning text fixed so it's not misleading. Since the reminder's threshold is independent, we can also mention it generically: "Conversation context has reached the reminder threshold (128k tokens). Run /handoff-new..." But better to keep dynamic. The test imports `CONTEXT_COMPACTION_REMINDER_MESSAGE` and checks exact match, so dynamic is fine.

Now RPC changes. Let's edit files.

Files to change:
- `src/core/agent-session.ts`: maybe add comment on guard, but no code change needed? The blocker asks to prove/cover. I might not change this file beyond comment. But I also need to check if any fix for default. I think no code change needed except maybe comment. However, the test file will be updated.
- `src/extensions/context-compaction-reminder.ts`: dynamic message.
- `src/extensions/context-compaction-reminder.test.ts`: update expectation to use dynamic message? It already imports constant, so fine if we update constant message to be dynamic but constant still same at runtime. Since we use template literal, `CONTEXT_COMPACTION_REMINDER_MESSAGE` is a string computed at load; tests will still match. No test changes needed.
- `src/modes/rpc/rpc-types.ts`: add threshold to state, command, response.
- `src/modes/rpc/rpc-mode.ts`: add threshold to get_state, handler for set_auto_handoff_threshold.
- `src/modes/rpc/rpc-client.ts`: add `setAutoHandoffThresholdTokens`.
- `src/core/agent-session-auto-handoff.test.ts`: add test exercising `_emitAgentSettled`. Need to mock `_extensionRunner.emit` to resolve, and check events emitted. But `_emitAgentSettled` is private. We can call `(session as any)._emitAgentSettled()`. It will call `this._extensionRunner.emit({ type: "agent_settled" })` then `this._emit({ type: "agent_settled" })` then `_checkAutoHandoff`. Since we stub `_extensionRunner`, we need emit to resolve. The mock `emit: vi.fn()` returns undefined which resolves. `_emit` loops over `_eventListeners`. We can add a listener if needed. The test can assert that handoff handler called once. Need to set `_extensionMode` to "tui". Already default in createMockSession. Need to maybe also test that in default mode (print) it doesn't trigger. But createMockSession default sets mode "tui". We can add a test for `_emitAgentSettled` in print mode.

Wait, review finding: "private-field stubbing fails to exercise settled dispatch". The test stubs `_extensionRunner` and `_extensionMode` directly and calls `_checkAutoHandoff`. They want a test that goes through `_emitAgentSettled`. We can add one.

Also maybe they want to avoid stubbing private fields? But we can call `_emitAgentSettled` with same stubbing. The point is to exercise the dispatch.

Let's implement.

First, update reminder message. </think>