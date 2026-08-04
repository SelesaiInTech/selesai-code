# Phase 4 Plan — Opt-in Main-Session Broad Exploration Guard

## Scope and decision

Implement a **main-session-only**, disabled-by-default guard in `pi-subagents`. It nudges or, only when explicitly configured, blocks repeated **broad** `read`/`grep`/`find`/`ls` exploration. It must not affect child sessions, bash, edits/writes, small targeted reads, or excluded metadata/documentation paths.

Use the existing extension `tool_call` hook; a `{ block: true, reason }` result is returned to the model as an error tool result without executing the call. Do not change core tool registration, SDK allowlists, child tool budgets, or the subagent launch contract.

## Preconditions and telemetry gate

Phase 4 must not start implementation until all are true:

1. **Phase 1 is released:** dynamic catalog and delegation contract are visible to the main model.
2. **Phase 2 is released:** delegated output/context controls are available so delegation does not create unbounded parent context.
3. **Phase 3 is released:** advisory routing remains explicit, honors dynamic/capability-restricted agents, and emits aggregate advisory/delegation outcome telemetry.
4. **Telemetry gate:** after at least 14 days and 100 root-session advisory opportunities:
   - At least 20% of opportunities reach four broad exploration operations without a successful non-management subagent launch after advisory.
   - Warn-only beta has at least 25 opted-in sessions and 50 warnings.
   - Explicit user bypasses (`allow`/`off`) occur in at most 5% of warning sessions after triage; each exception is reviewed for classifier defects.
   - No child-session guard activation, no handler exception, and no blocked `write`, `edit`, or `bash` event is recorded.

If the threshold is not met, stop at Phase 3; do not ship blocking behavior. A warn-only implementation may still be used by opt-in testers to refine false-positive rules.

## Detection policy

### Configuration

Add this optional field to `ExtensionConfig`:

```json
{
  "broadExplorationGuard": {
    "mode": "warn",
    "warnAfter": 2,
    "blockAfter": 4,
    "smallReadMaxLines": 400
  }
}
```

Rules:

- Missing `broadExplorationGuard`, `false`, or `mode: "off"`: no handler, no command, no telemetry.
- `mode: "warn"`: emits one nudge at `warnAfter`; never blocks.
- `mode: "block"`: emits the same nudge at `warnAfter`, then blocks only isolated broad calls after `blockAfter`.
- Defaults when enabled: `warnAfter: 2`, `blockAfter: 4`, `smallReadMaxLines: 400`.
- Validation:
  - `warnAfter`: integer `1..20`.
  - `blockAfter`: integer `warnAfter + 1..50`.
  - `smallReadMaxLines`: integer `1..1000`.
  - Invalid guard config disables only this guard, logs a concise configuration error, and fails open.

### Broad-operation classifier

Count only `read`, `grep`, `find`, and `ls`. Never inspect or regulate `bash`, `write`, `edit`, custom tools, or `subagent`.

Exclude from counting:

- Any child process (`SELESAI_SUBAGENT_CHILD=1`).
- Explicit targeted `read` calls with a non-empty path and `limit <= smallReadMaxLines`.
- Reads of `SKILL.md`, `AGENTS.md`, `CLAUDE.md`, package manifests/lockfiles, and paths under `docs/`, `.selesai/`, `.pi-subagents/`, `node_modules/`, or `dist/`.
- Searches/listings whose path is explicitly narrow rather than omitted/current-directory scope.
- Any broad candidate in a multi-tool batch for blocking purposes.

Count as broad:

- A non-exempt `read` without an explicit small `limit`.
- `grep`, `find`, or `ls` scoped to omitted path, `"."`, or the session cwd, with omitted/default-large result limits.
- At most one broad event per assistant multi-tool batch. A batch may produce a warning but must never be blocked, because sibling results are unavailable during sequential preflight.

This is an exploration pacing mechanism, not an authorization boundary. A model can choose narrower operations; that is acceptable and safer than blocking legitimate targeted investigation.

## State machine

Maintain state only in memory per root session:

