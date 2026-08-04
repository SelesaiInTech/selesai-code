All verification complete. Here is the recon artifact.

---

# Code Context

## Relevant Files

### Main-agent read/grep/find/bash tool registration
- `src/core/tools/index.ts:1-125` — central registry. `ToolName = "read" | "bash" | "edit" | "write" | "grep" | "find" | "ls"` (`:32`), `allToolNames` (`:33`), `createToolDefinition`/`createTool` (`:45-93`), `createAllToolDefinitions`/`createAllTools` (`:85-125`), read-only bundles `createReadOnlyTools` (`:108-114`) used by the watchdog review agent.
- `src/core/tools/read.ts:203-345` — `createReadToolDefinition`: `ReadToolOptions { autoResizeImages?, operations? }` (`:74-78`), `ReadOperations` pluggable I/O (`:44-57`), `execute` (truncation, image handling, `resolveReadPathAsync`). Path classifier `getCompactReadClassification` (`:117-127`) and `COMPACT_RESOURCE_FILE_NAMES` (`:33-34`) are reusable path-breadth heuristics.
- `src/core/tools/grep.ts`, `src/core/tools/find.ts`, `src/core/tools/ls.ts` — same shape: `create*ToolDefinition(cwd, options)` with pluggable `operations`.
- `src/core/tools/bash.ts:120-370` — `createBashToolDefinition`; `BashToolOptions { operations?, commandPrefix?, shellPath?, exposeSessionEnvironment?, spawnHook? }` (`:112-119`); `BashSpawnHook = (ctx) => ctx` (`:97-100`), applied in `resolveSpawnContext` (`:106-125`); `createLocalBashOperations` (`:60-95`) for extension-managed re-execution.
- Registration into the running agent: `src/core/agent-session.ts:2621-2673` `_buildRuntime` — base tools from `createAllToolDefinitions` with `read: { autoResizeImages }, bash: { commandPrefix, shellPath }`; default active = `["read","bash","edit","write"]` (`:2665-2668`); `_refreshToolRegistry` (`:2528-2618`) applies `_allowedToolNames`/`_excludedToolNames` (`:2531-2534`) — configured via `AgentSessionConfig.allowedToolNames/excludedToolNames` (`:227-230`, stored `:402-403`). SDK wiring: `src/core/sdk.ts:245-251, 382-390` (`options.tools`/`excludeTools`/`noTools` → allowlist/denylist; this is how child processes get `--tools`/`--no-tools`).
- Extension tools: `pi.registerTool` (`src/core/extensions/types.ts:1301-1307`), wrapped by `src/core/extensions/wrapper.ts` (`wrapRegisteredTools`), all extension tools active by default in the main agent (`includeAllExtensionTools: true`, `agent-session.ts:2668-2672`).

### Pre-tool / tool-call interception hooks (the Phase-4 mechanism)
- `src/core/agent-session.ts:484-513` `_installAgentToolHooks` — the single choke point for every agent (main AND children):
  - `:485-507` `this.agent.beforeToolCall = async ({ toolCall, args })` → `runner.emitToolCall(...)`; if `runner.hasHandlers("tool_call")` is false it short-circuits (`:487-489`). A throwing handler rethrows (`:497-502`).
  - `:509-527` `this.agent.afterToolCall` → `runner.emitToolResult(...)`; result overrides incl. `terminate` (`:520-526`).
- `src/core/extensions/runner.ts:933-954` `emitToolCall` — iterates all extensions' `tool_call` handlers; first handler returning `{ block: true }` short-circuits immediately (`:942-946`). Note: no try/catch here, so a handler throw propagates to `beforeToolCall` → agent loop catches → tool blocked (fail-safe; documented `docs/extensions.md:2596`).
- `src/core/extensions/types.ts`:
  - `:861-912` `ToolCallEvent` union — typed `BashToolCallEvent`/`ReadToolCallEvent`/…/`CustomToolCallEvent`; `event.input` mutable, later handlers see mutations, no re-validation (`:907-911`).
  - `:1079-1082` `ToolCallEventResult { block?: boolean; reason?: string }`; `:1239` `on("tool_call", ...)`.
  - `:1231-1236` `tool_execution_start/update/end` — observation-only, fire around the same point.
  - `:1241` `user_bash` event (user-initiated `!`/`!!` bash only, not agent bash).
