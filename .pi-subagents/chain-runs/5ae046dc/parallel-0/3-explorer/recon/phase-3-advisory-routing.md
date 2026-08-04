I have all the context I need. Here is the complete recon artifact.

# Code Context

## Phase 3 Advisory Routing — Codebase Recon

Scope: task-aware agent recommendation ("advisory routing") for the `pi-subagents` extension (`src/extensions/pi-subagents`), with launch kept explicit and dynamic agents authoritative. All paths below are relative to `/Users/andrewanggada/Documents/workdir/js_proj/selesai`.

---

## Relevant Files

### Agent resolution / discovery
- `src/extensions/pi-subagents/src/agents/agents.ts` — the single authority for agent config.
  - `agents.ts:477` `normalizeAgentAliases` — dedupes `aliases`/`alias` frontmatter, drops alias === agent name.
  - `agents.ts:483` `effectiveAgentMatch` — resolves same-name collisions by source rank `builtin(0) < package(1) < user(2) < project(3)` (highest wins).
  - `agents.ts:492` `resolveAgentName(name, agents)` — exact name → `localName` → alias match; returns `{agent}` or `{error: "Ambiguous agent name/alias ..."}`. This is the canonical resolution entry point for runtime (executor), preflight, and management (`get`/`update`/etc.).
  - `agents.ts:832` `readSubagentSettings` — parses `subagents` block: `agentOverrides`, `disableBuiltins`, `disableThinking`, `defaultModel`, `defaultThinking`, `defaultExtensions`, `modelScope`, `projectRootResolution`.
  - `agents.ts:970/1018` `applyBuiltinOverride` / `applyBuiltinOverrides` — project settings beat user settings; `false` value clears a field; `disableBuiltins`/`disableThinking` bulk gates.
  - `agents.ts:1073` `agentHasFrontmatterField` + `agents.ts:1078` `applyCustomAgentOverride` — for custom agents, frontmatter wins per-field over settings overrides; settings only fill unset fields.
  - `agents.ts:1230-1330` `saveBuiltinAgentOverride` / `removeBuiltinAgentOverride` / `mergeBuiltinAgentOverride` / `removeBuiltinAgentOverrideFields` — settings-file persistence (used by management `create`/`update`/`disable`/`enable`/`reset` and watchdog).
  - `agents.ts:1411` `loadAgentsFromDir` — markdown frontmatter → `AgentConfig`; requires `name`+`description`; parses `model`, `tools`, `skills`, `aliases`, `acceptance`, `acceptanceRole`, `output`, `defaultContext`, `maxSubagentDepth`, `toolBudget`, `memory`, `extraFields`; `runtimeName = buildRuntimeName(localName, packageName)` → dotted names for packaged agents (e.g. `package.agent`).
  - `agents.ts:1644` `discoverAgents(cwd, scope)` — runtime discovery: builtin + user (incl. `SELESAI_SUBAGENT_EXTRA_AGENT_DIRS`, `agents.ts:~1600` `extraUserAgentDirs`) + project (`<root>/.agents` legacy and `<configDir>/agents`) + package (`npm:`/`git:`/`file:` roots + global npm root); applies `applySubagentDefaults` then overrides; filters `disabled !== true`.
  - `agents.ts:1700` `discoverAgentsAll(cwd)` — full split `{builtin, package, user, project, chains, chainDiagnostics, ...}` used by management and preflight candidate lists.
- `src/extensions/pi-subagents/src/agents/agent-selection.ts` — `mergeAgentsForScope(scope, user, project, builtin, package)`: builtin → package → (user/project by scope) with later `set` winning; scope `"both"` lets project win name collisions.
- `src/extensions/pi-subagents/src/runs/foreground/subagent-executor.ts` — runtime resolution:
  - `subagent-executor.ts:1539` `canonicalizeAgentName` (wraps `resolveAgentName`, errors "Unknown agent: X").
  - `subagent-executor.ts:1546` `canonicalizeExecutionParams` — resolves agent names in single/tasks/chain/parallel/dynamic-parallel steps before validation. **This is where a recommended agent would have to be "confirmed" if any auto-fill were ever attempted — currently nothing is auto-filled; the model's explicit params are authoritative.**
