# Code Context

## Relevant Files
- `src/extensions/pi-subagents/src/extension/index.ts:263-506` — registers `subagent`; delegates execution to `createSubagentExecutor`.
- `src/extensions/pi-subagents/src/runs/foreground/execution.ts:2110-2170,292-296,632-646` — builds child CLI args, spawns `selesai`, and accumulates each child assistant message’s usage.
- `src/extensions/pi-subagents/src/runs/shared/pi-args.ts:170-175` — sets `SELESAI_SUBAGENT_CHILD=1`; `extension/index.ts:247-249` returns early in child processes.
- `src/extensions/pi-subagents/src/runs/foreground/subagent-executor.ts:2670-2682,3008-3012` — exposes aggregated `totalChildUsage` and `totalCost` in foreground tool-result details.
- `src/extensions/pi-subagents/src/runs/background/subagent-runner.ts:1916-1925,2684-2695,2854-2906,2953-3042` — maintains async per-step/run token totals and writes them to status/results.
- `src/extensions/pi-subagents/src/tui/render.ts:720-748,1335-1336,1571-1578` — displays async run token totals and foreground tool-result token/cost summaries.
- `src/extensions/pi-powerline-footer/index.ts:2048-2080` — footer totals scan only the current session’s assistant messages.
- `src/extensions/pi-powerline-footer/segments.ts:258-320` — `token_*`/`usage_group` render those main-session totals; `subagents` always returns hidden.
- `src/extensions/pi-powerline-footer/tps.ts:17-37,192-285` — explicitly aggregates main and subagent **output** tokens for TPS status.

## Current Behavior
- Main usage: the footer sums `ctx.sessionManager.getBranch()` assistant-message usage (`input`, `output`, cache, cost). Child sessions are separate processes/sessions, so their usage is absent.
- Child usage: foreground execution records child JSON events into `SingleResult.usage`; executor sums this into tool details. Async execution additionally persists `totalTokens` and `totalCost` for its own widget/status.
- Aggregation is expected only in subagent result/status UI and TPS. `setupTpsTracker()` detects `toolName === "subagent"` and adds child output tokens to `main+subagents` TPS. It does not aggregate input/cache/cost into the normal footer usage totals.
- The powerline `subagents` segment is intentionally unimplemented/hidden (`segments.ts:245-253`).

## Reuse / Risks
- **Medium:** normal footer token/cost figures are main-agent-only; treating them as total spend/usage underreports delegated work.
- **Low:** TPS aggregation uses output tokens only and its denominator adds each subagent call duration, so parallel calls are not a single wall-clock throughput metric.
- Existing aggregation helpers: `sumResultsUsage` / `sumResultsCost` in `src/extensions/pi-subagents/src/shared/utils.ts:329-370`; tests cover them in `test/unit/total-cost.test.ts`.

## Start Here
- `src/extensions/pi-powerline-footer/index.ts:2048` for changing displayed main-session usage; then `tps.ts:192` for subagent TPS behavior.

Artifact was not written: this read-only runtime exposes no file-write tool.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete launch, usage-tracking, rendering, and aggregation paths with exact files and line ranges are listed above."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "Read-only source inspection completed; no tests run and no project files changed."
  ],
  "residualRisks": [
    "Medium: footer usage/cost totals exclude child-process subagent usage.",
    "Low: aggregated TPS is output-only and parallel timing is cumulative per call."
  ],
  "noStagedFiles": true,
  "diffSummary": "No diff; read-only diagnosis.",
  "reviewFindings": [
    "medium: src/extensions/pi-powerline-footer/index.ts:2048-2080 - normal footer usage scans only the parent session branch and cannot include child-session usage.",
    "low: src/extensions/pi-powerline-footer/segments.ts:245-253 - the declared subagents segment is always hidden."
  ],
  "manualNotes": "Required artifact path could not be written because the provided runtime has no filesystem write/edit capability."
}
```

⧉ copy assistant: /cp 570f59