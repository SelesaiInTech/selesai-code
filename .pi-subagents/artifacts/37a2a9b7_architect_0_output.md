# Implementation Plan

## Goal

Fix caveman's `session_start` so it reads persisted `caveman-mode` session entries (like ponytail does via `resolveSessionMode`) instead of hardcoding `active = true`. This makes caveman persistent across sessions: ON by default, OFF stays off until explicitly turned back on.

## Root Cause

**File:** `src/extensions/caveman/index.js`, `session_start` handler (line ~73):

```js
pi.on("session_start", async (_event, ctx) => {
    active = true; // ponytail: always ON at session start; OFF is current-session-only
    ...
});
```

Caveman writes `appendEntry("caveman-mode", { active })` when toggled, but **never reads those entries back** on session resume. Ponytail, by contrast, calls `resolveSessionMode(entries, configuredDefaultMode)` in its `session_start` to restore the last persisted mode.

**Consequence:** If user does `/caveman off`, the OFF state is lost on the next session — caveman springs back to ON. This breaks persistence and makes the persisted entries dead data.

## What to Inspect First (already done — results below)

1. **`src/extensions/caveman/index.js`** — the extension entry point. Contains `session_start`, `before_agent_start`, command handler, deactivation listener. The `session_start` hardcodes `active = true`.
2. **`src/extensions/caveman/caveman-instructions.cjs`** — instruction builder. Already works: reads SKILL.md, strips frontmatter, prepends `"CAVEMAN MODE ACTIVE"`. No change needed.
3. **`src/extensions/ponytail/index.js`** — reference implementation. Shows the correct pattern: `resolveSessionMode(entries, fallback)` scans entries backward, restores the last persisted value.
4. **`src/extensions/ponytail/ponytail-config.cjs`** — ponytail's config logic. Caveman has no config file equivalent and doesn't need one (binary on/off, no intensity levels).
5. **`src/extensions/caveman/test/extension.test.js`** — existing tests. The test `"session_start always ON even if persisted entry is OFF"` explicitly asserts the **current broken behavior** and must be updated.
6. **`src/extensions/caveman/test/helpers.test.js`** — tests for `parseCavemanCommand`, `isDeactivationCommand`, `getCavemanInstructions`. No change needed.

## Suspected Shared Components / Code Paths

The fix touches exactly **one file**: `src/extensions/caveman/index.js`.

No shared utility exists between ponytail and caveman for session-state resolution. Ponytail's `resolveSessionMode` lives inside `src/extensions/ponytail/index.js` and is ponytail-specific (handles mode strings like "lite"/"full"/"ultra"). Caveman needs a simpler boolean version. Duplicating ~10 lines is simpler than extracting a shared abstraction for two callers with different types. This is the ponytail-correct call: smallest diff, no unnecessary abstraction.

## Minimum Code Changes

### Change 1: Add `resolveSessionActive(entries, fallback = true)` function

**File:** `src/extensions/caveman/index.js`
**Location:** After the existing exports (`isDeactivationCommand`), before `export default function cavemanExtension(pi)`.

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

This mirrors ponytail's `resolveSessionMode` pattern: scan backward, return the most recent matching entry's value, fall back to default if none found.

### Change 2: Use `resolveSessionActive` in `session_start`

**File:** `src/extensions/caveman/index.js`
**Location:** The `session_start` handler.

Replace:
```js
pi.on("session_start", async (_event, ctx) => {
    active = true; // ponytail: always ON at session start; OFF is current-session-only
    syncStatus(ctx);
    ctx?.ui?.notify?.(`Caveman loaded: ${active ? "ON" : "OFF"}`, "info");
});
```

With:
```js
pi.on("session_start", async (_event, ctx) => {
    const entries = ctx?.sessionManager?.getBranch?.() || ctx?.sessionManager?.getEntries?.() || [];
    active = resolveSessionActive(entries);
    syncStatus(ctx);
    ctx?.ui?.notify?.(`Caveman loaded: ${active ? "ON" : "OFF"}`, "info");
});
```

Default fallback is `true` (ON), matching the original default. The difference: if a persisted `caveman-mode: { active: false }` entry exists, caveman now respects it.

### Change 3: Update the test that asserts broken behavior

**File:** `src/extensions/caveman/test/extension.test.js`
**Test:** `"session_start always ON even if persisted entry is OFF"`

This test currently asserts that a persisted OFF entry is **ignored** (caveman springs back to ON). After the fix, it should assert the opposite: persisted OFF is **respected**.

Replace the test body to assert:
- `session_start` with a persisted `{ active: false }` entry results in `before_agent_start` returning `undefined` (no injection).
- Rename test to: `"session_start restores persisted OFF state"`.

### Change 4: Add one regression test for persistence

**File:** `src/extensions/caveman/test/extension.test.js`
**New test:** `"session_start restores persisted ON state when entry is active: true"`

Assert that a `{ active: true }` entry causes injection, and that no entry at all defaults to ON (injection happens).

Also add a test: `"session_start defaults to ON when no persisted entry exists"` — empty entries → active → injection happens.

