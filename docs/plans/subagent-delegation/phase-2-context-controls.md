# Phase 2 Plan — Minimize Parent Context from Delegated Work

## Verified findings

- **High — foreground non-intercom results leak full child output:** `src/extensions/pi-subagents/src/runs/foreground/subagent-executor.ts:3237-3245` aggregates full parallel output; `runSinglePath` returns `finalizeSingleOutput(...).displayOutput`; `compactForegroundDetails()` retains `results[].finalOutput`.
- **High — intercom moves, rather than minimizes, full output:** `src/extensions/pi-subagents/src/intercom/result-intercom.ts:244-269` places full `summary` text in the grouped event. The compact receipt only applies after acknowledged delivery.
- **High — async notifications expose full summaries:** `background/subagent-runner.ts:4135-4146` builds a full-output summary; `background/notify.ts:137-151` sends it as a model-visible `subagent-notify` message.
- **Medium — durable non-debug paths already exist:** explicit `output` persistence in `single-output.ts:173-208` works independently of `artifacts`; async always writes `asyncDir/output-<index>.log`.
- **Medium — chain terminal content is already concise, but details/intercom are not:** `shared/formatters.ts:58-90` emits a chain summary, while `details.results`/`details.outputs` and grouped intercom payloads can retain child text.
- **Medium — file-only is reusable but opt-in:** `finalizeSingleOutput()` emits only `SavedOutputReference.message` for `file-only`; tests cover read-only runtime persistence in `single-execution.test.ts:2478`.

## Design decision

Use the existing `output`, `outputMode: "file-only"`, saved-output reference, async output logs, `status`, transcript, and `resume` mechanisms. Do **not** add a new public “summary delivery” API, new artifact service, or dependency.

New default policy:

1. Every delegated child gets a durable result path unless the caller explicitly uses `output: false`.
2. Omitted `outputMode` resolves to `file-only` when a result path exists; explicit `outputMode: "inline"` retains legacy full-output delivery.
3. Full output is persisted independently of `artifacts: true`; debug artifacts remain opt-in.
4. Successful normal delivery contains references and lifecycle/status information, not child prose.
5. If persistence or reference reading fails, return a bounded fallback only: first **80 lines / 4 KiB**, prefixed with the persistence error and stating that full output is unavailable. Reuse `truncateOutput`; do not fall back to unbounded output.

`output: false` remains a compatibility escape hatch: no generated output file and bounded inline delivery. Explicit `outputMode: "file-only"` plus `output: false` remains a pre-spawn validation error.

## Data contract

No new public tool parameter is required.

| Field/surface | Contract |
|---|---|
| `SingleResult.savedOutputPath` / `outputReference` | Authoritative full-output location and byte/line metadata. Present for generated or explicit saved outputs, including failed children that produced output. |
| `SingleResult.finalOutput` | `Output saved to: …` reference for default/file-only delivery; bounded fallback only when persistence failed; full text only with explicit `outputMode:"inline"`. |
| `Details.results[]` | Terminal parent-facing details must omit raw `messages`, raw `finalOutput`, `truncation`, and chain `outputs` text. Keep status, error, output reference/path, session, transcript, acceptance, and compact tool-call metadata. |
| Foreground tool-result `content` | Compact run receipt/reference list. No child prose by default. |
| Intercom payload child `summary` | Saved-output/async-log reference plus process status; never full child output by default. |
| Async `result.json` | May retain internal result text until watcher delivery, but parent-facing notifier/intercom delivery must use references to `asyncDir/output-<index>.log` or explicit saved outputs. |
| Failure fallback | A bounded context slice with the write/read error and intended path. It must not claim a full artifact exists. |

## Ordered implementation tasks

### 1. Make saved-output persistence usable for default and failed delivery

**Discovery**
- Re-read `runs/shared/single-output.ts`, especially `resolveSingleOutput()` and `finalizeSingleOutput()`.
- Trace all callers in `foreground/execution.ts` and background runner step execution before editing.
- Confirm async `output-<index>.log` contains the child’s final output, not merely progress.

**Files**
- Modify `src/extensions/pi-subagents/src/runs/shared/single-output.ts`.
- Modify `src/extensions/pi-subagents/src/runs/foreground/execution.ts`.
- Update `src/extensions/pi-subagents/test/unit/single-output.test.ts`.
- Update focused cases in `test/integration/single-execution.test.ts`.

