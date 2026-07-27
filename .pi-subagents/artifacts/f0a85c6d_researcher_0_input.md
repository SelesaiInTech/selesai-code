# Task for researcher

Research only; do not edit or implement anything. Determine the latest released/current upstream version of @mariozechner/pi-coding-agent as of 2026-07-20, then compare notable upstream changes with this local fork at /Users/andrewanggada/Documents/workdir/js_proj/selesai. Identify the fork's current upstream baseline/version and produce a prioritized list of updates that could be ported later. Use authoritative sources (upstream repository releases/tags/changelog/package metadata and local git/package files), cite URLs/commits/tags and exact local file paths/lines where possible. Pay special attention to fork-specific config-dir/name changes: never recommend blindly restoring `.pi` paths or upstream package aliases. Include compatibility risks and suggested verification commands. Research and report only—make no file changes.

## Acceptance Contract
Acceptance level: checked
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Return concrete findings with file paths and severity when applicable

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