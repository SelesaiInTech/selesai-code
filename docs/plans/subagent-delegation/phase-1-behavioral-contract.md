# Phase 1 Plan: Always-Visible Delegation Contract and Dynamic Agent Catalog

## Objective

Make delegation behavior reliable through prompt/catalog contracts, without runtime enforcement changes:

- Keep tiny, targeted reads and simple answers with the parent.
- Delegate broad local investigation, external research, and mutation/implementation work when a capable configured agent exists.
- Require runtime catalog discovery before selection.
- Keep policy generic: static tool text must not name bundled agents.
- Expose the same dynamic catalog as concise human text and versioned machine metadata.
- Preserve capability ceilings, aliases, overrides, child boundaries, and existing execution semantics.

## Discovery completed

Verified ownership and seams:

- Main prompt assembly: `src/core/system-prompt.ts`, invoked by `src/core/agent-session.ts:_rebuildSystemPrompt`.
- Parent tool registration: `src/extensions/pi-subagents/src/extension/index.ts`.
- Full/compact/custom tool descriptions: `src/extensions/pi-subagents/src/extension/tool-description.ts`.
- Child-safe fanout tool: `src/extensions/pi-subagents/src/extension/fanout-child.ts`.
- Runtime discovery/listing: `src/extensions/pi-subagents/src/agents/agent-management.ts:handleList`.
- Dynamic agent model: `src/extensions/pi-subagents/src/agents/agents.ts:AgentConfig`.
- Result metadata: `src/extensions/pi-subagents/src/shared/types.ts:Details`.
- Parent-only skill: `src/extensions/pi-subagents/skills/pi-subagents/SKILL.md`.
- Bundled agent descriptions: `src/extensions/pi-subagents/agents/*.md`.
- Existing test seams: core Vitest tests, extension unit tests, and faux-provider E2E tests.

## Phase 0 dependency

Do not begin Phase 1 until Phase 0 is merged or rebased into the worktree.

Phase 1 relies on Phase 0 to establish truthful bundled-agent documentation and capabilities, including:

- Correct `.selesai` discovery paths.
- Correct fresh/fork defaults.
- Correct child tool declarations and extension/MCP availability.
- Correct role tables and output contracts.
- Regenerated `dist/extensions/pi-subagents/**` assets.

Before editing, run `git status --short` and inspect the Phase 0 diff. Resolve conflicts in bundled agent frontmatter before adding the Phase 1 descriptions and `acceptanceRole` fields below.

---

## Policy ownership contract

| Surface | Owner | Required content | Must not own |
|---|---|---|---|
| Selesai main guidance | `buildSystemPrompt` | Generic routing threshold: retain tiny targeted reads locally; delegate broad local, external, or mutation work when delegation is available | Agent names, catalog snapshots, enforcement |
| Mandatory parent tool guidance | Parent `subagent` tool registration and mandatory description block | Catalog-first selection, executable-only requirement, parent decision/writer responsibility | Builtin agent names or role-name routing |
| Parent-only skill | `skills/pi-subagents/SKILL.md` | Detailed orchestration procedure and writer/reviewer workflow | Child behavior or tool authorization |
| Agent descriptions | Bundled/custom agent frontmatter `description` | What each agent is best for; custom agents remain dynamic | Global routing policy |
| `action:list` human output | `handleList` | Current executable/restricted state, source, role, context, aliases, declared tools | Full system prompts or stale static agent tables |
| `action:list` machine metadata | `Details.catalog` | Versioned structured equivalent of the visible catalog | Authorization changes or a new request parameter |

`action:list` is the runtime source of truth. Prompt text tells the model to call it; it must not embed a copied catalog.

---

## Ordered implementation tasks

### Task 1 — Make active-tool prompt guidance survive both default and custom system prompts

#### Discovery
Inspect:

- `src/core/system-prompt.ts:buildSystemPrompt`
- `src/core/agent-session.ts:_rebuildSystemPrompt`
- `src/core/extensions/types.ts:ToolDefinition`
- Existing tests under `src/core/*.test.ts`

