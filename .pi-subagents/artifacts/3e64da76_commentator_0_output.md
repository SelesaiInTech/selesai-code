 ## Review

I inspected the targeted diff and source files for the private npm manual-update-awareness feature.

- `src/utils/version-check.ts`: `checkForNewPiVersion` now accepts `currentVersion`, `packageName` (defaults to `"@selesai/code"`), and optional `options`. It calls `getLatestPackageRelease`, then `isNewerPackageVersion` to decide if the registry version is newer. Offline/skip guards remain in `getLatestPackageRelease` as `process.env.PI_SKIP_VERSION_CHECK || process.env.PI_OFFLINE`.
- `src/modes/interactive/interactive-mode.ts`: `run()` now explicitly calls `checkForNewPiVersion(this.version, PACKAGE_NAME)` (line 878). Imports `PACKAGE_NAME` and `getUpdateInstruction` from `config.ts`. `showNewVersionNotification` now uses `getUpdateInstruction(PACKAGE_NAME)`. Removed the old inline update/changelog formatting and hyperlink usage.
- `src/modes/print-mode.ts`: Adds a fire-and-forget `void checkForNewPiVersion(VERSION, PACKAGE_NAME).then(...).catch(() => {})` at line 70. Writes to `stderr` (`console.error`) only, so stdout/RPC stream boundaries are preserved. The rejection handler swallows errors safely.
- `src/__tests__/version-check.test.ts`: Adds `beforeEach` clearing environment flags and 5 new `checkForNewPiVersion` cases: newer, current, offline, skip, registry failure. Covers offline/skip behavior and failure returns.

**Findings**
- **Blocker — none.**
- **Finding — low:** `src/__tests__/version-check.test.js` is an untracked CommonJS mirror of the TypeScript test. Vitest tries to run it and fails ("Vitest cannot be imported in a CommonJS module using require..."). It is not part of the staged diff, but it causes the full-suite `npx vitest run` to report failures, masking clean results for the actual changed files. This is a workspace hygiene issue, not a code issue in the diff.
- **Note:** The remaining full-suite failures are unrelated to this diff (test files referencing missing modules, "No test suite found" in compiled `dist/` tests, etc.).
- **Note:** The interactive version check is still fire-and-forget without a `.catch`. Any rejection would be an unhandled promise rejection. `checkForNewPiVersion` currently never throws (fetch failures return `undefined`), so this is safe today but worth a defensive `.catch` if the helper changes.

**Validation**
- `npx vitest run src/__tests__/version-check.test.ts` — 1 file passed, 6 tests passed.
- `npx tsc --noEmit` — TypeScript: No errors found.
- `npm run build` — completed successfully.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Reviewed actual diff of src/utils/version-check.ts, src/modes/interactive/interactive-mode.ts, src/modes/print-mode.ts, and src/__tests__/version-check.test.ts. Interactive startup calls checkForNewPiVersion(this.version, PACKAGE_NAME) at line 878. Print mode uses void checkForNewPiVersion(VERSION, PACKAGE_NAME).then(...).catch(() => {}). Stdout/RPC boundaries preserved by writing to stderr; offline/skip env guards remain in getLatestPackageRelease. Tests cover newer, current, offline, skip, and failure cases. Targeted tests and tsc/build pass."
    }
  ],
  "changedFiles": [
    "src/__tests__/version-check.test.ts",
    "src/modes/interactive/interactive-mode.ts",
    "src/modes/print-mode.ts",
    "src/utils/version-check.ts"
  ],
  "testsAddedOrUpdated": [
    "src/__tests__/version-check.test.ts"
  ],
  "commandsRun": [
    {
      "command": "npx vitest run src/__tests__/version-check.test.ts",
      "result": "passed",
      "summary": "1 passed, 6 passed"
    },
    {
      "command": "npx tsc --noEmit",
      "result": "passed",
      "summary": "No errors found"
    },
    {
      "command": "npm run build",
      "result": "passed",
      "summary": "Build completed"
    }
  ],
  "validationOutput": [
    "Targeted version-check tests pass; TypeScript emits no errors; production build succeeds."
  ],
  "residualRisks": [
    "Untracked src/__tests__/version-check.test.js (CommonJS mirror) causes unrelated full-suite Vitest failures and should be deleted to keep CI clean.",
    "Interactive fire-and-forget checkForNewPiVersion promise has no .catch; safe while the helper never throws, but brittle to future helper changes."
  ],
  "noStagedFiles": true,
  "diffSummary": "Re-enabled checkForNewPiVersion to query npm registry for @selesai/code, wired it into interactive and print modes, updated notifications to use getUpdateInstruction(PACKAGE_NAME), and added focused tests.",
  "reviewFindings": [
    "no blockers",
    "finding: untracked src/__tests__/version-check.test.js causes full-suite failures (cleanup)",
    "note: interactive mode's fire-and-forget version check lacks a defensive .catch"
  ],
  "manualNotes": "Workspace contains many untracked files (158). The diff under review is limited to the four tracked files; the rest are outside this review scope."
}
```

WORKFLOW_REVIEW_STATUS: clean

⧉ copy assistant: /cp cfa355