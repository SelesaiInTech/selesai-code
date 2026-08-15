# Upstream v0.50.0 merge mapping

Selesai fork of `nicobailon/pi-subagents` updated from v0.48.0 to upstream **v0.50.0**
(v0.49.0 + v0.50.0). This file is the exact reconciliation map: for every changed file,
what upstream did, what the fork had done, and what the merged tree contains. Regenerate
on the next upstream merge (the merge base is always the previously vendored tag).

Merge method: no shared git history exists (the fork vendors upstream as squashed
commits), so the merge was a file-level 3-way: base = upstream v0.48.0, ours = fork at
HEAD-before-merge, theirs = upstream v0.50.0. For each file, "theirs" was taken as the
new base and the fork's v0.48.0-based hunks were re-applied; hunks that no longer
matched were resolved by hand (listed below).

Result: `tsc --noEmit` clean, `tsgo` clean for the whole host monorepo, 2060 unit tests
pass (3 skipped), 777 integration tests pass.

## Numbers

| Set | Count | Handling |
| --- | --- | --- |
| Files changed by both fork and upstream (src) | 37 | 3-way merge, hunks re-applied |
| Files changed only by upstream (src) | 33 | v0.50.0 adopted wholesale (+ branding on 3) |
| Files changed only by the fork (src) | 38 | fork versions kept |
| Fork "new" files | 6 | exist **verbatim** in upstream v0.50.0 (our features were upstreamed) |
| Upstream-only test changes | 48 files | v0.50.0 adopted |
| Fork-only test changes | 80 files patched, 7 new files | fork hunks re-applied; 12 files took fork versions, then fixed |

## Fork features that upstream v0.50.0 already contains verbatim

These six fork additions were merged into upstream before v0.50.0; the merged tree uses
the upstream copies (identical content):