Confirm that `promptGuidelines` are collected from active tools but currently appear only in the default prompt path.

#### Identification
Modify:

- `src/core/system-prompt.ts`
- Add `src/core/system-prompt.test.ts`

Do not modify resource loading, skill formatting, `formatAgentsForPrompt`, or tool activation rules. The existing agent XML is read-tool-gated and is not a capability-ceiling-aware delegation catalog.

#### Change
1. Add one generic, conditional delegation-routing guideline to the core prompt construction:
   - It must say “when a delegation/subagent tool is available,” so sessions without the extension are unaffected.
   - It must direct the parent to keep tiny targeted reads/simple answers local.
   - It must direct broad local investigation, external research, and mutation/implementation work to a capable delegated agent.
   - It must direct catalog/list inspection before selection.
   - It must retain parent decision authority and one-writer safety.

2. Render active `promptGuidelines` in the custom-prompt branch as well as the default-prompt branch.
   - Preserve the caller’s custom prompt text unchanged.
   - Append a clearly delimited guidelines section only when non-empty guidelines exist.
   - Use the same normalized/deduplicated guidance collected by `_rebuildSystemPrompt`.
   - Do not require `read` to render these active-tool guidelines.

3. Keep existing default tool snippets, skills, agents XML, project context, append prompt behavior, and current-working-directory suffix unchanged.

#### Verification
Success:
- Default prompt contains the generic delegation threshold.
- A custom system prompt with an active tool guideline includes both the original custom prompt and the guideline.
- Empty `promptGuidelines` does not add an empty section.

Regression:
- Skills and generic agents remain gated by `read`.
- Custom prompt still replaces the default prose.
- No tool is made active by prompt construction.

Failure:
- A custom prompt must not silently lose mandatory active-tool guidance.

---

### Task 2 — Add generic mandatory parent-tool delegation guidance and remove static bundled names

#### Discovery
Inspect:

- `src/extensions/pi-subagents/src/extension/tool-description.ts`
- `src/extensions/pi-subagents/src/extension/index.ts`
- `src/extensions/pi-subagents/src/extension/fanout-child.ts`
- `src/extensions/pi-subagents/test/unit/tool-description.test.ts`
- `src/extensions/pi-subagents/test/unit/index-child-registration.test.ts`

#### Identification
Modify:

- `src/extensions/pi-subagents/src/extension/tool-description.ts`
- `src/extensions/pi-subagents/src/extension/index.ts`
- `src/extensions/pi-subagents/test/unit/tool-description.test.ts`
- `src/extensions/pi-subagents/test/unit/index-child-registration.test.ts` only if needed to assert parent-vs-child registration behavior.

Do not modify schemas, execution requests, delegation protocol versions, capability ceilings, or child runtime boundaries.

#### Change
1. Define a shared exported parent-routing guidance constant in `tool-description.ts`.
   - It must be generic and contain no bundled agent names.
   - It must require `{ action: "list" }` before execution.
   - It must require selecting only executable entries using current role/context/tool metadata.
   - It must state the tiny-local-read versus broad/external/mutation delegation threshold.
   - It must state that the parent remains decision-maker and normally the sole writer.

2. Include that guidance in:
   - `FULL_SUBAGENT_TOOL_DESCRIPTION`.
   - `COMPACT_SUBAGENT_TOOL_DESCRIPTION`.
   - The mandatory block appended by `withMandatorySafetyGuidance`, so custom descriptions cannot remove it.

3. In `extension/index.ts`, attach the shared routing text as `promptGuidelines` on the parent `subagent` `ToolDefinition`.
   - This is the always-visible active-tool path delivered by Task 1.
   - Do not attach it to child-safe fanout registration.

4. Replace existing hardcoded bundled-agent examples in static parent tool prose—currently eject/disable/enable/reset examples—with `"agent-name"` placeholders.
   - Strengthen the invariant: full, compact, and custom-rendered static descriptions must contain none of the six bundled names.
   - Generic chain placeholders such as `"agent-a"` remain acceptable.

