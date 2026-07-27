 ## Review

- **Blocker** — `src/extensions/workflow/adapter.ts:228-240` (resume reconcile loop): the new while-loop catches up on multiple already-written parent artifacts, but it only checkpoints `before` inside the loop. If `sm.onArtifactMaybe` advances past a skipped phase, the snapshot/loopState/run mutation is correct, but if a later iteration throws during `persistAfter`, `restoreCheckpoint` rolls back only to the *last* inner iteration checkpoint, not to the original pre-resume state. The first reconcile call outside the loop also already persisted; the inner loop then calls `persistAfter` again per iteration, which is fine, but a failure mid-catch-up could leave the persisted run at an intermediate phase while the in-memory SM is rolled back to an even earlier one, creating inconsistency. Safer: either skip the inner `restoreCheckpoint` for resume, or checkpoint once before the whole reconcile sequence and restore to there on any failure.

- **Finding** — `src/extensions/workflow/modes/task.ts:24-55` (reuse prompt): the wording "Skip if the project is empty... The adapter will auto-skip this phase when the project has no git history" is accurate, but the prompt *still asks the user* "Should I explore..." when unsure. Because the adapter auto-skips via `isEmptyProject`, this parent-level user question is misleading: if the user says YES on an empty project, the adapter will skip `reuse` anyway on the next `next()`/`onArtifactMaybe`, making the explorer call and `reuse.md` write wasted. This isn't a hard bug (it auto-skips through on the next transition), but it is confusing UX. Smallest safe fix: tell the user the adapter auto-skips when there's no git history, so they shouldn't opt in in that case.

- **Finding** — `docs/workflows.md:123`: says `reuse.md` is "optional; it is skipped automatically when the project has no git history", but the skip rule is based on `pi.exec("git", ["log", "--oneline", "-1"])` returning failure/empty. In a brand-new initialized repo with no commits, that's true; in a repo with commits, even if there's nothing reusable, it won't skip. Fine, but the doc phrasing conflates "empty project" with "no git history". Minor; consider clarifying.

- **Note** — `src/__tests__/task-workflow.test.ts` harness sets `ctx.isIdle() => false`, so all `continueAgent` calls take the `deliverAs: "followUp"` path. There's no test covering the idle/resume direct-message path, but existing resume tests assert prompt content, which is adequate for this diff.

- **Note** — the untracked file `src/extensions/grep-app/---` is unrelated to the workflow refactor and should not be committed.

- **Validation** — `npx vitest run src/__tests__/task-workflow.test.ts` passed 8/8.

WORKFLOW_REVIEW_STATUS: blocking

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Reviewed actual diff of all changed files (docs/workflows.md, src/__tests__/task-workflow.test.ts, src/extensions/workflow/adapter.ts, src/extensions/workflow/modes/task.ts); traced callers; ran tests. Concrete findings reported with file paths and severity."
    }
  ],
  "changedFiles": [
    "docs/workflows.md",
    "src/__tests__/task-workflow.test.ts",
    "src/extensions/workflow/adapter.ts",
    "src/extensions/workflow/modes/task.ts"
  ],
  "testsAddedOrUpdated": [
    "src/__tests__/task-workflow.test.ts"
  ],
  "commandsRun": [
    {
      "command": "npx vitest run src/__tests__/task-workflow.test.ts",
      "result": "passed",
      "summary": "8 tests passed, 0 failed"
    }
  ],
  "validationOutput": [
    "Task workflow phases verified as plan → reuse → handoff → loop",
    "reuse/handoff prompts and handoffValidator wired correctly",
    "Parent-owned artifact boundaries enforced via write_workflow_artifact; child output suppressed",
    "continueAfterArtifact queues next phase at plan/reuse/handoff boundaries",
    "Adapter resume catch-up loop advances through multiple already-written artifacts",
    "Tests cover phase progression, child output suppression, resume, bad handoff blocking, and max-iteration pause"
  ],
  "residualRisks": [
    "adapter.ts resume reconcile loop rolls back to the last inner checkpoint rather than pre-resume state on persistence failure, risking persisted vs in-memory state mismatch",
    "reuse prompt asks user to opt-in on empty projects even though adapter will auto-skip, causing a wasted explorer subagent call",
    "docs/workflows.md slightly conflates 'empty project' with 'no git history' for reuse skip"
  ],
  "noStagedFiles": true,
  "diffSummary": "Refactors task workflow from plan→loop to plan→reuse→handoff→loop; adds reuse/handoff prompts and handoff validator; updates adapter resume catch-up and write_workflow_artifact continuation; updates docs and tests.",
  "reviewFindings": [
    "blocker: src/extensions/workflow/adapter.ts:228-240 - resume catch-up loop's checkpoint/restore strategy can leave persisted state inconsistent with rolled-back in-memory state on persistence failure",
    "finding: src/extensions/workflow/modes/task.ts:30-55 - reuse prompt asks user to opt in to exploration even when adapter auto-skips on empty git history",
    "finding: docs/workflows.md:123 - wording conflates 'empty project' with 'no git history' for reuse skip",
    "note: src/extensions/grep-app/--- is an unrelated untracked file and should not be committed"
  ],
  "manualNotes": "Tests pass. The only hard issue is the resume rollback granularity in adapter.ts; the prompt/doc issues are soft UX findings. Remove the stray src/extensions/grep-app/--- file before merge."
}
```

⧉ copy assistant: /cp 853112