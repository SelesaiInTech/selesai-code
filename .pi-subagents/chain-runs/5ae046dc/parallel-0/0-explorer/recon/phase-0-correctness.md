All evidence gathered. Here is the complete recon artifact.

# Code Context

Read-only recon for Phase 0 (correctness cleanup) of the specialized-main-agent delegation over the `pi-subagents` port in the Selesai fork. Scope inspected: builtin agent definitions (`src/extensions/pi-subagents/agents/*.md`), bundled skill (`skills/pi-subagents/SKILL.md` + 4 references), discovery/frontmatter code and tests, packaging copies (`dist/extensions/pi-subagents/**`), user settings, and runtime tool-planning code. No files were edited.

## Relevant Files

- `src/extensions/pi-subagents/agents/{architect,builder,commentator,explorer,recapper,researcher}.md` — the six builtin agents. Loaded as source of truth at runtime from `BUILTIN_AGENTS_DIR` (`src/agents/agents.ts:1640-1641`, resolves to `…/pi-subagents/agents`). `BUILTIN_AGENT_NAMES` (`agents.ts:43-49`) matches exactly these six files.
- `src/extensions/pi-subagents/skills/pi-subagents/SKILL.md` + `references/{prompting-and-roles,execution-controls,management-authoring-rpc,constraints-and-recipes}.md` — parent-only orchestration skill shipped with the package.
- `src/extensions/pi-subagents/src/agents/agents.ts`, `frontmatter.ts`, `agent-serializer.ts`, `agent-management.ts` — frontmatter parsing/discovery and the valid key/value grammar.
- `src/extensions/pi-subagents/src/runs/shared/pi-args.ts`, `tool-availability.ts`, `mcp-direct-tool-allowlist.ts`, `subagent-prompt-runtime.ts`, `src/intercom/intercom-bridge.ts`, `native-supervisor-channel.ts` — how child tool allowlists, MCP tools, and `contact_supervisor` are resolved/injected; missing tools are **fatal** (`execution.ts:1060`, `subagent-runner.ts:1334-1336`).
- `src/extensions/pi-subagents/src/runs/shared/acceptance.ts` — `acceptanceRole` only affects acceptance inference, never tool grants.
- `dist/extensions/pi-subagents/**` — packaging copy; byte-copied from `src/extensions/pi-subagents/**` by root `package.json:54` (`copy-assets`: `shx cp -r src/extensions/. dist/extensions/`); ships in the published package (`files: ["dist"]`). Verified identical to `src` for the agent files and skill references spot-checked — all defects below propagate to `dist`.
- Tests: `src/extensions/pi-subagents/test/unit/agent-frontmatter.test.ts`, `config-dir-runtime.test.ts`, `agent-selection.test.ts`, `agent-overrides.test.ts`, `skills-fallback.test.ts`.

## Current Behavior

- Config dir is `.selesai` (`shared/utils.ts:16` `DEFAULT_CONFIG_DIR_NAME = ".selesai"`; root `package.json:28` `piConfig.configDir: ".selesai"`; pinned by `test/unit/config-dir-runtime.test.ts:24-25`). Project agents live under `.selesai/agents`, chains under `.selesai/chains`; legacy `.agents/**` is still read (`agents.ts:1604-1608`). **`.pi/` is never read at runtime.**
- `defaultContext` is per-agent frontmatter: `fork` only for architect + recapper; fresh for builder/commentator/explorer/researcher (`agents.ts:1702-1705`; pinned by `agent-frontmatter.test.ts:360-369` which asserts **only** architect and recapper fork).
- `tools` is a strict child allowlist. `mcp:`-prefixed names route to `mcpDirectTools`; bare names go into the builtin allowlist and are checked against `PI_CORE_CHILD_TOOLS = {bash, edit, find, grep, ls, read, write}` plus tools actually registered in the child (`tool-availability.ts:38-41`). A clean-exit child with missing required tools fails the run.
- `contact_supervisor` is auto-injected into child tools only when the intercom bridge is active (`intercom-bridge.ts:165-172`); the tool is registered child-side only when supervisor metadata env vars are set (`native-supervisor-channel.ts:290-291`, gated by `pi-args.ts:389-394` on `data.intercomBridge.active ? orchestratorTarget : undefined` at `subagent-executor.ts:2393/3153/3482`).
- All six builtin agents reference user-home skills (`ponytail`, `caveman`, `planger`, `implanger`), which exist under `~/.selesai/agent/skills/` but are **not shipped in the package**; missing skills warn but do not fail (`agent-management.ts:64-73`).
- User-scoped model config is intentional: `~/.selesai/agent/settings.json` sets `subagents.defaultModel` + `agentOverrides` model for all six agents (no tool/context overrides).

