# Reuse Brief: Caveman Persistence Fix

## What Already Exists and Should Be Reused

### 1. Ponytail's `resolveSessionMode` pattern (exact mirror)

**File:** `src/extensions/ponytail/index.js` (lines 24-35)

```js
export function resolveSessionMode(entries, fallbackMode = DEFAULT_MODE) {
  const fallback = normalizePersistedMode(fallbackMode) || DEFAULT_MODE;
  if (!Array.isArray(entries)) return fallback;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry?.type !== "custom" || entry?.customType !== "ponytail-mode") continue;
    const mode = normalizePersistedMode(entry?.data?.mode);
    if (mode) return mode;
  }
  return fallback;
}
```

Caveman needs the same function but simpler (boolean, not mode string). **Do not extract a shared helper** — the type signatures differ (boolean vs string mode), and duplicating ~8 lines is the ponytail-correct call.

### 2. Ponytail's `session_start` handler (exact mirror)

**File:** `src/extensions/ponytail/index.js` (lines 166-171)

```js
pi.on("session_start", async (_event, ctx) => {
    const entries = ctx?.sessionManager?.getBranch?.() || ctx?.sessionManager?.getEntries?.() || [];
    configuredDefaultMode = getDefaultMode();
    currentMode = resolveSessionMode(entries, configuredDefaultMode);
    syncStatus(ctx);
    ctx?.ui?.notify?.(`Ponytail loaded: ${currentMode}`, "info");
});
```

Caveman's `session_start` (line 83-87) currently hardcodes `active = true`. Replace with the same entry-reading pattern.

### 3. Ponytail's `before_agent_start` guard pattern

**File:** `src/extensions/ponytail/index.js` (lines 185-188)

```js
pi.on("before_agent_start", async (event) => {
    if (!currentMode || currentMode === "off") return;
    return { systemPrompt: `${event.systemPrompt}\n\n${getPonytailInstructions(currentMode)}` };
});
```

Caveman already has this (lines 99-102) — no change needed. The guard `if (!active) return;` is correct.

### 4. Ponytail's test harness (`createPiHarness`)

**File:** `src/extensions/ponytail/test/extension.test.js` (lines 10-25)

Caveman's test harness (`src/extensions/caveman/test/extension.test.js` lines 7-20) is already identical in structure. No reuse needed — it's already copied.

### 5. Session entry API (`appendEntry`)

Both extensions already use `pi.appendEntry(customType, data)` identically:
- Caveman: `pi.appendEntry("caveman-mode", { active })` (line 46)
- Ponytail: `pi.appendEntry("ponytail-mode", { mode: normalized })` (line 84)

No change needed.

### 6. Session entry reading API (`getBranch` / `getEntries`)

**File:** `src/core/session-manager.ts`
- `getBranch()` (line 1152): returns entries from current leaf to root (preferred — only relevant branch)
- `getEntries()` (line 1185): returns all entries in the session file

Ponytail uses `getBranch?.() || getEntries?.() || []` — the fallback chain handles both missing sessionManager and missing methods. Caveman should mirror this exactly.

### 7. Extension lifecycle events

Both extensions use the same events:
- `session_start` — restore persisted state
- `agent_start` / `agent_end` — toggle status indicator
- `before_agent_start` — inject system prompt instructions
- `input` — detect deactivation commands

