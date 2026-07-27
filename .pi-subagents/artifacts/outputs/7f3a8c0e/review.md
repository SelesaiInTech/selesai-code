Review complete. No blockers.

Findings:
- `src/extensions/caveman/index.js` now mirrors ponytail's `resolveSessionMode` pattern with a minimal boolean-specific `resolveSessionActive` helper.
- `session_start` reads persisted `caveman-mode` entries via `getBranch`/`getEntries` fallback chain and restores the last value, fixing the root cause.
- `before_agent_start` is unchanged and remains correct; auto-injection naturally follows the restored `active` flag.
- Tests updated: the broken-behavior test now asserts persistence OFF, a new default-ON test was added, and a unit-test block covers `resolveSessionActive`.
- All 21 tests pass.

Ponytail-review: no unnecessary abstraction was introduced. The ~14-line duplication vs. ponytail is correct because the data shapes differ (boolean vs. string mode). No shared utility extraction needed.

WORKFLOW_REVIEW_STATUS: clean

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Reviewed actual diff in src/extensions/caveman/index.js, test/extension.test.js, and test/helpers.test.js against plan.md. Implementation matches plan, fixes root cause, tests pass, no unnecessary abstraction."
    }
  ],
  "changedFiles": [
    "src/extensions/caveman/index.js",
    "src/extensions/caveman/test/extension.test.js",
    "src/extensions/caveman/test/helpers.test.js"
  ],
  "testsAddedOrUpdated": [
    "src/extensions/caveman/test/extension.test.js",
    "src/extensions/caveman/test/helpers.test.js"
  ],
  "commandsRun": [
    {
      "command": "cd src/extensions/caveman && node --test ./test/*.test.js",
      "result": "passed",
      "summary": "21 tests passed, 0 failed"
    }
  ],
  "validationOutput": [
    "All 21 caveman tests pass."
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "Added resolveSessionActive helper, updated session_start to restore persisted caveman-mode active state, updated tests to assert persistence and added unit tests.",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "The fix is minimal and matches the ponytail pattern. Both caveman and ponytail can coexist; each injects independently via before_agent_start."
}
```

⧉ copy assistant: /cp e2e10f