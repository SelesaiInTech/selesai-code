 Implemented: removed `"src/**/*.test.ts"` from `tsconfig.build.json` `exclude` as requested.

Changed files: `tsconfig.build.json`

Validation:
- `npx vitest run src/modes/interactive/interactive-mode.test.ts` -> `PASS (2) FAIL (0)`
- `npm run build` -> fails with TS2341 private property errors in `src/modes/interactive/interactive-mode.test.ts` because test file now included in build and accesses private members.

Residual note: workspace has unrelated unstaged modifications (`src/modes/interactive/interactive-mode.ts`, `.codegraph/`, `src/modes/interactive/interactive-mode.test.ts`) not touched by this task.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Removed only `\"src/**/*.test.ts\"` from `tsconfig.build.json` `exclude`; no other file edited."
    }
  ],
  "changedFiles": [
    "tsconfig.build.json"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "npx vitest run src/modes/interactive/interactive-mode.test.ts",
      "result": "passed",
      "summary": "PASS (2) FAIL (0)"
    },
    {
      "command": "npm run build",
      "result": "failed",
      "summary": "TS2341 private-property access errors in src/modes/interactive/interactive-mode.test.ts now included by tsconfig build"
    }
  ],
  "validationOutput": [
    "tsconfig.build.json exclude list no longer contains src/**/*.test.ts",
    "Build now compiles the test file and fails on private member access"
  ],
  "residualRisks": [
    "Unrelated unstaged file changes exist in workspace: src/modes/interactive/interactive-mode.ts, .codegraph/, src/modes/interactive/interactive-mode.test.ts",
    "Build fails due to pre-existing test file private-member access; reverting test files may be needed to restore original build behavior"
  ],
  "noStagedFiles": true,
  "diffSummary": "Removed `\"src/**/*.test.ts\"` from tsconfig.build.json exclude array",
  "reviewFindings": [
    "blocker: src/modes/interactive/interactive-mode.test.ts:13-44 - accesses private class members, causing build failure after removing test file from exclude"
  ],
  "manualNotes": "Task was to revert only tsconfig.build.json; I did not alter the test file or other workspace changes. The build failure is a downstream effect of the requested exclude change combined with the existing test file's private-member accesses."
}
```

⧉ copy assistant: /cp dcc5dd