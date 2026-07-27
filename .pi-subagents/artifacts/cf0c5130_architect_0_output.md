Now I have a complete understanding. Let me formulate the plan.

The key architectural decision: The `context-compaction-reminder.ts` extension currently just shows a warning. The user wants to:
1. Add persistent settings for auto-handoff (enabled + threshold)
2. Actually trigger handoff automatically when threshold is met
3. Add settings menu items for these

The simplest approach that respects the existing architecture:

**Settings layer**: Add `autoHandoff` to `Settings` interface with `enabled` (boolean, default false) and `threshold` (number, default 128_000). Add getter/setter methods to `SettingsManager`.

**AgentSession layer**: Add `getAutoHandoffEnabled()`, `setAutoHandoffEnabled()`, `getAutoHandoffThreshold()` methods. In `_emitAgentSettled()`, after emitting `agent_settled`, check if auto-handoff is enabled and context usage exceeds threshold, then execute the `handoff-new` command programmatically via `this._extensionRunner.getCommand("handoff-new")` + `this._extensionRunner.createCommandContext()`. This is exactly parallel to how `prompt()` calls `_tryExecuteExtensionCommand`.

**Extension layer**: Modify `context-compaction-reminder.ts` to be aware of auto-handoff settings. When auto-handoff is enabled, the extension should NOT show the warning (the session will auto-trigger handoff). When auto-handoff is disabled, keep showing the warning as before. But the extension needs settings access...

Actually, the simplest approach: since the `AgentSession._emitAgentSettled()` can check settings and trigger handoff, the extension doesn't need to change at all for the auto-trigger behavior. The extension can remain as-is for the warning case. But the user said "make it to suggest" — the current behavior IS a suggestion (warning). The new behavior is: if auto-handoff is enabled, trigger it; if not, keep showing the warning.

Actually, re-reading the user request: "Currently, the context reminding feature, it is I think just remind like warning. Can we actually make it to suggest the user that they can make it automatically compact at some certain of point?"

So the user wants:
1. The current warning should suggest the user enable auto-handoff
2. Add settings for auto-handoff (toggle + threshold)
3. When enabled, auto-trigger handoff at threshold

The extension's warning message should be updated to mention that the user can enable auto handoff in settings. And the auto triggering should happen in AgentSession.

But the extension doesn't have settings access... The extension can still show the warning. The auto-trigger should happen in AgentSession.

Let me think about the cleanest minimal approach:

1. **Settings**: Add `autoHandoff` section to `Settings` with `enabled` and `thresholdTokens`. Add getters/setters to `SettingsManager`.
2. **AgentSession**: Add `autoHandoffEnabled` getter, `setAutoHandoffEnabled()` setter, `autoHandoffThresholdTokens` getter. In `_emitAgentSettled()`, check auto-handoff settings and trigger `handoff-new` command if threshold met.
3. **Extension**: Update `context-compaction-reminder.ts` warning message to mention auto handoff in settings. No settings access needed — it just changes the message text.
4. **Settings Selector UI**: Add two new setting items: "Auto handoff" (toggle) and "Auto handoff threshold" (selector with preset values).
5. **Footer**: No changes needed (auto-compact indicator already exists; auto-handoff is a separate feature).
6. **RPC**: Add `autoHandoffEnabled` to `RpcSessionState` and `set_auto_handoff` command.

Now let me produce the complete plan.

Here is the complete implementation plan:

---

# Auto Handoff Implementation Plan

## Overview

Transform the existing context-compaction-reminder warning into a configurable Auto Handoff feature. Users can enable/disable auto handoff and set a context-window token threshold in Settings. When enabled and context reaches the threshold, the `handoff-new` command is automatically triggered, generating a handoff document and opening a fresh session.

Focus: auto handoff only — not compaction, not refresh.

---

## Task 1: Add Auto Handoff Settings to SettingsManager

### Discovery