- `src/core/agents.ts` — separate, simpler core persona loader (`loadAgents` at `core/agents.ts:130`, `formatAgentsForPrompt` at `:105`) that feeds `<available_agents>` into the parent system prompt; collision diagnostics. Not used by the subagent tool itself; advisory text mirrors this pattern.

### Overrides / capability ceilings
- `src/extensions/pi-subagents/src/runs/shared/capability-ceiling.ts` (+ re-export `src/extensions/pi-subagents/src/api/capability-ceiling.ts`):
  - v1 ceiling: `{ allowedTools?, allowedAgents?, denyExtensions? }` (at least one required); name validation `/^[A-Za-z0-9_.:-]+$/u`, ≤256 entries, ≤128 UTF-8 bytes/name.
  - `intersectSubagentCapabilityCeilings` — intersection of each allowed list, OR of `denyExtensions`; `sources` union.
  - `registerSubagentCapabilityCeiling` (per-session registry via `Symbol.for("pi-subagents.capability-ceiling.v1")`), handle `update`/`dispose`.
  - `isAgentAllowedByCapabilityCeiling(agentName, ceiling)` (~:300), `capabilityCeilingAgentRestrictionMessage` (~:305), `capabilityCeilingAgentRestrictionSources` (~:315), env propagation `SELESAI_SUBAGENT_CAPABILITY_CEILING_V1` (base64url, `encode`/`decode` ~:330-360).
  - **A task-aware recommender must filter/flag agents blocked by `allowedAgents`** — the same way `handleList` does (see below).

### Action dispatch / schema
- `src/extensions/pi-subagents/src/extension/schemas.ts` — `SubagentParams` (TypeBox): `agent`, `task`, `action`, `id`/`runId`/`dir`/`index`, `view`, `lines`, `message`, `steeringRecovery`, `additional`, `scope`, `target`, `thinking`, `schedule`, `scheduleName`, `chainName`, `config`, `tasks`, `concurrency`, `worktree`, `chain`, `context`, `chainDir`, `async`, `timeoutMs`/`maxRuntimeMs`, `turnBudget`, `toolBudget`, `usageBudget`, `agentScope`, `cwd`, `artifacts`, `includeProgress`, `share`, `sessionDir`, `clarify`, `control`, `output`, `outputMode`, `skill`, `model`, `outputSchema`, `agentContract`, `acceptance`. Note `keepTopLevelParameterDescriptions` (schemas.ts:3) prunes nested descriptions for token savings — any new param keeps this behavior. `SubagentWaitParams` second schema.
- `src/extensions/pi-subagents/src/shared/types.ts:1729` `SUBAGENT_ACTIONS` — 24 management/control actions (list, get, models, create, update, delete, eject, disable, enable, reset, status, grant-spawn-budget, interrupt, resume, steer, stop, append-step, approve-checkpoint, reject-checkpoint, doctor, watchdog.* x4, schedule* x4).
- `src/extensions/pi-subagents/src/runs/foreground/subagent-executor.ts` dispatch: `:137` `MUTATING_MANAGEMENT_ACTIONS` set; `:227` `allowMutatingManagementActions?` dep (child-safe fanout sets it false); `:3700`/`:4071` gates; `:4078` falls through to `handleManagementAction(action, params, ctx)`; control actions (`status`, `interrupt`, `stop`, `steer`, `append-step`, `schedule*`) are handled in the executor before the generic path (`:3950-4050`).
- `src/extensions/pi-subagents/src/agents/agent-management.ts` — `handleManagementAction` switch at `:1152`; `handleList` at `:675` (advisory output); `result()` helper at `:60` emits `details: { mode: "management", results: [] }`.
- `src/extensions/pi-subagents/src/extension/tool-description.ts` — `FULL_SUBAGENT_TOOL_DESCRIPTION` / `COMPACT_SUBAGENT_TOOL_DESCRIPTION`; both already instruct "call `{action:"list"}` before executing" and reference proactive skill suggestions (`:28`, `:88`); `buildSubagentToolDescription` at `:205`; custom override via `subagent-tool-description.md` with mandatory safety guidance. **Any new advisory action must be documented in both descriptions (and the safety block).**