5. Keep `fanout-child.ts` intentionally narrower:
   - It may continue to describe its allowed child-safe actions.
   - Do not give ordinary children the parent routing contract or imply that all children can orchestrate.

#### Verification
Success:
- Full, compact, and custom descriptions contain catalog-first routing and the local-vs-delegated threshold.
- Registered parent tool exposes `promptGuidelines`.
- Static descriptions contain none of `architect`, `builder`, `commentator`, `explorer`, `recapper`, or `researcher`.
- Mandatory guidance remains last for custom descriptions.

Regression:
- Full/compact/custom fallback behavior remains unchanged.
- Safety block still cannot be overridden by custom prose.
- Child-safe fanout still blocks mutating management actions and remains distinct from parent registration.

Failure:
- Invalid custom description mode still falls back to full mode.
- A custom description cannot omit mandatory routing/safety guidance.

---

### Task 3 — Publish a stronger dynamic catalog in human output and machine metadata

#### Discovery
Inspect:

- `src/extensions/pi-subagents/src/agents/agent-management.ts:handleList`
- `formatAgentDetail`
- `src/extensions/pi-subagents/src/agents/agents.ts:AgentConfig`
- `src/extensions/pi-subagents/src/shared/types.ts:Details`
- `src/extensions/pi-subagents/test/unit/agent-management.test.ts`
- `src/extensions/pi-subagents/test/unit/capability-ceiling-agent-allowlist.test.ts`

#### Identification
Modify:

- `src/extensions/pi-subagents/src/agents/agent-management.ts`
- `src/extensions/pi-subagents/src/shared/types.ts`
- `src/extensions/pi-subagents/test/unit/agent-management.test.ts`
- `src/extensions/pi-subagents/test/unit/capability-ceiling-agent-allowlist.test.ts`

Do not change:

- Agent discovery precedence.
- Alias resolution.
- Capability ceiling parsing/version/env propagation.
- `models` action’s builtin-only behavior.
- Execution preflight or authorization.

#### Change
1. Add optional versioned catalog metadata to `Details`, for example:
   - `catalog.version: 1`
   - `catalog.agents`
   - `catalog.chains`
   - `catalog.capabilityCeilingSources` when applicable.

2. Define catalog-agent metadata from the already resolved, visible runtime agents:
   - `name` — canonical runtime name.
   - `source` — builtin/package/user/project.
   - `description`.
   - `executable` — `true` for allowed visible agents; `false` for ceiling-restricted visible agents.
   - `restrictionSources` only when restricted.
   - `aliases` when present.
   - `defaultContext`, normalized to explicit `"fresh"` when unset.
   - `acceptanceRole` when declared.
   - Effective declared `tools`, combining normal tools and `mcp:`-prefixed direct MCP tools as already done in `formatAgentDetail`.

3. Define catalog-chain metadata from the currently listed chains:
   - `name`, `source`, `description`.
   - Do not expose full chain steps in list metadata; callers can use `get`.

4. Refactor the existing local “effective tools” formatting into one private helper if needed, so `formatAgentDetail`, human list text, and machine metadata cannot disagree.

5. Change `handleList` human output to make selection-relevant fields visible without needing `get`, using a stable compact line format such as:
   - executable/restricted status by section;
   - canonical name;
   - source;
   - role when declared;
   - normalized context;
   - aliases;
   - tools;
   - description.

6. Preserve current behavior:
   - Disabled agents remain absent.
   - Restricted agents remain visible but non-executable.
   - Scope filtering and shadowing remain unchanged.
   - Proactive recommendations and diagnostics remain after catalog sections.
   - `get` remains the full-detail path.

#### Verification
Success:
- A custom agent appears with its dynamic name, source, aliases, role, context, declared tools, and description in both text and `details.catalog`.
- A capability-ceiling-restricted agent appears as `executable: false` with restriction sources in metadata and remains in the restricted human section.
- A project override still shadows lower-priority entries.
- Chains appear in both human and machine catalog output.

Regression:
- Disabled agents do not leak into either catalog representation.
- Ceiling-restricted agents cannot be launched despite being visible.
- Existing text headings remain recognizable: `Executable agents:`, `Restricted agents`, and `Chains:`.