**Change**
- Export a small internal context-fallback limit (`bytes: 4096`, `lines: 80`) beside existing output helpers; reuse existing `truncateOutput()`.
- Add a formatter that produces a bounded persistence-failure fallback containing:
  - process error/status,
  - intended output path,
  - persistence/read error,
  - bounded output slice.
- Call `resolveSingleOutput()` whenever an output path is configured and meaningful child output exists, not only for `exitCode === 0`.
- Preserve existing child-authored-file precedence and snapshot safety.
- Update `finalizeSingleOutput()` so failed runs with a successfully persisted result return error/status plus the saved-output reference, rather than raw output.
- Do not change `formatSavedOutputReference()` wording or make debug artifacts mandatory.

**Verification**
- Successful child-written and runtime-persisted outputs retain full file contents.
- Failed child with output gets a reference and readable file.
- Failed write/read produces only the bounded fallback.
- Existing explicit inline behavior remains unchanged when selected.

### 2. Resolve generated paths and default delivery consistently by execution mode

**Discovery**
- Trace `resolveSingleRunOutputBaseDir()` and top-level parallel path namespacing in `subagent-executor.ts`.
- Trace foreground chain output resolution in `chain-execution.ts`.
- Trace async step construction in `async-execution.ts` and result-log creation in `subagent-runner.ts`.

**Files**
- Modify `src/extensions/pi-subagents/src/runs/foreground/subagent-executor.ts`.
- Modify `src/extensions/pi-subagents/src/runs/foreground/chain-execution.ts`.
- Modify `src/extensions/pi-subagents/src/runs/background/async-execution.ts`.
- Modify only necessary type declarations in `src/extensions/pi-subagents/src/shared/types.ts` and `runs/shared/parallel-utils.ts`.
- Update `test/integration/single-execution.test.ts`, `parallel-execution.test.ts`, and `async-execution.test.ts`.

**Change**
- Resolve omitted output as a generated per-child relative file name:
  - foreground single: `<singleRunOutputBaseDir>/<runId>/result.md`;
  - foreground top-level parallel: existing per-task namespace plus `result.md`;
  - foreground chain: `<chainDir>/outputs/<flat-index>-<agent>.md`;
  - async single/parallel/chain: `<asyncDir>/outputs/<flat-index>-<agent>.md`, while retaining existing `output-<index>.log` as status/transcript recovery.
- Preserve explicit absolute and relative `output` paths, existing duplicate-path validation, and `output: false`.
- Resolve omitted `outputMode` to `file-only` when an output path is active. Preserve explicit `"inline"` exactly.
- Keep chain handoff semantics valid: later `{previous}`/`{outputs.name}` consumers receive the existing file reference for file-only steps and can read the named path; do not re-inline child prose merely for chaining.
- Ensure generated output paths are passed to child task and system-prompt instructions through existing `injectSingleOutputInstruction()` / `injectOutputPathSystemPrompt()`.
- Do not add frontmatter-only defaults to builtin agents: those would collide in chains and fail to cover custom agents. Runtime-generated per-run paths own this behavior.

**Mode acceptance matrix**
- **Foreground single:** compact saved-output reference; explicit inline opt-out remains full text.
- **Foreground parallel:** one compact result per child, each with status and output reference.
- **Foreground chain:** existing chain completion summary plus chain/output paths; no step prose in terminal parent result.
- **Async launch:** existing concise launch receipt unchanged.
- **Async completion:** compact references to explicit saved output or `asyncDir/output-<index>.log`.
- **Status/transcript:** remain the path to inspect output; `resume` continues using existing session persistence.
- **Errors, pause, stop, timeout:** retain process error/status and recovery instructions; attach a saved-output/log reference if available, otherwise bounded fallback.

### 3. Strip terminal foreground details and intercom payloads of raw output

**Discovery**
- Inspect `compactForegroundDetails()` in `shared/utils.ts`.
- Inspect `maybeBuildForegroundIntercomReceipt()` and `resultSummaryForIntercom()` in `subagent-executor.ts`.
- Inspect `stripDetailsOutputsForIntercomReceipt()` in `intercom/result-intercom.ts`.

**Files**
- Modify `src/extensions/pi-subagents/src/shared/utils.ts`.
- Modify `src/extensions/pi-subagents/src/runs/foreground/subagent-executor.ts`.
- Modify `src/extensions/pi-subagents/src/intercom/result-intercom.ts`.
- Update `test/integration/foreground-result-size.test.ts`.
- Update `test/integration/intercom-result-delivery.test.ts`.