The settings system lives in `src/core/settings-manager.ts`. Settings are defined as a `Settings` interface, with nested sub-interfaces (e.g. `CompactionSettings`, `WarningSettings`). The `SettingsManager` class provides typed getters/setters that read from merged global/project settings. Nested settings objects (like `compaction`, `terminal`, `images`) use the pattern: create sub-interface in `Settings`, add getter/setter to `SettingsManager`, use `this.markModified(field, "nestedKey")` for nested writes.

### Identification

**File to modify:** `src/core/settings-manager.ts`

This file owns all settings storage, persistence, migration, and typed access. No other file defines settings types or persistence.

### Change

1. **Add `AutoHandoffSettings` interface** (after `WarningSettings` interface, ~line 40):

```typescript
export interface AutoHandoffSettings {
    enabled?: boolean; // default: false
    thresholdTokens?: number; // default: 128_000
}
```

2. **Add to `Settings` interface** (add field after `warnings?: WarningSettings;` ~line 120):

```typescript
autoHandoff?: AutoHandoffSettings;
```

3. **Add getter/setter methods** to `SettingsManager` class (after `getWarnings()`/`setWarnings()`, near end of class):

```typescript
getAutoHandoffEnabled(): boolean {
    return this.settings.autoHandoff?.enabled ?? false;
}

setAutoHandoffEnabled(enabled: boolean): void {
    if (!this.globalSettings.autoHandoff) {
        this.globalSettings.autoHandoff = {};
    }
    this.globalSettings.autoHandoff.enabled = enabled;
    this.markModified("autoHandoff", "enabled");
    this.save();
}

getAutoHandoffThresholdTokens(): number {
    return this.settings.autoHandoff?.thresholdTokens ?? 128_000;
}

setAutoHandoffThresholdTokens(tokens: number): void {
    if (!this.globalSettings.autoHandoff) {
        this.globalSettings.autoHandoff = {};
    }
    this.globalSettings.autoHandoff.thresholdTokens = Math.max(1000, Math.floor(tokens));
    this.markModified("autoHandoff", "thresholdTokens");
    this.save();
}
```

### Verification

- `getAutoHandoffEnabled()` returns `false` when no settings exist (default).
- `getAutoHandoffThresholdTokens()` returns `128_000` when no settings exist (default).
- After `setAutoHandoffEnabled(true)`, `getAutoHandoffEnabled()` returns `true` and the value persists in settings.json under `autoHandoff.enabled`.
- After `setAutoHandoffThresholdTokens(64000)`, `getAutoHandoffThresholdTokens()` returns `64000` and persists.
- Threshold setter clamps to minimum 1000.
- Existing settings unchanged (regression).

---

## Task 2: Add Auto Handoff to AgentSession

### Discovery

`src/core/agent-session.ts` owns the agent lifecycle. The `_emitAgentSettled()` method (line 535) is called after every agent run fully settles (after retries, compaction, and queued continuations). It has access to `this.settingsManager`, `this._extensionRunner` (which can execute commands via `getCommand()` + `createCommandContext()`), and `this.getContextUsage()`.

The `handoff-new` command is registered by `src/extensions/handoff-new.ts` and is accessible via `this._extensionRunner.getCommand("handoff-new")`. The `prompt()` method already shows the pattern for executing extension commands via `_tryExecuteExtensionCommand()` (line 1239).

### Identification

**File to modify:** `src/core/agent-session.ts`

This file owns the agent lifecycle and already has access to settings, context usage, and command execution. No other file should own this logic.

### Change

1. **Add auto-handoff state tracking** (near the `_lastAssistantMessage` field, ~line 545):

```typescript
private _autoHandoffTriggered = false;
```

2. **Add public getters/setters** (near `setAutoCompactionEnabled` / `autoCompactionEnabled`, ~line 2175):

```typescript
get autoHandoffEnabled(): boolean {
    return this.settingsManager.getAutoHandoffEnabled();
}

get autoHandoffThresholdTokens(): number {
    return this.settingsManager.getAutoHandoffThresholdTokens();
}
```

3. **Add auto-handoff check method** (after `_emitAgentSettled`, ~line 545):

