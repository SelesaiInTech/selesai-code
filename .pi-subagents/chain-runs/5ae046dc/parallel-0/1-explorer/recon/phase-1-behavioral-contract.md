I have completed the reconnaissance. Here is the full artifact.

# Code Context

Phase 1 recon: **always-visible delegation contract + dynamic agent catalog** — main system/developer prompt assembly, skill discovery/loading, `pi-subagents` tool registration/description modes, `action:list` discovery/output/details, agent overrides/aliases/capability ceilings, schemas, and tests.

## Relevant Files

### Main Selesai system/developer prompt assembly
- `src/core/system-prompt.ts:31` — `buildSystemPrompt(options)`; `BuildSystemPromptOptions:10`. Tools list rendered from `selectedTools` + `toolSnippets` (`:88`, default `["read","bash","edit","write"]`); skills appended via `formatSkillsForPrompt` only when `read` tool active (`:96,141`); agents via `formatAgentsForPrompt` likewise gated on `read` (`:97,142`); `<project_context>` block; `appendSystemPrompt`; custom-prompt path preserves context/skills/agents (`:52-84`).
- `src/core/agent-session.ts:1084` — `_rebuildSystemPrompt(toolNames)` assembles `_baseSystemPromptOptions` from `_resourceLoader.getSkills()/getAgents()/getAgentsFiles()` (`:1097-1119`); `setActiveToolsByName:986` rebuilds prompt per tool change; `getActiveToolNames:962`; `_refreshToolRegistry:2530` merges builtin + extension tools (`wrapRegisteredTools`), builds `_toolPromptSnippets`/`_toolPromptGuidelines` from `definition.promptSnippet`/`promptGuidelines` (`:2562-2582`), default active tools `["read","bash","edit","write"]` (`:2667`), rebuild on session start (`:2348`).
- `src/core/resource-loader.ts:780` — `updateAgentsFromPaths` → `loadAgents({includeDefaults:true})` (`:797`); `updateSkillsFromPaths:727` → `loadSkills({includeDefaults:false})`; `getAgentsFiles():352`.
- `src/core/agents.ts` — `loadAgentsFromDir:75` (flat `.md` only), `loadAgentFromFile`, `loadAgents:212` (user dir `agents/`, project `.selesai/agents/`, explicit paths; collision diagnostics; name-keyed map), `formatAgentsForPrompt:181` → `<available_agents><agent><name/description/location>` XML. `AgentFrontmatter:19` (name, description, model, skill, tools, systemPromptMode, inheritProjectContext, inheritSkills, output, defaultReads, defaultContext).
- `src/core/skills.ts` — `loadSkillsFromDir:168` (SKILL.md roots, recurse, ignore files), `loadSkills:387`, `formatSkillsForPrompt:~330` (`<available_skills>` XML; excludes `disableModelInvocation`), `validateName:99` / `validateDescription:129` (64-char name, 1024-char description).
- Tool registration contract: `src/core/extensions/types.ts:447` `ToolDefinition` (`name`, `label`, `description`, `promptSnippet?`, `promptGuidelines?`, `parameters`, `prepareArguments?`, `execute`, `renderCall`/`renderResult`); `defineTool:~480`. Wrapping: `src/core/tools/tool-definition-wrapper.ts:10` (`wrapToolDefinition`), `:35` (`createToolDefinitionFromAgentTool`).
- CLI flags: `src/cli/args.ts:116-122` (`--no-tools`/`-nt`, `--no-builtin-tools`/`-nbt`, `--tools`/`-t`), `:163` (`--no-skills`), `:169` (`--no-context-files`).
- Docs: `docs/extensions.md:1292-1315` (registerTool; `promptSnippet`/`promptGuidelines` semantics; guidelines must name the tool), `docs/skills.md:64-68` (skills land in system prompt as XML).