- Consumption in the agent core: `node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js:405-421` — `if (beforeResult?.block) return { kind: "immediate", result: createErrorToolResult(beforeResult.reason || "Tool execution was blocked"), isError: true }`. **The blocked call never executes; the `reason` string is returned to the model as an error tool result — that is the nudge channel.** Types: `node_modules/@earendil-works/pi-agent-core/dist/types.d.ts:35-42` (`BeforeToolCallResult`), `:69-75` (`BeforeToolCallContext` with `assistantMessage`, `toolCall`, `args`, `context`), `:226-233` (hook contract).
- Bash-only hook: `BashSpawnHook` (`src/core/tools/bash.ts:97-115`) can rewrite command/cwd/env, but it is configured at `AgentSession` build time (`agent-session.ts:2627-2629` from `settings.shellCommandPrefix`/`shellPath`), **not settable from an extension** — the extension-level hook for bash is `tool_call` on `event.toolName === "bash"`.

### Extension configuration / settings patterns
- Global settings: `~/.selesai/agent/settings.json` (`src/config.ts:624-627` `getSettingsPath`; agent dir `:601-607` `~/.selesai/agent`). `Settings` interface `src/core/settings-manager.ts:87-160` (incl. `extensions?: string[]`, `packages`, `skills`, `shellCommandPrefix`). Tests use `SettingsManager.inMemory(...)` (`settings-manager.ts`, used in `agent-session-auto-handoff.test.ts:15`).
- Extension JSON config precedent: `src/extensions/pi-subagents/src/extension/config.ts:7-53` — `getConfigPath()` = `~/.selesai/agent/extensions/subagent/config.json`, `loadConfig`/`saveConfig`/`updateConfig`. `ExtensionConfig` (`src/extensions/pi-subagents/src/shared/types.ts:1602+`) already has `toolBudget?: ToolBudgetConfig`, `maxSubagentSpawnsPerSession?`, `maxSubagentDepth?`, `turnBudget`, `usageBudget`, `globalConcurrencyLimit`, `fleetView`, `waitTool`.
- Extension locations: `docs/extensions.md:110-138` — `~/.selesai/agent/extensions/*.ts` and `*/index.ts` (global), `.pi/extensions/*.ts` and `*/index.ts` (project-local, trust-gated), plus `settings.json` `extensions`/`packages` arrays. Bundled: `src/extensions/package.json` `pi.extensions` (includes `./pi-subagents`). CLI: `-e/--extension`; children pass `--no-extensions` when ambient extensions are disabled (`src/extensions/pi-subagents/src/runs/shared/pi-args.ts:213-217, 292-295`).
- Extensions get CLI flags (`registerFlag`/`getFlag`, types.ts:1345-1356) but **no settings accessor**; they read their own config file (pi-subagents pattern) or `settings.json` via `getSettingsPath()`.