```typescript
private async _checkAutoHandoff(): Promise<void> {
    if (!this.settingsManager.getAutoHandoffEnabled()) return;

    const usage = this.getContextUsage();
    if (!usage || usage.tokens === null) return;

    const threshold = this.settingsManager.getAutoHandoffThresholdTokens();
    if (usage.tokens < threshold) {
        this._autoHandoffTriggered = false;
        return;
    }

    if (this._autoHandoffTriggered) return;
    this._autoHandoffTriggered = true;

    // Only trigger in interactive mode (handoff-new requires TUI)
    if (this._extensionMode !== "tui") return;

    const command = this._extensionRunner.getCommand("handoff-new");
    if (!command) return;

    const ctx = this._extensionRunner.createCommandContext();
    try {
        await command.handler("", ctx);
    } catch (err) {
        this._extensionRunner.emitError({
            extensionPath: "command:handoff-new",
            event: "auto-handoff",
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
```

4. **Call the check in `_emitAgentSettled()`** (line 535-543):

```typescript
private async _emitAgentSettled(): Promise<void> {
    this._isAgentRunActive = false;
    try {
        await this._extensionRunner.emit({ type: "agent_settled" });
        this._emit({ type: "agent_settled" });
        await this._checkAutoHandoff();
    } finally {
        this._resolveIdleWaitIfIdle();
    }
}
```

5. **Reset the triggered flag on new sessions** — in the `session_start` handler or wherever compaction resets, the flag already resets when tokens drop below threshold (in `_checkAutoHandoff`). The `session_compact` event also naturally resets because tokens become null after compaction.

### Verification

**Success cases:**
- When auto-handoff is enabled and context tokens ≥ threshold, after agent settles, `handoff-new` command is invoked, generating a handoff doc and opening a new session.
- When auto-handoff is disabled, no auto handoff occurs (existing behavior unchanged).
- When context tokens < threshold, no auto handoff occurs.
- When context tokens is null (post-compaction, before next response), no auto handoff occurs.
- Auto-handoff triggers only once per threshold crossing (the `_autoHandoffTriggered` flag prevents repeated triggers). It resets when tokens drop below threshold.

**Failure cases:**
- If `handoff-new` command is not registered (e.g. extensions disabled), silently returns.
- If `handoff-new` throws, error is emitted via `emitError` but does not crash the session.
- In non-TUI mode (rpc/json/print), auto-handoff is skipped.

**Regression checks:**
- Existing `context-compaction-reminder` extension still fires on `agent_settled` as before.
- Auto-compaction logic in `_handlePostAgentRun` is unaffected.
- `agent_settled` event is still emitted to extensions and listeners before auto-handoff check.

---

## Task 3: Update Context Compaction Reminder Extension

### Discovery

`src/extensions/context-compaction-reminder.ts` is a built-in extension that warns users when context reaches 128k tokens. It listens to `agent_settled` and calls `ctx.ui.notify()` with a warning message. The extension does NOT have access to settings.

### Identification

**File to modify:** `src/extensions/context-compaction-reminder.ts`

This file owns the warning message and when it fires.

### Change

Update the warning message to mention auto-handoff as a configurable option:

```typescript
export const CONTEXT_COMPACTION_REMINDER_THRESHOLD = 128_000;
export const CONTEXT_COMPACTION_REMINDER_MESSAGE =
	"Conversation context has reached 128k tokens. Run /handoff-new to summarize into a new chat, or enable Auto Handoff in Settings to do this automatically. Bigger context windows eat up tokens quickly and degrade AI quality.";
```

The threshold constant remains 128k — the extension still uses its own fixed threshold for the warning. The configurable auto-handoff threshold is handled by `AgentSession` in Task 2.

No other changes to the extension logic. The extension does not need settings access because:
- When auto-handoff is disabled, the extension shows the warning as before.
- When auto-handoff is enabled and the threshold is met, `AgentSession._checkAutoHandoff()` triggers handoff-new. The extension's warning may also fire (if its 128k threshold is also met), but this is harmless — it just shows an informational notification while the handoff is being generated.

### Verification

- Warning message includes mention of Auto Handoff in Settings.
- Extension behavior unchanged (fires once, resets on compaction, resets when tokens drop below threshold).
- Existing tests in `context-compaction-reminder.test.ts` need the message assertion updated.

