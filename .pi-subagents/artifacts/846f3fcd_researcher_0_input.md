# Task for researcher

Produce an evidence-only brief. You MUST read these local files: docs/skills.md, src/core/system-prompt.ts, src/core/agent-session.ts, src/core/resource-loader.ts, and cli/args.ts. Then use web research for the official Agent Skills specification, especially disable-model-invocation. Answer: What is the best practice to reduce skill prompt tokens while preserving safety/manual usability? Compare --no-skills versus per-skill disable-model-invocation versus prompt stripping. Cite paths/line ranges plus official URLs. Verify whether --no-skills removes all skill commands and whether disable-model-invocation preserves /skill:name. Do not edit files and do not claim anything unsupported.

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