Failure:
- Invalid list scope behavior remains unchanged.
- Empty catalog still returns `(none)` text and valid `{ version: 1, agents: [], chains: [] }` metadata.

---

### Task 4 — Align parent-only skill and bundled agent descriptions with the generic catalog contract

#### Discovery
Inspect after Phase 0 merge:

- `src/extensions/pi-subagents/skills/pi-subagents/SKILL.md`
- `src/extensions/pi-subagents/agents/{architect,builder,commentator,explorer,recapper,researcher}.md`
- `src/extensions/pi-subagents/test/unit/agent-frontmatter.test.ts`

#### Identification
Modify:

- `src/extensions/pi-subagents/skills/pi-subagents/SKILL.md`
- `src/extensions/pi-subagents/agents/architect.md`
- `src/extensions/pi-subagents/agents/builder.md`
- `src/extensions/pi-subagents/agents/commentator.md`
- `src/extensions/pi-subagents/agents/explorer.md`
- `src/extensions/pi-subagents/agents/recapper.md`
- `src/extensions/pi-subagents/agents/researcher.md`
- `src/extensions/pi-subagents/test/unit/agent-frontmatter.test.ts`

Do not edit child boundary instructions or add new frontmatter schema fields.

#### Change
1. In the parent-only `SKILL.md`, add one concise routing rule near “Selesai default”:
   - Keep tiny targeted reads/simple responses with the parent.
   - For broad local investigation, external research, or mutation work, call `action:list`, choose an executable entry from its runtime metadata, then delegate.
   - Treat list output—not hardcoded role names—as the agent-selection authority.
   - Keep existing parent ownership, capability ceiling, one-writer, and child-boundary rules.

2. Update only the `description:` frontmatter values for the six bundled agents so they advertise their purpose without making static tool text depend on their names:
   - architect: read-only architecture and implementation planning.
   - builder: mutation-capable scoped implementation.
   - commentator: read-only evidence-based review.
   - explorer: read-only local codebase reconnaissance.
   - recapper: read-only handoff/context synthesis.
   - researcher: read-only external/code-first research.

3. Add declared `acceptanceRole` fields where absent:
   - `builder`: `writer`.
   - All bundled advisory/read-only agents: `read-only`.
   - Preserve the architect’s existing `read-only` declaration.

4. Do not alter tool allowlists, context defaults, model settings, system prompts, skills, aliases, or child permissions in this phase.

5. Add frontmatter assertions that bundled descriptions and declared roles survive discovery. These assertions should read the discovered agent configurations rather than duplicate path-specific parsing logic.

#### Verification
Success:
- Catalog role metadata is populated for all bundled agents.
- Bundled descriptions clearly communicate intended routing capability.
- Existing acceptance behavior remains equivalent for current bundled roles.

Regression:
- `acceptanceRole` continues to influence acceptance inference only; it must not grant tools.
- Builder remains the only bundled mutation-capable agent by declared edit/write tools.
- Existing aliases and fresh/fork defaults remain unchanged.

Failure:
- Any malformed frontmatter continues to produce existing discovery diagnostics rather than a catalog crash.

---

### Task 5 — Add contract, catalog, and faux-provider behavior coverage; package only through build

#### Discovery
Inspect:

- `src/core/system-prompt.test.ts` after Task 1.
- `src/extensions/pi-subagents/test/unit/tool-description.test.ts`
- `src/extensions/pi-subagents/test/unit/agent-management.test.ts`
- `src/extensions/pi-subagents/test/unit/capability-ceiling-agent-allowlist.test.ts`
- `src/extensions/pi-subagents/test/e2e/real-session-subagent.test.ts`
- `src/extensions/pi-subagents/test/support/real-session-runner.ts`
- Root `package.json` and extension `package.json` scripts.

#### Identification
Modify:

- The tests listed above.
- Do not manually edit `dist/**`; root `npm run build` copies extension assets into `dist`.

