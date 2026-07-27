## Review
- Correct: Runtime state, not the model prompt, owns activation. `src/extensions/caveman/index.js:89-95` recognizes whole-message `stop caveman`/`normal mode` and persists OFF; `:97-101` restores the last persisted boolean; `:114-117` injects only when active for every agent start. Existing tests cover active injection, persisted OFF, both deactivation behavior cases (`src/extensions/caveman/test/extension.test.js:61-136`; `helpers.test.js:30-48`).
- Note (low): The runtime currently injects the entire skill body (`src/extensions/caveman/caveman-instructions.cjs:31-35`), including examples and persistence/deactivation policy (`src/skills/caveman/SKILL.md:12-49`). This is larger than required for runtime behavior.
- Recommendation: Omit persistence and deactivation wording safely. Extension state guarantees persistence and detects deactivation before `before_agent_start`; neither requires model cooperation. Keep the behavior/style and auto-clarity exception. Exact suggested runtime string:

  `CAVEMAN MODE ACTIVE. Terse smart-caveman prose: drop articles, filler, pleasantries, hedging, conjunctions; fragments, short terms, abbreviations, and -> OK. Preserve technical substance exactly; code blocks and errors unchanged. Use clear normal prose for security warnings, irreversible confirmations, risky multi-step instructions, or clarification/repeated questions; then resume terse mode.`

- Tests recommended: replace the current skill-body equality assertion in `src/extensions/caveman/test/helpers.test.js:58-64` with exact equality to the runtime string (and assertions that it excludes `Persistence`, `stop caveman`, and `normal mode`). Retain existing active/OFF/resume/input-deactivation tests; they already prove state behavior independent of prompt text. Add one assertion that the compact string retains the four clarity cases.
- Residual risk (low): This conclusion assumes Pi dispatches `input` before `before_agent_start`, as the existing extension test models. If host event order changes, an explicit stop message could receive one final caveman-styled answer; persistence/deactivation text in the prompt would not reliably repair that ordering issue. Also update both `src/...` and generated `dist/...` through the normal build/release flow, because `package.json` packages `dist` and copies extension/skill assets there.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete reviewed findings cite src/extensions/caveman/index.js:89-117, caveman-instructions.cjs:31-35, SKILL.md:12-49, and associated test lines; severity and residual risks are stated."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "npm --prefix src/extensions/caveman test",
      "result": "passed",
      "summary": "21 tests passed, 0 failed."
    },
    {
      "command": "git diff --check",
      "result": "passed",
      "summary": "No whitespace errors reported."
    }
  ],
  "validationOutput": [
    "Read-only review completed; no repository files modified.",
    "Caveman extension tests passed (21/21)."
  ],
  "residualRisks": [
    "A Pi host event-order change could allow one final styled response after a text deactivation; prompt wording cannot guarantee against this.",
    "The source and generated dist copies must remain synchronized in a future implementation."
  ],
  "noStagedFiles": true,
  "diffSummary": "No diff created; review-only task.",
  "reviewFindings": [
    "low: src/extensions/caveman/caveman-instructions.cjs:31-35 injects full skill documentation although extension state already enforces persistence and deactivation.",
    "no blockers: src/extensions/caveman/index.js:89-117 implements and tests the required state gating."
  ],
  "manualNotes": "Recommended compact runtime string intentionally omits persistence/deactivation language; keep the full SKILL.md as user-facing behavior documentation unless its role is separately changed."
}
```