### Skill discovery/loading (child side)
- `src/extensions/pi-subagents/src/agents/skills.ts` — `resolveSkillPath:566`, `resolveSkills:612`, `resolveSkillsWithFallback:653`, `buildSkillInjection:671` (`<available_skills>` XML injected into child system prompt), `normalizeSkillInput:699` (string/array/bool; JSON-string array guard), `discoverAvailableSkills:725` (excludes `pi-subagents` orchestration skill), `clearSkillCache:741`; TTL cache `loadSkillsCache` (`:51,548`).
- Injection point: `src/extensions/pi-subagents/src/runs/foreground/execution.ts` `runSyncCompletion:~1331` — resolves `options.skills ?? agent.skills` with `agent.skillPath` fallback to runtimeCwd, appends `buildSkillInjection` to the child system prompt; hard error when `pi-subagents` skill missing (`:1379-1386`).

### pi-subagents tool registration / description modes
- `src/extensions/pi-subagents/src/extension/index.ts` — `registerSubagentExtension(~240)`; tool def `:447-459`: `name:"subagent"`, `description: buildSubagentToolDescription(config)`, `parameters: SubagentParams`, `prepareArguments: validateChainInput`; `pi.registerTool(tool)` `:459`. **No `promptSnippet`/`promptGuidelines`** — the tool is model-visible only through `description` (this description is the always-visible delegation contract). Also registers `subagent_wait` (`wait-tool.ts:25`), slash bridge, prompt-template bridge (`slash/prompt-template-bridge.ts`), RPC bridge (`extension/rpc.ts:617`), watchdog, supervisor channel.
- `src/extensions/pi-subagents/src/extension/tool-description.ts` — `SUBAGENT_SAFETY_GUIDANCE:12`, `FULL_SUBAGENT_TOOL_DESCRIPTION:15`, `COMPACT_SUBAGENT_TOOL_DESCRIPTION:77`, `resolveToolDescriptionMode:~120`, `buildSubagentToolDescription:~200`, custom file `subagent-tool-description.md` (project dir then agent dir) with placeholders `{{full}}`/`{{compact}}`/`{{safetyGuidance}}`/`{{agentDir}}`/`{{projectConfigDir}}`; `withMandatorySafetyGuidance` forces safety block last (50KB cap).
- Child-safe tool: `src/extensions/pi-subagents/src/extension/fanout-child.ts:161-185` — different, shorter description; executor with `allowMutatingManagementActions:false`.
- Child runtime boundary: `src/extensions/pi-subagents/src/runs/shared/subagent-prompt-runtime.ts` — `CHILD_SUBAGENT_BOUNDARY_INSTRUCTIONS:48`, `CHILD_FANOUT_BOUNDARY_INSTRUCTIONS:56`, `rewriteSubagentPrompt:~175`, `stripProjectContext`/`stripInheritedSkills`/`stripSubagentOrchestrationSkill`/`stripParentOnlySubagentMessages`, applied in `before_agent_start` (`:436-450`). Also registers `structured_output`, tool budget, steering inbox, child watchdog, wait tool.
- Config: `src/extensions/pi-subagents/src/extension/config.ts` (`loadConfig` from `~/.selesai/agent/extensions/subagent/config.json`); `ExtensionConfig` at `src/shared/types.ts:1602-1638` (`toolDescriptionMode`, `maxSubagentDepth`, `maxSubagentSpawnsPerSession`, `asyncByDefault`, `waitTool`, `artifactDir`, `intercomBridge`, `proactiveSkillSubagents`, `scheduledRuns`, `usageBudget`, `control`…).
- Schema: `src/extensions/pi-subagents/src/extension/schemas.ts` — `SubagentParams` via `keepTopLevelParameterDescriptions` (nested descriptions pruned); `TaskItem`, `ParallelTaskSchema`, `DynamicParallelTemplateSchema`, `ChainItem` (checkpoint/expand/collect/parallel/gateOn), `AcceptanceOverride` (levels end at verified; `reviewed` deprecated-as-input), `AgentContractOverride` (`version:1`), `ChainGateOverride`, `ToolBudgetOverride`, `TurnBudgetOverride`, `UsageBudgetOverride`, `SubagentWaitParams`.