#### Change
1. Core prompt tests:
   - Default prompt includes generic delegation guidance.
   - Custom prompt receives active `promptGuidelines`.
   - No empty guideline block when none are supplied.

2. Tool-description tests:
   - Full, compact, and custom modes carry generic routing requirements.
   - Registered parent tool includes `promptGuidelines`.
   - All six bundled names are forbidden in static descriptions.
   - Child-safe registration remains separate and does not receive parent-only routing guidance.

3. Catalog tests:
   - Create a temporary custom project agent with alias, `writer` role, `fork` default context, core tools, and an `mcp:` tool.
   - Assert equivalent human and `details.catalog` fields.
   - Assert scope shadowing, disabled omission, and restricted-ceiling metadata.

4. Faux-provider E2E tests in `real-session-subagent.test.ts`:
   - **Broad mutation route:** Create a temporary project-only custom writer agent with a non-bundled name. Script the faux parent to call `action:list`, then delegate to the name it discovered. Assert the first tool result contains the custom catalog entry and the second result contains the child marker.
   - **Tiny targeted read stays local:** Script a faux parent response to a narrow read-only prompt without a `subagent` tool call. Assert no subagent tool result and a normal parent response.
   - Treat these as controlled routing-contract tests, not proof that a real LLM will reason identically. The deterministic assertions are the visible tool contract, catalog result, and observed call sequence.

5. Run focused tests before the full suite, then build:
   - `npx vitest run src/core/system-prompt.test.ts`
   - `npm run test:unit` from `src/extensions/pi-subagents`
   - `npm run test:e2e` from `src/extensions/pi-subagents`
   - `npm run build` from repository root.

#### Verification
Success:
- All focused, unit, and E2E tests pass.
- Build regenerates extension assets in `dist`.
- No new dependency or lockfile change is required.

Failure:
- If faux-provider runtime packages are unavailable, E2E retains its existing graceful skip behavior; unit coverage must still pass.
- Any description test failure caused by a bundled name indicates a static-tool-description regression.

---

## Compatibility

- `Details.catalog` is optional and additive; existing consumers reading `mode` and `results` continue to work.
- Catalog metadata reflects runtime discovery and capability ceilings; it does not replace launch authorization.
- Human `action:list` becomes richer but retains current headings and section ordering.
- Custom tool descriptions still work; mandatory routing/safety text is appended.
- Custom system prompts gain only active mandatory tool guidance, preserving their supplied content.
- No request schema, delegation protocol, capability-ceiling version, environment variable, or persisted agent file format changes are introduced.
- `models` remains explicitly builtin-oriented and is not redefined as a generic catalog endpoint.

## Risks and mitigations

| Severity | Risk | Mitigation |
|---|---|---|
| High | Custom prompts currently omit tool guidelines, so contract could be invisible | Task 1 renders active guidelines in both prompt paths and adds direct tests |
| High | Static tool text currently includes bundled names | Replace examples with placeholders; test all six names are absent |
| Medium | Human and machine catalogs could drift | Build both from shared effective-tool/catalog helpers in `handleList` |
| Medium | `acceptanceRole` could be mistaken for authorization | Preserve existing semantics; test it remains metadata/acceptance-only |
| Medium | Catalog may overstate actual extension availability | Report declared tools only; preserve launch-time availability diagnostics as authority |
| Medium | Faux tests can become flaky | Reuse existing isolated faux-provider runner and custom project-agent fixtures |
| Low | Richer list text may affect string consumers | Preserve existing headings and use additive fields |
| Low | Dist can become stale | Regenerate only through root build; never hand-edit generated assets |

## Explicit non-goals

- No runtime enforcement that rejects a parent’s local mutation.
- No automatic model routing/classifier changes.
- No changes to `task-intent.ts` or `acceptance.ts` heuristics in this phase.
- No new agent frontmatter schema or model-visible tool parameter.
- No capability-ceiling version bump.
- No changes to nested delegation depth, spawn budgets, tool budgets, async behavior, or worktree behavior.
- No expansion of `models` beyond bundled agents.
- No broad refactor of generic Selesai agents/skills XML.

## Acceptance criteria

