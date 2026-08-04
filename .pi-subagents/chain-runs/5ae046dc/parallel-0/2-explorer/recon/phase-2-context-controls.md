I have completed the reconnaissance. Here is the full recon artifact:

# Code Context

## Relevant Files

**Output/finalization core**
- `src/extensions/pi-subagents/src/runs/shared/single-output.ts` — Single-run output resolution: child-written-output extraction (`:22`), output path resolution (`:64`), output-path instruction injection into task/system prompt (`:99`, `:104`), saved-output reference formatting (`:128`), file-only validation (`:140`), snapshot/persist/resolve (`:147`–`:208`), and **`finalizeSingleOutput` (`:211`–`:239`)** which decides the display text that becomes the tool-result `content`.
- `src/extensions/pi-subagents/src/runs/shared/chain-outputs.ts` — Chain `{outputs.name}` map: validation (`:20`–`:52`), reference interpolation (`:55`–`:64`), and **`outputEntryFromResult` (`:74`–`:82`)** — structured output replaces text with compact JSON.
- `src/extensions/pi-subagents/src/shared/types.ts` — `MaxOutputConfig` (`:18`), `OutputMode` (`:23`), `SavedOutputReference` (`:82`), `TruncationResult` (`:89`), **`DEFAULT_MAX_OUTPUT = { bytes: 200*1024, lines: 5000 }` (`:1642`–`:1645`)**, **`DEFAULT_ARTIFACT_CONFIG = { enabled: false, ... }` (`:1647`–`:1656`)**, `truncateOutput()` (`:1831`–`:1862`), event names (`:1480`–`:1488`).
- `src/extensions/pi-subagents/src/runs/foreground/execution.ts` — Foreground `runSync`: acceptance stripping (`:217`–`:225`, `:1285`–`:1296`), **file-only `finalOutput` = reference message only (`:1297`–`:1300`)**, snapshot compaction incl. message stripping for file-only (`:237`–`:257`), artifact write gates (`:1435`–`:1441`, `:1620`–`:1644`), **truncation application (`:1631`–`:1639`)**.
- `src/extensions/pi-subagents/src/runs/foreground/subagent-executor.ts` — Orchestrator: `resultSummaryForIntercom` (`:1437`–`:1443`), intercom payload emission (`:1470`–`:1512`), **`maybeBuildForegroundIntercomReceipt` (`:1514`–`:1537`)** — receipt replaces output in `content` and strips outputs from `details`; single-run final return (`:3538`–`:3595`); artifact config construction `enabled: params.artifacts === true` (`:1291`, `:1357`, `:4226`–`:4231`); parallel aggregation using truncated text (`:3237`–`:3245`); `resumeAsyncRun` (`:1147`–`:1433`).
- `src/extensions/pi-subagents/src/runs/foreground/chain-execution.ts` — Chain details build (`:171`–`:197`), parallel/sequential output map population (`:947`, `:1490`), **final chain content = `buildChainSummary(...)` (`:1495`–`:1501`)**.
- `src/extensions/pi-subagents/src/shared/formatters.ts` — **`buildChainSummary` (`:58`–`:90`)**: completed-chain text contains step names, duration, progress path, chain dir — **no step outputs**.