- `src/slash/inline-subagents.ts` (#agent-name inline invocation + autocomplete)
- `src/workflows/workflow-auto-relaunch.ts` (relaunch decision module — note: upstream
  ships the module but **does not wire it**; the fork wires it, see below)
- `src/agents/task-aware-routing.ts`
- `src/extension/chain-validation.ts`
- `src/shared/env.ts` (PI_SUBAGENT* → SELESAI_SUBAGENT* legacy shim)
- `src/shared/session-lineage.ts`

## Both-changed files (37) — resolutions

Base for every file is v0.50.0; fork hunks were re-applied. Hand-resolved files:

| File | Upstream (v0.48→v0.50) | Fork (vs v0.48) | Resolution |
| --- | --- | --- | --- |
| `src/extension/index.ts` | Orca tabs, external jobs, async-status snapshot, detach shortcut, resumable retained children, result-index reload work | branding; lineage goal continuation; resources_discover prompt paths; adoptedActive capacity; formatActiveWorkflowSummary; resetSessionState(previousSessionFile) | v0.50.0 + fork hunks; hand-added: lineage/adoption bits in `resetSessionState`, `formatActiveWorkflowSummary` definition (was referenced but missing), `resources_discover`, adopted-job capacity accounting |
| `src/extension/public-execution.ts` | structured single-child (converts `{agent,task}` → `runs.run("main",…)`), rejects legacy top-level chain/tasks | restores chain/tasks/clarify as first-class | v0.50.0 + fork policy: `clarify` rejected only with workflowScript, top-level `chain`/`tasks` pass through, `schedule.create` accepts direct execution fields, single-child conversion kept (fork executor is v0.50's) |
| `src/extension/schemas.ts` | task param, toolTimeoutMs, debug.run descriptions, agentContract integer bounds (#1095) | top-level `chain`/`tasks`/`clarify`, chatProgress 5-value enum, legacyChainControls trim comment | v0.50.0 + fork's top-level `chain`/`tasks`/`clarify` + 5-value chatProgress enum; v0.50's bounds fix and new descriptions kept |
| `src/extension/tool-description.ts` | rewrote FULL/COMPACT text (single-child + retained resumability) | fork text describing all four modes | fork's FULL/COMPACT text kept (matches fork schema), v0.50's resumable-children wording folded in |
| `src/agents/agents.ts` | `tools: "inherit"`, model validation | branding, extra builtins, home-dir guard, extra-agent-dirs env | v0.50.0 + fork branding/builtins (fork's splitToolList was already upstreamed) |
| `src/runs/background/retained-children.ts` | resumable/not-resumable states | `listRetainedChildren` accepts multiple session ids | v0.50.0 + signature widened to `string \| string[]` (lineage callers) |
| `src/runs/foreground/subagent-executor.ts` | result-files/async-status refactors, detached children as paused | auto-relaunch wiring (fan-out budget exhaustion) | v0.50.0 + re-wired fork auto-relaunch loop around `runWorkflowScript` (async path), with cap-exhaustion → failed run + `relaunchNote` summaries |
| `src/runs/shared/llm-intent-arbiter.ts` | confidence levels, registry-method auth call, fail-closed >8k | simpler arbitration, head+tail truncation | v0.50.0 wholesale (strictly better) + `SELESAI_SUBAGENTS_LLM_INTENT_ARBITER` env rebrand |
| `src/runs/shared/model-fallback.ts` | `resolveRequiredSubagentModelCandidate` (rejects unknown models, #1093) | same-model transient retry (503/429/no-body/econnreset), `MODEL_RETRY_DELAYS_MS`, `formatModelRetryNote` | both: v0.50.0's strict resolution + fork's retry schedule/exports (used by runner/execution) |
| `src/shared/types.ts` | async-status snapshot types, artifact default "session" | `AsyncJobState.adopted`, artifact default "project" + `.pi-subagents` comment | v0.50.0 + `adopted` flag; fork's `DEFAULT_ARTIFACT_CONFIG.dir = "project"` kept (deliberate fork behavior) |
| `src/shared/artifacts.ts` | packaging-warning work | `getArtifactsDir`/`getChainRunsDir` default "project" | v0.50.0 + fork default "project" restored |
| `src/runs/background/result-watcher.ts` | indexed result inbox, session/observer/tool-call indexing | lineage adoption of old-session results | v0.50.0 + fork lineage logic, plus a fork-specific flat-file scan bounded to the adoption window (v0.50's scan only reads the index) |
| `src/slash/slash-commands.ts` | detach command/shortcut, live-state work | export `launchSlashSubagent` (host workflow extension imports it), branding | v0.50.0 + `export` on `launchSlashSubagent` + import rebrand + inline invocation import |
| `src/slash/slash-live-state.ts` | structured single-child initial results | `buildWorkflowInitialResult` + workflow update path | v0.50.0 + fork's workflow preview builder (+ `background` flag for async) |
| `src/tui/fleet-status.ts` | nested-run tree (#1086), spacing config | nested rows (older own implementation) | v0.50.0 wholesale + import rebrand (upstream's tree supersedes fork's) |
| `src/watchdog/review.ts`, `src/watchdog/permission-arbiter.ts`, `src/runs/foreground/prompt-audit.ts` | `agentStreamOptions()` host-API adapter | bare `streamFn` + auth | v0.50.0 wholesale + `@selesai/code` import rebrand (agentStreamOptions emits both `streamFn` and `streamFunction`, compatible with host pi-agent-core 0.84.1) |

Remaining both-changed files (20) merged mechanically: fork hunks re-applied over v0.50.0
with no conflicts — `extension/config.ts`, `extension/rpc.ts`, `intercom/native-supervisor-channel.ts`,
`runs/background/{async-execution, async-job-tracker, async-status, run-id-resolver, run-status,
scheduled-runs, subagent-runner, subagent-wait}.ts`, `runs/foreground/{chain-execution,
execution}.ts`, `runs/shared/{nested-events, subagent-prompt-runtime}.ts`,
`slash/slash-live-state.ts` (see above), `tui/{fleet, fleet-transcript, render}.ts`,
`workflows/chat-progress.ts`.

## Upstream-only files (33 src) — adopted wholesale

v0.50.0 content taken as-is, then the fork branding transform applied where tokens
appeared. Only three needed it:

- `src/runs/shared/tool-timeout.ts` — `TOOL_TIMEOUT_ENV` → `SELESAI_SUBAGENT_TOOL_TIMEOUT_MS`, reads via `readSubagentEnv` (PI_ fallback)
- `src/runs/shared/orca-progress-tabs.ts` — `PI_SUBAGENT_ORCA_BINARY` → `SELESAI_SUBAGENT_ORCA_BINARY` via `readSubagentEnv`
- `src/runs/background/async-status-snapshot.ts` — widget prefix → `SELESAI_SUBAGENT_ASYNC_JSON:`

The other 30 (agent-serializer, api/external-runs, api/preflight, herdr/*, intercom-bridge,
missions/goal-driver, missions/store, result-files, active-*-capacity/index, async-resume,
chain-root-attachment, completion-replay, fleet-view, resume-guidance, stale-run-reconciler,
wait-completions, async-dismiss-action, completion-guard, external-cli-runner, parallel-utils,
subagent-control, subagent-startup-retry, agent-stream-options, display-text, node-executable,
scripted-workflow) are upstream's latest with no fork content to preserve.

## Fork-only files (38 src) — kept

Fork versions kept (upstream did not touch them): agent-management, agent-memory,
agent-refinements, control-notices, doctor, fanout-child, steering-notices, profiles,
notify, wait-config/wait-subscriptions/wait-tool, chain-clarify, foreground-history,
capability-ceiling, permissions, pi-args, pi-spawn, run-fanout-budget,
runtime-acknowledged-extensions, structured-output, tool-availability, tool-budget,
worktree, fork-context, utils, prompt-workflows (`/chain` `/parallel` `/run-chain`
`/chain-prompts`), selector, slash-bridge, subagents-admin, render-helpers,
watchdog/{change-signature, child-status, model-selection, register-child, register-main,
runtime, tool-actions}.

## Deliberate fork-vs-upstream behavior decisions (the "how far" answer)

Kept as fork behavior:

1. **Execution surface** — top-level `chain` / `tasks` / `clarify` remain first-class
   alongside `{ agent, task }` and `workflowScript`. Upstream v0.50.0 only exposes
   structured single-child + workflowScript at the top level; our schemas, public
   boundary, tool text, and skill docs advertise all four modes.
2. **Artifact default** — `DEFAULT_ARTIFACT_CONFIG.dir = "project"` (cwd `.pi-subagents/`).
   Upstream moved the default to "session" (#1062) so worktrees stay clean; the fork
   keeps project-scoped artifacts and gitignores `.pi-subagents/` subdirs. Consequence:
   a worktree with artifacts is not `git status`-clean; the upstream worktree-clean test
   is adapted to expect exactly `.pi-subagents/`.
3. **Mission storage** — upstream relocates automatic mission records out of project
   worktrees (`<agentDir>/missions/projects/<hash>`); adopted as-is (fork's
   `.pi-subagents/missions` was runtime state, not load-bearing).
4. **Workflow auto-relaunch wiring** — upstream ships the decision module only; the fork
   wires `config.maxWorkflowAutoRelaunches` into the async workflow loop with fresh
   fan-out budgets per relaunch and a failed-run outcome at the cap.
5. **Same-model transient retry** — fork's `MODEL_RETRY_DELAYS_MS` retry schedule on
   503/429/no-body/econnreset, in addition to upstream's fallback-model switching.
6. **Lineage carry-over** — upstream adopted the fork's session-lineage machinery; the
   fork additionally (a) counts adopted jobs against the per-session active async cap,
   (b) labels adopted jobs in carry-over summaries, and (c) scans flat result files
   during the adoption window (upstream only scans its indexed inbox).
7. **Branding** — `@selesai/code` host import, `~/.selesai` config dirs, `.pi-subagents`
   runtime dir, `SELESAI_SUBAGENT*` / `SELESAI_SUBAGENTS_*` env vars with legacy `PI_`
   fallback, extra builtin agents (architect, builder, commentator, explorer, recapper),
   `SELESAI_SUBAGENT_EXTRA_AGENT_DIRS`, home directory never treated as a project root.

Adopted as upstream behavior (fork's prior code superseded):

1. Structured single-child converts to a `runs.run("main", …)` workflow internally.
2. Generic `intercom` tool removed from supervisor coordination (#1107); ceiling audit
   removes only `write` + `contact_supervisor`.
3. `needs_attention` escalation for repeated mutating tool failures (was
   `active_long_running` in the fork).
4. `tools: "inherit"` builtin overrides, model-registry validation before spawn (#1093),
   `agentContract.version` integer bounds (#1095).
5. Retained-children resumability states, detached workflow children shown as paused.
6. Result inbox indexing, async-status snapshots, Orca progress tabs, external-job
   FleetView API, foreground detach shortcut, per-tool-call timeouts, debug.run.

## Non-src mapping

| Area | Resolution |
| --- | --- |
| `package.json` / `package-lock.json` | v0.50.0 (version 0.50.0, no new deps) + fork description + `@selesai/code` renames |
| `CHANGELOG.md` | v0.50.0 changelog + branding transform + rewritten "Selesai fork (0.50.0)" section |
| `README.md` | v0.50.0 + branding + fork's 12-row builtin-agent table |
| `docs/*.md` (9 files) | v0.50.0 + mechanical branding transform (fork doc delta was pure branding) |
| `skills/pi-subagents/SKILL.md` | fork version (upstream didn't change it) |
| `skills/…/references/*.md` (4 files) | 3-way: v0.50.0 base + fork hunks; hand-added fork's Chain/Parallel execution sections and technique sections (context-build, handoff-plan) |
| `agents/*.md` | upstream's oracle/reviewer/scout/worker/delegate updates + fork's researcher (Selesai-custom) + fork's architect/builder/commentator/explorer/recapper |
| `prompts/*.md` | upstream's 5 + fork's parallel-context-build / parallel-handoff-plan |
| `test/` | v0.50.0 base + fork hunks; 12 behavioral files took fork versions, then adjusted to merged behavior (single-child conversion, `needs_attention`, mission store location, `.pi-subagents`/`.selesai` paths, `SELESAI_*` env names, worktree-clean exception); 7 fork test files copied |

## Test adjustments made after the merge (merged behavior wins)

- `agent-overrides/agent-frontmatter/index-child-registration/pi-coding-agent-dir` —
  `.selesai` paths and `SELESAI_CODING_AGENT_DIR` (v0.50 tests still used `.pi`).
- `async-execution` — capability audit removes `["write", "contact_supervisor"]` (no `intercom`).
- `external-cli-runner` — `sessionId: "session-external"` (v0.50 result-files requirement).
- `orca-progress-tabs` — jiti path via `import.meta.resolve`, `SELESAI_*` env.
- `single-execution` — live-activity uses `needs_attention`; detach test expects
  `/run detaches: detached/`; mission tests rewritten to upstream's agent-dir store
  (`resolveMissionStoreLocation`/`missionStatePath`); worktree-clean test expects
  `.pi-subagents/` (fork artifact default); mutating-failure escalation → `needs_attention`.
- `public-execution` / `schemas` / `slash-*` / `mission-lifecycle` / `builtin-agent-documentation`
  — expectations aligned with merged surface (single→workflowScript conversion, four-mode
  schema, "Workflow running." initial slash message, mode "workflow" snapshots,
  `.pi-subagents` mission paths, 12-row README builtin table).
- `tool-timeout` / `orca` unit tests — `SELESAI_*` env with `PI_` fallback assertions.