### Proactive-skill suggestions (closest existing "advisory" precedent)
- `src/extensions/pi-subagents/src/agents/proactive-skills.ts`:
  - `:38` `resolveProactiveSkillSubagentsConfig(config|false)` — defaults: enabled true, minReferences 2, maxRecommendations 3 (hard cap 5), preferredAgent "commentator".
  - `:108` `recommendProactiveSkillSubagents({agents, chains, availableSkills, config})` — counts skill references across enabled agents' `skills` and chain steps (incl. nested `parallel`), requires ≥ minReferences, filters to available skills (and never the `pi-subagents` orchestration skill), picks `chooseRecommendationAgent` (preferred → fallback order `[commentator, architect, builder]` → first enabled), sorts by references desc, slices to cap.
  - `:156` `formatProactiveSkillSubagentRecommendations` — text lines incl. guardrails ("use for broad tasks … skip when the user asks for a direct answer").
  - `:172` `buildProactiveSkillSubagentRecommendationLines` — wraps with `discoverAvailableSkills()` (skills.ts:725).
- Wired only into `handleList` output: `agent-management.ts:687-706` appends suggestions to the `list` result.
- Config: `ProactiveSkillSubagentsConfig` at `shared/types.ts:1585`; `ExtensionConfig.proactiveSkillSubagents` at `:1634` (can be `false`).
- Tests: `test/unit/proactive-skills.test.ts` (pure-function tests with hand-built `AgentConfig`/`ChainConfig` fixtures); `test/unit/agent-management.test.ts:725-774` (list output + disable via config).

### Task-intent classification
- `src/extensions/pi-subagents/src/runs/shared/task-intent.ts`:
  - `:148` `classifyTaskMutationIntent(agent, task)` → `{kind:"implementation"|"read-only"|"unknown"}` — agent-aware grammar (builder/reviewer-style agents vs generic), blanket vs scoped no-edit prohibitions, read-only deliverables, research-agent short-circuit.
  - `:163` `expectsImplementationMutation`; `:176` `taskMayMutate` (broad write-capability, used by acceptance inference).
  - `stripFrameworkInstructions` (`:102`) strips harness boilerplate lines ("Return the complete artifact in your final response.", "This path is authoritative…", "Do not call contact_supervisor merely…", etc.) before classification — task text from orchestrated children is already partially normalized.
- Consumer: `src/extensions/pi-subagents/src/runs/shared/acceptance.ts:89-104` — `inferLevel` derives `readOnlyTask`, `rolePatchTask`, `taskMayWrite`, `readOnlyAgent` from intent + acceptanceRole + agent name; drives `attested`/`checked`/`verified` evidence gates and review requirements. **Any "advisory routing" recommendation should be consistent with this inference (a writer task should not be routed to a read-only reviewer and vice-versa).**

### Preflight / RPC surfaces
- `src/extensions/pi-subagents/src/api/preflight.ts`:
  - `:25` `SUBAGENT_LAUNCH_CONTRACT_VERSION = 2`; `:207` `resolveSubagentLaunchContract(input)` — side-effect-free contract resolution: agent identity + `shadowedCandidates` (`candidateList` at `:196`), `definitionDigest` (via `shared/launch-contract.ts` `agentDefinitionDigest`), model/thinking candidates, skills/tools/MCP incl. capability-ceiling audit, roots/lifecycle paths, `launchContractDigest` (`launchBindingDigest`), `digest` (sha256 of stable JSON, `:173`).
  - Failure codes: `missing_agent | ambiguous_agent | missing_skill | denied_required_tool | invalid_artifact_dir | invalid_cwd | unsupported_mode | restricted_agent` (`:31`); `host_required` / `snapshot_warning` diagnostics.
  - Exported via package.json `"./preflight": "./src/api/preflight.ts"`.