### action:list discovery / output / details
- `src/extensions/pi-subagents/src/agents/agent-management.ts` — `handleList:675` (output: "Executable agents:", `- name (source, context, aliases): description`; then "Restricted agents (…capability ceiling…)" section; "Chains:"; proactive skill suggestions; chain diagnostics), `handleGet:793` → `formatAgentDetail:588` / `formatChainDetail:662`, `handleModels:~715` (builtin-only), `handleManagementAction:1152`, `MUTATING` set in executor `subagent-executor.ts:137`.
- `SUBAGENT_ACTIONS` (list of 27 actions incl. watchdog.* and schedule*) at `src/shared/types.ts:1729`.
- Executor dispatch: `src/extensions/pi-subagents/src/runs/foreground/subagent-executor.ts` — action validity `:4064`, child-safe mutating block `:4071` (`:3700` for nested), `handleManagementAction(...) :4078`; execution path `:4123-4320` (discover → canonicalize → defaults → context policy → fork session/thinking → budgets → execData).
- Discovery: `src/extensions/pi-subagents/src/agents/agents.ts` — `loadAgentsFromDir:1411` (recursive, prunes `.git`/`node_modules`/nested project roots), `loadChainsFromDir:~1500` (`.chain.md`/`.chain.json`), `discoverAgents:1661`, `discoverAgentsAll:1722`, `resolveAgentName:492`, `mergeAgentsForScope` (`agents/agent-selection.ts:5`; precedence builtin<package<user<project), `BUILTIN_AGENTS_DIR` = `../../agents` (`:1615`), `BUILTIN_AGENT_NAMES:37-45`, `EXTRA_AGENT_DIRS_ENV:1617` (SELESAI_SUBAGENT_EXTRA_AGENT_DIRS), legacy `.agents` dirs, `SELESAI_CODING_AGENT_DIR` user dir.

### Agent overrides / aliases / capability ceilings
- Overrides (settings.json `subagents.agentOverrides.<name>`): `agents/agents.ts` `applyBuiltinOverrides:1047`, `applyCustomAgentOverride:1171` (frontmatter-field-aware, `agentHasFrontmatterField:1060`), `saveBuiltinAgentOverride:~1300`, `mergeBuiltinAgentOverride:1279`, `removeBuiltinAgentOverrideFields:~1330`; settings keys `SubagentSettings:~120` (`overrides`, `defaultModel`, `defaultThinking`, `defaultExtensions`, `disableBuiltins`, `disableThinking`, `modelScope`); paths `getUserAgentSettingsPath:655` (`agentDir/settings.json`), `getProjectAgentSettingsPath:659` (`<projectRoot>/.selesai/settings.json`).
- Aliases: `normalizeAgentAliases:477`, `resolveAgentName:492` (name → localName → aliases), frontmatter `aliases`/`alias`; builtin `builder.md` declares `aliases: developer, coder, implementer, develop`.
- Capability ceilings: `src/extensions/pi-subagents/src/runs/shared/capability-ceiling.ts` — full module: `SubagentCapabilityCeiling` (`allowedTools`/`allowedAgents`/`denyExtensions`, `:9-11`), registry `pi-subagents.capability-ceiling.v1` (`:6`), env `SELESAI_SUBAGENT_CAPABILITY_CEILING_V1` (`:7`), `registerSubagentCapabilityCeiling:104`, `intersectSubagentCapabilityCeilings:147`, `resolveCurrentSubagentCapabilityCeiling:198`, `isAgentAllowedByCapabilityCeiling:206`, `encode/decode:242/252`; validation: ≤256 entries, ≤128-byte names, `[A-Za-z0-9_.:-]+`. Re-exported from `src/api/capability-ceiling.ts`. Documented in README `:1243-1290`.
- Enforcement: `src/runs/shared/pi-args.ts` `resolvePiLaunchToolPlan:~190-240` (ceiling intersect, `allowedToolSet` filter, `fanoutAuthorized = declaredBuiltinTools.includes("subagent")`, `denyExtensions` drops extension args, `capabilityAudit`), `buildPiArgs:~255` (passes `--tools`/`--no-tools`, `--no-extensions`, `--extension`, `--no-context-files`, `--no-skills`, system-prompt file, task via arg or `@file` at 8000-char cap); `execution.ts:1331-1346` (`assertAgentAllowedByCapabilityCeiling` before spawn).
- Depth/spawn caps: `src/shared/types.ts` — `DEFAULT_SUBAGENT_MAX_DEPTH:1732`, `resolveCurrentMaxSubagentDepth:~1790`, `checkSubagentDepth:~1804`, `resolveMaxSubagentSpawnsPerSession:~1825`; `src/runs/shared/spawn-budget.ts` (preflight/reserve/grant; grants capped at configured max).