**Async/background**
- `src/extensions/pi-subagents/src/runs/background/subagent-runner.ts` — child process runner: `finalOutput` extraction (`:821`, `:842`), per-step output resolution + `finalizeSingleOutput` (`:1477`–`:1519`), run log `subagent-log-<id>.md` (`:937`–`:986`), **summary aggregation + truncation (`:4135`–`:4146`)**, result.json write with `summary` + per-child `output`/`artifactPaths` (`:4292`–`:4311+`).
- `src/extensions/pi-subagents/src/runs/background/result-watcher.ts` — Result file delivery: session lease gate, **intercom grouped delivery (`:298`–`:315`)**, notifier delivery (`:318`–`:345`), `SUBAGENT_ASYNC_COMPLETE_EVENT` (`:348`–`:367`), file unlink after acceptance (`:369`–`:386`).
- `src/extensions/pi-subagents/src/runs/background/notify.ts` — `formatSingleCompletion`/`formatGroupedCompletion` (`:52`–`:66`, `:117`–`:134`), **`sendCompletion` → `pi.sendMessage({customType:"subagent-notify", display:true}, {triggerTurn})` (`:137`–`:151`)**, `buildCompletionDetails` (`:206`–`:241`), **`intercomDelivered` short-circuit (`:271`)**.
- `src/extensions/pi-subagents/src/runs/background/subagent-wait.ts` — `waitForSubagents` returns **counts only, never output text** (`:452`–`:604`).
- `src/extensions/pi-subagents/src/runs/background/async-execution.ts` — async launch receipt **`formatAsyncStartedMessage` (`:259`–`:283`)**, `executeAsyncChain` content (`:1153`–`:1156`), `executeAsyncSingle` content (`:1498`–`:1501`).
- `src/extensions/pi-subagents/src/runs/background/async-resume.ts` — resume target resolution, recovery descriptor validation incl. `maxOutput` (`:343`–`:345`) and `artifactConfig` (`:346`–`:354`).

**Intercom receipts**
- `src/extensions/pi-subagents/src/intercom/result-intercom.ts` — status resolution (`:20`), grouped message format (`:200`–`:242`), payload build (`:244`–`:269`), event delivery w/ 500ms ack window (`:271`–`:354`), **`stripSingleResultOutputs`/`stripDetailsOutputsForIntercomReceipt` (`:356`–`:370`)**, **`formatSubagentResultReceipt` (`:372`–`:410`)**.
- `src/extensions/pi-subagents/src/intercom/intercom-bridge.ts` — bridge resolution/instruction injection (`:100`–`:175`); default template (`:31`–`:61`).

**Structured output / transcripts / artifacts**
- `src/extensions/pi-subagents/src/runs/shared/structured-output.ts` — `createStructuredOutputRuntime` (temp dir, `:197`–`:210`), `readStructuredOutput` (`:260`–`:276`).
- `src/extensions/pi-subagents/src/runs/shared/subagent-prompt-runtime.ts` — child-side `structured_output` tool registration writing validated JSON and terminating (`:436`–`:452`); `MISSING_STRUCTURED_OUTPUT_CALL_ERROR` behavior.
- `src/extensions/pi-subagents/src/shared/child-transcript.ts` — transcript JSONL writer: 50MB cap (`:30`), 32KB tool-payload truncation (`:6`–`:27`).
- `src/extensions/pi-subagents/src/shared/artifacts.ts` — `PROJECT_ARTIFACT_ROOT = ".pi-subagents"` (`:6`), `getArtifactsDir` (`:20`–`:44`), `getArtifactPaths` (`:46`–`:57`), `formatOutputArtifactContent` (`:67`–`:78`).
- `src/extensions/pi-subagents/src/extension/schemas.ts` — `outputMode` (`:49`–`:52`), `artifacts: "(default: false)"` (`:324`), `output` (`:334`–`:340`) — **no `maxOutput` field**.
- `src/extensions/pi-subagents/src/extension/index.ts` — message renderers for `subagent-notify`/`subagent-control`/slash results (`:306`–`:364`) — details are UI-only surfaces.
- `src/extensions/pi-subagents/src/tui/render.ts` — UI uses `r.truncation?.text || getSingleResultOutput(r)` (`:1311`, `:1503`).
- `src/extensions/pi-subagents/src/runs/background/run-status.ts` — status/transcript views cap output previews at 160 chars (`:120`), transcript tail (`:161`–`:175`).
- `src/extensions/pi-subagents/CHANGELOG.md:6` — documents the artifact-default-off change.

## Current Behavior

### Data surface split (model context vs UI/details vs files)