- `src/extensions/pi-subagents/src/extension/rpc.ts` — extension event-bus RPC v1:
  - `:24` `SUBAGENT_RPC_PROTOCOL_VERSION = 1`; `:29` `SUBAGENT_RPC_METHODS = ["ping","status","spawn","steer","interrupt","stop","resume"]`; request/reply envelopes `subagents:rpc:v1:*`; `pingData` advertises versioned `capabilities` (incl. `fleetStatus`, `processTerminalProof`, `launchResolvedExtensions`) — **the natural place to advertise a new advisory capability**; `buildFleetStatus` (opaque keys, cap 16 entries); `spawnParams` explicitly rejects `action` and non-async calls; `registerSubagentRpcBridge` at `:617`.
- `src/extensions/pi-subagents/src/api/delegation.ts` — extension-to-extension event contracts v1/v2 (`SubagentDelegationRequest`/`V2Request`); validation in `src/extensions/pi-subagents/src/slash/delegation-request.ts` (strict field allowlists, byte limits). A recommendation field here would be a v3/extension, not a change to existing fields.
- `src/extensions/pi-subagents/src/shared/launch-contract.ts` — `projectAgentDefinition` (all launch-affecting fields, versioned), `agentDefinitionDigest`, `projectLaunchBinding`/`launchBindingDigest` (task digest included; runtime acceptance/output annotations explicitly excluded). Any contract addition changes digests → contract version must bump.
- Host-level prompt preflight: `src/core/agent-session.ts:263-264` (`preflightResult` hook), `:1181-1328` wiring; `src/modes/rpc/rpc-mode.ts:401-416` uses it for `prompt` responses. (Different surface from the subagent launch preflight; not a routing hook today.)

### Management output metadata
- `src/extensions/pi-subagents/src/shared/types.ts:915` `Details` — `mode: SubagentRunMode | "management"`, `results: SingleResult[]`, plus `chainAgents/totalSteps/currentStepIndex/workflowGraph`, `checkpoint`, `outputs`, `totalChildUsage/totalCost`, `spawnBudget`, `capabilityCeiling/capabilityAudit`, `launchContractDigest`, `lifecycleStatus`, `launchResolvedExtensions/runtimeAcknowledgedExtensions`, `sourceLaunchContractDigest`.
- Management actions always return `{ mode: "management", results: [] }`; advisory output is plain text (see `handleList`). If advisory routing needs machine-readable output, `Details` or the tool result content parts would carry it.

### Routing-related tests (seams)
- Unit: `test/unit/agent-selection.test.ts` (scope precedence), `test/unit/agent-overrides.test.ts` (settings precedence, frontmatter-wins, disableBuiltins), `test/unit/agent-disabled.test.ts`, `test/unit/agent-eject-disable.test.ts`, `test/unit/capability-ceiling.test.ts` + `capability-ceiling-agent-allowlist.test.ts` + `capability-ceiling-pi-args.test.ts` (allowlist filtering incl. list output and preflight rejection), `test/unit/preflight.test.ts` (contract resolution, shadowed candidates, digests; env fixture pattern via `SELESAI_CODING_AGENT_DIR`), `test/unit/proactive-skills.test.ts`, `test/unit/task-intent.test.ts`, `test/unit/agent-management.test.ts` (list/get/create; proactive suggestions at `:725-774`), `test/unit/rpc.test.ts` (FakeEvents + fake ctx; ping capability assertions), `test/unit/schemas.test.ts`, `test/unit/tool-description.test.ts`, `test/unit/delegation-api.test.ts`, `test/unit/prompt-template-bridge.test.ts`, `test/unit/slash-bridge.test.ts`.
- Integration: `test/integration/single-execution.test.ts:4085` (does not proactively detach foreground children), `test/integration/slash-commands.test.ts`, `test/integration/acceptance-file-report.test.ts`, `test/integration/fork-context-execution.test.ts`.
- Harness: extension tests use `node --experimental-strip-types --test` (`src/extensions/pi-subagents/package.json` scripts), root repo uses vitest (`vitest.config.ts`). Env-fixture pattern for discovery: set `SELESAI_CODING_AGENT_DIR` + `HOME` in `beforeEach` (see `preflight.test.ts:27-60`).

