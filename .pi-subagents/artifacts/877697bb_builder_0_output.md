Implemented: bundled one-time 128k `/compact` warning with reset after compaction or known low usage.

Changed files: `src/extensions/context-compaction-reminder.ts`, test, bundled manifest.

Validation: focused Vitest and build passed.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Added the reminder as a bundled extension using existing agent_settled/session_compact events and getContextUsage(), with no core behavior changes."
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
      "summary": "4 focused reminder tests passed."
    },
    {
      "command": "npm run build",
      "result": "passed",
      "summary": "Type build and asset copy completed."
    },
    {
      "command": "git diff --check && git diff --cached --name-only",
      "result": "passed",
      "summary": "No whitespace errors and no staged files."
    },
    {
      "command": "test -f dist/extensions/context-compaction-reminder.ts && node -e '...'",
      "result": "passed",
      "summary": "Built extension was copied and declared in its bundled manifest."
    }
  ],
  "validationOutput": [
    "Vitest: PASS (4) FAIL (0).",
    "Build completed including copied bundled extension assets."
  ],
  "residualRisks": [
    "Smaller context-window models may auto-compact before 128k, intentionally preventing this advisory.",
    "The in-memory latch resets on extension reload."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added the 128k settled-context reminder, focused lifecycle tests, and the required manifest entry so the bundled extension is loaded.",
  "reviewFindings": [
    "no blockers",
    "Plan correction: src/extensions/package.json required a manifest entry; without it the new top-level extension would not load."
  ],
  "manualNotes": "Pre-existing unrelated working-tree changes were left untouched."
}
```

⧉ copy assistant: /cp 4a4270