| State | Entry | Behavior |
|---|---|---|
| `tracking` | enabled session starts | Count eligible broad operations. |
| `warned` | count reaches `warnAfter` | Send one steer nudge and visible UI notification; allow current call. |
| `delegation-pending` | a non-management `subagent` call follows a warning | Wait for its `tool_result`. |
| `tracking` | delegated call succeeds | Reset the current broad-operation streak and warning latch. |
| `fallback-warn-only` | `subagent` is inactive, or the pending delegated call errors | Never block for the rest of the session; continue warnings/observability. |
| `bypassed` | user runs session `off` | Permit all calls for the rest of the session. |
| `blocking` | isolated call would exceed `blockAfter` in `mode: "block"` | Return `{ block: true, reason }`; remain eligible for later explicit user override. |

Additional state: broad attempts, allowed broad calls, blocked broad calls, warning count, bypass allowance, and delegation outcome. Do not retain paths, search patterns, task text, tool arguments, tool-call IDs, model output, or child output.

Before blocking, check `pi.getActiveTools()` includes `subagent`. If it does not, transition to `fallback-warn-only` and permit the call. When a non-management delegated launch after warning returns `isError`, also transition to `fallback-warn-only`; do not parse its content or guess whether an agent is suitable.

## User escape hatch

Register a **user-only slash command** only when the guard is enabled:

```text
/subagents-exploration-guard status
/subagents-exploration-guard allow [1..20]
/subagents-exploration-guard off
```

- `status` exposes effective mode, state, counters, next threshold, and whether delegation fallback is active; it never displays paths or queries.
- `allow` permits the requested number of otherwise-blocked broad operations for this session only; default is one, maximum is 20.
- `off` disables the guard for the current session only.
- Persistent enablement/disablement remains config-file controlled and takes effect after `/reload` or restart.
- Do not add a model-callable `subagent` action for bypass. The model must not grant itself an override.
- Block reasons must name the delegation alternative and the exact user escape command.

## Ordered implementation tasks

### 1. Verify prerequisites and establish the implementation boundary

**Discovery**
- Confirm Phase 1–3 artifacts, release state, and telemetry schema with their owners.
- Inspect `src/extensions/pi-subagents/src/extension/index.ts`, `src/extensions/pi-subagents/src/extension/tool-description.ts`, and Phase 3 telemetry implementation.
- Confirm the telemetry-gate report satisfies the numeric criteria above.

**Identification**
- No source change in this task.
- Phase 4 is owned by `pi-subagents`, because `src/extensions/pi-subagents/src/extension/index.ts` is the host/main-session registration point and owns the `subagent` capability.

**Change**
- Record the go/no-go decision before enabling any block-mode beta.
- Do not modify Phase 1–3 code, public RPC/preflight versions, child runtime budgets, or core tool definitions.

**Verification**
- Success: telemetry shows advisory routing is insufficient under the declared gate.
- Failure: if metrics are absent, under-sampled, or show low residual broad exploration, do not implement/enable blocking.
- Regression: Phase 1–3 behavior remains independently deployable.

### 2. Add validated opt-in guard configuration

**Discovery**
- Inspect `src/extensions/pi-subagents/src/shared/types.ts` `ExtensionConfig`.
- Inspect `src/extensions/pi-subagents/src/extension/config.ts` load/error behavior.
- Reuse the existing config-file location and startup loading in `extension/index.ts`; do not add a second settings file.

**Identification**
- Modify `src/extensions/pi-subagents/src/shared/types.ts` to add `BroadExplorationGuardConfig` and `ExtensionConfig.broadExplorationGuard`.
- Add `src/extensions/pi-subagents/src/extension/exploration-guard.ts` for guard-specific parsing/defaulting.
- Add `src/extensions/pi-subagents/test/unit/main-exploration-guard.test.ts`.

**Change**
- Export exact symbols from the new module:
  - `resolveBroadExplorationGuardConfig(raw)`
  - `classifyBroadExplorationCall(event, cwd, smallReadMaxLines)`
  - `registerMainExplorationGuard(pi, config)`
- Make `resolveBroadExplorationGuardConfig` return either normalized config or a concise error. Invalid input must result in disabled guard behavior, not a thrown `tool_call` handler error.
- Keep guard config separate from child `ToolBudgetConfig`; it has different scope and semantics.
- Do not add environment-variable overrides, global telemetry dependencies, or new package dependencies.

**Verification**
- Success: absent/`false`/`off` configuration yields inactive behavior; valid warn and block configurations normalize defaults.
- Failure: malformed objects, non-integers, inverted thresholds, and out-of-range values fail open with an error.
- Regression: existing config keys, especially `toolBudget`, remain unchanged.

