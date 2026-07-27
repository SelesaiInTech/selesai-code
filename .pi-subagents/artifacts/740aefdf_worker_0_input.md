# Task for worker

Fallback implementation run because builtin `builder` failed to launch due runtime model mapping error. Execute the same approved implementation task in the workspace.

Use these workflow artifacts as the source of truth:
- plan: ./.selesai/artifacts/20260710-194326-i-think-caveman-not-auto-inject-like-pon/plan.md
- handoff: ./.selesai/artifacts/20260710-194326-i-think-caveman-not-auto-inject-like-pon/handoff.md
- reuse: ./.selesai/artifacts/20260710-194326-i-think-caveman-not-auto-inject-like-pon/reuse.md

Task summary:
- Root cause is in `src/extensions/caveman/index.js`: `session_start` hardcodes `active = true` and ignores persisted `caveman-mode` entries.
- Mirror the tiny session-restore pattern from `src/extensions/ponytail/index.js`, but keep it caveman-specific: no shared abstraction.
- Caveman must persist ON/OFF across sessions and continue auto-injecting its instructions through `before_agent_start` when active.
- If caveman and ponytail are both active, both should still apply.

Implement every task from the plan in order:
1. Add `resolveSessionActive(entries, fallback = true)` to `src/extensions/caveman/index.js`.
2. Update caveman `session_start` to read `ctx?.sessionManager?.getBranch?.() || ctx?.sessionManager?.getEntries?.() || []` and restore `active` from persisted entries.
3. Update the existing caveman test that currently asserts broken OFF persistence behavior.
4. Add the small regression coverage described in the plan/handoff/reuse docs, including a focused pure-function test for `resolveSessionActive`.
5. Run the relevant caveman tests and report results.

Constraints:
- All code changes must stay in the workspace; do not write anything under `./.selesai/artifacts/20260710-194326-i-think-caveman-not-auto-inject-like-pon`.
- Keep the diff minimal.
- Do not change ponytail files.
- Do not add shared helpers or extra abstractions.
- Leave existing caveman prompt injection/command/deactivation behavior intact unless required by the root-cause fix.

When done, return:
- files changed
- concise summary of what changed
- exact test command(s) run and results
- any residual risk or follow-up, if any

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