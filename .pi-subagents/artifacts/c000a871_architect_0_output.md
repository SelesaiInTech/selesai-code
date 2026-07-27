# Implementation Plan

## Goal

Add a TUI-only confirmation suggesting manual `/compact` when known context usage reaches `128_000` tokens, without changing automatic compaction.

## Findings

- `src/core/agent-session.ts:getContextUsage()` provides the current token estimate and returns `tokens: null` immediately after compaction to avoid stale measurements.
- `AgentSession._checkCompaction()` may auto-compact before the TUI receives `agent_settled`; the reminder must run afterward.
- `src/modes/interactive/interactive-mode.ts` owns the `/compact` command, modal confirmations (`showExtensionConfirm()`), and compaction event UI.
- `docs/compaction.md` documents manual and automatic compaction. No new setting or dependency is needed.

## Steps

1. Add `src/modes/interactive/compaction-suggestion.ts`.
   - Export `CONTEXT_COMPACTION_SUGGESTION_TOKENS = 128_000`.
   - Implement a small, testable per-session gate: prompt only when known tokens are `>=` the threshold; suppress repeats for the same above-threshold interval; reset when tokens drop below threshold, compaction succeeds, or session ID changes.
   - Treat `null`/unknown usage as ineligible and keep dismissal memory-only.

2. Update `src/modes/interactive/interactive-mode.ts`.
   - Keep one suggestion-gate instance.
   - In the `agent_settled` handler, after `checkShutdownRequested()`, call a private `maybeSuggestContextCompaction()` method.
   - Read `this.session.getContextUsage()?.tokens`; skip when usage is unknown/below threshold, the session is compacting, shutdown is pending, or the gate has already handled this interval.
   - Show `showExtensionConfirm()` with a concise “Context has reached 128,000 tokens. Compact now?” message.
   - On confirmation, call existing `handleCompactCommand()`; on decline/Escape, leave the interval suppressed.
   - Reset the gate only for successful `compaction_end`, not cancelled/failed compactions.

3. Add `src/__tests__/compaction-suggestion.test.ts`.
   - Cover below-threshold, exactly-128k, repeated high usage after dismissal, unknown usage, below-threshold reset, successful-compaction reset, and session-change reset.

4. Update `docs/compaction.md`.
   - Document the fixed 128,000-token TUI suggestion, confirmation requirement, dismissal behavior, unknown-usage suppression after compaction, and unchanged auto-compaction behavior.

## Verification

- `npx vitest run src/__tests__/compaction-suggestion.test.ts`
- `npx vitest run`
- `npm run build`
- Manual TUI: verify one prompt at 128,000, No/Escape suppresses repeats, Yes uses the normal compaction spinner/summary, and successful auto-compaction produces no stale prompt.

## Risks / Open Questions

- A 128k-context model with auto-compaction enabled will normally compact before this reminder; this is intentional to avoid competing flows.
- This plan interprets “128k” as decimal `128_000`, not `131_072`.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Planning-only request completed with a narrow implementation sequence, exact source/test/doc targets, and regression coverage."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "Repository inspection only; no implementation or validation commands were run."
  ],
  "residualRisks": [
    "Known token usage is unavailable immediately after compaction and must not trigger a reminder.",
    "Automatic compaction can preempt the manual suggestion for smaller context windows."
  ],
  "noStagedFiles": true,
  "diffSummary": "No source changes made; implementation plan only.",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "Reuse the existing confirmation and /compact paths; do not add settings, RPC behavior, or a second compaction mechanism."
}
```

WORKFLOW_PLAN_STATUS: ready

⧉ copy assistant: /cp 831ce2