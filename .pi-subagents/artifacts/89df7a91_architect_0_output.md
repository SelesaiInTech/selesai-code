# Implementation Plan

## Goal

Add a bundled, one-time warning that tells users to run `/compact` when known conversation context reaches **128,000 tokens**, without changing existing automatic-compaction behavior.

## Findings

- `src/core/agent-session.ts:getContextUsage()` is the authoritative accounting path: it returns `{ tokens, contextWindow, percent }`, returns `undefined` without a usable model/window, and intentionally returns `tokens: null` immediately after compaction until a new valid assistant usage exists.
- `src/core/extensions/types.ts:AgentSettledEvent` is emitted only after retries, automatic compaction, and queued continuations finish. A bundled extension listening here avoids warning immediately before a successful auto-compaction.
- `src/modes/interactive/interactive-mode.ts:createExtensionUIContext()` routes `ctx.ui.notify(..., "warning")` to a visible TUI warning; `src/modes/rpc/rpc-mode.ts` forwards it as an `extension_ui_request`. Print mode uses a no-op UI.
- `src/main.ts` always loads `getBundledExtensionsDir()`, and `package.json:copy-assets` recursively copies `src/extensions`; a new extension needs no loader, registry, dependency, or package-script change.
- `src/defaults/settings.json` enables auto-compaction with a 64k reserve, while `src/core/settings-manager.ts` has 16k fallbacks. **Medium residual behavior risk:** smaller-window models may auto-compact before 128k, so the advisory will correctly not appear for those sessions.
- Existing `docs/compaction.md` references upstream Pi and `.pi` paths rather than this repository’s `.selesai` config paths. **Low pre-existing documentation risk:** do not widen this feature into a documentation migration.

## Steps

1. **Add `src/extensions/context-compaction-reminder.ts`.**
   - Register an `agent_settled` handler and read `ctx.getContextUsage()?.tokens`; use the existing accounting result rather than recalculating tokens from transcript text.
   - Define the fixed requested threshold as `128_000`; do not add a settings field or dependency.
   - At `tokens >= 128_000`, issue one warning per above-threshold period: `Conversation context has reached 128k tokens. Run /compact to summarize older context.`
   - Keep an extension-local latch so later settled runs above the threshold do not repeat the warning.
   - Clear the latch after a successful `session_compact` event and when known usage falls below 128k, allowing a later threshold crossing to warn again.
   - If usage is `undefined` or `null`, do nothing and preserve the latch. This respects the intentional post-compaction unknown state and avoids false/repeated prompts.
   - Do not trigger compaction automatically. Because the check runs at `agent_settled`, successful automatic compaction has already completed and exposes unknown/low context instead of producing a stale advisory.

2. **Add `src/extensions/context-compaction-reminder.test.ts`.**
   - Mock `ExtensionAPI.on` to capture `agent_settled` and `session_compact` handlers and provide a minimal `ExtensionContext` with `getContextUsage()` and `ui.notify()` spies.
   - Verify no warning below 128k; exactly one warning at 128k and above; the warning is a warning-level message containing `/compact`.
   - Verify repeated settled events above the threshold do not duplicate the prompt.
   - Verify unavailable (`undefined`) and post-compaction (`null`) token data do not warn or reset the dedupe state.
   - Verify `session_compact` and a later known below-threshold reading reset the latch, so a subsequent crossing warns once again.

3. **Leave `src/core/agent-session.ts`, `src/core/extensions/types.ts`, `src/modes/interactive/interactive-mode.ts`, `src/modes/rpc/rpc-mode.ts`, `src/defaults/settings.json`, and `package.json` unchanged.**
   - Existing extension lifecycle, token accounting, UI transport, bundled-extension discovery, and asset copying already provide the required behavior.
   - This keeps automatic-compaction settings independent from the fixed manual-compaction advisory.

## Verification

- Success cases:
  - A settled session with exactly 128,000 known context tokens displays one warning instructing the user to run `/compact`.
  - A session remaining above 128k across later turns does not repeatedly warn.
  - After successful manual or automatic compaction, a later new crossing can warn again.
  - TUI shows the warning; RPC clients receive the existing warning notification request.

- Failure/regression cases:
  - No warning when no model/context window exists or token accounting is unavailable after compaction.
  - No advisory is emitted before automatic compaction settles.
  - Existing auto-compaction thresholds, manual `/compact`, and compaction cancellation/failure behavior remain unchanged.
  - Bundled extension loading remains automatic without adding user configuration.

- Commands/manual checks:
  ```bash
  npx vitest run src/extensions/context-compaction-reminder.test.ts
  npm run build
  ```
  - Manually run an interactive session with auto-compaction disabled and context usage at/above 128k; confirm one warning, run `/compact`, then confirm no warning until known usage later crosses 128k again.

## Risks / Open Questions

- **Medium:** The fixed 128k advisory is absolute, while automatic compaction is model-window/reserve based. Models that auto-compact earlier will not show the advisory; this is intentional to avoid prompting after compaction.
- **Low:** Context token values are provider usage plus existing estimates, not exact tokenizer counts. Reusing `getContextUsage()` preserves current product semantics.
- **Low:** A reload recreates extension-local dedupe state, so a still-large context can be warned once after reload. Persisting dismissal state would require session metadata and is unnecessary unless cross-reload suppression is explicitly required.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete findings identify src/core/agent-session.ts, src/core/extensions/types.ts, src/modes/interactive/interactive-mode.ts, src/modes/rpc/rpc-mode.ts, src/main.ts, package.json, and src/defaults/settings.json, including medium and low severity risks."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [
    "src/extensions/context-compaction-reminder.test.ts (planned)"
  ],
  "commandsRun": [],
  "validationOutput": [
    "Planning-only review; no repository code or tests were changed or run."
  ],
  "residualRisks": [
    "Auto-compaction can occur below 128k for smaller context windows, intentionally suppressing the advisory.",
    "The existing context estimate is provider-derived/heuristic rather than tokenizer-exact.",
    "Reloading recreates the in-memory one-time reminder latch."
  ],
  "noStagedFiles": true,
  "diffSummary": "Planning-only task; proposed implementation adds one bundled extension and one focused extension test.",
  "reviewFindings": [
    "no blocker: existing agent_settled, session_compact, getContextUsage, bundled-extension loading, and UI notification paths support the feature without core changes.",
    "medium: src/defaults/settings.json uses a 64k compaction reserve while src/core/settings-manager.ts falls back to 16k; model-specific auto-compaction may preempt the 128k advisory.",
    "low: docs/compaction.md retains pre-existing upstream Pi/.pi path references."
  ],
  "manualNotes": "No new configuration or dependency is needed; the requested fixed threshold should remain a bundled extension constant."
}
```

WORKFLOW_PLAN_STATUS: ready

⧉ copy assistant: /cp 0a65f5