### Session state
- `ctx.sessionManager` = `ReadonlySessionManager` (`src/core/session-manager.ts:190-206`: getCwd, getSessionId, getSessionFile, getLeafId, getEntry, getLabel, **getBranch**, getEntries, getTree, getSessionName, buildContextEntries…).
- `getBranch` (`session-manager.ts:1260-1270`) walks leaf→root, path order; entries include `{ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id, name, arguments }] } }`.
- Guarantee for `tool_call` handlers: `docs/extensions.md:711` — "Before tool_call runs, pi waits for previously emitted Agent events to finish draining… `ctx.sessionManager` is up to date through the current assistant tool-calling message." `:713` — in parallel mode, sibling calls are preflighted sequentially and executed concurrently; **sibling *calls* are visible via getBranch, sibling *results* are not**. The workflow adapter's `isSoleToolCall` (`src/extensions/workflow/adapter.ts:402-418`) is the reference implementation of "inspect current assistant message's toolCall blocks".
- Main-vs-child identity: `SUBAGENT_CHILD_ENV = SELESAI_SUBAGENT_CHILD` (`pi-args.ts:24`); `registerSubagentExtension` early-returns when set (`extension/index.ts:178-180`); `SUBAGENT_PARENT_SESSION_ENV` set only in the root session (`extension/index.ts:554-558`). Session id via `resolveCurrentSessionId(ctx.sessionManager)` (`pi-subagents/src/shared/session-identity.ts`). Persistence: `pi.appendEntry(customType, data)` (types.ts:1412), `setSessionName`, `setLabel`.

### User override / confirmation mechanisms
- `ctx.ui.confirm(title, message, opts?) → Promise<boolean>`, `ui.select`, `ui.input`, `ui.notify(message, type)` (`types.ts:56-66`); `ctx.hasUI` true in TUI and RPC (types.ts:1394-1396); `ExtensionUIDialogOptions { signal?, timeout? }`.
- Docs example: `docs/extensions.md:69-73` — `pi.on("tool_call")` + `ctx.ui.confirm(...)` → `return { block: true, reason: "Blocked by user" }`.
- Nudge precedents: `src/extensions/context-compaction-reminder.ts:16-32` (`ui.notify` on `agent_settled`, once per session via module flag); child tool-budget soft nudge via `pi.sendUserMessage(text, { deliverAs: "steer" })` (`subagent-prompt-runtime.ts:249-259`).
- Explicit user-grant precedent against a cap: `subagent({ action: "grant-spawn-budget", additional })` (pi-subagents README.md:1634) — the model of a user override for Phase-4 blocks.
- `ExtensionAPI.sendUserMessage`/`sendMessage` (`types.ts:1393-1411`, deliverAs `"steer" | "followUp" | "nextTurn"`, triggerTurn).

### Capability ceilings
- Tool availability: `allowedToolNames`/`excludedToolNames` (`agent-session.ts:227-230`), set only from SDK config (`sdk.ts:246-251`); dynamic ceiling from extensions via `pi.setActiveTools(names)`/`getActiveTools()`/`getAllTools()` (`types.ts:1331-1337`; `ToolInfo` `:1563-1565`; runner actions `runner.ts:659-661`, agent-session `:2466-2469`).
- pi-subagents per-session ceiling registry: `src/extensions/pi-subagents/src/runs/shared/capability-ceiling.ts` — `allowedTools`/`allowedAgents`/`denyExtensions`, intersection across registrations + inherited env `SELESAI_SUBAGENT_CAPABILITY_CEILING_V1`, audit shape `SubagentCapabilityAudit` (`:24-31`).
- Child tool budget (the exact machinery to port): `src/extensions/pi-subagents/src/runs/shared/tool-budget.ts` — `DEFAULT_TOOL_BUDGET_BLOCK = ["read","grep","find","ls"]` (`:3`), `{ soft?, hard, block? | "*" }` (`validateToolBudgetConfig` `:10-36`), `shouldBlockToolForBudget` (`:62-64`), `toolBudgetSoftNudge` (`:66-68`), `toolBudgetBlockedMessage` (`:70-72`), env encode/decode (`:74-83`). Enforced child-side only: `registerToolBudget` (`subagent-prompt-runtime.ts:244-264`) fed by `TOOL_BUDGET_ENV` set in `pi-args.ts:419-421`; child extension loaded via `--extension subagent-prompt-runtime.ts` (`pi-args.ts:22, 210-212`). **The main agent has no equivalent today.**
- Other caps: `turnBudget`, `usageBudget`, `maxSubagentSpawnsPerSession`, `maxSubagentDepth` (`types.ts:1602-1630`).
- Read-only enforcement precedent (separate in-process agent): `src/extensions/pi-subagents/src/watchdog/review.ts:280-286` — `beforeToolCall` allowlist `WATCHDOG_ALLOWED_TOOL_NAMES` → `{ block: true, reason: "Watchdog reviews are read-only; tool '…' is not allowed." }`.