## Current Behavior

- Main session: `AgentSession._rebuildSystemPrompt` → `buildSystemPrompt`; model sees tools (from snippets), guidelines, project context, skills XML, agents XML — all generic, no hardcoded agent names in the core prompt.
- `pi-subagents` parent tool: single `subagent` tool whose description (full/compact/custom, safety guidance always last) is the always-visible delegation contract; `{ action: "list" }` is the runtime agent catalog, filtered by disabled status and capability ceiling (restricted agents stay visible but non-executable); `{ action: "get" }` gives per-agent detail including tools, skills, acceptanceRole, defaultContext, extensions, budgets.
- Child: launched via `buildPiArgs` with tool allowlist/extension args derived from the agent config + ceiling; child system prompt is rewritten with boundary instructions (child vs fanout-child), skills injected as XML, project context/skills stripped when not inherited.
- Acceptance: `src/runs/shared/acceptance.ts` `inferLevel:~80-125` maps agent name heuristics + `acceptanceRole` + task wording to level/evidence/review; `formatAcceptancePrompt:~430` emits the "Acceptance Contract" block; parsing/validation of `acceptance-report` JSON is strict (`validateAcceptanceReport:~700`).

## Reuse / Risks

**Hardcoded builtin names — the key constraint for "generic delegation thresholds":**
- `agents/agents.ts:37-45` `BUILTIN_AGENT_NAMES` (exported; used by `handleModels` filter and `models` action).
- `agents/agents.ts:48-53` `defaultSystemPromptMode`/`defaultInheritProjectContext` keyed on `name === "delegate"`.
- `runs/shared/task-intent.ts:142-160` — `hasImplementationIntent` `agent === "builder"`; `isReviewerStyleAgent` regex `(architect|commentator|explorer|recapper|researcher)`; `RESEARCH_AGENT_PATTERNS` (`investigate|scout|research(er)`); `classifyTaskMutationIntent:162`.
- `runs/shared/acceptance.ts:89` (`acceptanceRole ? "builder" : agentName`), `:105-106` read-only agent regex + `\bbuilder\b`, `:118` `review: { agent: "commentator", required: true }`.
- `agents/proactive-skills.ts:7-9` `DEFAULT_PREFERRED_AGENT="commentator"`, `FALLBACK_AGENT_ORDER=["commentator","architect","builder"]` (falls back to first enabled agent — partially generic already).
- `profiles/profiles.ts:245-247` `agentsForRoleTier` returns builtin names; `slash/prompt-workflows.ts:90,243` and `slash/delegation-adapters.ts:306` default `"builder"`.
- `extension/tool-description.ts:50-53` eject/disable/enable/reset examples name `commentator` (test only forbids `scout|worker|planner`).
- `runs/shared/mcp-direct-tool-allowlist.ts:9` `BUILTIN_TOOL_NAMES` (`read,bash,edit,write,grep,find,ls,mcp`).
- `agents/skills.ts` + `proactive-skills.ts:6` orchestration skill name `pi-subagents`.

