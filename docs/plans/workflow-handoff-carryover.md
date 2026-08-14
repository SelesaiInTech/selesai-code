# Plan: Carry workflows over compaction & auto-handoff

Status: implemented (P0 + P1). The first workflow attempt timed out in `build-1` with zero changes; the parent session then implemented the plan directly. All changes are in `src/extensions/pi-subagents`; no core changes. Feasibility held at ~90%.

## 1. Problem

Running a scripted workflow (`/workflow-*` → `launchSlashSubagent({ workflowScript, async: true })` → pi-subagents async run) and then triggering **compaction** or **auto-handoff** (`handoff-new` via `_checkAutoHandoff`) makes the workflow "disappear":

- After **auto-handoff** the new session shows no widget/fleet jobs, receives no completion results, cannot resume/steer the workflow, and the handoff document itself omits tool-call details — so the fresh agent doesn't even know a workflow exists.
- After **compaction** the parent agent loses the workflow manifest (run ids, keys, phases) from its context; the only countermeasure is a generic "resume the parent task" nudge.

## 2. Root cause (trace)

1. Workflow runs are **detached child processes** with state on disk under a global tmp root (`DIRS.async` / `DIRS.results`, `src/extensions/pi-subagents/src/shared/types.ts:2030`). The workflow script itself (worker thread + `runs.run` children + mission-backed `state.get/set`) lives in that spawned run — it keeps running after the parent session is replaced. Nothing about the workflow actually dies.
2. Auto-handoff replaces the session: `ctx.newSession()` (`src/extensions/handoff-new.ts:146`) → `AgentSessionRuntime.newSession` (`src/core/agent-session-runtime.ts:226`) → `teardownCurrent` + fresh `createRuntime` → **fresh extension instances**. The new pi-subagents instance restores state only for its own session identity.
3. The identity key is the **session file path** (`resolveCurrentSessionId`, `src/extensions/pi-subagents/src/shared/session-identity.ts` → `getSessionFile() ?? getSessionId()`). Every restore path filters by it and misses the old session's runs:

   | Component | Filter that drops the old session | File |
   |---|---|---|
   | Async job tracker | `restoreActiveJobs` → `listAsyncRuns(..., sessionId: state.currentSessionId)` | `runs/background/async-job-tracker.ts:648` |
   | Result delivery | `ownsSession(sessionId, epoch)` / `identity.sessionId === state.currentSessionId` | `runs/background/result-watcher.ts:168, 211` |
   | Foreground history | `run.sessionId === sessionId` | `runs/foreground/foreground-history.ts:124` |
   | Retained children (`children.list`) | `listRetainedChildren(DIRS.async, ownerSessionId)` | `runs/background/retained-children.ts` |
   | Wait subscriptions | `record.sessionId === state.currentSessionId` | `runs/background/wait-subscriptions.ts:~245` |
   | Async capacity | `getActiveAsyncCapacitySnapshot(state.currentSessionId, ...)` | `extension/index.ts:757` |
   | Mission goal notices | `ownerSessionId = state.currentSessionId` | `extension/index.ts:~634` |

4. `session_shutdown` (`extension/index.ts:~843`) clears in-memory jobs, stops the result watcher, and disposes watchers — by design, but nothing re-links the old session's estate.
5. The new session's header records the parent: `parentSession` in `SessionHeader` (`src/core/session-manager.ts:942`), and `SessionStartEvent` carries `previousSessionFile` for reason `"new"`/`"fork"` (`src/core/extensions/types.ts:562`). The extension never uses either.
6. Compaction: tool results are summarized away (`compaction.ts` / `branch-summarization.ts` skip tool-result bodies). The `session_compact` handler injects a resume message only when active async jobs exist, with **generic** text (`extension/index.ts:810`) — run ids/keys/phases are lost from the model's context.

## 3. Fix design — session lineage adoption

> Implemented. Files changed: `shared/session-lineage.ts` (new), `shared/types.ts`, `runs/background/async-status.ts`, `runs/background/async-job-tracker.ts`, `runs/background/result-watcher.ts`, `runs/background/notify.ts`, `runs/background/run-status.ts`, `runs/background/run-id-resolver.ts`, `runs/background/retained-children.ts`, `runs/background/wait-subscriptions.ts`, `runs/foreground/foreground-history.ts`, `runs/foreground/subagent-executor.ts`, `tui/fleet.ts`, `extension/index.ts`. Tests: `test/unit/session-lineage.test.ts` (new), `test/unit/handoff-adoption.test.ts` (new), existing `compaction-resume.test.ts` unchanged and passing. One extra find beyond the plan: the completion notifier (`notify.ts`) rejected non-current-session results, so it also needed lineage awareness for adopted result delivery.

One concept fixes the handoff half: **on `session_start` with `previousSessionFile`, adopt the previous session's workflow estate** instead of filtering on the current session id alone. Everything is keyed by stable session-file paths and the chain is recoverable via `SessionManager.getHeader().parentSession` (`session-manager.ts:1291`), so adoption is additive and needs **zero core changes**.

### 3.1 New helper — `shared/session-lineage.ts`

- `resolveSessionLineage(ctx, { depth = 8 })`: `[currentSessionId, ...walk(getHeader().parentSession)]`, depth-bounded, deduped, skipping paths that don't exist (`existsSync` guard, same as `retainedSessionFile` in `retained-children.ts`).
- Stored as `state.sessionLineage: string[]` in `resetSessionState` (`extension/index.ts:~766`).
- `listAsyncRuns` gains a `sessionIds: string[]` filter (`async-status.ts`) so all callers share one primitive.