## Reuse / Risks

- Fixes to the role tables/context claims must be mirrored to `dist/` (regenerate via `npm run build` / `copy-assets`), or the published package stays stale.
- Any change to builtin `tools:` must respect the strict-allowlist + fatal-diagnostic mechanics; builder's explicit `contact_supervisor` is the risky one (see findings).
- Do not "fix" the user skills coupling or `~/.selesai/agent/settings.json` — intentional user-scoped config.

## Start Here

- `src/extensions/pi-subagents/skills/pi-subagents/references/prompting-and-roles.md:176-192` — most corrupted section (duplicated/missing agents).
- Then `src/extensions/pi-subagents/agents/*.md` frontmatter (lines cited below) as the source of truth.

---

# Findings (definite defects)

## A. Mangled role/naming statements (merge artifacts) — HIGH

`src/extensions/pi-subagents/skills/pi-subagents/references/prompting-and-roles.md`
- `:14` "Recon and planning: use `explorer` or `explorer`, then `architect`" — duplicated `explorer`.
- `:176-190` "Builtin Agents" table lists `explorer` twice (`:178`, `:182`), `builder` twice (`:180`, `:186`), `commentator` three times (`:181`, `:188`, `:190`); **`recapper` is missing entirely**; `:190` "`commentator` | Claude Code-compatible alias for `commentator`" is a nonsense self-alias row.
- `:192` "Builtin `builder` and `builder` use strict tool allowlists…" — duplicated `builder`.
- `:269` model tiering "for example on `builder`, `commentator`, `builder`" — duplicated `builder`.

`src/extensions/pi-subagents/README.md`
- `:105-114` "Builtin agents in plain English": `explorer` twice (`:107`, `:112`), `commentator` twice (`:111`, `:113`), `builder` twice (`:110`, `:114`); `recapper` missing.
- `:116` rule of thumb ends "…`builder` to implement, `commentator` to check, and `commentator` when the decision itself feels risky" — `commentator` twice, no `recapper`.
- `:407` "Packaged `architect`, `builder`, `commentator`, and `commentator` default to forked context" — duplicated `commentator` (plus false claim, see B).

Identical copies in `dist/extensions/pi-subagents/skills/pi-subagents/references/prompting-and-roles.md` and `dist/extensions/pi-subagents/README.md:407`.

## B. Context-default contradictions (docs vs builtin frontmatter) — HIGH

Actual frontmatter (source of truth): `builder.md:11` `defaultContext: fresh`; `commentator.md:9` `defaultContext: fresh`; `explorer.md:9` fresh; `researcher.md:9` fresh; fork only on `architect.md:10` and `recapper.md:9`.

Docs that claim builder/commentator default to **forked** context:
- `constraints-and-recipes.md:8-9` "Packaged `architect`, `builder`, `commentator`, and `commentator` default to forked context…" (also duplicated commentator)
- `constraints-and-recipes.md:106` "In particular, packaged `architect`, `builder`, `commentator`, and `commentator` default to forked context."
- `constraints-and-recipes.md:141` "Packaged `builder` defaults to forked context; pass `context: "fresh"` only when you intentionally want a fresh child."
- `execution-controls.md:363` "commentator defaults to forked context" and `:369` "builder defaults to forked context"; `:371-373` "`commentator` is not a fresh-context commentator… It is a forked advisory thread that inherits the parent session history."
- `README.md:407` (as above).