### 3. Implement classifier and state-machine behavior

**Discovery**
- Inspect `src/core/tools/read.ts`, `grep.ts`, `find.ts`, and `ls.ts` input shapes and default limits.
- Inspect `src/extensions/workflow/adapter.ts` `isSoleToolCall` and `transitionBatchBlock`.
- Inspect `src/core/extensions/types.ts` `ToolCallEvent`, `ToolCallEventResult`, and `ExtensionAPI.getActiveTools()`.

**Identification**
- Modify only `src/extensions/pi-subagents/src/extension/exploration-guard.ts` and its new unit test.
- Do not export or change private core read-classification helpers; implement the narrow guard classifier locally from typed event inputs.

**Change**
- Implement the exclusion and broad-operation rules above.
- Inspect `ctx.sessionManager.getBranch()` only to determine whether the current assistant message has multiple tool calls; never persist branch contents.
- Deduplicate to one counted event per batch.
- Implement the documented state transitions, including:
  - single soft nudge through `pi.sendUserMessage(..., { deliverAs: "steer" })`;
  - best-effort `ctx.ui.notify` when UI exists;
  - block response only for isolated broad calls in block mode;
  - active-tool and failed-delegation fallback to warn-only;
  - successful non-management delegated execution resets the current streak.
- Wrap all event-handler logic in `try/catch`; on any unexpected error, emit a concise local diagnostic and return `undefined` so the tool executes.
- Keep block/nudge strings short and stable. Example block reason:

  ```text
  Exploration guard: repeated broad repo exploration is paused. Delegate the remaining survey with subagent, or ask the user to run /subagents-exploration-guard allow or off. Small targeted reads remain allowed.
  ```

**Verification**
- Success cases:
  - Two broad operations warn once with default thresholds.
  - In block mode, four broad operations are allowed and the next isolated broad operation is blocked.
  - A successful delegated execution resets the streak.
  - A successful `subagent({ action: "list" })` does not reset the streak.
- Failure/fallback cases:
  - Inactive `subagent` tool or failed delegated execution permits continued exploration in warn-only fallback.
  - Handler exceptions fail open.
  - Multi-tool batches are not blocked.
- Regression checks:
  - `bash`, `write`, `edit`, custom tools, small targeted reads, excluded documentation/resource paths, and narrow searches are never blocked.

### 4. Register the guard at the main host lifecycle boundary

**Discovery**
- Inspect `src/extensions/pi-subagents/src/extension/index.ts` startup cleanup (`__piSubagentRuntimeCleanup`), `session_start`, and `session_shutdown`.
- Inspect `src/extensions/pi-subagents/src/runs/shared/pi-args.ts` `SUBAGENT_CHILD_ENV`.
- Inspect `test/unit/index-child-registration.test.ts` child-registration assertions.

**Identification**
- Modify `src/extensions/pi-subagents/src/extension/index.ts`.
- Reuse the new `registerMainExplorationGuard` from `exploration-guard.ts`.
- Do not modify `subagent-prompt-runtime.ts`, `tool-budget.ts`, `pi-args.ts`, or `src/core/agent-session.ts`.

**Change**
- After `const config = loadConfig()`, resolve/register the main guard.
- Ensure `registerMainExplorationGuard` independently returns without registration when `SUBAGENT_CHILD_ENV === "1"`.
- Add its `dispose()` call to the existing reload cleanup path. Disposal must make stale callbacks inert because `pi.on` handlers may remain registered after reload.
- Reset only in-memory guard counters on `session_start` and clear them on `session_shutdown`.
- Register the slash command only for enabled configurations and only in the main process.

**Verification**
- Success: enabled root session registers one `tool_call`, one `tool_result`, lifecycle handlers, and the user command.
- Failure: disabled config registers no guard handler; guard initialization error cannot prevent the rest of `pi-subagents` from loading.
- Regression: existing child-mode early-return test still proves no parent extension registrations occur in normal or fanout child sessions.

### 5. Add privacy-preserving observability

**Discovery**
- Inspect `ExtensionAPI.appendEntry` in `src/core/extensions/types.ts`.
- Inspect existing custom-entry and notification practices in `extension/index.ts` and watchdog runtime code.