| Data element | Model context | UI/details | Files |
|---|---|---|---|
| Child final output text | Tool-result `content[0].text` **only when intercom bridge inactive/off/unacked**; otherwise only the intercom receipt | `details.results[].finalOutput` (stripped for intercom receipts, `result-intercom.ts:356`–`:370`), `details.outputs` (chain) | `_output.md` (artifacts on), saved `output:` path, session `.jsonl`, `_transcript.jsonl` |
| Child messages/transcript | Never (stripped by `compactForegroundResult` `utils.ts:414`–`:418` and receipts) | `messages` kept in-memory for running progress; `toolCalls` summaries in compact details | `_transcript.jsonl` (50MB cap, 32KB payload truncation) |
| Truncation marker | Yes — `truncation.text` becomes display text (with `full output at <artifactPath>` only when artifacts enabled) | `details.results[].truncation` incl. `artifactPath` | full output at artifact/saved path |
| Structured output | Not in content; chain `{outputs.name}` text = compact JSON | `details.results[].structuredOutput`/`structuredOutputPath`, `details.outputs[].structured` | temp `output.json` (deleted when artifacts off, `subagent-executor.ts:3501`), result.json |
| Acceptance report | Stripped (`execution.ts:217`–`:225`, `:1287`) | ledger in metadata | `_meta.json` ledger |
| Async completion | `subagent-notify` custom message (`display:true`, `triggerTurn`) + grouped intercom message (via external pi-intercom companion) | async widget/fleet from `status.json`/`events.jsonl` | `result.json` (deleted post-delivery), `status.json`, `subagent-log-<id>.md`, `output-<n>.log` |

### Mode matrix — what text the parent model actually receives

| Mode | Tool-result `content` text | Notes |
|---|---|---|
| Foreground single, bridge on + acked | `formatSubagentResultReceipt` — "Delivered single subagent result via intercom. Run/children counts/artifact/session paths. Full grouped output was sent over intercom." (`result-intercom.ts:372`–`:410`) | `details` stripped of `finalOutput`/`messages`/`truncation` (`:356`–`:370`); full per-child summaries ride the `subagent:result-intercom` event → parent-session message via companion extension. Test: `intercom-result-delivery.test.ts:229` |
| Foreground single, bridge off/inactive/unacked | `finalizeSingleOutput(...).displayOutput` = full output (+ `\n\nOutput saved to: …` ref if `output:` path; **reference only** if `outputMode:"file-only"`, `single-output.ts:224`–`:229`) | Fallback path; tests `intercom-result-delivery.test.ts:233`, `:249`, `:265` |
| Foreground parallel, bridge on | Grouped receipt (one event for all children) | `aggregateParallelOutputs` used only when bridge off (`subagent-executor.ts:3238`–`:3245`) |
| Foreground chain, bridge on | Grouped receipt | — |
| Foreground chain, bridge off | `buildChainSummary` — "✅ Chain completed: a → b (2 steps, 12.3s)\n📋 Progress: …\n📁 Artifacts: {chain_dir}" — **outputs not included** (`formatters.ts:58`–`:90`; `chain-execution.ts:1495`–`:1501`) | Step outputs only in `details.outputs`/`{previous}` chaining; chain is effectively file-only for model context |
| Async launch (single/chain) | `formatAsyncStartedMessage` — "Async: agent [id]" + guidance (`async-execution.ts:259`–`:283`) | `details.asyncId/asyncDir/workflowGraph` |
| Async completion | (1) grouped intercom message with per-child `summary` = output (via result-watcher `:298`–`:315`); (2) `subagent-notify` message with `resultPreview` = summary (`notify.ts:137`–`:151`) | `intercomDelivered === true` suppresses local notify (`notify.ts:271`) |
| `subagent_wait` | "Waited 12s for 2 async run(s); done. Outcome: 2 complete." — counts only (`subagent-wait.ts:586`–`:604`) | — |
| `resume`/revive | "Revived async subagent from <id>. Revived run: <newId>…" (`subagent-executor.ts:1416`–`:1433`) — relaunches async; output arrives via async completion channel | — |
| `status` | Text summary; remembered-foreground output preview capped at 160 chars (`run-status.ts:120`), transcript tail view up to 1000 lines (`:161`–`:175`) | — |

