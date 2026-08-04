# Phase 0 Plan — Correctness Cleanup Before Delegation Changes

## Objective

Correct stale bundled-agent documentation and impossible builtin-agent contracts without changing intended delegation policy. Keep current runtime defaults authoritative: only `architect` and `recapper` fork by default; the other four builtins are fresh-context.

## Non-goals

- Do not redesign delegation behavior, context policy, model routing, or orchestration.
- Do not grant `commentator` write tools.
- Do not make `researcher` portable by adding new extension/package dependencies.
- Do not alter user settings, user-home skills, `.selesai/`, `.pi-subagents/`, or unrelated dirty changes.
- Do not run `npm run build`: it cleans `dist/` and can destroy unrelated dirty generated artifacts.

## Review findings

- **High — stale/mangled role docs:** `src/extensions/pi-subagents/skills/pi-subagents/references/prompting-and-roles.md:14,176-192,269` and `README.md:105-116,407` duplicate roles, omit `recapper`, and contain a false self-alias.
- **High — context contradiction:** `constraints-and-recipes.md:8-9,106,141` and `execution-controls.md:363,369-376` claim `builder`/`commentator` fork by default; their frontmatter declares `fresh`.
- **High — stale discovery paths:** `execution-controls.md:9-22` and additional README discovery/settings text describe `.pi`, although runtime discovers `.selesai` and legacy `.agents`.
- **Medium — impossible/unsafe role contracts:** `agents/architect.md:38` tells a child without `question` or `subagent` access to use them; `agents/builder.md:7,21` requires bridge-only `contact_supervisor`; `agents/researcher.md:4` misclassifies MCP tools as builtin tools.
- **Medium — output/tool-description drift:** role tables say read-only agents write output files and that `commentator` can receive edit/write tools from an explicit fix pass. Neither is true.

## Discovery and baseline preservation

1. From repository root, run:
   ```bash
   git status --short
   git diff --check
   git diff -- src/extensions/pi-subagents dist/extensions/pi-subagents
   ```
2. Record every pre-existing dirty path and hunk. Treat them as owned by another change.
3. Before touching an affected `dist/extensions/pi-subagents/**` file, inspect its existing diff. If it is already dirty, manually merge only the Phase 0 documentation/agent hunk; never reset, checkout, clean, or overwrite unrelated content.
4. Confirm these runtime facts before editing:
   - `src/extensions/pi-subagents/src/agents/agents.ts`: `BUILTIN_AGENT_NAMES` is exactly `architect`, `builder`, `commentator`, `explorer`, `recapper`, `researcher`; discovery uses `.selesai/agents` plus legacy `.agents`.
   - `src/extensions/pi-subagents/agents/*.md`: only `architect` and `recapper` have `defaultContext: fork`.
   - `src/extensions/pi-subagents/src/intercom/intercom-bridge.ts:applyIntercomBridgeToAgent`: bridge tools are appended only when the bridge is active.
   - `src/extensions/pi-subagents/src/runs/shared/pi-args.ts:resolvePiLaunchToolPlan` and `tool-availability.ts`: `tools` is a strict allowlist and `mcp:` values become direct MCP selections.

## Files and ownership

### Source files to modify

| File | Ownership / required change |
|---|---|
| `src/extensions/pi-subagents/agents/architect.md` | Builtin planner’s executable prompt; remove unavailable-tool instructions. |
| `src/extensions/pi-subagents/agents/builder.md` | Builtin writer’s declared tool contract and escalation instruction. |
| `src/extensions/pi-subagents/agents/researcher.md` | Builtin researcher’s MCP-tool declaration. |
| `src/extensions/pi-subagents/skills/pi-subagents/references/prompting-and-roles.md` | Canonical parent-skill role routing/table guidance. |
| `src/extensions/pi-subagents/skills/pi-subagents/references/constraints-and-recipes.md` | Canonical default-context/workflow guidance. |
| `src/extensions/pi-subagents/skills/pi-subagents/references/execution-controls.md` | Canonical discovery, context, and commentator-workflow guidance. |
| `src/extensions/pi-subagents/README.md` | Public package documentation for builtin roles, paths, and defaults. |
| `src/extensions/pi-subagents/test/unit/agent-frontmatter.test.ts` | Existing runtime-discovery test seam for builtin frontmatter. |
| `src/extensions/pi-subagents/test/unit/builtin-agent-documentation.test.ts` (new) | Narrow regression test for six unique builtin roles in both public role tables. |

