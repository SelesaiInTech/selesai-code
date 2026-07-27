# Task for builder

Implement the complete auto-update-awareness plan in the workspace, in the stated order. Do not write to `.selesai/artifacts/7d866a9c-c409-48a0-b7d2-e44fab5a0833` or any workflow artifact. Scope: (1) reactivate `checkForNewPiVersion` in `src/utils/version-check.ts` using the existing npm registry helper and PACKAGE_NAME, respecting PI_SKIP_VERSION_CHECK/PI_OFFLINE; (2) update `src/modes/interactive/interactive-mode.ts` so its update notice shows `getUpdateInstruction(PACKAGE_NAME)` rather than pi.dev/`selesai update`; (3) add a non-blocking update notice only to `runPrintMode`, writing exclusively to stderr and never RPC/stdout; (4) add isolated tests in `src/__tests__/version-check.test.ts` for newer, current, offline, skipped, and registry-failure behavior. Preserve current project style and reuse existing functions/dependencies. Verify with the focused Vitest test and `npm run build`, fixing any failures caused by your changes. Return an inline completion summary listing changed files, behavior, and exact command outcomes.

## Acceptance Contract
Acceptance level: checked
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Implement the requested change without widening scope

Required evidence: changed-files, tests-added, commands-run, residual-risks, no-staged-files

Finish with a fenced JSON block tagged `acceptance-report` in this shape:
Use empty arrays when no items apply; array fields contain strings unless object entries are shown.
```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "specific proof"
    }
  ],
  "changedFiles": [
    "src/file.ts"
  ],
  "testsAddedOrUpdated": [
    "test/file.test.ts"
  ],
  "commandsRun": [
    {
      "command": "command",
      "result": "passed",
      "summary": "short result"
    }
  ],
  "validationOutput": [
    "validation output or concise summary"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "short description of the diff",
  "reviewFindings": [
    "blocker: file.ts:12 - issue found, or no blockers"
  ],
  "manualNotes": "anything else the parent should know"
}
```