**Identification**
- Modify `src/extensions/pi-subagents/src/extension/exploration-guard.ts`.
- Extend `src/extensions/pi-subagents/test/unit/main-exploration-guard.test.ts`.

**Change**
- Emit local aggregate transition entries only for:
  - activated,
  - warned,
  - blocked,
  - user-allow,
  - user-off,
  - delegation-started,
  - delegation-succeeded,
  - delegation-failed,
  - delegation-unavailable,
  - config-invalid.
- Entry payload may include mode, state, aggregate counters, and classifier category (`read`, `grep`, `find`, `ls`), but must exclude paths, patterns, tool arguments, task text, raw errors, model output, and identifiers.
- Do not send network telemetry, write a new log file, or store raw branch/session contents.
- Ensure status output uses only the same aggregate fields.

**Verification**
- Success: transition entries are sufficient to produce telemetry-gate aggregates.
- Privacy failure: tests assert no source path or grep pattern is present in appended data, notifications, or command status.
- Regression: no entries are emitted when config is absent/off.

### 6. Document configuration, behavior, and rollback

**Discovery**
- Inspect `src/extensions/pi-subagents/README.md` Configuration and watchdog command sections.
- Confirm the documented config path matches `getConfigPath()`.

**Identification**
- Modify `src/extensions/pi-subagents/README.md`.
- Do not change the always-visible subagent tool description: the guard is off by default and block reasons already instruct the model when it is active.

**Change**
- Add a `broadExplorationGuard` configuration section with:
  - disabled-by-default statement;
  - warn/block examples;
  - broad-operation and exclusion definitions;
  - child exclusion;
  - fallback when delegation is unavailable;
  - slash-command escape hatch;
  - privacy statement;
  - `/reload` requirement;
  - rollback instructions: set `mode: "off"` or remove the block, then reload.
- State explicitly that this is not a security boundary and does not regulate bash commands.

**Verification**
- Success: copyable JSON examples validate under the new parser.
- Regression: documentation does not imply auto-delegation, automatic user consent, or child enforcement.

### 7. Complete tests and release validation

**Discovery**
- Inspect `src/extensions/pi-subagents/package.json` test scripts and root `package.json` build script.
- Confirm `@selesai/code` alias/build requirements before testing extension code.

**Identification**
- Add/update:
  - `src/extensions/pi-subagents/test/unit/main-exploration-guard.test.ts`
  - `src/extensions/pi-subagents/test/unit/index-child-registration.test.ts` only if existing child early-return coverage cannot exercise the new registration path.

**Change**
- Test config parsing, classifier boundaries, state transitions, batch behavior, delegation success/failure fallback, user bypass, observability redaction, reload disposal, disabled default, and child exclusion.
- Use fake `pi`, fake `ctx`, and fake `sessionManager.getBranch()`; no real tools or child processes are required for core state-machine tests.
- Do not add end-to-end model tests or modify core Vitest harnesses.

**Commands**
```bash
cd src/extensions/pi-subagents && npm run test:unit
npm run build
npx vitest run src/__tests__/task-workflow.test.ts
```

The final Vitest command is a regression check for the shared `tool_call` block contract. If a targeted extension test command is desired during iteration:

```bash
cd src/extensions/pi-subagents && node --experimental-strip-types --test test/unit/main-exploration-guard.test.ts
```

## Acceptance criteria

- Guard is absent/inert by default.
- Guard runs only in root/main sessions and never in normal or fanout children.
- Only `read`, `grep`, `find`, and `ls` are considered; `bash`, writes, edits, and custom tools are never blocked.
- Small explicit reads and listed documentation/resource/excluded paths are never counted.
- Block mode always warns before blocking and never blocks a multi-tool batch.
- Delegation unavailable or failed after a warning transitions to warn-only fallback, not hard blocking.
- User-only session `allow` and `off` escape hatches work without persistent config mutation.
- Handler failures fail open.
- Observability is aggregate-only and contains no paths, patterns, prompts, tool arguments, or outputs.
- README documents enablement, thresholds, fallback, privacy, and rollback.
- All specified unit tests, root build, and workflow regression test pass.

## Risks and mitigations