### Generated package mirrors to synchronize

Mirror only corresponding changed source assets into:

- `dist/extensions/pi-subagents/agents/architect.md`
- `dist/extensions/pi-subagents/agents/builder.md`
- `dist/extensions/pi-subagents/agents/researcher.md`
- `dist/extensions/pi-subagents/README.md`
- `dist/extensions/pi-subagents/skills/pi-subagents/references/prompting-and-roles.md`
- `dist/extensions/pi-subagents/skills/pi-subagents/references/constraints-and-recipes.md`
- `dist/extensions/pi-subagents/skills/pi-subagents/references/execution-controls.md`

Do **not** modify runtime TypeScript, user settings, skill installations, or unrelated `dist` output.

## Ordered implementation tasks

### 1. Correct impossible builtin-agent instructions

1. In `agents/architect.md`, replace the sentence that says the architect should use an explorer agent and a “questions tool.”
   - New instruction: inspect the repository directly with its available read/search tools.
   - For unresolved user-owned decisions, require the architect to list them explicitly in the returned plan rather than trying to ask questions or launch a child.
   - Do not add `question`, `interview`, `subagent`, or `contact_supervisor` to architect’s allowlist.

2. In `agents/builder.md`:
   - Remove `contact_supervisor` from the static `tools:` frontmatter list.
   - Replace the unconditional instruction to call it with a conditional rule:
     - when injected bridge instructions make `contact_supervisor` available, use it for unapproved decisions and wait;
     - otherwise stop, do not guess, and report the exact blocking decision.
   - Keep all existing core writer tools and the single-writer role unchanged.

3. In `agents/researcher.md`, prefix `grep_app_search` and `grep_app_fetch` with `mcp:` in `tools:`.
   - Preserve `read` and `web_explore`.
   - Do not add `extensions` or `subagentOnlyExtensions`; that would introduce a separate dependency/policy decision.

### 2. Repair role, output, capability, and specialty documentation

1. In `prompting-and-roles.md`:
   - Change “use `explorer` or `explorer`” to one `explorer`.
   - Replace the malformed Builtin Agents table with exactly one row for each canonical builtin:
     `architect`, `builder`, `commentator`, `explorer`, `recapper`, `researcher`.
   - Describe outputs as final responses/artifacts only when caller-configured output persistence is used; never claim read-only agents write project files such as `context.md`, `plan.md`, or `research.md`.
   - Describe `commentator` as review-only and `builder` as the writer. Remove the claim that a fix pass automatically grants commentator `edit`/`write`.
   - Include `recapper` as the fork-context handoff specialist.
   - Replace the false strict-isolation statement with: explicit `tools` is an allowlist, but ambient extension discovery remains possible unless `extensions`, `subagentOnlyExtensions`, or a capability ceiling constrains it; naming a tool alone does not load its provider.
   - Remove duplicate `builder` in model-tier examples; use real builtins only.

2. In `README.md`:
   - Replace “Builtin agents in plain English” with the same six unique roles and accurate specialties.
   - Update the rule of thumb to use `recapper` for a clean current-state handoff, rather than repeating `commentator`.
   - Remove stale claims that `commentator` is an alias or can make small fixes, and remove obsolete researcher tool names/install guidance.
   - Correct `.pi` project path/root references to `.selesai`, retaining `.agents` only where runtime actually supports legacy discovery.
   - State the true context defaults: `architect` and `recapper` fork; `builder`, `commentator`, `explorer`, and `researcher` are fresh.
   - Remove duplicate/nonexistent “lightweight builder” examples from model-tier text.

