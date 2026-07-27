# Task for architect

Produce a concise markdown plan for this repo only. No web/upstream release lookup, no questions, no file writes.

Requirement summary:
- Goal: produce an update plan for syncing this fork with upstream `.pi`.
- Upstream baseline: `pi` release/tag `v0.80.3`.
- Focus: assess whether pulling/rebasing is feasible and outline the path.
- Constraint: preserve all existing local fork features/customizations.

Known local context:
- This fork is `@selesai/code` with `piConfig.configDir = ".selesai"` in `package.json`.
- It vendors/customizes local extensions under `src/extensions/` including `pi-subagents`, `workflow`, `question`, `pi-intercom`, `pi-powerline-footer`, `pi-web-agent`, `ponytail`, `caveman`, `handoff-new`, `tokenin-onboarding`.
- The repo already has an upstream mirror checkout at `.upstream-cache/pi/`.
- Main risk area is rebrand/fork divergence: `@selesai/code`, `.selesai`, `SELESAI_*`, reused pi-host extension loading, and hardcoded `.pi`/pi path literals.
- Dependencies currently pin `@earendil-works/pi-agent-core`, `pi-ai`, and `pi-tui` at `0.80.2`, while the target upstream baseline is `v0.80.3`.

Output requirements:
- Explain what to do, how, order, components to inspect, checks to preserve local features, and what done looks like.
- Keep it concrete and implementation-oriented for a quick workflow plan.
- End with exactly one line on its own:
WORKFLOW_PLAN_STATUS: ready

---
**Output:**
Write your findings to exactly this path: /Users/andrewanggada/Documents/workdir/js_proj/selesai/.selesai/artifacts/20260709-021255-this-project-is-fork-of-pi-https-github-/plan.md
This path is authoritative for this run.
Ignore any other output filename or output path mentioned elsewhere, including output destinations in the base agent prompt, system prompt, or task instructions.

## Acceptance Contract
Acceptance level: reviewed
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Implement the requested change without widening scope
- criterion-2: Return evidence sufficient for an independent acceptance review

Required evidence: changed-files, tests-added, commands-run, validation-output, residual-risks, no-staged-files

Review gate: required by reviewer.

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