The runner (`src/core/extensions/runner.ts`) iterates all extensions independently. Each `before_agent_start` handler receives the *current* `systemPrompt` (which includes previous extensions' injections). This means caveman and ponytail compose naturally — both inject when active.

## Exact Files/Functions/Events to Mirror

| What | Source (ponytail) | Target (caveman) | Action |
|------|-------------------|-------------------|--------|
| `resolveSessionMode` → `resolveSessionActive` | `index.js:24-35` | `index.js` (new export) | Copy, simplify to boolean |
| `session_start` entry reading | `index.js:166-171` | `index.js:83-87` | Replace hardcoded `active = true` |
| `before_agent_start` guard | `index.js:185-188` | `index.js:99-102` | Already correct, no change |
| `session_start` restore test | `test/extension.test.js:78-92` | `test/extension.test.js:83-97` | Update existing test |
| `resolveSessionMode` unit tests | `test/helpers.test.js:22-30` | `test/helpers.test.js` (new) | Add `resolveSessionActive` tests |

## Shared Helper: No

Ponytail's `resolveSessionMode` handles string modes (`"lite"`, `"full"`, `"ultra"`, `"off"`). Caveman needs a boolean `active` field. The two functions differ in:
- Return type: `string` vs `boolean`
- Validation: `normalizePersistedMode(mode)` vs `typeof active === "boolean"`
- Fallback: `DEFAULT_MODE` vs `true`

Extracting a shared helper for two callers with different types is over-engineering. Duplicate ~8 lines.

## How Caveman and Ponytail Coexist When Both Active

The extension runner (`src/core/extensions/runner.ts` lines 999-1045) iterates all extensions in registration order. Each `before_agent_start` handler receives the *accumulated* `systemPrompt` from previous handlers. So:

1. Ponytail's handler fires → appends `"PONYTAIL MODE ACTIVE — level: full\n\n..."` to systemPrompt
2. Caveman's handler fires → appends `"CAVEMAN MODE ACTIVE.\n\n..."` to systemPrompt
3. Final systemPrompt contains both instruction blocks

Both status bars render independently via `setStatus("ponytail", ...)` and `setStatus("caveman", ...)`. The footer renders both.

**No conflict.** Both extensions are independent. The fix doesn't change this.

## Smallest Safe Implementation Path

### Files to change: 2
1. `src/extensions/caveman/index.js` — add `resolveSessionActive`, update `session_start`
2. `src/extensions/caveman/test/extension.test.js` — update 1 test, add 1 test

### Files to add: 0

### Steps:

1. **Add `resolveSessionActive` to `index.js`** (after `isDeactivationCommand`, before `export default function`):
   ```js
   export function resolveSessionActive(entries, fallback = true) {
     if (!Array.isArray(entries)) return fallback;
     for (let i = entries.length - 1; i >= 0; i -= 1) {
       const entry = entries[i];
       if (entry?.type !== "custom" || entry?.customType !== "caveman-mode") continue;
       const active = entry?.data?.active;
       if (typeof active === "boolean") return active;
     }
     return fallback;
   }
   ```

2. **Replace `session_start` body** (lines 83-87):
   ```js
   pi.on("session_start", async (_event, ctx) => {
       const entries = ctx?.sessionManager?.getBranch?.() || ctx?.sessionManager?.getEntries?.() || [];
       active = resolveSessionActive(entries);
       syncStatus(ctx);
       ctx?.ui?.notify?.(`Caveman loaded: ${active ? "ON" : "OFF"}`, "info");
   });
   ```

3. **Update test** `"session_start always ON even if persisted entry is OFF"` → `"session_start restores persisted OFF state"`:
   - Change assertion from `assert.ok(result.systemPrompt.includes("CAVEMAN MODE ACTIVE"))` to `assert.equal(result, undefined)`

4. **Add test** `"session_start defaults to ON when no persisted entry exists"`:
   - Empty entries → `before_agent_start` injects instructions

5. **Run tests**: `cd src/extensions/caveman && node --test ./test/*.test.js`

## Relevant Test Patterns

### Existing test that asserts broken behavior (must update)
**File:** `src/extensions/caveman/test/extension.test.js` (lines 83-97)
```js
test("session_start always ON even if persisted entry is OFF", async () => {
  // ...creates ctx with getEntries returning [{ active: false }]
  // Currently asserts: result.systemPrompt.includes("CAVEMAN MODE ACTIVE")
  // After fix: assert.equal(result, undefined)
});
```

### Existing test that asserts reset-to-ON behavior (must update)
**File:** `src/extensions/caveman/test/extension.test.js` (lines 99-110)
```js
test("off then new session_start resets to ON", async () => {
  // Creates a *fresh* harness (no persisted entries) → should still be ON
  // This test is correct after the fix — fresh harness = no entries → default true
  // No change needed
});
```

### Ponytail's restore test (reference for new test)
**File:** `src/extensions/ponytail/test/extension.test.js` (lines 78-92)
```js
test("session_start restores latest persisted mode", async () => {
  const { events } = createPiHarness();
  const ctx = createCommandContext({
    sessionManager: {
      getEntries: () => [
        { type: "custom", customType: "ponytail-mode", data: { mode: "lite" } },
      ],
    },
  });
  await events.get("session_start")({ reason: "resume" }, ctx);
  const result = await events.get("before_agent_start")({ systemPrompt: "BASE" }, ctx);
  assert.ok(result.systemPrompt.includes("lite"));
});
```

### Ponytail's `resolveSessionMode` unit tests (reference)
**File:** `src/extensions/ponytail/test/helpers.test.js` (lines 22-30)
```js
test("resolveSessionMode prefers latest persisted session mode", () => {
  const entries = [
    { type: "custom", customType: "ponytail-mode", data: { mode: "lite" } },
    { type: "custom", customType: "ponytail-mode", data: { mode: "ultra" } },
  ];
  assert.equal(resolveSessionMode(entries, "full"), "ultra");
});
test("resolveSessionMode returns fallback when entries is not an array", () => {
  assert.equal(resolveSessionMode(null, "ultra"), "ultra");
  assert.equal(resolveSessionMode(undefined, "lite"), "lite");
  assert.equal(resolveSessionMode({}, "full"), "full");
  assert.equal(resolveSessionMode("not an array"), "full");
});
```

## Constraints and Risks

1. **No shared module extraction** — caveman and ponytail have different data shapes (boolean vs string). A shared helper would be an unnecessary abstraction for two callers.

2. **`getBranch` vs `getEntries`** — `getBranch()` returns only the current branch (preferred — respects forks). `getEntries()` returns all entries including orphaned branches. The fallback chain `getBranch?.() || getEntries?.() || []` is correct and matches ponytail.

3. **`session_start` fires on reload too** — `src/core/agent-session.ts` line 2486 emits `session_start` with `reason: "reload"`. The fix handles this correctly since it reads persisted entries regardless of reason.

4. **No config file needed** — caveman is binary on/off with no intensity levels. Ponytail's `ponytail-config.cjs` handles default mode persistence across sessions, but caveman doesn't need this — the session entries themselves are the persistence mechanism.

5. **Test harness limitation** — `createPiHarness()` creates a fresh module scope each call, so `active` starts at `true`. The test `"off then new session_start resets to ON"` (line 99) creates a *second* harness to simulate a fresh session. This is correct — no persisted entries → default `true`. No change needed.

6. **Both active simultaneously** — no conflict. The extension runner chains `before_agent_start` handlers, accumulating systemPrompt. Both status bars render independently. The fix doesn't change this.