### Existing main-agent enforcement precedents (the strongest reuse)
- `src/extensions/workflow/adapter.ts:708-733` — `pi.on("tool_call")` in the **main agent**: blocks `write`/`edit` when a workflow is active with reason "…workspace edits must be delegated to subagents." (`:720-727`); also `transitionBatchBlock` (`:420-426`) blocking batch-context transition calls using `isSoleToolCall` (`:402-418`). This is literally "block parent tool use in favor of delegation" already shipped.
- `src/extensions/workflow/adapter.ts:736-...` — `tool_result` handler pattern (persist/transform results; `terminate` hint).

### Tests / test seams
- `src/__tests__/task-workflow.test.ts:19-54` — harness: mock `pi` (`events` Map, `on`, `registerTool`, `registerCommand`), mock `ctx` (`sessionManager: { getBranch }`, `ui`). Direct unit seam for main-agent `tool_call` enforcement: `:185-210` asserts `h.events.get("tool_call")({ toolName, toolCallId, input }, ctx)` returns `{ block: true, reason }`.
- `src/extensions/pi-subagents/test/unit/subagent-prompt-runtime.test.ts:166-194` — unit seam for nudge+block: register runtime against a mock `pi`, assert soft nudge (`sent` array) and block shape: `{ block: true, reason: "Tool budget hard limit reached after 3 tool calls (hard 2). …" }`.
- `src/core/agent-session-auto-handoff.test.ts:9-79` — `AgentSession` construction seam (mock agent/sessionManager/resourceLoader, `SettingsManager.inMemory`, private field override `(session as any)._extensionRunner = …`).
- `src/core/settings-manager-auto-handoff.test.ts` — settings manager behavior.
- `src/extensions/pi-subagents/test/integration/single-execution.test.ts:2946-2971` — full child-process integration (asserts `--extension subagent-prompt-runtime.ts`, `--no-extensions`).
- `vitest.config.ts` — vitest, node env, globals; **`@selesai/code` alias → `dist/index.js`** (type changes in `src/core/extensions/types.ts` need a build to be visible to extension tests; behavior tests importing `src/...` directly are fine). No `test` script in `package.json`; run `npx vitest run`.

## Current Behavior
- **Entry point**: `src/core/agent-session.ts` `AgentSession` wraps `Agent` (pi-agent-core) for both the interactive main agent and every headless child. Extension events flow through `ExtensionRunner` (`src/core/extensions/runner.ts`); `tool_call` handlers are the sanctioned interception point ("can block", docs/extensions.md:707-721).
- **Data flow for a block**: LLM emits tool call → agent-loop validates args → `AgentSession.beforeToolCall` (`agent-session.ts:485`) → `runner.emitToolCall` (`runner.ts:933`) → each extension's `tool_call` handler (first `{block:true}` wins) → back to agent-loop (`agent-loop.js:405-421`) → tool does NOT execute; `reason` (or `"Tool execution was blocked"`) becomes an error tool result the model sees next turn. Sibling calls in the same assistant batch are preflighted sequentially, so a handler can inspect the whole batch via `ctx.sessionManager.getBranch()`.
- **Nudge paths**: `sendUserMessage(text, { deliverAs: "steer" })` (hidden steer into the queue; precedent `subagent-prompt-runtime.ts:249-259`), `ui.notify` (visible; precedent context-compaction-reminder.ts), or the block `reason` itself (model-visible error text).
- **Children are isolated by construction**: child processes run with `SELESAI_SUBAGENT_CHILD=1`, ambient extensions disabled (`--no-extensions`) when a capability ceiling denies extensions or explicit extension args exist (`pi-args.ts:213-217`), and only `subagent-prompt-runtime.ts` (+ optional fanout-child) injected via `--extension`. So a main-agent enforcement extension placed inside `pi-subagents` (guarded by `SUBAGENT_CHILD_ENV`) or in global/bundled extensions won't run in children by default — but **any extension added to `extensionArgs`/ambient paths runs everywhere unless guarded**.