### 3.2 Adopt the estate (P0)

| # | Change | Location |
|---|---|---|
| 1 | `restoreActiveJobs`: list `queued|running` runs for `sessionIds: state.sessionLineage`; mark adopted jobs (`adopted: true`) so completion notices can say "started in a previous session". | `async-job-tracker.ts:648` |
| 2 | Result watcher: treat lineage as owned (`ownsSession` + identity checks accept lineage set); dedupe: at adoption only prime results whose `runId` ∈ adopted set or `completedAt` ≥ session-start epoch — never replay ancient results. | `result-watcher.ts:168–262` |
| 3 | Foreground history, retained children, wait subscriptions: restore/union over lineage. | `foreground-history.ts:124`, `retained-children.ts`, `wait-subscriptions.ts:~245` |
| 4 | Async capacity: snapshot over lineage so adopted runs count against `maxActiveAsyncRunsPerSession`. | `active-async-capacity.ts` caller at `extension/index.ts:757` |
| 5 | Mission goal notices: collect for each lineage owner on `session_start` (reasons `new`/`fork`) in addition to the existing `agent_end` path. Missions themselves already persist per-project (`missions/store.ts`) and `mission.list` works. | `extension/index.ts:~634`, `missions/goal-driver.ts:118` |
| 6 | Schedules: already re-armed on the new session (`bindSession` → `selectProject` → `restoreOne` → `arm`); `scheduledRunManager.stop()` on shutdown is safe because of that re-arm. Lock in with a regression test. | `scheduled-runs.ts:376–381` |

### 3.3 Make the new agent aware (P0)

- On `session_start` (reason `new`/`fork`) with adopted active workflows, set `state.handoffResumePending`. On the first `agent_settled` after that (avoids racing the handoff doc's first turn), send one custom message — same pattern as `subagent-compaction-resume`:

  ```
  customType: "subagent-handoff-resume", display: false, triggerTurn: true
  content: "Session handoff detected. N active background workflows carried over from the previous session:
    - <id8> workflow[task] builder · step 3/5 · running (last: read)
    - <id8> single explorer · running
  Monitor with subagent status <id>, interrupt/resume/steer/approve-checkpoint by run id; children.list shows completed steps."
  ```

  Built from `state.asyncJobs` (id, mode, `workflowKey`, agent, phase/currentStep, activity).

### 3.4 Enrich the compaction nudge (P1)

- Replace the generic `subagent-compaction-resume` text with the same workflow manifest (one line per active job). Keep the trigger conditions and custom type unchanged — test at `test/unit/compaction-resume.test.ts` covers the pattern.

### 3.5 Out of scope (documented, intentional)

- **Watchdog**: resets on `session_before_switch` by design (`watchdog/register-main.ts:431`). Keep.
- **Core changes**: none needed. If a third extension later needs cross-session state, revisit with a generic `session_replaced` state-bag API (rejected now — YAGNI).
- **Blocking handoff while workflows run**: rejected; long workflows would lock the session. Carry-over is the correct fix.

## 4. Tests

- unit: `resolveSessionLineage` (chain walk, depth bound, missing files, dedupe) — `test/unit/session-lineage.test.ts` ✔
- unit: `restoreActiveJobs` adopts lineage runs — covered by the adoption harness ✔
- unit: result watcher delivers lineage results; no replay of pre-adoption results (dedupe watermark) — harness asserts adopted result delivery + cleanup ✔
- unit: `session_start(reason:"new")` + first `agent_settled` injects `subagent-handoff-resume` when adopted workflows exist; nothing when none — `test/unit/handoff-adoption.test.ts` ✔ (repeated-settle no-op also asserted)
- unit: compaction resume message contains the workflow manifest — harness asserts run id in content ✔
- regression: full pi-subagents unit suite 1907 pass / 0 fail ✔

## 5. Risk register

| Risk | Mitigation |
|---|---|
| Result replay across the boundary (ancient results re-delivered) | Adopt-set + epoch watermark (3.2 #2) |
| Resume message races the handoff doc's first turn | Defer to first `agent_settled` (3.3) |
| Stale/deleted parent session files | `existsSync` guard + bounded walk (3.1) |
| Adopted runs exceeding capacity | Count lineage in capacity snapshot (3.2 #4); existing spawn budgets still enforce |
| Double-watch in the same process | Old instance fully disposed at `session_shutdown` before the new one starts; watchers are per-instance |
| Extra turn noise after handoff | One message, `display:false`, same precedent as compaction resume |

## 6. Effort & feasibility

- **Possibility: ~90%.** Everything the workflow needs already persists on disk keyed by stable session-file paths; the spawned workflow process survives the session switch; the new session already knows its parent (`parentSession` header + `previousSessionFile` event); all filters to widen live in one package; the message-injection pattern already exists. The change is additive filtering + one notification — no protocol, no core change, no data migration.
- **Size:** ~500–700 LOC + ~12–16 tests, all in `src/extensions/pi-subagents`.
- **Effort:** 2–3 focused dev-days.
- **Order:** P0 (3.1–3.3) → P1 (3.4) → tests/regression. Each P0 item is independently shippable.

## 7. Verification (manual)

Same as before — worth an interactive smoke test with `/workflow-task` + `/handoff-new` to see the widget adoption and the `subagent-handoff-resume` notice end-to-end. Automated coverage: `src/extensions/pi-subagents/test/unit/{session-lineage,handoff-adoption}.test.ts` + existing compaction-resume test.