**Safest seams for Phase 1 (generic thresholds + dynamic catalog, no hardcoded names):**
1. **Catalog seam**: `handleList` (`agent-management.ts:675`) — already fully dynamic, ceiling-aware, splits executable/restricted; add generic threshold fields (e.g., read/write role, tools, context) to the line format here.
2. **Contract seam**: `tool-description.ts` — guarded by `test/unit/tool-description.test.ts:31` ("free of hardcoded builtin agent names"); new wording must keep that invariant and pass its regexes.
3. **Role seam**: `agent.acceptanceRole` (`read-only`/`writer`, KNOWN_FIELDS `agent-serializer.ts:4-37`) already overrides name heuristics (`acceptance.ts:89`) — the generic read/write mechanism exists; migrate `task-intent.ts`/`acceptance.ts` name regexes to attributes (`acceptanceRole`, `completionGuard`, `tools`, `defaultContext`).
4. **Ceiling seam**: `capability-ceiling.ts` is fully generic and name-based; extend shape only with a version bump (`SUBAGENT_CAPABILITY_CEILING_VERSION=1`).
5. **Main-prompt seam**: `formatAgentsForPrompt` (`core/agents.ts:181`) — no tests exist; adding per-agent attributes (role/tools/read-write) to the `<available_agents>` XML is the lowest-risk main-side change.
6. **Boundary seam**: `subagent-prompt-runtime.ts` always-visible child instructions — generic already.
7. **Schema seam**: `extension/schemas.ts` — new model-visible params must go through `keepTopLevelParameterDescriptions`.
8. **Frontmatter seam**: new agent fields must be added to `KNOWN_FIELDS` or `update`/`serialize` round-trips drop them.

**Compatibility risks (severity: blocker/high/medium):**
- **high** — Changing `task-intent`/`acceptance` name heuristics to attribute-based silently changes inferred acceptance for the 6 builtin agents (e.g., `commentator` currently infers `attested` read-only). Preserve via `acceptanceRole: read-only` in builtin frontmatter or keep a name→attribute mapping table sourced from the catalog.
- **high** — `tool-description.test.ts:31-90` and `:260` pin exact description text; edits must satisfy all regexes (both full and compact, plus registration via subprocess).
- **medium** — `handleModels` and `models` action are builtin-only (`BUILTIN_AGENT_NAMES`); a fully generic catalog must either extend it or keep the builtin restriction documented.
- **medium** — `formatAgentsForPrompt`/`formatSkillsForPrompt` vanish from the main prompt when `read` is not active (`system-prompt.ts:96-97,141-142`); "always-visible" catalog must not rely on that gate.
- **medium** — parent tool description (`extension/index.ts`) and child-safe description (`fanout-child.ts`) diverge; an "always-visible" contract needs both updated consistently.
- **medium** — `delegation.ts` protocol v1/v2 is the extension-to-extension contract (`SUBAGENT_DELEGATION_PROTOCOL_VERSION=1`, `_V2=2`); adding fields is versioned, v2 is foreground-only, not a sandbox.
- **low** — `agent-scope.ts` `resolveExecutionAgentScope` defaults unknown scope to `"both"`.
- **low** — `pi-args.ts` `TASK_ARG_LIMIT=8000` and `MAX_LAUNCH_RESOLVED_EXTENSION_IDS=32` bound child launch surface.