**Change**
- Add one shared terminal-result projection based on the existing intercom stripping pattern. It must remove raw child output from terminal `Details`, including chain `details.outputs` text/structured payloads, while retaining references and operational metadata.
- Apply that projection for all completed foreground modes, not just acknowledged intercom receipts.
- Keep remembered foreground state able to recover output from `savedOutputPath` first; do not retain full `finalOutput` in memory when an authoritative path exists.
- Change foreground intercom child summaries from `getSingleResultOutput()` to the saved-output reference. Include error/status before the reference for failed children.
- Keep the current 500 ms intercom acknowledgement behavior:
  - acknowledged relay: compact receipt and stripped details;
  - unavailable/unacknowledged relay: compact native foreground receipt, not legacy full child output;
  - explicit `outputMode:"inline"` is the sole compatibility opt-out for full foreground output.
- Do not alter supervisor-request/detached-run routing.

**Verification**
- Bridge-on and bridge-off foreground single, parallel, and chain responses contain no child prose by default.
- Intercom payloads contain references, not full output.
- Explicit inline still exposes legacy content.
- `JSON.stringify(result)` remains below current payload-size protections.

### 4. Make async notifier and grouped intercom delivery reference-only

**Discovery**
- Trace `summary` creation in `background/subagent-runner.ts`.
- Trace result-file normalization and delivery in `background/result-watcher.ts`.
- Trace `buildCompletionDetails()`, `formatSingleCompletion()`, and `formatGroupedCompletion()` in `background/notify.ts`.

**Files**
- Modify `src/extensions/pi-subagents/src/runs/background/subagent-runner.ts`.
- Modify `src/extensions/pi-subagents/src/runs/background/result-watcher.ts`.
- Modify `src/extensions/pi-subagents/src/runs/background/notify.ts`.
- Update `test/integration/async-execution.test.ts`.
- Update `test/integration/result-watcher.test.ts`.
- Update `test/unit/notify.test.ts`.

**Change**
- Persist/retain each async child’s authoritative output location in the result payload: explicit `savedOutputPath` when present, otherwise its existing `asyncDir/output-<index>.log`.
- At watcher delivery time, build compact child summaries from that path using `formatSavedOutputReference()`; do not use `results[].output` or run `summary` as parent-facing text.
- Build the local `subagent-notify` content from the same compact run receipt so notification and intercom behavior match.
- Preserve grouped intercom acknowledgement semantics:
  - acknowledged grouped delivery suppresses duplicate local notification;
  - unacknowledged or disabled grouped delivery sends the compact local notifier;
  - session-lease and result-file retry/unlink behavior remains unchanged.
- On absent/unreadable output log, include process error and bounded fallback only; do not emit raw `result.json.summary`.
- Preserve full internal `result.json` data only until watcher consumption; the durable parent reference must be the output path/log, not the deletable result queue file.

**Verification**
- Async success emits a notification/intercom message with output-log or saved-output reference only.
- Async failed, paused, stopped, and timed-out cases retain status, error, and recovery guidance.
- Intercom acknowledgement still suppresses duplicate notifier delivery.
- Watcher retry on notifier failure leaves the result file intact.

### 5. Document migration and rebuild packaged assets

**Discovery**
- Re-read current output instructions in:
  - `src/extensions/pi-subagents/README.md:647-671,1446-1486`;
  - `src/extensions/pi-subagents/skills/pi-subagents/references/execution-controls.md:91,140-156`;
  - `src/extensions/pi-subagents/src/extension/tool-description.ts`.
- Coordinate with Phase 0/1 edits before resolving overlapping wording.

**Files**
- Modify `src/extensions/pi-subagents/README.md`.
- Modify `src/extensions/pi-subagents/skills/pi-subagents/references/execution-controls.md`.
- Modify `src/extensions/pi-subagents/src/extension/tool-description.ts` only if Phase 1 has not already incorporated the final contract.
- Regenerate `dist/extensions/pi-subagents/**` with the root build; do not hand-edit generated copies.

**Change**
- State that normal delegated results are reference-first and full output is inspected through saved output, async status/transcript, or resume.
- Document explicit `outputMode:"inline"` as compatibility opt-out.
- Document `output:false` as disabling durable result persistence and causing bounded fallback visibility.
- State that generated output paths persist with `artifacts:false`; debug `_input`, `_output`, metadata, and transcript artifacts remain opt-in.
- Correct old claims that failed runs always return full inline debugging output.
- Keep examples using explicit output paths where humans or later processes need stable project-owned names.

