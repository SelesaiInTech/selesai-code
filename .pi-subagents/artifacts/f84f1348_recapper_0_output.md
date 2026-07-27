# Handoff: Caveman Persistence + Auto-Inject Fix

## User Goal

Caveman mode should persist across sessions and auto-inject into the system/runtime prompt — exactly like ponytail already does. Currently, if a user runs `/caveman off`, the OFF state is lost on the next session: caveman springs back to ON because `session_start` hardcodes `active = true`.

## Approved Requirements

Source: `./.selesai/artifacts/20260710-194326-i-think-caveman-not-auto-inject-like-pon/requirements.md`

- Audit the mode-injection path; do not patch just one call site.
- Caveman must be persistent once enabled until explicitly turned off (same as ponytail).
- Caveman instructions must auto-inject into the system prompt via `before_agent_start`.
- Smallest root-cause fix in the shared path if possible.
- Validation: one manual smoke test + one small regression test.
- When caveman and ponytail are both active, both apply: caveman affects brevity/style, ponytail affects implementation style.

## Root Cause Summary

**File:** `src/extensions/caveman/index.js`, `session_start` handler (line ~83):

```js
pi.on("session_start", async (_event, ctx) => {
    active = true; // always ON — ignores persisted entries
    ...
});
```

Caveman already writes `appendEntry("caveman-mode", { active })` when toggled (via `setActive`, line ~46), but **never reads those entries back** on session resume. Ponytail, by contrast, calls `resolveSessionMode(entries, fallback)` in its `session_start` to restore the last persisted mode.

**Consequence:** Persisted OFF is dead data. New session always starts ON.

**Why auto-inject already works:** The `before_agent_start` handler (line ~99) already injects `getCavemanInstructions()` when `active` is true. The only problem is that `active` is always set to `true` at session start, overriding any persisted OFF state. Fix the persistence bug → auto-inject is automatically correct for OFF sessions too.

## Exact Files / Patterns to Inspect and Reuse

### Primary fix target

| File | Lines | What's there | Action |
|------|-------|-------------|--------|
| `src/extensions/caveman/index.js` | ~38 | `isDeactivationCommand` export | Add `resolveSessionActive` export after this |
| `src/extensions/caveman/index.js` | ~83-87 | `session_start` handler hardcodes `active = true` | Replace with entry-reading pattern |
| `src/extensions/caveman/index.js` | ~99-102 | `before_agent_start` handler | **No change** — already correct |
| `src/extensions/caveman/index.js` | ~46 | `setActive` calls `pi.appendEntry("caveman-mode", { active })` | **No change** — write side already works |

### Reference implementation to mirror

| File | Lines | Pattern |
|------|-------|---------|
| `src/extensions/ponytail/index.js` | 24-35 | `resolveSessionMode(entries, fallbackMode)` — scans entries backward, returns last matching `ponytail-mode` entry's mode |
| `src/extensions/ponytail/index.js` | 166-171 | `session_start` reads `ctx?.sessionManager?.getBranch?.() || ctx?.sessionManager?.getEntries?.() || []`, calls `resolveSessionMode` |
| `src/extensions/ponytail/index.js` | 185-188 | `before_agent_start` guard: `if (!currentMode || currentMode === "off") return;` then injects. Caveman already mirrors this with `if (!active) return;` |

### Session entry API

| File | Method | Notes |
|------|--------|-------|
| `src/core/session-manager.ts` | `getBranch()` (line ~1152) | Returns entries from current leaf to root. Preferred — respects forks. |
| `src/core/session-manager.ts` | `getEntries()` (line ~1185) | Returns all entries in session file. Fallback. |

Fallback chain ponytail uses (and caveman should copy):
```js
const entries = ctx?.sessionManager?.getBranch?.() || ctx?.sessionManager?.getEntries?.() || [];
```

### Test files to update

