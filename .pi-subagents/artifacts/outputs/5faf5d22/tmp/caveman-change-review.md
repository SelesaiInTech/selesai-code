## Review
- Correct: `src/extensions/caveman/caveman-instructions.cjs:4-8` replaces per-turn skill-file loading with a compact fixed prompt. It retains terse/complete guidance, exact technical terms/code blocks/quoted errors, and all four clarity exceptions. `src/extensions/caveman/index.js:42-116` owns persisted activation and whole-message deactivation; the compact prompt correctly omits those state rules. Caveman tests pass.
- Note (medium): `src/extensions/ponytail/ponytail-instructions.cjs:79` still injects `persistent every response; off only "stop ponytail"/"normal mode"` every turn, and `src/extensions/ponytail/index.js:144-187` already implements deactivation and persisted mode in extension state. This is redundant per-turn prompt content and conflicts with the state-owned persistence/deactivation objective. Remove that clause (and its test expectation) unless Ponytail intentionally has a separate requirement to keep it model-instructed.
- Correct: workflow prompt metadata removal is covered by `src/__tests__/adapter.test.ts:133-139`; all targeted tests passed.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "One actionable medium-severity objective regression is identified with paths and line numbers; retained Caveman requirements were verified against implementation and tests."
    }
  ],
  "changedFiles": [
    "src/__tests__/adapter.test.ts",
    "src/extensions/caveman/caveman-instructions.cjs",
    "src/extensions/caveman/test/helpers.test.js",
    "src/extensions/ponytail/index.js",
    "src/extensions/ponytail/ponytail-instructions.cjs",
    "src/extensions/ponytail/test/extension.test.js",
    "src/extensions/ponytail/test/helpers.test.js",
    "src/extensions/workflow/adapter.ts"
  ],
  "testsAddedOrUpdated": [
    "src/__tests__/adapter.test.ts",
    "src/extensions/caveman/test/helpers.test.js",
    "src/extensions/ponytail/test/extension.test.js",
    "src/extensions/ponytail/test/helpers.test.js"
  ],
  "commandsRun": [
    {
      "command": "(cd src/extensions/caveman && npm test) && (cd src/extensions/ponytail && npm test) && npx vitest run src/__tests__/adapter.test.ts",
      "result": "passed",
      "summary": "Caveman: 20 passed; Ponytail: 18 passed; Vitest: 35 passed, 0 failed."
    },
    {
      "command": "git diff --check",
      "result": "passed",
      "summary": "No whitespace errors reported."
    }
  ],
  "validationOutput": [
    "Compact Caveman prompt is under 400 characters and tests assert state instructions are absent.",
    "Targeted test suites passed."
  ],
  "residualRisks": [
    "Ponytail retains redundant persistence/deactivation wording on every turn despite state-based handling."
  ],
  "noStagedFiles": true,
  "diffSummary": "Compacts Caveman and Ponytail injected instructions and removes workflow tool prompt metadata.",
  "reviewFindings": [
    "medium: src/extensions/ponytail/ponytail-instructions.cjs:79 - redundant persistence/deactivation clause remains in the per-turn prompt although extension state owns both behaviors."
  ],
  "manualNotes": "Read-only review; no source files were modified. Untracked .codegraph/ and UBIQUITOUS_LANGUAGE.md were outside the reviewed diff."
}
```