## Migration and compatibility

- This is an intentional behavior change for omitted `outputMode`: default delivery becomes file-only/reference-first.
- Existing callers requiring full terminal text must set `outputMode:"inline"`.
- Existing callers with explicit `output` keep that path; generated paths affect only omitted output.
- Existing `output:false` behavior remains available, but loses full durable recovery by design.
- No external protocol version bump is needed if new fields are additive and result files remain backward-readable. Treat absent saved-path fields as legacy and use bounded fallback.
- Do not expose `maxOutput` as a new Phase 2 API; its current undocumented semantics are unrelated. Use a fixed internal fallback cap only.

## Phase dependencies

- **Phase 0:** must land its corrected role/output documentation first, or Phase 2 documentation will conflict with stale “write/no-write” and context claims. Runtime work is otherwise independent.
- **Phase 1:** should land before the final `tool-description.ts` wording so the always-visible delegation contract can describe reference-first completion once, without duplicate edits. Runtime Phase 2 code does not depend on Phase 1 catalog changes.
- **No dependency on Phase 3/4:** advisory routing and enforcement must not be coupled to output delivery.

## Test commands

```sh
cd src/extensions/pi-subagents
node --experimental-strip-types --test test/unit/single-output.test.ts test/unit/notify.test.ts
node --experimental-strip-types --import ./test/support/register-loader.mjs --test \
  test/integration/single-execution.test.ts \
  test/integration/parallel-execution.test.ts \
  test/integration/foreground-result-size.test.ts \
  test/integration/intercom-result-delivery.test.ts \
  test/integration/async-execution.test.ts \
  test/integration/result-watcher.test.ts
npm run test:all

cd ../../..
npm run build
```

## Acceptance criteria

- Default foreground single, parallel, and chain completion contains no raw child output in `content`, terminal `details`, or intercom delivery.
- Default async completion notification/intercom contains no raw child output.
- Each successful child has a readable, authoritative result reference with byte/line metadata while `artifacts:false`.
- Failure/timeout/stop/pause preserves status and recovery information and never emits unbounded output.
- Persistence failure produces the specified 80-line/4-KiB fallback and does not falsely claim a full reference exists.
- Explicit `outputMode:"inline"` preserves legacy inline delivery.
- `output:false`, status, transcript, resume, intercom acknowledgement, session leases, chain output bindings, and structured output behavior remain covered by regression tests.
- Root build regenerates `dist` from source.

## Risks and rollback

- **Risk:** reference-only chains require downstream children to read referenced outputs deliberately. Mitigate with injected authoritative output-path instructions and chain tests.
- **Risk:** generated output files increase `.pi-subagents` disk use despite debug artifacts being disabled. Mitigate through documented paths and existing project/session/temp placement; do not silently delete authoritative outputs in this phase.
- **Risk:** host behavior for tool `details` is not fully controlled. Mitigate by removing terminal raw output from details rather than relying on renderer behavior.
- **Rollback:** restore omitted-mode resolution to `"inline"` and remove generated-path assignment; explicit output/file-only callers remain functional. Leave already-written result files in place; they are harmless and should not be deleted automatically.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete findings verified in source and tests: high-risk raw-output surfaces in foreground executor, result-intercom, async runner, notifier, and details; reusable file-only, async-log, status, transcript, resume, and artifact-default-off mechanisms cited with exact paths."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "read/grep static inspection of pi-subagents source, docs, and tests",
      "result": "passed",
      "summary": "Verified cited symbols, current mode behavior, artifact-default-off gates, and existing test seams. No implementation commands were run."
    }
  ],
  "validationOutput": [
    "Plan is implementation-ready and limited to Phase 2.",
    "No files were edited."
  ],
  "residualRisks": [
    "Reference-first defaults intentionally change omitted outputMode behavior; callers needing inline output must migrate.",
    "Generated authoritative outputs require a retention policy decision outside this phase if disk growth becomes material."
  ],
  "noStagedFiles": false,
  "diffSummary": "No diff produced; planning-only task.",
  "reviewFindings": [
    "high: foreground executor and intercom payloads currently expose full child output by default.",
    "high: async completion notifier currently forwards full runner summaries.",
    "medium: existing explicit output persistence and async output logs can satisfy Phase 2 without enabling debug artifacts."
  ],
  "manualNotes": "Staged-file state was not inspected because this session has no shell execution tool."
}
```

⧉ copy assistant: /cp 5224d1