---

## Task 4: Add Settings UI for Auto Handoff

### Discovery

`src/modes/interactive/components/settings-selector.ts` defines `SettingsConfig` (data passed to the settings UI), `SettingsCallbacks` (handlers for setting changes), and `SettingsSelectorComponent` (the UI component). Settings items are `SettingItem` objects with `id`, `label`, `description`, `currentValue`, and either `values` (for toggles/selectors) or `submenu`.

The interactive mode (`src/modes/interactive/interactive-mode.ts`) wires up the settings at line ~4190 (`showSettingsSelector()`), passing config values and callback handlers.

### Identification

**Files to modify:**
1. `src/modes/interactive/components/settings-selector.ts` — Add UI items and callbacks
2. `src/modes/interactive/interactive-mode.ts` — Wire up settings values and callbacks

### Change

#### settings-selector.ts

1. **Add to `SettingsConfig` interface** (after `autoCompact: boolean;`):

```typescript
autoHandoffEnabled: boolean;
autoHandoffThresholdTokens: number;
```

2. **Add to `SettingsCallbacks` interface** (after `onAutoCompactChange`):

```typescript
onAutoHandoffEnabledChange: (enabled: boolean) => void;
onAutoHandoffThresholdTokensChange: (tokens: number) => void;
```

3. **Add setting items** in the `SettingsSelectorComponent` constructor's `items` array. Insert after the `autocompact` item (index 0, before image settings are spliced in):

```typescript
{
    id: "auto-handoff",
    label: "Auto handoff",
    description: "Automatically generate a handoff prompt and open a new session when context reaches the threshold",
    currentValue: config.autoHandoffEnabled ? "true" : "false",
    values: ["true", "false"],
},
{
    id: "auto-handoff-threshold",
    label: "Auto handoff threshold",
    description: "Context token count at which auto handoff triggers",
    currentValue: String(config.autoHandoffThresholdTokens),
    values: ["32000", "64000", "96000", "128000", "160000"],
},
```

4. **Add handlers** in the `SettingsList` callback switch statement (after `case "autocompact":`):

```typescript
case "auto-handoff":
    callbacks.onAutoHandoffEnabledChange(newValue === "true");
    break;
case "auto-handoff-threshold":
    callbacks.onAutoHandoffThresholdTokensChange(parseInt(newValue, 10));
    break;
```

#### interactive-mode.ts

5. **Add config values** in `showSettingsSelector()` (in the config object passed to `SettingsSelectorComponent`, after `autoCompact:`):

```typescript
autoHandoffEnabled: this.settingsManager.getAutoHandoffEnabled(),
autoHandoffThresholdTokens: this.settingsManager.getAutoHandoffThresholdTokens(),
```

6. **Add callbacks** in the callbacks object (after `onAutoCompactChange:`):

```typescript
onAutoHandoffEnabledChange: (enabled) => {
    this.settingsManager.setAutoHandoffEnabled(enabled);
},
onAutoHandoffThresholdTokensChange: (tokens) => {
    this.settingsManager.setAutoHandoffThresholdTokens(tokens);
},
```

### Verification

- Settings menu shows "Auto handoff" toggle and "Auto handoff threshold" selector.
- Toggling auto handoff persists to settings.json.
- Changing threshold persists to settings.json.
- Values load correctly from settings on menu open.
- Existing settings menu items remain unchanged (regression).

---

## Task 5: Update Existing Tests

### Discovery

`src/extensions/context-compaction-reminder.test.ts` tests the context-compaction-reminder extension. It asserts the exact warning message via `expect(notify).toHaveBeenCalledWith(CONTEXT_COMPACTION_REMINDER_MESSAGE, "warning")`.

### Identification

**File to modify:** `src/extensions/context-compaction-reminder.test.ts`

### Change

The test imports `CONTEXT_COMPACTION_REMINDER_MESSAGE` from the extension, so the assertion `expect(notify).toHaveBeenCalledWith(CONTEXT_COMPACTION_REMINDER_MESSAGE, "warning")` will automatically use the updated message. No test code changes needed — the test already uses the exported constant, so it will pass with the new message.

