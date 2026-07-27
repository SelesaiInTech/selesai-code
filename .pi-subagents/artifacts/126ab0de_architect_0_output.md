Plan written. Here's the summary:

## What was done

Read and analyzed the full repo structure: `package.json` (deps pinned at 0.80.2, selesai identity via `piConfig`), `scripts/upstream.sh` (existing sync/cherry-pick tool with path rewriting from `packages/coding-agent/` to root), `.upstream-cache/pi` (shallow sparse clone at v0.80.2), and all selesai-specific divergences from upstream.

Identified 3 tiers of files for the sync:
- **Tier 1** (safe merge): upstream-only changes in files selesai hasn't touched
- **Tier 2** (manual merge): ~10 files where selesai has local modifications that overlap with potential upstream changes
- **Tier 3** (preserve): 15+ selesai-only files/directories (extensions, skills, themes, agents.ts, tests, etc.)

The plan has 10 ordered tasks with explicit fallbacks, verification steps, and a preservation checklist.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Plan covers only the upstream sync workflow for v0.80.3. No scope creep into implementing code changes, adding features, or refactoring. Plan is a workflow deliverable as requested."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Plan written to /Users/andrewanggada/Documents/workdir/js_proj/selesai/.selesai/artifacts/20260709-021255-this-project-is-fork-of-pi-https-github-/plan.md. Evidence includes: file inventory of selesai-only files, modification list for fork-customized files, 10-task ordered workflow, risk tier classification, preservation checklist, and order-of-operations diagram."
    }
  ],
  "changedFiles": [
    ".selesai/artifacts/20260709-021255-this-project-is-fork-of-pi-https-github-/plan.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "ls/read/grep on src/, .upstream-cache/pi/, package.json, scripts/upstream.sh, config.ts, context.md, handoff doc",
      "result": "passed",
      "summary": "Discovered repo structure: selesai is a flatten of pi's packages/coding-agent/. Identified all fork-specific files and modifications."
    },
    {
      "command": "contact_supervisor (need_decision + intercom ask)",
      "result": "passed",
      "summary": "Confirmed: purely local analysis plan, assume v0.80.3 exists upstream with fetch/sync step and fallback to audit-only if unavailable."
    }
  ],
  "validationOutput": [
    "Plan has 10 ordered tasks with explicit verification steps per task",
    "Tier classification covers all selesai-specific files and modifications",
    "Preservation checklist has 13 checks with verification commands",
    "Fallback path documented: if v0.80.3 tag unavailable, stop at audit-only and report blocker"
  ],
  "residualRisks": [
    "Plan assumes v0.80.3 tag exists upstream — not verified at plan-writing time (supervisor confirmed assumption)",
    "Tier 2 merge difficulty depends on actual upstream diff size, which is unknown until Task 2 runs",
    "Extension peer-dep versions (0.74.0 in pi-subagents) may need bumping if v0.80.3 has breaking changes since 0.74.0"
  ],
  "noStagedFiles": true,
  "diffSummary": "Created one new file: plan.md containing the upstream sync workflow plan for selesia fork vs pi v0.80.3. No existing files modified.",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "The plan is a workflow deliverable only. No code changes should be made from this plan directly — it describes what to do and in what order. The executor should follow tasks sequentially, stopping at Task 1 if v0.80.3 tag fetch fails."
}
```

⧉ copy assistant: /cp 99b8ca