| Severity | Risk | Mitigation |
|---|---|---|
| High | A throwing `tool_call` handler blocks execution through the host fail-safe path. | Catch all guard errors and return `undefined`; keep parser/classifier synchronous and dependency-free. |
| High | Parallel preflight cannot see sibling results, creating unjustified blocks. | Never block a multi-tool batch; count at most one broad event for warning purposes. |
| Medium | Legitimate repository investigation may resemble broad browsing. | Narrow classifier, explicit small-read/resource exclusions, warn-only rollout, and user-only temporary/session bypasses. |
| Medium | A suitable specialist may be unavailable despite advisory text. | Check active `subagent`; downgrade to warn-only after a failed delegated execution; never parse or guess agent suitability. |
| Medium | Persisted observability may leak source details. | Persist only aggregate state/category/counters; prohibit raw args, paths, patterns, task content, output, and errors. |
| Low | Config changes are not live. | Document `/reload`/restart and provide session-only escape commands. |

## Rollout and rollback

1. Land code with config absent/off by default.
2. Enable only `mode: "warn"` for volunteer sessions after the telemetry prerequisite is met.
3. Review aggregate false positives and bypasses after the warn-only cohort gate.
4. Permit `mode: "block"` only as explicit opt-in; never auto-upgrade existing warn users.
5. Roll back immediately by setting `broadExplorationGuard.mode` to `"off"` or removing the block and reloading. This removes enforcement without data migration or child-process impact.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Verified concrete ownership and hook findings: src/extensions/pi-subagents/src/extension/index.ts registers the root extension and returns early for SUBAGENT_CHILD_ENV; src/core/agent-session.ts and src/core/extensions/runner.ts route tool_call blocks; src/core/extensions/types.ts defines ToolCallEvent/ToolCallEventResult and getActiveTools(); src/extensions/workflow/adapter.ts provides the main-session blocking and batch-inspection precedent; src/extensions/pi-subagents/src/runs/shared/tool-budget.ts provides soft-nudge/hard-block wording and counter precedent."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "read/grep over Phase 1-4 reconnaissance, extension registration/config, tool schemas, hook types, workflow adapter, and unit-test harnesses",
      "result": "passed",
      "summary": "Static source verification completed; no implementation commands were run because this task is planning-only."
    }
  ],
  "validationOutput": [
    "Confirmed the safest host hook is the pi-subagents main-session tool_call handler, not core tool registration or child tool-budget code.",
    "Confirmed child exclusion is already structurally supported by src/extensions/pi-subagents/src/extension/index.ts early return and existing index-child-registration tests.",
    "Confirmed read/grep/find/ls schemas expose the path/limit signals required for a conservative broad-operation classifier."
  ],
  "residualRisks": [
    "Phase 1-3 implementation and telemetry availability were not verified as released in this planning task; Phase 4 is gated on their completion and measured advisory insufficiency.",
    "The host's sequential parallel-tool preflight makes result-aware batch enforcement unsafe; this plan intentionally permits all multi-tool batches.",
    "No raw telemetry service was found in the inspected Phase 4 surfaces; aggregate local transition entries must be mapped to the Phase 3 telemetry process before rollout."
  ],
  "noStagedFiles": true,
  "diffSummary": "No files modified; implementation-ready Phase 4 opt-in enforcement plan only.",
  "reviewFindings": [
    "high: src/core/extensions/runner.ts:933-954 and src/core/agent-session.ts:484-513 - handler exceptions propagate into tool blocking; guard implementation must fail open.",
    "high: docs/extensions.md:711-713 and src/extensions/workflow/adapter.ts:402-426 - sibling results are unavailable during parallel preflight; broad-operation blocking must exclude multi-tool batches.",
    "medium: src/extensions/pi-subagents/src/runs/shared/tool-budget.ts - existing tool budget applies to child runtime only and must not be reused as parent enforcement without child/main isolation and false-positive controls.",
    "medium: src/core/tools/read.ts, grep.ts, find.ts, and ls.ts - naive counting would classify normal targeted investigation as broad; classifier must require the documented path/limit conditions."
  ],
  "manualNotes": "No implementation or edits were performed. The recommended design adds one main-only pi-subagents extension module, one optional ExtensionConfig field, focused node:test coverage, and README documentation; it deliberately avoids core, SDK, RPC, preflight, schema, and child-runtime changes."
}
```

⧉ copy assistant: /cp 35abed