However, **add a new test** for the `ContextUsage` threshold edge case — verify the extension still does not fire when tokens are below threshold. This is already covered by existing tests.

### Verification

- All existing tests pass.
- No new test changes needed.

---

## Task 6: Update RPC Protocol (Optional / Minimal)

### Discovery

`src/modes/rpc/rpc-types.ts` defines the RPC command and response types. `src/modes/rpc/rpc-mode.ts` handles commands. `src/modes/rpc/rpc-client.ts` provides the client API.

### Identification

**Files to modify:**
1. `src/modes/rpc/rpc-types.ts` — Add command and state field
2. `src/modes/rpc/rpc-mode.ts` — Handle the new command
3. `src/modes/rpc/rpc-client.ts` — Add client method

### Change

1. **rpc-types.ts**: Add to `RpcCommand` union:
```typescript
| { id?: string; type: "set_auto_handoff"; enabled: boolean }
```

Add `autoHandoffEnabled: boolean;` to `RpcSessionState`.

Add to `RpcResponse`:
```typescript
| { id?: string; type: "response"; command: "set_auto_handoff"; success: true }
```

2. **rpc-mode.ts**: In `get_state`, add `autoHandoffEnabled: session.autoHandoffEnabled`. Add command handler:
```typescript
case "set_auto_handoff": {
    session.settingsManager.setAutoHandoffEnabled(command.enabled);
    return success(id, "set_auto_handoff");
}
```

3. **rpc-client.ts**: Add method:
```typescript
async setAutoHandoff(enabled: boolean): Promise<void> {
    await this.send({ type: "set_auto_handoff", enabled });
}
```

### Verification

- `get_state` response includes `autoHandoffEnabled`.
- `set_auto_handoff` command persists the setting.
- Existing RPC commands unchanged (regression).

---

## Ordering

1. **Task 1** (Settings) — foundational, no dependencies
2. **Task 2** (AgentSession) — depends on Task 1
3. **Task 3** (Extension message) — independent, can be done in parallel with Task 1-2
4. **Task 4** (Settings UI) — depends on Task 1
5. **Task 5** (Tests) — depends on Task 3
6. **Task 6** (RPC) — depends on Tasks 1-2, can be done last

Recommended: Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6

---

## Finished Result

### User Experience

1. User opens Settings (`/settings` or keyboard shortcut).
2. Two new items appear near the top (after "Auto-compact"):
   - **Auto handoff** — toggle true/false (default false)
   - **Auto handoff threshold** — selector: 32k, 64k, 96k, 128k, 160k (default 128k)
3. When auto handoff is **disabled** (default): the existing context warning appears at 128k tokens, now mentioning that auto handoff can be enabled in Settings.
4. When auto handoff is **enabled**: after the agent settles and context tokens ≥ threshold, the system automatically runs the `handoff-new` flow — generates a handoff document via LLM, opens a new session with the handoff text in the editor. The user reviews and submits.
5. Settings persist in `~/.selesai/agent/settings.json` under `autoHandoff: { enabled: true, thresholdTokens: 128000 }`.

### Settings JSON Example

```json
{
  "autoHandoff": {
    "enabled": true,
    "thresholdTokens": 128000
  }
}
```

### Files Changed

| File | Change |
|------|--------|
| `src/core/settings-manager.ts` | Add `AutoHandoffSettings` interface, `autoHandoff` field on `Settings`, 4 getter/setter methods |
| `src/core/agent-session.ts` | Add `_autoHandoffTriggered` flag, `autoHandoffEnabled`/`autoHandoffThresholdTokens` getters, `_checkAutoHandoff()` method, call it in `_emitAgentSettled()` |
| `src/extensions/context-compaction-reminder.ts` | Update warning message to mention Auto Handoff in Settings |
| `src/modes/interactive/components/settings-selector.ts` | Add `autoHandoffEnabled`/`autoHandoffThresholdTokens` to `SettingsConfig`, callbacks to `SettingsCallbacks`, 2 setting items + handlers |
| `src/modes/interactive/interactive-mode.ts` | Wire up settings values and callbacks in `showSettingsSelector()` |
| `src/modes/rpc/rpc-types.ts` | Add `set_auto_handoff` command, `autoHandoffEnabled` to state, success response |
| `src/modes/rpc/rpc-mode.ts` | Handle `set_auto_handoff`, add state field |
| `src/modes/rpc/rpc-client.ts` | Add `setAutoHandoff()` client method |