### Truncation / maxOutput
- Defaults `200 KB / 5000 lines` (`types.ts:1642`–`:1645`). Applied post-hoc: foreground `execution.ts:1631`–`:1639` (with `artifactPath` only when artifacts enabled), async summary `subagent-runner.ts:4138`–`:4146`. Marker prefix `[TRUNCATED: showing first N of M lines … full output at <path>]` (`types.ts:1854`–`:1862`). Truncated text replaces display output; full output remains in artifact/saved file.
- **Gap:** `maxOutput` is not declared in `schemas.ts` — only reachable via typed internal params and resume recovery descriptors (`async-resume.ts:343`–`:345`). Effectively undocumented.

### File-only output
- `outputMode:"file-only"` requires `output` path (`single-output.ts:140`–`:144`); `finalOutput` = reference message only (`execution.ts:1298`–`:1300`); result `messages` dropped (`execution.ts:240`); full content persisted via `resolveSingleOutput` (`:172`–`:208`), which preserves agent-written file contents (snapshot compare). Read-only children get the "Return the complete artifact in your final response; the runtime will persist it…" fallback instruction (`single-output.ts:84`–`:97`).

### Structured output
- Child must call `structured_output` (validated, `subagent-prompt-runtime.ts:436`–`:452`); missing call = step failure (`MISSING_STRUCTURED_OUTPUT_CALL_ERROR`). Chain `{outputs.name}` text = compact JSON (`chain-outputs.ts:74`–`:82`); propagates to `details.outputs[].structured` and async result.json.

### Artifact-default-off diff
- `DEFAULT_ARTIFACT_CONFIG.enabled: false` (`types.ts:1648`), enabled only via `artifacts: true` param (`schemas.ts:324`) or persisted recovery descriptor (`async-resume.ts:346`). Documented in `CHANGELOG.md:6`. Consequences: no `_input.md`/`_output.md`/`_meta.json`/`_transcript.jsonl` per child; `result.artifactPaths` undefined; truncation marker loses the "full output at" path; structured-output temp dirs cleaned immediately (`subagent-executor.ts:3501`). Independent of: `output:` file persistence (always honored), chain_dir outputs (chain behavior), asyncDir logs/status (always written).

## Reuse / Risks

**Reusable patterns**
- `stripAcceptanceReport`/`stripAcceptanceReportsFromMessages` (`execution.ts:217`–`:225`, `acceptance.ts:740`) — precedent for removing verbose blocks from model-visible output while persisting to files/details. Directly applicable to Phase 2 minimization.
- `finalizeSingleOutput` (`single-output.ts:211`–`:239`) — single choke point that already implements file-only reference mode; extend here for any new visibility policy.
- Intercom receipt cutover (`maybeBuildForegroundIntercomReceipt` + `stripDetailsOutputsForIntercomReceipt`) — proven mechanism for keeping full output out of `content`/`details` while delivering via event; **test seams** in `test/integration/intercom-result-delivery.test.ts` (bridge on/off/unacked/disabled matrix, asserts `finalOutput === undefined` in receipt details at `:229`, `:304`, `:467`).
- Payload compaction verified by `test/integration/foreground-result-size.test.ts` (content < 2000 B, payload < 80 KB, `messages`/`progress` undefined, compact `toolCalls`).
- `test/support/mock-pi.ts` `mockPi.onCall(...)` harness used by all integration tests.

**Risks / gaps**
1. **Chain completion content carries no output** (`formatters.ts:58`–`:90`): with bridge off, a finished chain's model-visible text is only the summary line — parent must read chain_dir; no explicit pointer to a single "final output" file.
2. **Intercom delivery dependency**: receipt content claims "Full grouped output was sent over intercom", but delivery requires the external pi-intercom companion in the parent; unacked → fallback to legacy full-output content (test `:265`–`:279`).
3. **Async notify summary truncation**: `result.json.summary` truncated at maxOutput with no artifactPath when artifacts off (`subagent-runner.ts:4138`–`:4146`); recovery only via session file / `output-<n>.log`.
4. **`maxOutput` undocumented/unexposed** in the call schema.
5. **`subagent_wait` never surfaces output text**; headless auto-drain relies on `subagent-notify` delivery, which is session-lease gated (`notify.ts:264`).
6. **Truncation + file-only interplay**: truncated text is what gets saved by `persistSingleOutput` for inline mode only if artifacts write the truncated text — artifacts actually write the *full* `artifactOutputByResult` (`execution.ts:1625`), so no loss there; but truncation marker's artifactPath is absent when artifacts are off.
7. UI/details (`details`) rendering is host-driven (`extension/index.ts:306`–`:364`, `tool-execution.ts:297`); the extension cannot guarantee details never enter host transcripts — receipts already strip the large fields to mitigate.

