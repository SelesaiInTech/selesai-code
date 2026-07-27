## Review
- No blockers or actionable findings. `src/extensions/context-compaction-reminder.ts` uses supported `agent_settled` and successful `session_compact` events, reads the authoritative `ExtensionContext.getContextUsage()` API, preserves its latch for unknown post-compaction usage, and resets only after compaction or known low usage. The test covers the threshold boundary, deduplication, unknown/null usage, and both reset paths. `src/extensions/package.json` includes the new bundled entry.

## Validation
- `npx vitest run src/extensions/context-compaction-reminder.test.ts` — passed: 4 tests, 0 failures.
- `git diff --check -- src/extensions/package.json` — passed; manifest diff is one entry with no whitespace errors.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Reviewed src/extensions/context-compaction-reminder.ts, its focused test, and src/extensions/package.json directly. No actionable correctness, lifecycle, API-compatibility, or test-coverage finding remains."
    }
  ],
  "changedFiles": [
    "src/extensions/context-compaction-reminder.ts",
    "src/extensions/context-compaction-reminder.test.ts",
    "src/extensions/package.json"
  ],
  "testsAddedOrUpdated": [
    "src/extensions/context-compaction-reminder.test.ts"
  ],
  "commandsRun": [
    {
      "command": "npx vitest run src/extensions/context-compaction-reminder.test.ts",
      "result": "passed",
      "summary": "4 tests passed; 0 failures."
    },
    {
      "command": "git diff --check -- src/extensions/package.json",
      "result": "passed",
      "summary": "No whitespace errors in the manifest change."
    }
  ],
  "validationOutput": [
    "Focused reminder tests passed.",
    "The manifest adds ./context-compaction-reminder.ts to the bundled extension list."
  ],
  "residualRisks": [
    "The intentionally in-memory deduplication latch resets if extensions reload, so a still-large session can receive one new reminder after reload.",
    "Models that automatically compact before 128k will not reach this advisory threshold."
  ],
  "noStagedFiles": true,
  "diffSummary": "Adds one bundled 128k settled-context reminder extension, its focused lifecycle test, and the manifest entry that loads it.",
  "reviewFindings": [
    "no blockers or actionable findings"
  ],
  "manualNotes": "No files were edited during review; only the required review artifact was written."
}
```