## Reuse / Risks
- **Reuse**: (1) `registerToolBudget` + `tool-budget.ts` is a drop-in template — same counters, same soft-nudge/`{block,reason}` shape; (2) workflow adapter `:708-733` proves main-agent `tool_call` enforcement with delegation-directed reasons works today; (3) `isSoleToolCall` (`adapter.ts:402-418`) is the batch-inspection primitive for "broad exploration in one assistant message"; (4) `ExtensionConfig` + `config.ts` JSON pattern for opt-in thresholds; (5) `grant-spawn-budget` for user-override precedent; (6) `getCompactReadClassification` (`read.ts:117-127`) for path-classification to avoid false positives.
- **Risks**:
  - Handler errors block the tool fail-safe (`extensions.md:2596`, `agent-session.ts:497-502`) — a buggy enforcement handler freezes the agent. Keep handlers cheap, sync, try/catch → `undefined`.
  - Parallel preflight: sibling **results** are never visible in `tool_call` — a counter cannot credit completed sibling reads; double-counting or blocking a batch whose siblings already delivered the needed context is possible.
  - False positives: legitimately large targeted reads (big docs, generated files) and bash `find`/`grep` for build/tooling would trip naive breadth thresholds; exclude `node_modules`, `dist`, `docs/`, `SKILL.md`, `package.json`-class paths, and keep bash out of the default block list (mirror `DEFAULT_TOOL_BUDGET_BLOCK`).
  - Repeated blocked attempts are not self-limiting: the model can retry the same call; only your own counter/budget stops it (that is the point of the hard cap, but the reason string must tell the model what to do instead — delegate via `subagent`).
  - `reason` goes into context on every block (token cost); keep it short and stable so the model can act on it.
  - `ui.confirm` requires `hasUI` (TUI/RPC); in `print` mode fall back to notify or reason-only.
  - Config drift: `ExtensionConfig`/thresholds live in a JSON file read at startup (`loadConfig` in `extension/index.ts`); changing it needs `/reload` (or read per-call, like `maxSubagentSpawnsPerSession` is resolved at session reset).
- **Escape hatches for users**: remove/disable the extension (`settings.json` `extensions`, delete config file); grant-style override command; per-block `ui.confirm` gate before hard-block (docs permission-gate example); `ctx.signal` aborts mid-handler if needed (`types.ts:1423-1425`).
- **Scope note**: this is the *selesai repo* (`@selesai/code`); the pi-subagents bundled extension is the owning host for delegation tooling — a Phase-4 enforcement extension most naturally lives under `src/extensions/pi-subagents/src/` (main-process side, guarded like `extension/index.ts:178`).

## Start Here
1. `src/extensions/pi-subagents/src/runs/shared/subagent-prompt-runtime.ts:244-264` (`registerToolBudget`) + `src/extensions/pi-subagents/src/runs/shared/tool-budget.ts` — the nudge+block machinery to adapt for the main agent.
2. `src/extensions/workflow/adapter.ts:708-733` — the existing main-agent `tool_call` block-in-favor-of-subagents pattern.
3. Tests to mirror: `src/extensions/pi-subagents/test/unit/subagent-prompt-runtime.test.ts:166-194` and `src/__tests__/task-workflow.test.ts:185-210`.