### 3. Align context and discovery references with runtime

1. In `constraints-and-recipes.md`:
   - Replace all duplicated context-default lists with the actual six-agent split.
   - Change builder guidance from “defaults to fork; pass fresh” to “defaults to fresh; pass fork only when inherited parent context is intentionally required.”
   - Correct duplicate `explorer` references in Fable/clarify workflow prose.
   - Keep explicit fresh-context review guidance unchanged.

2. In `execution-controls.md`:
   - Replace canonical `.pi/agents` and `.pi/chains` paths with `.selesai/agents` and `.selesai/chains`.
   - State that `.agents` is legacy agent discovery only; do not invent legacy chain discovery.
   - Replace nearest-root `.pi` wording with `.selesai` or `.agents`.
   - Rewrite the commentator workflow to show fresh context as the default and an explicit `context: "fork"` only when a branched advisory thread is intended.
   - Correct builder example prose to state that builder is fresh by default and fork is explicit.
   - Keep the bridge-injection caveat for `contact_supervisor`; it is accurate once the builder prompt becomes conditional.

### 4. Add focused regression coverage

1. Extend `agent-frontmatter.test.ts`:
   - Replace the partial fork assertion with a complete expected map for all six builtins:
     - `architect`, `recapper` → `fork`
     - `builder`, `commentator`, `explorer`, `researcher` → `fresh`
   - Assert builder’s static builtin tools do not include `contact_supervisor`.
   - Assert researcher discovery produces:
     - builtin tools: `read`, `web_explore`
     - `mcpDirectTools`: `grep_app_search`, `grep_app_fetch`.

2. Add `builtin-agent-documentation.test.ts`:
   - Read source `README.md` and `skills/pi-subagents/references/prompting-and-roles.md`.
   - Extract the first-column agent names from each respective builtin-role table.
   - Assert each table has exactly the six names in `BUILTIN_AGENT_NAMES`, with no duplicates and no aliases.
   - Do not test generated `dist` here; generated-copy equality is verified in Task 5.

### 5. Synchronize package copies safely

1. After source tests pass, copy or manually merge only the listed changed source asset files into their matching `dist/extensions/pi-subagents/` paths.
2. Do not run root `npm run build`.
3. Do not run broad `npm run copy-assets` if it would overwrite pre-existing dirty generated files.
4. Verify every changed source asset is byte-identical to its matching `dist` copy:
   ```bash
   cmp -s src/extensions/pi-subagents/README.md dist/extensions/pi-subagents/README.md
   # Repeat for each changed agents/ and skills/ asset listed above.
   ```

## Decisions requiring approval (do not implement in Phase 0)

1. **Change builtin context defaults rather than docs:**  
   Recommended Phase 0 action is docs-only alignment with current frontmatter/tests. Changing `builder` or `commentator` to fork would be a delegation-policy change and belongs in a later phase.

2. **Give `commentator` edit/write capability:**  
   Recommended Phase 0 action is to remove stale documentation only. If fix-pass reviewers should edit, explicitly redesign its frontmatter, acceptance semantics, single-writer guarantees, and tests later.

3. **Make researcher tool providers self-contained:**  
   Prefixing the grep.app tools as MCP tools is a correctness fix. Adding a web-agent extension path or packaging/configuring a grep.app provider is dependency/routing work and needs approval.

## Verification

### Commands

```bash
cd src/extensions/pi-subagents
node --experimental-strip-types --test \
  test/unit/agent-frontmatter.test.ts \
  test/unit/builtin-agent-documentation.test.ts

npm run test:unit
```

From repository root:

```bash
git diff --check
git diff -- src/extensions/pi-subagents dist/extensions/pi-subagents
cmp -s src/extensions/pi-subagents/README.md dist/extensions/pi-subagents/README.md
```