---

## Current Behavior

### Data flow (entry points)
1. **Parent model → tool**: `registerSubagentExtension` (`src/extensions/pi-subagents/src/extension/index.ts`) registers tool `subagent` with `SubagentParams`, `prepareArguments` runs `validateChainInput` first (`extension/chain-validation.ts`), then `executor.execute` (`runs/foreground/subagent-executor.ts`).
2. **Action vs execution dispatch** (`subagent-executor.ts:~3850-4080`): if `params.action` present → control actions (status/interrupt/stop/steer/append-step/schedule*) handled inline; unknown-but-listed actions go to `handleManagementAction` (`agent-management.ts:1152`); child-safe fanout blocks `MUTATING_MANAGEMENT_ACTIONS`. If no action → execution: `resolveExecutionAgentScope` → `discoverAgents` → `canonicalizeExecutionParams` (name/alias resolution per child) → `validateExecutionInput` (exactly one mode) → budgets → spawn preflight → launch.
3. **Advisory content today**: only two places — (a) `subagent({action:"list"})` output shows executable agents (aliases, context), restricted agents (capability ceiling sources), chains, chain diagnostics, and proactive skill subagent suggestions (`agent-management.ts:675-714`); (b) tool descriptions and the `pi-subagents` skill instruct the model to consult list first and to use proactive-skill fanout only for broad tasks.
4. **Preflight**: external extensions call `resolveSubagentLaunchContract` (README `:1097-1133` documents v2 contract + digest semantics) for side-effect-free launch resolution.
5. **RPC**: extensions send `subagents:rpc:v1:request` events; bridge replies on `subagents:rpc:v1:reply:<requestId>`; `ping` returns capability metadata.

### Important constraints
- **Launch is explicit**: the executor only launches what the model passes; nothing auto-selects an agent. `canonicalizeExecutionParams` resolves/validates but never invents agents.
- **Dynamic agents are authoritative**: discovery is dynamic (files + settings + packages + env dirs), `resolveAgentName` + `mergeAgentsForScope` define the effective set; any recommendation must be computed from the same discovered set and must not mutate it.
- **Capability ceilings gate execution**: restricted agents are blocked pre-launch (`restricted_agent`) and hidden-or-flagged in list output.
- **Contract/digest stability**: `SUBAGENT_LAUNCH_CONTRACT_VERSION = 2` and `launchContractDigest` are public, documented, and used for retry correlation; additions to the contract or its projection require a version bump.
- **Proactive skill recommendations are conservative**: min 2 references, available-skill filter, hard cap 5, guardrail text, opt-out via `proactiveSkillSubagents: false`.

---

## Reuse / Risks

### Patterns to reuse
- **Pure recommender + formatter + builder** (proactive-skills.ts:108/156/172) is the exact shape for an advisory agent recommender: pure function over `(task, agents, chains?, config?)`, deterministic ordering, text formatting with guardrails, config-gated (`false` disables), unit-tested with hand-built fixtures.
- **`classifyTaskMutationIntent`/`taskMayMutate`** (task-intent.ts) give task-aware signal (writer vs read-only vs unknown) already validated and harness-normalized.
- **`resolveAgentName` + `mergeAgentsForScope` + `isAgentAllowedByCapabilityCeiling`** give the eligibility filter (aliases, dotted package names, disabled, restricted).
- **`handleList`** (`agent-management.ts:675`) is the existing advisory surface the model already reads before launching; appending a task-aware recommendation block there requires no schema/contract change.
- **`pingData` capabilities map** (rpc.ts) is the advertisement point if an RPC method is added.
- **Test seams**: `preflight.test.ts` env-fixture setup; `rpc.test.ts` FakeEvents; `proactive-skills.test.ts` fixture builders; `agent-management.test.ts` direct `handleManagementAction` calls.