| File | What | Action |
|------|------|--------|
| `src/extensions/caveman/test/extension.test.js` | Test `"session_start always ON even if persisted entry is OFF"` (lines ~83-97) — asserts the **broken** behavior | Update: rename to `"session_start restores persisted OFF state"`, change assertion to `assert.equal(result, undefined)` |
| `src/extensions/caveman/test/extension.test.js` | Test `"off then new session_start resets to ON"` (lines ~99-110) — fresh harness with no entries | **No change** — still correct (no entries → default ON) |
| `src/extensions/caveman/test/helpers.test.js` | No `resolveSessionActive` tests yet | Add unit test block for `resolveSessionActive` |
| `src/extensions/caveman/test/helpers.test.js` | Existing tests for `parseCavemanCommand`, `isDeactivationCommand`, `getCavemanInstructions` | **No change** |

### Ponytail test reference (for pattern, not copy)

| File | Lines | Pattern |
|------|-------|---------|
| `src/extensions/ponytail/test/extension.test.js` | 78-92 | `"session_start restores latest persisted mode"` — shows how to mock `getEntries` returning a persisted entry |
| `src/extensions/ponytail/test/helpers.test.js` | 22-30 | `resolveSessionMode` unit tests — shows the assertion shape |

### Instruction builder (no change needed)

| File | What |
|------|------|
| `src/extensions/caveman/caveman-instructions.cjs` | Already works: reads `SKILL.md`, strips frontmatter, prepends `"CAVEMAN MODE ACTIVE"`. No change. |

### Runner coexistence proof

| File | Lines | What |
|------|-------|------|
| `src/core/extensions/runner.ts` | 995-1045 | `before_agent_start` dispatch: loops all extensions in registration order. Each handler receives `currentSystemPrompt` (accumulated from previous handlers). If handler returns `{ systemPrompt: ... }`, it replaces `currentSystemPrompt`. Both caveman and ponytail inject independently — no conflict. |

## Minimum Implementation Steps

### Step 1: Add `resolveSessionActive` to `src/extensions/caveman/index.js`

Location: after the `isDeactivationCommand` export, before `export default function cavemanExtension(pi)`.

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

This mirrors ponytail's `resolveSessionMode` but simpler: boolean, not mode string. Scan backward, return last matching entry's `active` value, fall back to `true`.

### Step 2: Replace `session_start` handler body

In `src/extensions/caveman/index.js`, replace:

