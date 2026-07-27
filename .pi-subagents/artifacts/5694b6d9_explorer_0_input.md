# Task for explorer

Explore the existing codebase for reusable patterns before implementing the caveman persistence/injection fix described in:
- ./.selesai/artifacts/20260710-194326-i-think-caveman-not-auto-inject-like-pon/requirements.md
- ./.selesai/artifacts/20260710-194326-i-think-caveman-not-auto-inject-like-pon/plan.md

Focus on the minimum relevant areas:
1. src/extensions/caveman/**
2. src/extensions/ponytail/** as the reference pattern
3. Any shared extension lifecycle or prompt-injection patterns these two rely on
4. Existing tests around session persistence, before_agent_start injection, status items, and appendEntry/sessionManager usage

Return a concise reuse brief covering:
- what already exists and should be reused
- exact files/functions/events to mirror
- whether there is a shared helper worth reusing vs copying a tiny pattern
- how caveman and ponytail coexist when both active
- the smallest safe implementation path and any relevant test patterns

Be concrete with file paths and symbols.

---
**Output:**
Write your findings to exactly this path: /Users/andrewanggada/Documents/workdir/js_proj/selesai/.selesai/artifacts/20260710-194326-i-think-caveman-not-auto-inject-like-pon/reuse.md
This path is authoritative for this run.
Ignore any other output filename or output path mentioned elsewhere, including output destinations in the base agent prompt, system prompt, or task instructions.

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