### Minimal design options (evaluated)
1. **Recommendation block in `action:"list"`** (optionally a new `action:"recommend"` + `task` param): zero schema/contract risk, mirrors proactive-skills; reachable by the model via the existing "call list first" instruction; extend `FULL/COMPACT_SUBAGENT_TOOL_DESCRIPTION` with one line. **Lowest risk; launch stays fully explicit.**
2. **Preflight advisory field**: add `recommendations` to `SubagentLaunchContract` — requires `SUBAGENT_LAUNCH_CONTRACT_VERSION` → 3, `projectLaunchBinding`/digest changes, README updates; breaks existing v2 consumers (documented digest semantics). Only worthwhile if external orchestrators need machine-readable advice.
3. **New RPC method** (e.g. `recommend`): requires `SUBAGENT_RPC_PROTOCOL_VERSION` → 2, new entry in `SUBAGENT_RPC_METHODS`, `pingData.capabilities`, `handleRequest` branch; `spawnParams` must keep rejecting `action` so recommendation stays advisory (no auto-launch through RPC).

### Concrete risks / edge cases
- **Ambiguity**: recommendation must surface `resolveAgentName` ambiguity errors rather than guessing (reuse `effectiveAgentMatch` semantics, but show candidates).
- **Aliases & dotted names**: recommend the canonical runtime name (what `canonicalizeExecutionParams` accepts); aliases are input sugar only.
- **Disabled/restricted agents**: filter `disabled !== true` and capability-ceiling `allowedAgents`; if a preferred agent is restricted, fall back (mirror `chooseRecommendationAgent` + `FALLBACK_AGENT_ORDER`).
- **Chain/parallel tasks**: `task` templates contain `{task}`/`{previous}`/`{chain_dir}`/`{outputs.name}` variables — per-step recommendation is unreliable; recommend at the top level only, or skip template-laden steps (proactive-skills already handles nested `parallel` skill collection, so reuse `collectStepSkills`-style traversal if chain-level advice is wanted).
- **Consistency with acceptance inference**: a "writer" classification (task-intent) should not route to a reviewer-style agent and vice-versa; recommendation must not contradict `acceptance.ts` inference the same task will undergo.
- **Schema/token cost**: any new `SubagentParams` field must go through `keepTopLevelParameterDescriptions`; `Action` enum additions affect `MUTATING_MANAGEMENT_ACTIONS` gating in child-safe fanout (a read-only `recommend` action should NOT be added to that set, but must be reachable in child-safe mode or explicitly blocked).
- **Digest/version coupling**: any contract or RPC change is a breaking public-API change (README documents both protocols); tests `rpc.test.ts` and `preflight.test.ts` assert exact versions and capabilities.
- **Text-only output**: management results are plain text with `details:{mode:"management"}`; machine consumers of recommendations would need a structured field (e.g. in `Details` or tool result content), which changes `Details` typing.

---

## Start Here

1. `src/extensions/pi-subagents/src/agents/proactive-skills.ts` — the recommender pattern to mirror (pure, config-gated, formatted, tested).
2. `src/extensions/pi-subagents/src/runs/shared/task-intent.ts` — the task signal for writer/read-only routing.
3. `src/extensions/pi-subagents/src/agents/agent-management.ts:675-714` (`handleList`) — the existing advisory surface where a task-aware block would attach (option 1).
4. `src/extensions/pi-subagents/src/agents/agents.ts:492` (`resolveAgentName`) + `src/extensions/pi-subagents/src/runs/shared/capability-ceiling.ts:300-315` — eligibility filtering.
5. Only if a machine-readable/contract surface is required: `src/extensions/pi-subagents/src/api/preflight.ts:207` and `src/extensions/pi-subagents/src/extension/rpc.ts:29` (both versioned, breaking).

---