```js
pi.on("session_start", async (_event, ctx) => {
    active = true;
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

Default fallback is `true` — preserves original behavior when no persisted entries exist. The only change: if a persisted `{ active: false }` entry exists, caveman now respects it.

### Step 3: Update the test that asserts broken behavior

In `src/extensions/caveman/test/extension.test.js`:

Rename `"session_start always ON even if persisted entry is OFF"` → `"session_start restores persisted OFF state"`.

Change the final assertion from:
```js
assert.ok(result.systemPrompt.includes("CAVEMAN MODE ACTIVE"));
```
To:
```js
assert.equal(result, undefined);
```

The test setup already has `getEntries` returning `[{ type: "custom", customType: "caveman-mode", data: { active: false } }]`. After the fix, `session_start` should read this and set `active = false`, so `before_agent_start` returns `undefined` (no injection).

### Step 4: Add `resolveSessionActive` unit tests to `helpers.test.js`

In `src/extensions/caveman/test/helpers.test.js`:

Add `resolveSessionActive` to the import from `../index.js`:
```js
import {
  getCavemanInstructions,
  isDeactivationCommand,
  parseCavemanCommand,
  resolveSessionActive,
} from "../index.js";
```

Add test:
```js
test("resolveSessionActive: returns last persisted boolean, defaults to true", () => {
  assert.equal(resolveSessionActive([]), true);
  assert.equal(resolveSessionActive([{ type: "custom", customType: "caveman-mode", data: { active: false } }]), false);
  assert.equal(resolveSessionActive([{ type: "custom", customType: "caveman-mode", data: { active: true } }]), true);
  assert.equal(resolveSessionActive([
    { type: "custom", customType: "caveman-mode", data: { active: false } },
    { type: "custom", customType: "caveman-mode", data: { active: true } },
  ]), true); // last entry wins
  assert.equal(resolveSessionActive([{ type: "custom", customType: "other", data: {} }]), true); // no match -> default
  assert.equal(resolveSessionActive(null), true); // not array -> default
});
```

### Step 5: Run tests

```bash
cd src/extensions/caveman && node --test ./test/*.test.js
```

All tests should pass. The updated test now asserts persistence (OFF respected), and the new `resolveSessionActive` unit test covers the pure function.

## Test / Manual Verification Expectations

### Automated tests (must pass after fix)

1. **Updated test:** `"session_start restores persisted OFF state"` — persisted `{ active: false }` entry → `before_agent_start` returns `undefined`.
2. **New unit test:** `"resolveSessionActive: returns last persisted boolean, defaults to true"` — covers empty, single ON, single OFF, last-entry-wins, no-match, null input.
3. **Existing tests unchanged:** all other tests in `extension.test.js` and `helpers.test.js` remain green. The `"off then new session_start resets to ON"` test uses a fresh harness with no persisted entries → defaults to `true` → still correct.

### Manual smoke test

1. Start interactive session.
2. Run `/caveman off` → verify status bar clears, no caveman instructions in next turn.
3. End session, start new session.
4. **Verify caveman stays OFF** (status bar empty, `before_agent_start` does not inject). This is the bug fix — previously it sprang back to ON.
5. Run `/caveman on` → verify injection resumes.
6. End session, start new → verify caveman stays ON.
7. With both ponytail and caveman ON: verify both `PONYTAIL MODE ACTIVE` and `CAVEMAN MODE ACTIVE` appear in the system prompt.

### Edge cases verified by the fix

- **Corrupt entry (active not boolean):** `resolveSessionActive` skips via `typeof active === "boolean"` check, falls through to default `true`.
- **No sessionManager:** `ctx?.sessionManager?.getBranch?.()` returns `undefined`, falls back to `[]`, `resolveSessionActive([])` returns `true`.
- **`session_start` with `reason: "reload"`:** handled correctly — reads persisted entries regardless of reason.

## Coexistence Rule: Caveman + Ponytail Both Active

Both extensions are independent. The fix does not change this.

- **Runner** (`src/core/extensions/runner.ts` lines 995-1045): iterates all extensions in registration order. Each `before_agent_start` handler receives the accumulated `systemPrompt` from previous handlers. Ponytail injects its block, caveman injects its block. Final prompt contains both.
- **Status bars:** both render independently via `setStatus("ponytail", ...)` and `setStatus("caveman", ...)`. Footer renders both.
- **Session entries:** each writes its own `customType` (`ponytail-mode` vs `caveman-mode`). No collision.
- **No conflict.** Both apply: caveman affects brevity/style, ponytail affects implementation style.

## Constraints

1. **No shared module extraction.** Ponytail's `resolveSessionMode` handles string modes (`"lite"`/`"full"`/`"ultra"`/`"off"`). Caveman needs boolean `active`. Different types, different validation. Duplicating ~8 lines is simpler than a shared abstraction for two callers. This is the ponytail-correct call.
2. **No new files.** Only modify `src/extensions/caveman/index.js` and `src/extensions/caveman/test/extension.test.js` and `src/extensions/caveman/test/helpers.test.js`.
3. **No config file for caveman.** Caveman is binary on/off — session entries are the persistence mechanism. Ponytail's `ponytail-config.cjs` handles default mode persistence, but caveman does not need this.
4. **Do not touch ponytail.** No changes to any ponytail file. Both extensions are independent.
5. **Do not change `before_agent_start`, `input` handler, `agent_start`/`agent_end`, or the command handler.** They are already correct. Only `session_start` and the new `resolveSessionActive` function are the fix.
6. **Keep diff minimal.** One new exported function (~8 lines), one handler body replacement (~2 lines changed), one test update (rename + 1 assertion change), one new unit test block (~8 lines). Total: ~20 lines changed.
7. **Default fallback stays `true`.** Caveman defaults to ON when no persisted entry exists — this preserves the original behavior for fresh sessions.

WORKFLOW_HANDOFF_STATUS: ready