### Change 5: Export `resolveSessionActive` from index.js

Already done in Change 1 (it's an `export function`). Add a test in `helpers.test.js` for the pure function:

**File:** `src/extensions/caveman/test/helpers.test.js`

```js
test("resolveSessionActive: returns last persisted boolean, defaults to true", () => {
  assert.equal(resolveSessionActive([]), true);
  assert.equal(resolveSessionActive([{ type: "custom", customType: "caveman-mode", data: { active: false } }]), false);
  assert.equal(resolveSessionActive([{ type: "custom", customType: "caveman-mode", data: { active: true } }]), true);
  assert.equal(resolveSessionActive([
    { type: "custom", customType: "caveman-mode", data: { active: false } },
    { type: "custom", customType: "caveman-mode", data: { active: true } },
  ]), true); // last entry wins
  assert.equal(resolveSessionActive([{ type: "custom", customType: "other", data: {} }]), true); // no match → default
  assert.equal(resolveSessionActive(null), true); // not array → default
});
```
Import `resolveSessionActive` from `../index.js`.

## What NOT to Change

- `caveman-instructions.cjs` — instruction builder works correctly.
- `before_agent_start` handler — already injects instructions when active. No change needed.
- `input` / deactivation handler — already listens for "stop caveman" / "normal mode". No change needed.
- Command handler (`/caveman on|off|toggle|status`) — already calls `setActive` which calls `pi.appendEntry`. No change needed.
- Ponytail extension — no change needed. Both extensions are independent; they each inject into `systemPrompt` via `before_agent_start`, and the host concatenates both results. When both are active, both instructions appear in the system prompt. This is the desired behavior.
- No shared module extraction. Two extensions with ~10 lines of duplicated resolution logic is simpler than a shared utility.

## Verification

### Success Cases

1. **Fresh session (no prior entries):** caveman defaults to ON, `before_agent_start` injects `"CAVEMAN MODE ACTIVE"`.
2. **Persisted OFF:** User did `/caveman off` in a prior session. New session reads `{ active: false }` entry → caveman OFF → `before_agent_start` returns `undefined`.
3. **Persisted ON:** User did `/caveman on` in a prior session. New session reads `{ active: true }` entry → caveman ON → injection happens.
4. **Both caveman + ponytail ON:** Both `before_agent_start` handlers fire, both inject their instructions. System prompt contains both `"PONYTAIL MODE ACTIVE"` and `"CAVEMAN MODE ACTIVE"`.
5. **Mid-session toggle:** `/caveman off` during a session writes entry, immediately sets `active = false`, subsequent `before_agent_start` skips injection.

### Failure Cases

1. **Corrupt entry (active not boolean):** `resolveSessionActive` skips it via `typeof active === "boolean"` check, falls through to default `true`.
2. **No sessionManager:** `ctx?.sessionManager?.getBranch?.()` returns `undefined`, falls back to `[]`, `resolveSessionActive([])` returns `true` (ON).

### Regression Checks

1. All existing tests in `extension.test.js` pass except the one explicitly updated.
2. `helpers.test.js` tests remain green (no change to `parseCavemanCommand`, `isDeactivationCommand`, `getCavemanInstructions`).
3. Ponytail tests remain green (completely untouched).

### Manual Smoke Test

1. Start an interactive session.
2. Run `/caveman off` — verify status bar clears, no caveman instructions in next turn.
3. End session, start a new session.
4. Verify caveman stays OFF (status bar empty, `before_agent_start` doesn't inject). **This is the bug fix — previously it would spring back to ON.**
5. Run `/caveman on` — verify injection resumes.
6. End session, start new — verify caveman stays ON.
7. With both ponytail and caveman ON: verify both `PONYTAIL MODE ACTIVE` and `CAVEMAN MODE ACTIVE` appear in the system prompt.

### Run Tests

```bash
cd src/extensions/caveman && node --test ./test/*.test.js
```

## What the Finished Prototype Should Look Like

`src/extensions/caveman/index.js` with:
- A new exported `resolveSessionActive(entries, fallback = true)` function (~8 lines)
- `session_start` reads entries and calls `resolveSessionActive` instead of hardcoding `true`
- Everything else unchanged

`src/extensions/caveman/test/extension.test.js` with:
- Updated `"session_start restores persisted OFF state"` test (was `"session_start always ON even if persisted entry is OFF"`)
- New `"session_start defaults to ON when no persisted entry exists"` test

`src/extensions/caveman/test/helpers.test.js` with:
- New `resolveSessionActive` test block

## Implementation Order

1. Add `resolveSessionActive` to `src/extensions/caveman/index.js` and export it.
2. Replace the `session_start` handler body to use `resolveSessionActive`.
3. Update the existing `"session_start always ON even if persisted entry is OFF"` test to assert persistence.
4. Add the `resolveSessionActive` unit test to `helpers.test.js`.
5. Run `cd src/extensions/caveman && node --test ./test/*.test.js` — all green.
6. Manual smoke test (steps above).

WORKFLOW_PLAN_STATUS: ready