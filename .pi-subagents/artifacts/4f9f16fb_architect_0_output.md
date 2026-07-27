# Implementation Plan

## Goal

Add a TUI-only, non-destructive suggestion to manually compact when the **known current context usage reaches 128,000 tokens**. Reuse the existing `/compact` workflow; do not alter automatic compaction thresholds or add settings.

## Findings

- **Core token tracking:** `src/core/agent-session.ts:getContextUsage()` derives current context usage from the latest valid assistant usage plus trailing-message estimates. It returns `tokens: null` immediately after compaction until a fresh assistant response, preventing stale pre-compaction usage.
- **Existing compaction:** `src/core/agent-session.ts:compact()` implements manual compaction; `_checkCompaction()` and `_runAutoCompaction()` implement automatic threshold/overflow compaction. `/compact [instructions]` is handled by `src/modes/interactive/interactive-mode.ts`.
- **TUI surfaces:** `src/modes/interactive/components/footer.ts` already displays context percentage/window. `interactive-mode.ts` has existing confirmation dialogs (`showExtensionConfirm`), status/error rendering, compaction spinner handling, and editor restoration.
- **Settings:** `src/core/settings-manager.ts` supports only auto-compaction enablement, reserve tokens, and retained recent tokens. A fixed 128k reminder does not require another setting.
- **Tests:** There are no core compaction/TUI reminder tests. Vitest tests live under `src/__tests__/`; `npm run build` compiles production TypeScript.
- **Documentation:** `docs/compaction.md` documents auto/manual compaction and is the appropriate location for the reminder behavior.

## Steps

1. **Add `src/modes/interactive/compaction-suggestion.ts`.**
   - Export `CONTEXT_COMPACTION_SUGGESTION_TOKENS = 128_000`.
   - Add a small stateful gate that accepts the active session ID and known token count, returning whether to show the prompt.
   - Show at `tokens >= 128_000`; ignore unknown usage (`null`/`undefined`).
   - Mark the high-usage interval as handled before opening a dialog, so repeated render/settled events cannot create duplicate prompts.
   - Reset the gate when usage falls below the threshold, when a successful compaction completes, or when the active session ID changes.
   - Keep dismissal in memory only; do not persist it in settings or session history.

2. **Update `src/modes/interactive/interactive-mode.ts`.**
   - Hold one `ContextCompactionSuggestion` instance.
   - After `agent_settled` (and after shutdown handling), call a private `maybeSuggestContextCompaction()` method. This timing ensures automatic compaction has already run, avoiding a stale or competing prompt.
   - Read `this.session.getContextUsage()?.tokens`; do nothing for unknown usage, inactive/compacting sessions, below-threshold usage, or an already-open selector.
   - Use the existing `showExtensionConfirm()` selector with wording such as: “Context has reached 128,000 tokens. Compact now to preserve room for future work? You can also run `/compact` later.”
   - On **Yes**, invoke the existing `handleCompactCommand()`/`session.compact()` path so existing extension hooks, cancellation, spinner, queueing, summary rendering, and errors remain unchanged.
   - On **No** or Escape, treat the reminder as dismissed for the current above-128k interval. Do not re-prompt until context becomes known below 128k, compaction succeeds, or a different session is active.
   - On successful `compaction_end`, reset the gate. Do not reset after cancelled or failed compaction, preventing immediate repeated prompts while usage remains high.

3. **Add `src/__tests__/compaction-suggestion.test.ts`.**
   - Verify no prompt below 128,000 and a prompt at exactly 128,000.
   - Verify only one prompt while usage remains at/above threshold after dismissal.
   - Verify reset/re-prompt eligibility after usage drops below threshold, successful compaction, and session-ID change.
   - Verify unknown token usage never prompts and does not incorrectly create a reminder.

4. **Update `docs/compaction.md`.**
   - Add a “128k manual suggestion” subsection near trigger behavior.
   - Document that it is a TUI suggestion based on known context usage, invokes the existing `/compact` command only after confirmation, does not change auto-compaction, is suppressed while token usage is unknown after compaction, and is dismissible for the current high-usage interval.
   - State that the threshold is fixed at 128,000 tokens and has no settings entry.

## Verification

- Run `npx vitest run src/__tests__/compaction-suggestion.test.ts`.
- Run `npm run build`.
- Run `npx vitest run`.
- Manual TUI checks:
  - At 127,999 known tokens, no prompt appears.
  - At 128,000 known tokens after the agent settles, one confirmation appears and retains editor focus after dismissal.
  - Selecting No/Escape produces no further prompt while usage remains above threshold.
  - Selecting Yes runs the normal compaction spinner and renders the normal compaction summary.
  - A successful compaction followed by new high usage can prompt again.
  - Auto-compaction and post-compaction `tokens: null` do not produce a stale prompt.
  - Models/sessions whose context never reaches 128,000 do not show the suggestion.

## Risks / Open Questions

- **Medium:** `src/core/agent-session.ts:_checkCompaction()` may auto-compact before the TUI settles for models whose configured auto threshold is at or below 128k. This is desirable: no manual prompt should compete with successful automatic compaction.
- **Medium:** `docs/compaction.md` describes upstream `.pi` paths and fallback defaults that differ from this fork’s shipped `src/defaults/settings.json` values. Keep this reminder change scoped, but separately reconcile documentation with Selesai configuration paths/defaults.
- **Low:** This plan interprets “128k” as decimal `128_000`, consistent with displayed token notation. Change the constant to `131_072` only if product intends binary Ki-token semantics.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete findings identify src/core/agent-session.ts, src/modes/interactive/interactive-mode.ts, src/modes/interactive/components/footer.ts, src/core/settings-manager.ts, docs/compaction.md, exact symbols, and severity-tagged risks."
    }
  ],
  "changedFiles": [
    ".selesai/artifacts/963cb53a-6e2f-4fed-ba95-c12af2ac3ae1/plan.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "Planning-only task; no implementation or test commands were run."
  ],
  "residualRisks": [
    "The implementation must preserve the distinction between known context estimates and null usage after compaction.",
    "The product meaning of 128k must remain decimal 128,000 unless explicitly changed."
  ],
  "noStagedFiles": true,
  "diffSummary": "Planning artifact only; no repository source files were modified.",
  "reviewFindings": [
    "medium: src/core/agent-session.ts:1910 - automatic compaction can preempt a manual reminder at the same practical usage level; the TUI check must run after automatic post-run handling.",
    "medium: docs/compaction.md:35 and src/defaults/settings.json - documented upstream config paths/defaults do not match this fork's shipped defaults."
  ],
  "manualNotes": "The recommended implementation deliberately reuses the existing confirmation dialog and /compact workflow, with no new dependency, setting, RPC event, or compaction algorithm."
}
```

WORKFLOW_PLAN_STATUS: ready

⧉ copy assistant: /cp c5836c