**Test seams:**
- Extension unit tests (node:test): `test/unit/tool-description.test.ts` (description modes + no-hardcoded-names), `task-intent.test.ts` (`:51` research/commentator read-only), `acceptance.test.ts`, `agent-management.test.ts` (`:45` list shadowing, `:60` get effective detail, `:711` delegate defaults), `capability-ceiling.test.ts` / `capability-ceiling-agent-allowlist.test.ts` / `capability-ceiling-pi-args.test.ts`, `pi-args.test.ts`, `delegation-api.test.ts`, `prompt-template-bridge.test.ts`, `agent-overrides.test.ts`, `agent-frontmatter.test.ts`, `agent-selection.test.ts`, `agent-scope.test.ts`, `agent-disabled.test.ts`, `agent-eject-disable.test.ts`, `proactive-skills.test.ts`, `schemas.test.ts`, `index-child-registration.test.ts` (child-safe tool), `subagent-prompt-runtime.test.ts` (boundary), `skills-fallback.test.ts`, `spawn-budget.test.ts`, `tool-budget.test.ts`.
- Runner: `src/extensions/pi-subagents/package.json` — `test:unit` = `node --experimental-strip-types --test test/unit/*.test.ts`.
- Main repo: no tests exist for `buildSystemPrompt`/`formatSkillsForPrompt`/`formatAgentsForPrompt` — **gap**; nearest patterns: `src/core/agent-session-skill-block.test.ts`, `src/core/agent-session-auto-handoff.test.ts` (auto-handoff thresholds, not delegation). Repo runner: vitest (`vitest.config.ts`, offline `PI_OFFLINE=1`).

## Start Here

