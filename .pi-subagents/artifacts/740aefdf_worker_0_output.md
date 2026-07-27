Implemented caveman session-state restore from persisted `caveman-mode` entries, plus the matching regression tests.
Changed files: `src/extensions/caveman/index.js`, `src/extensions/caveman/test/extension.test.js`, `src/extensions/caveman/test/helpers.test.js`.
Validation: `cd src/extensions/caveman && node --test ./test/*.test.js` → passed (21/21); `git diff --cached --name-only` → `<none>`.
Open risks/questions: no code blockers; interactive/manual smoke for real session resume wasn’t run here.
Recommended next step: do one manual resume check in the app (`/caveman off` → restart session → confirm no caveman injection).

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Added caveman-only resolveSessionActive in src/extensions/caveman/index.js, updated session_start to restore from getBranch/getEntries without touching ponytail or adding shared helpers, and updated caveman-only tests."
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
    },
    {
      "command": "git diff --cached --name-only",
      "result": "passed",
      "summary": "no staged files (<none>)"
    }
  ],
  "validationOutput": [
    "Caveman tests: 21 pass, 0 fail, duration_ms 102.361791",
    "Persisted OFF now restores correctly and skips before_agent_start injection",
    "Fresh session with no persisted entry still defaults to ON"
  ],
  "residualRisks": [
    "Interactive/manual smoke test for real session resume behavior was not run in this workspace session"
  ],
  "noStagedFiles": true,
  "diffSummary": "Added resolveSessionActive, restored caveman active state from persisted session entries on session_start, flipped the broken OFF-persistence assertion, and added pure-function coverage.",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "Unrelated unstaged/untracked workspace files were present before/after (for example .selesai/prompts/ and a session HTML export); they were left untouched."
}
```

⧉ copy assistant: /cp d8ff2e