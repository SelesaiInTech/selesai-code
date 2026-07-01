# Handoff: Change footer welcome title from "pi agent" to "SelesaiCode"

## 1. Task summary

The user noticed the hard-coded text `" pi agent "` in the welcome splash screen of the `pi-powerline-footer` extension and wants it changed to `"SelesaiCode"`. This is a two-line, single-file literal text replacement — no logic, layout math, or structural changes are involved.

**Artifact references (authoritative):**
- Requirements: `./.selesai/artifacts/20260702-013213-in-src-extensions-pi-powerline-footer-we/requirements.md`
- Plan: `./.selesai/artifacts/20260702-013213-in-src-extensions-pi-powerline-footer-we/plan.md`
- Reuse: `./.selesai/artifacts/20260702-013213-in-src-extensions-pi-powerline-footer-we/reuse.md` (skipped — not applicable)

## 2. File to modify

| File | Line | Current text | New text |
|------|------|-------------|----------|
| `src/extensions/pi-powerline-footer/welcome.ts` | 191 | `const title = " pi agent ";` | `const title = "SelesaiCode";` |
| `src/extensions/pi-powerline-footer/welcome.ts` | 218 | `* Welcome overlay component for pi agent.` | `* Welcome overlay component for SelesaiCode.` |

## 3. Precise edits

### Edit 1 — Visible title (line 191)

- **oldText:** `const title = " pi agent ";`
- **newText:** `const title = "SelesaiCode";`

Render the replacement text **exactly** as typed by the user: `SelesaiCode` — no surrounding spaces, no lowercase transformation.

The title is rendered in the top border of the welcome splash box via `fgOnly("model", title)`. The layout math (`titleVisLen`, `afterTitle`, `afterTitleText` on lines 194-196) recomputes automatically from `visibleWidth(title)`. The new string is shorter than `" pi agent "` (10 chars vs 11 chars), so the trailing border fill will be longer. **No code changes to the layout math are needed.**

### Edit 2 — JSDoc comment (line 218)

- **oldText:** ` * Welcome overlay component for pi agent.`
- **newText:** ` * Welcome overlay component for SelesaiCode.`

Preserve the leading space, asterisk, and trailing period formatting.

## 4. Scope

### In scope
- Replace the `const title` value at line 191.
- Update the JSDoc comment at line 218.

### Out of scope
- Do **not** rename any internal path references containing `agent`: `.pi/agent/`, `AGENTS.md`, `agentsMdPaths`, `agent/extensions`, `agent/settings.json`, `agent/skills`, `agent/commands`, `agent/sessions`.
- Do **not** change other occurrences of the word "agent" (lines 345-353, 358, 366, 463, 496, 544).
- Do **not** modify the `PI_LOGO` ASCII art, gradient rendering, `WelcomeComponent` class logic, countdown, or data loading.
- Do **not** touch any other file.

## 5. Verification and success criteria

### Commands to run after editing

```bash
# 1. Zero remaining "pi agent" occurrences
grep -n "pi agent" src/extensions/pi-powerline-footer/welcome.ts

# 2. Exactly 2 "SelesaiCode" matches
grep -n "SelesaiCode" src/extensions/pi-powerline-footer/welcome.ts

# 3. Internal path references untouched (count should be unchanged)
grep -rn "\.pi.*agent" src/extensions/pi-powerline-footer/welcome.ts

# 4. Only two lines changed in the diff
git diff src/extensions/pi-powerline-footer/welcome.ts
```

### Expected results
1. `grep -n "pi agent"` returns **zero matches**
2. `grep -n "SelesaiCode"` returns **exactly 2 matches**: line ~191 (`const title = "SelesaiCode";`) and line ~218 (`* Welcome overlay component for SelesaiCode.`)
3. `grep -rn "\.pi.*agent"` returns the same count as before the edit (all internal paths untouched)
4. `git diff` shows only the two intended line changes

### Confirmed source lines (as of 2026-07-02)
```
src/extensions/pi-powerline-footer/welcome.ts:191:  const title = " pi agent ";
src/extensions/pi-powerline-footer/welcome.ts:218: * Welcome overlay component for pi agent.
```

## 6. Context for the builder

- **No grilling needed.** The user explicitly confirmed:
  - Replacement text: `SelesaiCode` (exact casing, no spaces).
  - Scope: title + JSDoc comment only.
- **No dependencies.** Both edits are independent and can be applied in either order.
- **No new files.** Only `src/extensions/pi-powerline-footer/welcome.ts` is modified.
- **Low risk.** No runtime logic depends on the literal text value of `title`. The border-fill arithmetic auto-adjusts to the new string length.

## Suggested skills

- **handoff** (`C:\Users\andrew.anggada\.selesai\agent\skills\handoff\SKILL.md`) — if further handoff compaction is needed.
- **ponytail** (`C:\Users\andrew.anggada\.selesai\agent\skills\ponytail\SKILL.md`) — for post-implementation review if a structured review pass is desired.