Test seam pinning the truth: `test/unit/agent-frontmatter.test.ts:360-369` ("loads packaged architect and recapper with fork defaultContext"). Also `schemas.ts` (`context` enum `["fresh","fork"]` with "agents without defaultContext: 'fork' run fresh").

## C. Tool-capability contradictions — MEDIUM (latent launch failures)

1. `prompting-and-roles.md:181` — commentator "tools include edit/write when a fix pass is explicit": **false**. `commentator.md:5` allowlist is `read, grep, find, ls, bash`; nothing adds edit/write (tool plan is purely frontmatter-derived; `acceptanceRole` only drives acceptance inference, `acceptance.ts:88-103`).
2. `prompting-and-roles.md:192` / README child-boundary text — "builtin … use strict tool allowlists and do not inherit ambient parent extension tools": only true when `extensions` is set; `pi-args.ts:213` keeps ambient extension discovery when `extensions` is undefined (all six builtins). Confusing/stale phrasing.
3. `builder.md:7` includes `contact_supervisor` in the strict allowlist. The runtime auto-injects it only when the bridge is active (`intercom-bridge.ts:165-172`); when inactive (`intercomBridge: "off"`, or `"fork-only"` + builder's own fresh default), the tool is not registered child-side (`native-supervisor-channel.ts:290-291`, `pi-args.ts:389-394`) → missing required tool → **builder launches fail** (`tool-availability.ts:59-67`; `execution.ts:1060`; `subagent-runner.ts:1334-1336`). The body (`builder.md:17`) also instructs use of `contact_supervisor`. Redundant when active, fatal when inactive.
4. `researcher.md:4` lists `grep_app_search, grep_app_fetch` as bare names — violates the documented/tested `mcp:` prefix convention (`agents.ts:1594-1598` `splitToolList`; test `agent-frontmatter.test.ts:198-239, 247-256` pins `mcp:` → `mcpDirectTools`). Bare names go into the strict builtin allowlist checked against `PI_CORE_CHILD_TOOLS` + child registry (`tool-availability.ts:38-41`), so researcher launches fail unless grep.app tools are ambiently registered. `web_explore` is registered by the separate `src/extensions/pi-web-agent/src/extension.ts:104` extension, not core — also not guaranteed in child sessions.
5. `architect.md:38` "clarify with the user (using questions tool)" — the bundled tool is named `question` (singular, `src/extensions/question/index.ts:509`), and architect's allowlist (`architect.md:4`) has no such tool and no `extensions`/`subagentOnlyExtensions` to load it. Wrong name + unavailable tool.

## D. Output-contract contradictions — HIGH

- `prompting-and-roles.md:182` explorer "Writes `context.md` handoff material", `:183` architect "Writes `plan.md`", `:187` researcher "Writes `research.md`" — contradicts the agent bodies: `explorer.md:13` "Do not edit project files, write output files, or launch subagents"; `architect.md:23` "Return the complete plan in your final response; do not write an output file"; `researcher.md:13` same read-only contract. (The runtime persists the final response only when an `output` path is configured — `execution-controls.md:56-58` itself documents "Read-only children return the complete artifact in their final response and the runtime persists it.")
- `recapper` has no output-contract row anywhere in the role tables.

## E. Stale path/naming statements — HIGH

`execution-controls.md` "Discovery and Scope Rules":
- `:9` "`.pi/agents/**/*.md` — canonical project scope"
- `:10` "…`.pi/agents/` wins on conflicts"
- `:14` "`.pi/chains/**/*.chain.md` and `.pi/chains/**/*.chain.json` — project scope"
- `:21-22` "Project settings resolve from the nearest parent directory containing `.pi` or `.agents`"

Runtime truth: config dir is `.selesai` (`utils.ts:16`, root `package.json:28`), never `.pi`; `:23` in the same file already says `.selesai/settings.json` — self-contradictory. Test seam: `config-dir-runtime.test.ts:23-31`.

# Intentional user-scoped config / skills (NOT defects)

- `~/.selesai/agent/settings.json:42-66` — `subagents.defaultModel` + per-agent `agentOverrides` models for all six agents. Intentional; leave alone.
- `skill: ponytail, caveman, planger|implanger` in agent frontmatter — resolves to user-home skills (`~/.selesai/agent/skills/{planger,implanger,ponytail,caveman}` exist). Intentional for this deployment, but a portability note: these are not shipped in the package, and on other machines the agents run without them (missing skills warn only, `agent-management.ts:64-73`).
- `.pi-subagents/` project artifact dir (`.pi-subagents/`, `types.ts:1631`) is correct and unrelated to the stale `.pi/agents` claims.

# Current dirty diff caveat

No shell/exec tool was available, so `git status`/`git diff` could not be run. HEAD is `54eaf1e8` ("fix: stabilize copy hashes and make artifacts opt-in"). The `src/` vs `dist/` copies are identical, so no packaging drift. The mangled role tables + context claims are consistent with recent history ("chore(agents): streamline role prompts" e115f89 and the v0.37 port 82d0be69) where agent frontmatter was rewritten without updating the bundled skill docs — the next agent should run `git diff` to confirm exactly which files are uncommitted.

# Residual risks

- Deployment-dependent latent failures: builder (contact_supervisor, bridge inactive) and researcher (bare MCP names / web_explore not ambient) may fail at launch depending on bridge mode and MCP/extension config.
- Fixing docs alone won't change runtime behavior; if the team intends builder/commentator to be fork-based or commentators to get edit/write on fix passes, the *frontmatter* must change too (with `agent-frontmatter.test.ts:360-369` updated).
- No test currently validates the bundled skill role tables against the six builtin agents — the gap Phase 0 should close.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete findings with exact paths and line numbers across 5 defect classes: (A) mangled role tables prompting-and-roles.md:14,176-192,269 + README.md:105-116,407 with recapper missing and duplicated explorer/builder/commentator rows; (B) context-default contradictions constraints-and-recipes.md:8-9,106,141 + execution-controls.md:363,369 vs builder.md:11/commentator.md:9 defaultContext: fresh; (C) tool-capability contradictions prompting-and-roles.md:181 (commentator edit/write), builder.md:7 (contact_supervisor bridge dependency), researcher.md:4 (bare MCP names, web_explore from pi-web-agent), architect.md:38 (questions tool vs registered 'question'); (D) output-contract contradictions prompting-and-roles.md:182-183,187 vs explorer.md:13/architect.md:23/researcher.md:13; (E) stale .pi/ path claims execution-controls.md:9-10,14,21-22 vs runtime .selesai (utils.ts:16, package.json:28). All verified against runtime code (tool-availability.ts, pi-args.ts, intercom-bridge.ts, agents.ts) and tests (agent-frontmatter.test.ts:360-369, config-dir-runtime.test.ts:24-25)."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "git status / git diff (dirty diff verification)",
      "result": "not-run",
      "summary": "No shell/exec tool available in this subagent; HEAD is 54eaf1e8 on main. Dirty-diff evidence instead inferred by comparing on-disk copies (src == dist for agents + skill refs) and git log entries (e115f89 'chore(agents): streamline role prompts', 82d0be69 v0.37 port)."
    },
    {
      "command": "read/grep/find inspection of agents, skill refs, runtime tool-planning code, tests, dist copies, user settings",
      "result": "passed",
      "summary": "All findings above verified by direct file reads and targeted greps with line numbers."
    }
  ],
  "validationOutput": [
    "BUILTIN_AGENT_NAMES (agents.ts:43-49) = exactly the six agents/*.md files; docs' extra/duplicated role rows have no backing builtin.",
    "PI_CORE_CHILD_TOOLS = {bash, edit, find, grep, ls, read, write} (tool-availability.ts:38); missing required child tools are fatal (execution.ts:1060, subagent-runner.ts:1334-1336).",
    "contact_supervisor auto-injected only when intercom bridge active (intercom-bridge.ts:165-172; pi-args.ts:389-394; subagent-executor.ts:2393).",
    "dist/extensions/pi-subagents/** is a byte copy of src (root package.json:54 copy-assets); verified identical for architect.md, builder.md, prompting-and-roles.md, constraints-and-recipes.md, README.md:407.",
    "config dir pinned to .selesai (config-dir-runtime.test.ts:24-25).",
    "user settings.json:42-66 agentOverrides are model-only; skills ponytail/caveman/planger/implanger exist under ~/.selesai/agent/skills/."
  ],
  "residualRisks": [
    "Latent launch failures: builder with contact_supervisor when intercomBridge is off/fork-only+fresh; researcher with bare grep_app_* names and web_explore when MCP/pi-web-agent not ambient in child sessions.",
    "Context-default and tool statements may reflect intended design rather than accidental drift; runtime frontmatter and test agent-frontmatter.test.ts:360-369 are the source of truth and pin fork to architect+recapper only.",
    "Builtin agents depend on user-home skills (ponytail/caveman/planger/implanger) not shipped in the package; other machines get warnings only.",
    "git dirty-diff state unconfirmed (no shell); run git status/diff before editing.",
    "No test guards the skill-doc role tables against the builtin agents; add one in Phase 0."
  ],
  "noStagedFiles": true,
  "diffSummary": "Read-only recon; no files changed. Identified 5 classes of stale/contradictory statements in pi-subagents builtin agents docs (mangled role tables, forked-context claims, tool-capability claims, output-contract claims, .pi/ path claims), all propagated to dist packaging copies.",
  "reviewFindings": [
    "high: skills/pi-subagents/references/prompting-and-roles.md:14,176-192,269 - duplicated explorer/builder/commentator rows, nonsense self-alias row, recapper missing (merge artifact)",
    "high: README.md:105-116,407 (and dist copies) - same duplication + false 'commentator/commentator' fork-default claim",
    "high: constraints-and-recipes.md:8-9,106,141 + execution-controls.md:363,369,371-373 - claim builder/commentator default to forked context; actual frontmatter is fresh (builder.md:11, commentator.md:9); only architect.md:10 and recapper.md:9 fork",
    "high: prompting-and-roles.md:182-183,187 - explorer/architect/researcher 'Writes *.md' contradicts agent bodies (explorer.md:13, architect.md:23, researcher.md:13 do-not-write contracts)",
    "high: execution-controls.md:9-10,14,21-22 - .pi/agents, .pi/chains claims; runtime uses .selesai (utils.ts:16, package.json:28, config-dir-runtime.test.ts:24-25)",
    "medium: prompting-and-roles.md:181 - commentator 'tools include edit/write when a fix pass is explicit' is false (commentator.md:5; acceptanceRole never grants tools)",
    "medium: builder.md:7,17 - contact_supervisor in strict allowlist is bridge-dependent; inactive bridge makes builder launches fail (intercom-bridge.ts:165-172, tool-availability.ts:38-41, execution.ts:1060)",
    "medium: researcher.md:4 - bare grep_app_search/grep_app_fetch violate mcp: prefix convention (agent-frontmatter.test.ts:247-256); web_explore comes from pi-web-agent extension (extension.ts:104), not core",
    "low: architect.md:38 - 'questions tool' wrong name (registered tool is 'question', src/extensions/question/index.ts:509) and not in architect allowlist",
    "note: intentional user config (settings.json agentOverrides models, user-home skills ponytail/caveman/planger/implanger) - do not treat as defects"
  ],
  "manualNotes": "No write-capable tool was available, so no file was created beyond this response; the runtime persists it to the configured path. Next agent should: (1) run git status/diff to confirm dirty files; (2) fix src/ copies and regenerate dist via npm run build/copy-assets; (3) decide whether frontmatter or docs are authoritative for builder/commentator context and commentator edit/write, updating agent-frontmatter.test.ts:360-369 if frontmatter changes."
}
```

⧉ copy assistant: /cp 73a34b