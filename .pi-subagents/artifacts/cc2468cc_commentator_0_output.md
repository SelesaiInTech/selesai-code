 Reviewed the uncommitted batched questions implementation in `src/extensions/question`. Here are the evidence-backed findings.

## Review

- **Finding** — `src/extensions/question/index.ts:868-870`: `BatchQuestionComponent.handleInput` blocks page navigation when `this.questionComponent?.isEditing` is true, which prevents switching to the next question while the user is typing a freeform answer or comment. For freeform-only batch questions, this means Tab/Right cannot advance without first submitting the current answer. Requirement says "freely next/previous;" this is an unnecessary restriction for freeform mode and mismatch with paged form UX. Smallest safe fix: allow navigation keys to advance/skip even while editing, or handle Tab/Right inside the editor only when it wants focus, otherwise bubble to page navigation.

- **Finding** — `src/extensions/question/index.ts:888`: After a cancellation on an individual question page (`saveAnswer` receives `null`), the whole batch immediately calls `this.onDone(null)` and cancels the entire batch. There is no way for a user to cancel just the current question and return to the batch; pressing Esc on a question page aborts everything. This may be intentional but is a UX gap vs "freely next/previous" and review concept; worth confirming.

- **Finding** — `src/extensions/question/index.ts:850-852`: On the review page, when not all questions are answered, Enter is ignored but the legend only says "Answer every question before submitting" without explaining how to go back ( SHIFT+Tab/← is listed for previous). The messaging is acceptable but a muted visual cue could be clearer; not a correctness bug.

- **Finding** — `src/extensions/question/index.ts:665`: `BatchQuestionComponent` does not pass `timeout` to the per-question dialog fallback (`askBatchViaDialogs`), so in headless/RPC mode batch questions ignore the overall `timeout` parameter even though the schema says "Auto-dismiss the whole batch after N milliseconds." In TUI mode it works via the top-level `setTimeout`. Smallest safe fix: pass `timeout` through to `askBatchViaDialogs` and enforce a single timeout there.

- **Finding** — `src/extensions/question/helpers.ts:21-26`: `normalizeOptions` filters out options whose labels are only whitespace, but `prepareBatchQuestions` does not issue an error when all options become empty after filtering; an options array of `[" ", "  "]` yields zero options yet `allowFreeform: false` can be supplied, causing the question to have no answerable choices. Smallest safe fix: after normalizing options, if options length is 0 and `allowFreeform` is false, return the same "options are empty" error.

- **Finding** — `src/extensions/question/index.ts:768`: The batch renderResult path maps over `details.answers` and accesses `answer.response` without a fallback; if a cancelled batch somehow reaches renderResult with an empty `answers` array it is fine, but there is no guard for malformed details. Existing single path already has similar assumptions; minor.

- **Note** — `src/extensions/question/batch.ts:1-32` is short and validated only by `batch.test.ts`. The new tests cover happy path and basic validation but do not exercise `BatchQuestionComponent` rendering, navigation, or review-page submission.

- **Note** — `src/extensions/question/schemas.ts:38-47`: TypeBox `Type.Union([SingleQuestionParamsSchema, BatchQuestionParamsSchema])` is permissive; the discriminator is `questions`. This is fine because `execute` checks `Array.isArray(params.questions)` first. Single-question path still requires `question`, batch path requires `questions`. No issue.

- **Validation — `npx vitest run src/extensions/question/tests`** — PASS (all 0 failures across batch, helpers, question-list, row-layout, shortcuts, ui-protocol tests).

- **Manual diff inspection** — Confirmed new files `src/extensions/question/batch.ts` and `src/extensions/question/tests/batch.test.ts` are untracked additions; modifications to existing files are limited to batch support and type parameterization of `UIProtocol.custom`.

No blocker found for the basic `questions[]` API, review page Enter-submit, or backward compatibility with single questions. Main actionable defects are the navigation-blocking-while-editing behavior and missing timeout propagation in dialog fallback.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete findings listed with file paths and severity: index.ts navigation while editing, index.ts no timeout in dialog fallback, helpers.ts/options filtering edge case, batch.ts/validation gap. No prose-only conclusion."
    }
  ],
  "changedFiles": [
    "src/extensions/question/batch.ts",
    "src/extensions/question/dialog-adapter.ts",
    "src/extensions/question/index.ts",
    "src/extensions/question/schemas.ts",
    "src/extensions/question/tui-adapter.ts",
    "src/extensions/question/types.ts",
    "src/extensions/question/ui-protocol.ts"
  ],
  "testsAddedOrUpdated": [
    "src/extensions/question/tests/batch.test.ts"
  ],
  "commandsRun": [
    {
      "command": "npx vitest run src/extensions/question/tests",
      "result": "passed",
      "summary": "All tests passed with 0 failures."
    }
  ],
  "validationOutput": [
    "Vitest suite src/extensions/question/tests passed; inspected git diff and source files for batch support, schemas, TUI adapter, dialog fallback, helpers, and constants."
  ],
  "residualRisks": [
    "Navigation keys (Tab/Right) are blocked when user is in freeform/comment editor inside a batched question; may conflict with 'freely next/previous' requirement.",
    "Batch timeout is not passed through to askBatchViaDialogs, so RPC/headless fallback ignores the timeout parameter.",
    "normalizeOptions silently drops whitespace-only option labels, allowing an unanswerable question when allowFreeform is false.",
    "No component-level tests for BatchQuestionComponent render, navigation, or review submission; logic is only manually inspected.",
    "Pressing Esc during an individual batched question calls onDone(null) and cancels the entire batch rather than returning to review."
  ],
  "noStagedFiles": false,
  "diffSummary": "Adds batched question support via a new questions[] parameter, BatchQuestionComponent for paged navigation and review page, dialog fallback for headless mode, updated schemas, generic UIProtocol.custom, and supporting types/tests. Existing single-question path remains unchanged.",
  "reviewFindings": [
    "finding: src/extensions/question/index.ts:868-870 - navigation keys blocked while editing freeform/comment; conflicts with freely next/previous requirement",
    "finding: src/extensions/question/index.ts:888 - Esc on an individual question cancels the entire batch instead of returning to review",
    "finding: src/extensions/question/index.ts:665 - batch timeout is not propagated to askBatchViaDialogs; ignored in headless/RPC fallback",
    "finding: src/extensions/question/helpers.ts:21-26 - normalizeOptions filters whitespace labels without error, allowing unanswerable questions when allowFreeform=false",
    "note: src/extensions/question/tests/batch.test.ts - component behavior not covered; only prepareBatchQuestions validation is tested"
  ],
  "manualNotes": "Overall implementation meets the questions[] API, final review Enter submit, and backward compatibility requirements. Primary concerns are the editing-time navigation block and missing dialog timeout. Recommend adding component-level tests before considering the feature fully validated."
}
```

⧉ copy assistant: /cp 7eb717