1. `src/extensions/pi-subagents/src/extension/tool-description.ts` + its test `src/extensions/pi-subagents/test/unit/tool-description.test.ts:31` — the always-visible contract and its no-hardcoded-names invariant.
2. `src/extensions/pi-subagents/src/agents/agent-management.ts:675` (`handleList`) + `agents/agents.ts` (`discoverAgentsAll:1722`, `resolveAgentName:492`, `BUILTIN_AGENT_NAMES:37`) — the dynamic catalog and resolution.
3. `src/extensions/pi-subagents/src/runs/shared/acceptance.ts:80-125` + `runs/shared/task-intent.ts:140-165` — read/write role inference (the hardcoded-name hotspots to generalize).
4. `src/core/agents.ts:181` (`formatAgentsForPrompt`) + `src/core/system-prompt.ts:31` — main-side catalog insertion point (currently untested).

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Returned concrete findings with exact paths, line numbers, and severity for: main system-prompt assembly (src/core/system-prompt.ts:31, agent-session.ts:1084, resource-loader.ts:780, core/agents.ts:181, core/skills.ts:~330), skill discovery/loading (extension agents/skills.ts:566-741, execution.ts:~1331-1390), pi-subagents tool registration and description modes (extension/index.ts:447-459, tool-description.ts, fanout-child.ts:161-185, subagent-prompt-runtime.ts:48-56/175/436), action:list discovery/output/details (agent-management.ts:675/588/793/1152, SUBAGENT_ACTIONS at shared/types.ts:1729, subagent-executor.ts:4064-4078), agent overrides/aliases/ceilings (agents.ts:477/492/1047/1171/1279, capability-ceiling.ts, pi-args.ts:~190-240, spawn-budget.ts), schemas (extension/schemas.ts, agent-serializer.ts KNOWN_FIELDS:4), and test seams (tool-description.test.ts:31, task-intent.test.ts:51, agent-management.test.ts:45, capability-ceiling*.test.ts, pi-args.test.ts, delegation-api.test.ts, prompt-template-bridge.test.ts). 11 hardcoded-builtin-name seams enumerated with severity, plus 8 safe seams for generic delegation thresholds and dynamic catalog exposure."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "npm run test:unit (src/extensions/pi-subagents)",
      "result": "not-run",
      "summary": "No shell/exec tool available in this recon session; verification performed by static inspection of test files and runners (package.json scripts, node:test usage, vitest.config.ts)."
    },
    {
      "command": "npx vitest run (repo)",
      "result": "not-run",
      "summary": "No shell/exec tool available; vitest.config.ts inspected (offline PI_OFFLINE=1, globals, 30s timeout)."
    }
  ],
  "validationOutput": [
    "tool-description.test.ts:31 asserts the no-hardcoded-builtin-names invariant (scout/worker/planner absent) and full/compact/custom registration via subprocess (line 260) - the key regression guard for any new always-visible contract text.",
    "task-intent.test.ts:51 and acceptance.ts:80-125 confirm read/write role inference currently keys off builtin names (builder/architect/commentator/explorer/recapper/researcher) with acceptanceRole as the generic override.",
    "capability-ceiling.ts + pi-args.ts resolvePiLaunchToolPlan show the fully generic name-based ceiling mechanism (allowedAgents/allowedTools/denyExtensions, versioned env propagation) that Phase 1 can extend.",
    "No tests exist for core buildSystemPrompt/formatSkillsForPrompt/formatAgentsForPrompt - gap identified for main-side catalog changes."
  ],
  "residualRisks": [
    "Tests were not executed (no exec tool); findings are static-inspection based. The two pinned test files (tool-description.test.ts, task-intent.test.ts) should be run before and after Phase 1 edits.",
    "task-intent/acceptance name heuristics changes can silently alter inferred acceptance for the 6 builtin agents; mitigation: acceptanceRole in builtin frontmatter or a catalog-sourced role table.",
    "handleModels/models action is builtin-name-restricted (BUILTIN_AGENT_NAMES); fully generic catalog exposure must decide whether to extend or keep the restriction.",
    "Main prompt agents/skills sections are gated on the read tool being active (system-prompt.ts:96-97,141-142); an always-visible catalog must not depend on that gate.",
    "Parent vs child-safe subagent tool descriptions diverge (extension/index.ts vs fanout-child.ts); both need consistent Phase 1 contract updates.",
    "Delegation protocol v1/v2 (api/delegation.ts) is the extension-to-extension contract; any new request/response fields require versioning discipline (v2 exists and is foreground-only)."
  ],
  "noStagedFiles": true,
  "diffSummary": "Read-only reconnaissance; no files changed. Produced behavioral-contract map for Phase 1 (always-visible delegation contract + dynamic agent catalog) with exact paths/lines, hardcoded-name seams, safe seams, compatibility risks, and test seams.",
  "reviewFindings": [
    "no blockers: read-only recon, no edits made",
    "high: runs/shared/task-intent.ts:142-160 - read/write role inference keyed on hardcoded builtin names (builder/architect/commentator/explorer/recapper/researcher); generic alternative already exists via agent.acceptanceRole (acceptance.ts:89)",
    "high: runs/shared/acceptance.ts:105-118 - read-only agent regex, \\bbuilder\\b, and review agent 'commentator' hardcoded in inferLevel",
    "medium: agents/proactive-skills.ts:7-9 - DEFAULT_PREFERRED_AGENT 'commentator' and FALLBACK_AGENT_ORDER hardcoded (falls back to first enabled agent)",
    "medium: agents/agents.ts:37-53 - BUILTIN_AGENT_NAMES exported and used by handleModels; defaultSystemPromptMode/defaultInheritProjectContext special-case name 'delegate'",
    "medium: profiles/profiles.ts:245-247, slash/prompt-workflows.ts:90/243, slash/delegation-adapters.ts:306 - builtin-name defaults for role tiers and prompt workflows",
    "low: extension/tool-description.ts:50-53 - eject/disable/enable/reset examples name 'commentator' (not covered by the no-hardcoded-names test which forbids scout/worker/planner only)",
    "gap: no tests for core system-prompt assembly (buildSystemPrompt/formatAgentsForPrompt/formatSkillsForPrompt) - new main-side catalog output is unprotected"
  ],
  "manualNotes": "Output path .pi-subagents/chain-runs/5ae046dc/parallel-0/1-explorer/recon/phase-1-behavioral-contract.md is authoritative; artifact returned inline for runtime persistence. Note: an accidental no-op intercom message was sent to session 019fccda during recon (message: '(no action needed — just a local recon note)'); it carries no findings and can be ignored. No further intercom/supervisor contact is required for this task."
}
```

⧉ copy assistant: /cp 400ef0