---

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Returned concrete findings with file paths and line numbers throughout: main-agent tool registration (src/core/tools/index.ts:1-125, agent-session.ts:2621-2673, sdk.ts:245-251), interception hooks (agent-session.ts:484-527, extensions/runner.ts:933-954, types.ts:861-912/1079-1082/1239, pi-agent-core agent-loop.js:405-421), extension config patterns (config.ts:601-627, pi-subagents extension/config.ts:7-53, types.ts:1602+), session state (session-manager.ts:190-206/1260-1270, extensions.md:711-713, workflow adapter isSoleToolCall adapter.ts:402-418), user override/confirmation (types.ts:56-66 ui.confirm, extensions.md:69-73, grant-spawn-budget README.md:1634), capability ceilings (agent-session.ts:227-230, capability-ceiling.ts, tool-budget.ts, watchdog/review.ts:280-286), and test seams (task-workflow.test.ts:19-54/185-210, subagent-prompt-runtime.test.ts:166-194, agent-session-auto-handoff.test.ts:9-79, vitest.config.ts). Feasible opt-in detection/block approaches, limitations, false-positive risks, and escape hatches are enumerated in the artifact."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "grep/find/read over src/core, src/extensions/pi-subagents, src/extensions/workflow, node_modules/@earendil-works/pi-agent-core/dist, docs/extensions.md",
      "result": "passed",
      "summary": "Located tool registration, tool_call interception chain, budget/ceiling machinery, session state accessors, and test seams; verified via direct file reads"
    }
  ],
  "validationOutput": [
    "No files edited; read-only recon. Line numbers verified by direct reads of each cited file. Children isolation verified: SUBAGENT_CHILD_ENV guard (extension/index.ts:178-180), --no-extensions path (pi-args.ts:213-217, 292-295), child-only TOOL_BUDGET_ENV (pi-args.ts:419-421)."
  ],
  "residualRisks": [
    "tool_call handler throws block the tool fail-safe (extensions.md:2596, agent-session.ts:497-502) - enforcement handler must be try/catch-wrapped to avoid freezing the agent",
    "Sibling tool results are not visible in tool_call during parallel preflight (extensions.md:713) - batch counters can double-count or block a batch whose siblings already produced the needed context",
    "Naive breadth thresholds false-positive on legitimately large targeted reads and bash find/grep for build tooling; recommended exclusions: node_modules, dist, docs/, SKILL.md, package manifests; default block list should mirror DEFAULT_TOOL_BUDGET_BLOCK (read/grep/find/ls only, no bash)",
    "reason strings are injected into context on every block (token cost) and models can retry blocked calls; only the enforcement counter is self-limiting",
    "ui.confirm requires hasUI (TUI/RPC); print mode needs notify/reason fallback",
    "Config JSON is read at startup; changes require /reload unless read per-call",
    "@selesai/code alias resolves to dist/index.js in vitest (vitest.config.ts) - type changes in src/core/extensions/types.ts require a build before extension tests see them"
  ],
  "noStagedFiles": true,
  "diffSummary": "No diff - read-only reconnaissance artifact only",
  "reviewFindings": [
    "no blockers - full context for Phase 4 optional enforcement delivered",
    "note: main agent currently has NO tool budget/exploration enforcement; the child-side registerToolBudget (subagent-prompt-runtime.ts:244-264) and the main-agent workflow adapter block (adapter.ts:708-733) are the two directly reusable templates"
  ],
  "manualNotes": "Next agent should start from registerToolBudget/tool-budget.ts and workflow adapter.ts:708-733, then mirror the unit test seams in subagent-prompt-runtime.test.ts:166-194 and task-workflow.test.ts:185-210. Artifact path: /Users/andrewanggada/Documents/workdir/js_proj/selesai/.pi-subagents/chain-runs/5ae046dc/parallel-0/4-explorer/recon/phase-4-optional-enforcement.md"
}
```

⧉ copy assistant: /cp 65c3c5