## Start Here
`src/extensions/pi-subagents/src/runs/shared/single-output.ts` (`finalizeSingleOutput` `:211`–`:239`) is the single choke point for foreground display output; then `src/extensions/pi-subagents/src/runs/foreground/subagent-executor.ts:3538`–`:3595` (single return path + intercom receipt branch) and `result-intercom.ts:356`–`:410` (receipt stripping) for the intercom cutover. For async, `subagent-runner.ts:4135`–`:4311` (summary + result.json) then `result-watcher.ts:298`–`:367` (delivery). Test seams: `test/integration/intercom-result-delivery.test.ts` and `test/integration/foreground-result-size.test.ts`.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Returned concrete file:line findings for every requested Phase 2 surface: model-context vs UI/details vs files split, mode matrix (foreground single/parallel/chain, async launch/completion, intercom receipts, wait, resume/revive), truncation/maxOutput (types.ts:1642-1645, execution.ts:1631-1639, subagent-runner.ts:4138-4146), structured output (subagent-prompt-runtime.ts:436-452, chain-outputs.ts:74-82), file-only output (single-output.ts:211-239, execution.ts:1297-1300), artifact-default-off diff (types.ts:1647-1656, CHANGELOG.md:6), plus reusable mechanisms and test seams (intercom-result-delivery.test.ts, foreground-result-size.test.ts)."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "grep/find/read reconnaissance of src/extensions/pi-subagents (read-only)",
      "result": "passed",
      "summary": "Traced final-output visibility/persistence across ~25 files; no files modified; verified all cited line numbers by reading the sources."
    }
  ],
  "validationOutput": [
    "No code changes made; recon only. All path:line citations verified against current working tree.",
    "Confirmed maxOutput is absent from extension/schemas.ts (internal-only option).",
    "Confirmed DEFAULT_ARTIFACT_CONFIG.enabled === false (types.ts:1648) is the artifact-default-off state."
  ],
  "residualRisks": [
    "Chain completion content (formatters.ts:58-90) omits step outputs entirely; with intercom bridge off the parent model only sees the summary line and must read chain_dir.",
    "Intercom receipt delivery depends on the external pi-intercom companion being loaded in the parent; unacknowledged delivery falls back to legacy full-output content (intercom-result-delivery.test.ts:265-279).",
    "maxOutput is not exposed in the tool schema (schemas.ts) — only via internal params and async resume recovery descriptors (async-resume.ts:343-345).",
    "Async result.json summary is truncated with no artifactPath when artifacts are disabled (subagent-runner.ts:4138-4146); recovery requires session file or output-<n>.log.",
    "subagent_wait returns counts only (subagent-wait.ts:586-604); output text only reaches the parent via subagent-notify/intercom messages, which are session-lease gated.",
    "Whether host tool-result details ever enter the model context is host-controlled; the extension mitigates by stripping messages/finalOutput/truncation from intercom receipts."
  ],
  "noStagedFiles": true,
  "diffSummary": "Read-only reconnaissance; no diff produced.",
  "reviewFindings": [
    "no blockers - recon only; findings above are informational for Phase 2 planning"
  ],
  "manualNotes": "The artifact-default-off diff (DEFAULT_ARTIFACT_CONFIG.enabled=false, CHANGELOG.md:6) means per-child _output.md/_transcript.jsonl/_meta.json are opt-in; truncation markers lose their artifactPath when disabled. Existing mechanisms ready for reuse: stripAcceptanceReport pattern (execution.ts:217-225) for removing verbose blocks from model-visible output, finalizeSingleOutput as the single display-output choke point, and the intercom receipt cutover (result-intercom.ts:356-410) as the proven full-output-off-content path with tests in intercom-result-delivery.test.ts."
}
```

⧉ copy assistant: /cp 40d2ed