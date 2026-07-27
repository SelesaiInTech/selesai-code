## Review

### Correctness & plan adherence

- **npm-registry check detects newer `@selesai/code` without auto-installing** — satisfied. `checkForNewPiVersion` now calls `getLatestPackageRelease` with `PACKAGE_NAME` defaulting to `@selesai/code`, compares versions, and returns the release. No install path is invoked.
- **skip/offline suppress network** — satisfied. Both `getLatestPiRelease` and `getLatestPackageRelease` guard on `process.env.PI_SKIP_VERSION_CHECK || process.env.PI_OFFLINE` and return early; tests cover the paths.
- **interactive notification presents manual update instruction and no pi.dev link** — satisfied. `showNewVersionNotification` now builds the message with `getUpdateInstruction(PACKAGE_NAME)` and removed the changelog URL/hyperlink and the trailing `DynamicBorder` styling.
- **print mode fire-and-forget stderr-only** — satisfied. `runPrintMode` does `void checkForNewPiVersion(...).then(...)` and writes only to `console.error`, never `writeRawStdout`.
- **tests isolated and meaningful** — mostly satisfied. Six tests cover newer, current, offline, skipped, and registry-failure cases. `beforeEach` resets env; `afterEach` un-stubs globals.

### Findings

- **Finding** — `src/modes/interactive/interactive-mode.ts:878`: `checkForNewPiVersion(this.version)` is called without the second `packageName` argument. Because the default is now `@selesai/code` this works for selesai, but it is fragile: if the default ever drifts or this code is reused for another fork, the wrong package would be queried. Pass `PACKAGE_NAME` explicitly for clarity and consistency with `print-mode.ts:70`.
- **Finding** — `src/modes/print-mode.ts:70`: the fire-and-forget promise has no rejection handler. `getLatestPackageRelease` already catches network failures and returns `undefined`, so no unhandled rejection is expected today, but if an unexpected throw ever occurs in that chain it can crash the process. Add `.catch(() => {})` after the `.then(...)` to make the fire-and-forget contract explicit.
- **Note** — the test uses `process.env.PI_OFFLINE = ""` and `PI_SKIP_VERSION_CHECK = ""` in `beforeEach`. These empty-string values are falsy, so the early return is not triggered; that is the intended baseline. The tests that set `"1"` correctly exercise the truthy path.
- **Note** — existing `getLatestPiRelease` still uses `https://pi.dev/api/latest-version` for `APP_NAME === "pi"` self-update paths; this is untouched and intended for the pi brand only.

### Validation

- `npx vitest run src/__tests__/version-check.test.ts` — **6 passed**
- `npm run build` — **success**
- `npx tsc --noEmit` — **no errors**

WORKFLOW_REVIEW_STATUS: blocking

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Reviewed actual diff for src/utils/version-check.ts, src/modes/print-mode.ts, src/modes/interactive/interactive-mode.ts, and src/__tests__/version-check.test.ts. Verified npm-registry check, skip/offline guards, manual-update instruction without pi.dev link, stderr-only fire-and-forget print-mode behavior, and isolated tests. Validation: version-check.test.ts passes 6/6, npm run build succeeds, tsc --noEmit clean."
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
      "summary": "6 tests passed"
    },
    {
      "command": "npm run build",
      "result": "passed",
      "summary": "build succeeded with tsgo and asset copy"
    },
    {
      "command": "npx tsc --noEmit",
      "result": "passed",
      "summary": "no TypeScript errors"
    }
  ],
  "validationOutput": [
    "vitest: 1 passed, 6 passed",
    "build: success",
    "tsc: no errors"
  ],
  "residualRisks": [
    "interactive-mode.ts:878 calls checkForNewPiVersion(this.version) without explicit packageName; default currently works but is fragile.",
    "print-mode.ts:70 fire-and-forget promise lacks an explicit .catch(); safe today because getLatestPackageRelease swallows errors, but the contract should be explicit."
  ],
  "noStagedFiles": true,
  "diffSummary": "Re-enabled version checks against the npm registry for @selesai/code; added fire-and-forget stderr notice in print mode; changed interactive update notification to show a manual update instruction via getUpdateInstruction and removed pi.dev changelog link; added tests for newer/current/offline/skipped/failure cases.",
  "reviewFindings": [
    "finding: src/modes/interactive/interactive-mode.ts:878 - call checkForNewPiVersion(this.version, PACKAGE_NAME) for consistency and to avoid relying on the default packageName.",
    "finding: src/modes/print-mode.ts:70 - add .catch(() => {}) to the fire-and-forget promise to guarantee no future unhandled rejection."
  ],
  "manualNotes": "No coordination needed. The two findings are small safety/clarity fixes, not functional bugs. If accepted, they should be addressed before merge; otherwise current behavior meets the stated requirements."
}
```

⧉ copy assistant: /cp 579bfa