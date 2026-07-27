# Task for builder

Address the blocking review findings in the current Task workflow refactor, then re-run relevant validation. Keep changes limited to the requested workflow files; do not touch or delete unrelated untracked src/extensions/grep-app/ files.

Review findings to fix:
1. BLOCKER: src/extensions/workflow/adapter.ts around the resume reconcile loop. The catch-up loop currently checkpoints inside each iteration. If a later onArtifactMaybe/persistAfter fails, restoreCheckpoint only rolls back to the latest inner checkpoint, while persisted state may already be at an intermediate phase and in-memory state can become inconsistent. Make resume reconciliation atomic from the original pre-reconcile checkpoint: on any failure, restore in-memory controller state to the checkpoint before the whole reconcile sequence. Preserve successful multi-artifact catch-up and durable persistence. Add or update a focused regression test if needed.
2. UX: src/extensions/workflow/modes/task.ts reuse prompt should clearly explain that the adapter skips reuse when the project has no git history, so asking to explore in that situation is not misleading. Keep the existing optional reuse behavior.
3. Docs: clarify docs/workflows.md reuse skip wording to say it is skipped when the project has no git history, rather than conflating that with any empty project.

Inspect the actual diff and existing tests before editing. Run the narrow Task workflow tests plus the workflow regression suite and npm run build. Return an inline completion summary with files changed and validation results. Do not write workflow artifacts.

## Acceptance Contract
Acceptance level: attested
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Return concrete findings with file paths and severity when applicable

Required evidence: review-findings, residual-risks

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