 Implemented minimal fix and focused regression test.

Changed files:
- src/modes/interactive/interactive-mode.ts — call component.updateArgs(event.args) in tool_execution_update handler
- src/modes/interactive/interactive-mode.test.ts — regression test verifying rewritten args refresh component display
- tsconfig.build.json — exclude src/**/*.test.ts from build output

Validation:
- npx vitest run src/modes/interactive/interactive-mode.test.ts — 2 passed
- npm run build — passed (typecheck + asset copy clean)

Residual risks:
- Header refresh depends on tool emitting tool_execution_update; built-in bash already emits an initial update before output.
- Non-bash tools that never emit updates will still show original header — consistent with existing extension mutation contract.
- Full vitest suite has pre-existing failures unrelated to this change (OAuth provider import issues in upstream test cache); targeted and build checks are clean.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Fixed stale TUI bash command header by applying mutated args from tool_execution_update; regression test verifies updateArgs called with rewritten command and preserves result update + render request."
    }
  ],
  "changedFiles": [
    "src/modes/interactive/interactive-mode.ts",
    "src/modes/interactive/interactive-mode.test.ts",
    "tsconfig.build.json"
  ],
  "testsAddedOrUpdated": [
    "src/modes/interactive/interactive-mode.test.ts"
  ],
  "commandsRun": [
    {
      "command": "npx vitest run src/modes/interactive/interactive-mode.test.ts --reporter=verbose --pool=forks",
      "result": "passed",
      "summary": "2 passed"
    },
    {
      "command": "npm run build",
      "result": "passed",
      "summary": "tsgo and copy-assets completed without errors"
    },
    {
      "command": "git diff --check && git status --short",
      "result": "passed",
      "summary": "no whitespace issues; staged/untracked files expected"
    }
  ],
  "validationOutput": [
    "New regression test fails before the fix and passes after.",
    "Build typecheck clean after excluding test files from tsconfig.build.",
    "No lifecycle, extension, type, or dependency changes."
  ],
  "residualRisks": [
    "Header refresh depends on the tool emitting tool_execution_update; built-in bash emits an initial update before output.",
    "Tools that never emit updates will continue to show the original header, which matches existing extension-mutation behavior.",
    "Full suite has pre-existing unrelated failures in upstream-cached tests."
  ],
  "noStagedFiles": true,
  "diffSummary": "One added call to ToolExecutionComponent.updateArgs in the tool_execution_update handler, one new focused regression test, and tsconfig.build.json excludes test files.",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "The actual RTK extension and bundled manifest were verified to be present and loaded; the perceived 'RTK not loaded' symptom was a stale TUI command header, not actual unloading. Execution/output was already RTK-filtered."
}
```

⧉ copy assistant: /cp 0f786c