Repeat `cmp -s` for every changed mirrored asset.

### Success cases

- Discovery returns exactly six builtins with documented specialties.
- Only architect and recapper resolve to fork context without an explicit run context.
- Builder launches without requiring bridge-only tools when the bridge is inactive.
- Builder still receives `contact_supervisor` when the bridge is active.
- Researcher’s grep.app tools are parsed into `mcpDirectTools`.
- Both role tables list all six roles exactly once.
- Source and `dist` copies are identical for every changed package asset.

### Failure cases

- Missing MCP/provider registration still fails with the existing clear missing-tool diagnostic.
- A builder blocked without a bridge does not guess or attempt an unavailable tool.
- A forked run without a persisted parent session continues to fail as documented.

### Regression checks

- Explicit `context: "fresh"` and `context: "fork"` overrides retain precedence.
- `commentator` remains read-only.
- `architect`, `explorer`, `recapper`, and `researcher` remain non-writing.
- Legacy `.agents` agent discovery remains supported.
- Existing user model overrides and user-home skills remain untouched.

## Compatibility, dependencies, risks, rollback

- **Compatibility:** This preserves existing intended frontmatter behavior; only malformed tool routing and bridge-inactive builder startup are corrected.
- **Dependencies:** existing Node test runtime with `--experimental-strip-types`; no new npm packages.
- **Risks:** manually generated `dist` copies can conflict with current dirty artifacts; preserve/merge baseline hunks instead of regenerating broad output.
- **Rollback:** revert only the Phase 0 source, test, and matching `dist` hunks. Do not revert baseline dirty hunks recorded before work began.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete findings and planned fixes identify exact source paths, generated mirror paths, severity, runtime ownership, test seams, and residual risks."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "read/grep inspection of recon, builtin agent markdown, runtime discovery/tool planning code, package scripts, README, skill references, and unit tests",
      "result": "passed",
      "summary": "Verified Phase 0 ownership, current defaults, strict tool behavior, bridge injection, test runner, and generated-asset copy mechanism."
    },
    {
      "command": "git status --short / git diff",
      "result": "not-run",
      "summary": "No shell tool is available in this planning session; the plan requires a baseline dirty-diff capture before implementation."
    }
  ],
  "validationOutput": [
    "BUILTIN_AGENT_NAMES contains architect, builder, commentator, explorer, recapper, and researcher.",
    "Only architect and recapper currently declare defaultContext: fork.",
    "Builder statically requires contact_supervisor even though the bridge appends it only when active.",
    "Researcher currently declares grep.app tools without the parser-required mcp: prefix.",
    "Root copy-assets copies src/extensions into dist/extensions, while root build cleans dist and is unsafe for preserving existing dirty generated output."
  ],
  "residualRisks": [
    "Current dirty artifacts and unrelated edits were not inspectable through git in this session; implementation must baseline and preserve them.",
    "Researcher still depends on host MCP/web extension availability after the prefix correction.",
    "Changing context defaults or granting commentator write capability requires separate product/architecture approval."
  ],
  "noStagedFiles": false,
  "diffSummary": "No implementation was performed; this artifact is an implementation-ready Phase 0 plan.",
  "reviewFindings": [
    "high: skills/pi-subagents/references/prompting-and-roles.md and README.md contain duplicated/missing builtin roles and false output/capability descriptions.",
    "high: constraints-and-recipes.md and execution-controls.md contradict builtin defaultContext frontmatter.",
    "high: execution-controls.md and README.md contain stale .pi project discovery/root claims despite .selesai runtime configuration.",
    "medium: agents/architect.md, agents/builder.md, and agents/researcher.md contain impossible or incorrectly routed tool instructions."
  ],
  "manualNotes": "Phase 0 is intentionally limited to correctness cleanup and synchronization. Policy-level delegation behavior changes are explicitly deferred."
}
```

⧉ copy assistant: /cp e225dd