## Acceptance Report

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Returned concrete findings with exact paths and line numbers across all requested areas: agent resolution (agents.ts:477/483/492/1411/1644/1700, agent-selection.ts), aliases/overrides (agents.ts:832/970/1018/1078/1230-1330, agent-overrides.test.ts), capability ceilings (runs/shared/capability-ceiling.ts, api/capability-ceiling.ts), action dispatch/schema (schemas.ts SubagentParams, shared/types.ts:1729 SUBAGENT_ACTIONS, subagent-executor.ts:137/1539/1546/3700/4071/4078, agent-management.ts:1152), proactive-skill suggestions (agents/proactive-skills.ts:38/108/156/172, agent-management.ts:675-714, types.ts:1585/1634), task-intent classification (runs/shared/task-intent.ts:148/163/176, acceptance.ts:89-104), preflight/RPC surfaces (api/preflight.ts:25/207, extension/rpc.ts:24/29/617, api/delegation.ts, slash/delegation-request.ts, shared/launch-contract.ts, core/agent-session.ts:263-264/1181-1328, modes/rpc/rpc-mode.ts:401-416), management output metadata (shared/types.ts:915 Details), and routing tests (unit: proactive-skills/task-intent/preflight/rpc/schemas/agent-selection/agent-overrides/capability-ceiling*/agent-management/tool-description; integration: single-execution.test.ts:4085, slash-commands.test.ts). Also evaluated three minimal design options with risk ratings and edge cases."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "read/grep/find over src/extensions/pi-subagents, src/core, src/modes/rpc",
      "result": "passed",
      "summary": "Read-only recon; ~20 targeted reads/greps; all line-number claims verified by grep before citing"
    }
  ],
  "validationOutput": [
    "No code changes made; no build/test run (read-only recon task). Line numbers for all cited symbols verified via targeted grep (resolveAgentName=agents.ts:492, discoverAgents=agents.ts:1644, discoverAgentsAll=agents.ts:1700, classifyTaskMutationIntent=task-intent.ts:148, recommendProactiveSkillSubagents=proactive-skills.ts:108, handleList=agent-management.ts:675, handleManagementAction=agent-management.ts:1152, SUBAGENT_LAUNCH_CONTRACT_VERSION=preflight.ts:25, SUBAGENT_RPC_PROTOCOL_VERSION=rpc.ts:24, SUBAGENT_ACTIONS=types.ts:1729, Details=types.ts:915)."
  ],
  "residualRisks": [
    "Design options evaluated but no implementation chosen; contract/RPC version-bump impacts (preflight v2, RPC v1) are documented as breaking for public consumers (README:1097-1133, rpc.test.ts, preflight.test.ts).",
    "Chain step task templates ({task}/{previous}/{chain_dir}/{outputs.name}) make per-step agent recommendation unreliable; top-level-only recommendation recommended.",
    "e2e test directory (test/e2e) not inspected in detail; only unit/integration routing seams verified.",
    "acceptance.ts inference and task-intent classification overlap could drift if a recommender re-implements rather than reuses classifyTaskMutationIntent."
  ],
  "noStagedFiles": true,
  "diffSummary": "No diff — read-only reconnaissance artifact.",
  "reviewFindings": [
    "no blockers - read-only recon; all requested surfaces located and cited with verified line numbers",
    "note: subagent-executor.ts:1539-1589 canonicalizeExecutionParams is the enforcement point keeping launch explicit; advisory routing must not modify effectiveParams.agent there",
    "note: proactive-skills.ts is the direct reusable template (pure recommender + formatter + config gate) for task-aware recommendations"
  ],
  "manualNotes": "Phase 3 advisory-routing recon complete. Minimal-risk design is a recommendation block appended to action:'list' output (option 1) mirroring proactive-skills.ts, using classifyTaskMutationIntent for writer/read-only signal and resolveAgentName + capability-ceiling allowlist for eligibility. Contract (preflight v2) and RPC (v1) surfaces are versioned and breaking to extend; advertise any new RPC capability in pingData (rpc.ts pingData). Output persisted by runtime to the authoritative path."
}
```

⧉ copy assistant: /cp 24c951