### No New Files. No New Dependencies. No New Abstractions.

---

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete findings with file paths: src/core/settings-manager.ts (Settings interface + SettingsManager class), src/core/agent-session.ts (_emitAgentSettled at line 535, _tryExecuteExtensionCommand at line 1239, settingsManager at line 273, extensionRunner.getCommand at line 614 of runner.ts), src/extensions/context-compaction-reminder.ts (CONTEXT_COMPACTION_REMINDER_MESSAGE at line 4, threshold 128_000 at line 3), src/extensions/handoff-new.ts (registers handoff-new command at line 88, uses ExtensionCommandContext.newSession at line 110), src/modes/interactive/components/settings-selector.ts (SettingsConfig at line 53, SettingsCallbacks at line 86, autocompact item at line 484), src/modes/interactive/interactive-mode.ts (showSettingsSelector at line 4190), src/modes/rpc/rpc-types.ts (RpcCommand at line 19, RpcSessionState at line 94), src/modes/rpc/rpc-mode.ts (set_auto_compaction handler at line 559), src/modes/rpc/rpc-client.ts (setAutoCompaction at line 308)"
    }
  ],
  "changedFiles": [
    "src/core/settings-manager.ts",
    "src/core/agent-session.ts",
    "src/extensions/context-compaction-reminder.ts",
    "src/modes/interactive/components/settings-selector.ts",
    "src/modes/interactive/interactive-mode.ts",
    "src/modes/rpc/rpc-types.ts",
    "src/modes/rpc/rpc-mode.ts",
    "src/modes/rpc/rpc-client.ts"
  ],
  "testsAddedOrUpdated": [
    "src/extensions/context-compaction-reminder.test.ts (existing tests auto-pass via exported constant, no code change needed)"
  ],
  "commandsRun": [],
  "validationOutput": [
    "Plan verified against codebase: settings-manager.ts Settings/SettingsManager pattern confirmed, agent-session.ts _emitAgentSettled + extensionRunner.getCommand/createCommandContext pattern confirmed, settings-selector.ts SettingItem pattern confirmed, interactive-mode.ts showSettingsSelector wiring confirmed, rpc-types.ts/rpc-mode.ts/rpc-client.ts RPC pattern confirmed, context-compaction-reminder.ts test uses exported constant so message change is assertion-safe"
  ],
  "residualRisks": [
    "Auto-handoff triggers after agent_settled which is async — if the user submits a new prompt before handoff generation completes, there could be a race. Mitigation: _autoHandoffTriggered flag prevents duplicate triggers; handoff-new uses ctx.newSession which replaces the active session.",
    "The context-compaction-reminder extension may fire its warning simultaneously with auto-handoff triggering. This is cosmetic (informational notification while handoff generates), not a functional issue.",
    "Non-TUI modes (rpc/json/print) skip auto-handoff since handoff-new requires interactive mode. RPC clients would need to implement their own handoff flow if needed."
  ],
  "noStagedFiles": true,
  "diffSummary": "Plan only — no code written. Adds AutoHandoffSettings to Settings/SettingsManager, _checkAutoHandoff() to AgentSession._emitAgentSettled(), updated reminder message, 2 new setting items in settings UI, RPC command/state for set_auto_handoff",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "The plan uses the existing handoff-new command (not a new implementation of handoff). Auto-handoff simply triggers that command programmatically when the threshold is met. The _autoHandoffTriggered flag ensures it fires once per threshold crossing, resetting when context drops below threshold (e.g. after handoff creates a new session with fresh context)."
}
```

WORKFLOW_PLAN_STATUS: ready

⧉ copy assistant: /cp 46ee23