1. Main sessions always receive a generic delegation-routing threshold, including custom system prompt sessions when the parent `subagent` tool is active.
2. Full, compact, and custom parent tool descriptions require catalog-first, executable-only agent selection and contain no bundled agent names.
3. The parent-only skill owns detailed delegation workflow; ordinary child behavior remains unchanged.
4. Bundled agent descriptions and declared roles make local reconnaissance, external research, review, handoff, planning, and mutation capability discoverable.
5. `action:list` exposes runtime-resolved human and machine catalogs with source, aliases, context, role, declared tools, executable status, and restriction source.
6. Disabled entries remain hidden; restricted entries remain visible but cannot execute.
7. Faux-provider E2E coverage demonstrates list-then-delegate behavior with a non-bundled writer and a no-delegation tiny-read path.
8. Focused, extension unit/E2E, and root build commands pass.

## Rollback

1. Revert the Phase 1 commit as one unit.
2. If only catalog consumers regress, revert `Details.catalog` and the richer `handleList` line format while retaining existing list text.
3. If custom prompt compatibility regresses, revert only custom-path guideline rendering and keep default/tool-description coverage for follow-up.
4. Rebuild root artifacts after any rollback; do not hand-edit `dist`.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Verified exact ownership paths for core prompt assembly, parent tool registration, tool descriptions, dynamic action:list output, Details metadata, parent-only skill, bundled agents, unit tests, and faux-provider E2E support. The plan names concrete files, symbols, ordered edits, tests, compatibility constraints, Phase 0 dependency, risks, acceptance criteria, and rollback."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "Static source/test inspection via read and grep",
      "result": "passed",
      "summary": "Verified source ownership and existing test seams; no implementation or shell commands were run."
    },
    {
      "command": "npx vitest run src/core/system-prompt.test.ts; npm run test:unit; npm run test:e2e; npm run build",
      "result": "not-run",
      "summary": "Planned verification commands only; this task was planning-only."
    }
  ],
  "validationOutput": [
    "src/core/system-prompt.ts currently omits promptGuidelines in the custom-prompt branch.",
    "src/extensions/pi-subagents/src/extension/index.ts registers the parent subagent tool without promptGuidelines.",
    "src/extensions/pi-subagents/src/agents/agent-management.ts:handleList currently produces text-only catalog output and generic management Details.",
    "src/extensions/pi-subagents/test/e2e/real-session-subagent.test.ts and test/support/real-session-runner.ts provide an existing faux-provider route for deterministic delegation behavior tests."
  ],
  "residualRisks": [
    "Phase 1 must wait for Phase 0’s bundled-agent/frontmatter and documentation corrections to avoid conflicts and stale capability claims.",
    "Faux-provider E2E tests validate the exposed prompt/catalog contract and scripted call sequence, not emergent behavior from production models.",
    "Declared tool metadata is not proof that a child extension/provider is available; existing launch validation remains authoritative."
  ],
  "noStagedFiles": true,
  "diffSummary": "Planning-only artifact; no repository files were edited.",
  "reviewFindings": [
    "high: src/core/system-prompt.ts: custom prompts currently skip active tool promptGuidelines, leaving mandatory delegation policy invisible in that mode.",
    "high: src/extensions/pi-subagents/src/extension/tool-description.ts: static management examples currently hardcode the bundled name commentator, conflicting with the generic-catalog requirement.",
    "medium: src/extensions/pi-subagents/src/agents/agent-management.ts:handleList returns no versioned machine-readable catalog metadata; consumers must parse display text.",
    "medium: src/extensions/pi-subagents/src/shared/types.ts:Details has no catalog field despite management result details being the correct additive metadata channel.",
    "medium: src/extensions/pi-subagents/src/runs/shared/task-intent.ts and acceptance.ts retain bundled-name heuristics; this plan intentionally excludes them because Phase 1 is contract/catalog work, not enforcement."
  ],
  "manualNotes": "No implementation was performed. Phase 0 completion and a clean/rebased worktree are prerequisites before executing this plan."
}
```

⧉ copy assistant: /cp 7669bb