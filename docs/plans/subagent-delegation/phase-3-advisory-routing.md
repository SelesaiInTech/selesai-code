# Phase 3 Plan — Optional Task-Aware Advisory Routing

## Decision

Use **`subagent({ action: "list", task?, agentScope? })`** as the only Phase 3 advisory surface.

It is the smallest robust design because `task` and `action:"list"` already exist in `SubagentParams`, list already discovers the effective runnable agent set, and it already emits advisory text. This adds no launch path, RPC method, preflight-contract field, persistence, metadata schema, or new action.

### Alternatives rejected

| Option | Decision | Reason |
|---|---|---|
| Extend `action:"list"` with optional `task` | **Select** | Existing schema/action/output surface; model already instructed to call list; no API-version changes. |
| Add `action:"recommend"` or `action:"route"` | Reject | Adds action registry, dispatch, child-safe policy, docs, and a second advisory surface without a functional benefit. |
| Add generic role aliases such as `writer`/`reviewer` as runnable aliases | Reject | Would alter `resolveAgentName` ambiguity/precedence behavior and can collide with user/package aliases. Existing `acceptanceRole` plus established name heuristics are sufficient. |
| Add recommendation to launch preflight/RPC | Reject | Would require public contract/protocol version changes and digest compatibility work for advisory-only behavior. |

## Public behavior and API

### Supported call

```ts
subagent({
  action: "list",
  task: "Inspect the authentication flow and report findings only.",
  agentScope: "both", // optional; existing behavior
})
```

- `task` remains optional.
- With no task, or a whitespace-only task, preserve current list output and behavior.
- With a non-empty task, append a text-only advisory section after the existing agents/chains/proactive-skill/diagnostic sections.
- The caller must make a separate explicit execution call to launch anything:

```ts
subagent({ agent: "architect", task: "..." })
```

### Output shape

Keep the existing management result shape unchanged:

```ts
{
  content: [{ type: "text", text: "<existing list text plus optional advisory>" }],
  isError: false,
  details: { mode: "management", results: [] }
}
```

Do **not** add a `recommendations` field to `Details`, a result-content JSON schema, telemetry payload, or launch contract.

For a safe recommendation, append exactly this conceptual structure:

```text
Task-aware advisory routing:
- Intent: implementation | read-only
- Recommended: <canonical runtime agent name> (<source>)
- Reason: <declared/inferred role and safety basis>
- Advisory only: no subagent was launched. To proceed, explicitly call subagent with this canonical agent name and the task.
```

For unclear intent or no safe candidate:

```text
Task-aware advisory routing:
- Intent: unknown | implementation | read-only
- Recommendation: none
- Next: <clarification or configuration/capability explanation>
- Advisory only: no subagent was launched.
```

Never echo the complete task in the response; this avoids enlarging output and reflecting untrusted text.

## Eligibility and deterministic routing algorithm

Create a pure recommender that receives the already discovered effective agents and current capability ceiling. It must not read files, mutate discovery results, resolve aliases, modify params, or launch agents.

1. **Normalize task**
   - `task.trim() === ""` means no advisory section.
   - Otherwise classify the task with `classifyTaskMutationIntent("builder", task)`.
   - This deliberately uses the existing broad writer grammar as a task-level signal:
     - `implementation`
     - `read-only`
     - `unknown`

2. **Use only effective executable candidates**
   - Start from the same `scopedAgents` produced by:
     `mergeAgentsForScope(scope, d.user, d.project, d.builtin, d.package)`.
   - Exclude `agent.disabled === true`.
   - Exclude agents denied by `isAgentAllowedByCapabilityCeiling(agent.name, capabilityCeiling)`.
   - This preserves project > user > package > builtin collision resolution already performed by discovery/selection.
   - Do not consider chains in Phase 3.
   - Do not inspect or route individual chain steps/templates.

3. **Determine candidate role without adding aliases or metadata**
   - Reuse the existing `acceptanceRole` field where set:
     - `"writer"` is a writer candidate.
     - `"read-only"` is a read-only candidate.
   - When it is unset, reuse the existing acceptance name heuristics:
     - names matching `builder` are writer candidates;
     - names matching `architect|commentator|explorer|recapper|researcher|analyst` are read-only candidates.
   - Refactor this shared heuristic into one exported helper so advisory routing and acceptance inference cannot drift.
   - Alias values are never used as role signals. They remain input-only name resolution sugar.

4. **Apply conservative write safety**
   - Reuse `agentHasWriteTools` from `src/agents/agent-memory.ts`.
   - For an `implementation` task, retain only writer-role candidates with write capability.
   - If `capabilityCeiling.allowedTools` is present, retain a writer only when its allowlist includes at least one recognized writer tool: `edit`, `write`, or `bash`.
   - For a `read-only` task, retain only read-only-role candidates for which `agentHasWriteTools(agent) === false`.
   - This is intentionally conservative: an agent with unset tools or `bash` is not recommended as the safe read-only choice.
   - Do not claim that arbitrary MCP/custom tools are provably non-mutating; actual launch preflight remains authoritative.

5. **Select or recover**
   - For `unknown`, return no recommendation and request clarification: whether the task is read-only analysis/review or implementation allowed to edit files.
   - For a known intent with zero safe candidates, return no recommendation and explain the missing role/capability condition. Point to the executable/restricted sections already emitted by list.
   - Sort valid candidates deterministically:
     1. source precedence: `project`, `user`, `package`, `builtin`;
     2. explicit `acceptanceRole` before inferred name heuristic;
     3. canonical runtime `agent.name` ascending with a fixed lexical comparator.
   - Recommend `agent.name` only—the canonical runtime name accepted by execution. Never output an alias as the launch target.

6. **Preserve user control**
   - Do not write to `params.agent`.
   - Do not touch `canonicalizeExecutionParams`.
   - Do not invoke `resolveAgentName` for a generic role.
   - An explicit later execution request remains authoritative, including existing canonical-name/alias handling and its ambiguity errors.
   - Existing preflight and execution checks remain the final enforcement point for agent/tool restrictions.

## Implementation tasks

### Task 1 — Centralize the existing role heuristic

**Discovery**
- Inspect `src/extensions/pi-subagents/src/runs/shared/task-intent.ts`.
- Inspect `src/extensions/pi-subagents/src/runs/shared/acceptance.ts:76-134`.
- Confirm the current reviewer-name and builder-name regex behavior before changing it.

**Files**
- Modify `src/extensions/pi-subagents/src/runs/shared/task-intent.ts`.
- Modify `src/extensions/pi-subagents/src/runs/shared/acceptance.ts`.
- Update `src/extensions/pi-subagents/test/unit/task-intent.test.ts`.
- Existing `test/unit/acceptance.test.ts` is the regression suite; only alter it if current behavior needs an explicit regression assertion.

**Change**
- Add and export a narrow helper such as:
  ```ts
  resolveAgentRoutingRole(
    agentName: string,
    acceptanceRole?: AcceptanceRole,
  ): "writer" | "read-only" | undefined
  ```
- Preserve current acceptance semantics exactly:
  - declared `acceptanceRole` wins;
  - otherwise builder-name heuristic means writer;
  - otherwise existing reviewer-name heuristic means read-only;
  - otherwise undefined.
- Refactor `inferLevel` to use this helper in place of its duplicated `readOnlyAgent`/builder-name checks.
- Do not change task mutation grammar, acceptance levels, evidence requirements, or `acceptanceRole` schema.

**Verification**
- Declared writer/read-only roles still override name inference.
- `builder` remains a writer and `commentator` remains reviewer-style.
- Existing acceptance tests retain their current levels/reasons.

### Task 2 — Add the pure advisory recommender

**Discovery**
- Inspect:
  - `src/extensions/pi-subagents/src/agents/proactive-skills.ts` for pure-function/formatter conventions.
  - `src/extensions/pi-subagents/src/agents/agent-memory.ts:33-39` for `agentHasWriteTools`.
  - `src/extensions/pi-subagents/src/runs/shared/capability-ceiling.ts:300-315` for allowlist checks.
  - `src/extensions/pi-subagents/src/agents/agent-selection.ts` for effective-set precedence.
- Do not add frontmatter fields, settings fields, tags, or role aliases.

**Files**
- Add `src/extensions/pi-subagents/src/agents/task-aware-routing.ts`.
- Add `src/extensions/pi-subagents/test/unit/task-aware-routing.test.ts`.

**Change**
- Export a small typed pure API, for example:
  - `recommendTaskAwareAgent({ task, agents, capabilityCeiling })`
  - `formatTaskAwareAgentRecommendation(recommendation)`
- Keep returned data internal to the extension; do not add it to public `Details`.
- Implement the algorithm above, including:
  - empty-task no-op;
  - task intent;
  - disabled and capability-agent filtering;
  - conservative role/write-tool matching;
  - capability `allowedTools` writer check;
  - deterministic ordering;
  - unknown/no-candidate recovery text.
- Include source, canonical agent name, role basis (`declared` or `inferred`), and reason in the returned recommendation object so formatting never reimplements selection logic.
- Do not access aliases, chains, filesystem discovery, executor APIs, RPC, preflight, telemetry, or user settings in this module.

**Verification**
- Implementation task recommends a canonical writer, never a reviewer.
- Read-only task recommends a role-compatible agent without known write tools, never a writer.
- Unknown intent yields no recommendation and a clarification message.
- Disabled agents and agents outside `allowedAgents` cannot be selected.
- A ceiling without `edit`, `write`, or `bash` prevents a writer recommendation.
- A project candidate outranks an otherwise-equivalent user/package/builtin candidate.
- Equal candidates sort by canonical name.
- An alias such as `developer` is never output as the recommended launch name.

### Task 3 — Attach advice only to list management output

**Discovery**
- Inspect `handleList` in `src/extensions/pi-subagents/src/agents/agent-management.ts:675-714`.
- Inspect management dispatch at `handleManagementAction`.
- Inspect the executor management dispatch at `subagent-executor.ts:4064-4083` to confirm no execution path needs modification.

**Files**
- Modify `src/extensions/pi-subagents/src/agents/agent-management.ts`.
- Modify `src/extensions/pi-subagents/src/extension/schemas.ts`.
- Update `src/extensions/pi-subagents/test/unit/agent-management.test.ts`.
- Update `src/extensions/pi-subagents/test/unit/capability-ceiling-agent-allowlist.test.ts`.
- Update `src/extensions/pi-subagents/test/unit/schemas.test.ts`.
- Update `src/extensions/pi-subagents/test/unit/index-child-registration.test.ts`.

**Change**
- Extend internal `ManagementParams` with `task?: string`.
- In `handleList`, reuse its already computed `agents` array, `capabilityCeiling`, and scope-specific effective discovery.
- When `params.task?.trim()` is non-empty, call the new pure recommender and append its formatter lines after proactive-skill suggestions and before chain diagnostics.
- Leave no-task list output structurally unchanged.
- Update the top-level `task` schema description to state that it is a single-execution task **or an optional advisory intent for `action:"list"`; it never launches work in management mode**.
- Keep `action` as a free string schema; do not add an action enum.
- Keep `SUBAGENT_ACTIONS`, `ManagementAction`, mutating-action gates, and executor dispatch unchanged.

**Verification**
- `handleManagementAction("list", { task: "Implement the fix" }, ctx)` returns management details with `results: []`, no error, and an advisory recommendation.
- `handleManagementAction("list", { task: "Review only; do not edit files" }, ctx)` emits a read-only recommendation.
- `handleManagementAction("list", { task: "Look into this" }, ctx)` emits no agent name recommendation and asks for intent clarification.
- `handleManagementAction("list", {}, ctx)` retains current executable/restricted/chains/proactive output.
- Existing restricted-agent list behavior remains; a restricted builder must not be recommended.
- The fanout-child registration test calls list with a task and confirms it remains a permitted read-only management action.

### Task 4 — Document explicit-only use

**Discovery**
- Inspect both built-in descriptions in `src/extensions/pi-subagents/src/extension/tool-description.ts`.
- Inspect management examples and parameter reference in `src/extensions/pi-subagents/README.md:1377-1442`.

**Files**
- Modify `src/extensions/pi-subagents/src/extension/tool-description.ts`.
- Modify `src/extensions/pi-subagents/README.md`.
- Update `src/extensions/pi-subagents/test/unit/tool-description.test.ts`.

**Change**
- In full and compact descriptions:
  - show `{ action: "list", task: "..." }` as optional advice;
  - state that it only recommends and never launches;
  - state the caller must explicitly execute the returned canonical agent.
- Adjust “management action fields” wording so list’s optional task is documented as the sole exception.
- Add a README management example and revise the `task` parameter reference.
- Do not change custom-description loading behavior; mandatory safety guidance naturally remains appended to custom descriptions.

**Verification**
- Full and compact descriptions both mention task-aware list advice and explicit launch.
- Existing safety guidance, proactive-skill text, and no-hardcoded-builtin-name assertions remain valid.
- README does not imply automatic routing or execution.

## Compatibility and dependency impact

- No dependency changes.
- No new config/settings schema.
- No agent frontmatter changes.
- No new aliases.
- No new tool action.
- No RPC version bump.
- No preflight contract version/digest change.
- No delegation API version change.
- No telemetry: the extension has no matching event/metric convention for advisory list reads, and telemetry would add privacy and API surface without an execution decision.

## Commands

Run from `src/extensions/pi-subagents`:

```bash
node --experimental-strip-types --test \
  test/unit/task-intent.test.ts \
  test/unit/acceptance.test.ts \
  test/unit/task-aware-routing.test.ts \
  test/unit/agent-management.test.ts \
  test/unit/capability-ceiling-agent-allowlist.test.ts \
  test/unit/schemas.test.ts \
  test/unit/tool-description.test.ts \
  test/unit/index-child-registration.test.ts
npm run test:unit
npm run test:integration
npm run test:all
```

## Acceptance criteria

1. `action:"list"` accepts optional `task` advice without creating a new action or schema object.
2. Recommendations use only the dynamically discovered, effective, enabled, capability-allowed set.
3. Project/user/package/builtin precedence, canonical names, and existing alias resolution remain intact.
4. A read-only task is never recommended to a known writer; an implementation task is never recommended to a read-only agent.
5. Unknown intent and missing safe candidates produce recovery guidance, not guesses.
6. List advice never launches, schedules, persists, mutates params, or changes executor agent selection.
7. Existing list, acceptance, capability-ceiling, and child-safe management behavior pass regression tests.
8. No metadata/tag schema, dependency, protocol, telemetry, or contract version is added.

## Risks and rollback

- **Heuristic limitation:** task wording and name-based roles remain heuristic. Mitigation: no recommendation for unknown intent and existing `acceptanceRole` is preferred when configured.
- **Tool limitation:** `agentHasWriteTools` only recognizes core write tools; custom/MCP tools cannot be proven read-only. Mitigation: conservative filtering and explicit-launch/preflight enforcement.
- **Usability limitation:** a restrictive `allowedTools` ceiling can yield no writer recommendation. This is safer than recommending a writer that cannot write.
- **Rollback:** remove the `handleList` call/formatting and new routing module; leave the shared role-helper refactor only if acceptance behavior is verified identical. No stored data, API version, or migration requires cleanup.

## Review findings

- **No blocker** — `src/extensions/pi-subagents/src/agents/agent-management.ts:675-714` already owns advisory list output and receives the effective executable/capability-filtered agent set.
- **No blocker** — `src/extensions/pi-subagents/src/runs/foreground/subagent-executor.ts:4078-4083` routes management actions without invoking execution; leaving it unchanged preserves explicit-only launch behavior.
- **Finding (medium)** — `src/extensions/pi-subagents/src/runs/shared/acceptance.ts:89-101` duplicates role-name heuristics that a recommender would otherwise need to copy. Centralize the existing heuristic before using it for routing to prevent behavior drift.
- **Finding (medium)** — `src/extensions/pi-subagents/src/agents/agent-memory.ts:33-39` treats unset tools as write-capable and treats `bash` as write-capable. Advisory routing must retain this conservative interpretation for read-only recommendations.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Verified concrete Phase 3 ownership and constraints in src/extensions/pi-subagents/src/agents/agent-management.ts:675-714, agents/agent-selection.ts, agents/agents.ts:477-510, runs/shared/task-intent.ts, runs/shared/acceptance.ts:76-134, runs/shared/capability-ceiling.ts:300-315, extension/schemas.ts:263-349, extension/tool-description.ts, and targeted unit tests."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "Targeted read/grep inspection of Phase 3 source and tests",
      "result": "passed",
      "summary": "Verified list discovery, precedence, alias handling, capability ceilings, task-intent/acceptance heuristics, tool safety helper, schema, descriptions, and test seams."
    },
    {
      "command": "npm run test:unit",
      "result": "not-run",
      "summary": "Planning-only task; no implementation was made."
    }
  ],
  "validationOutput": [
    "No code changes were made.",
    "Selected extension of action:'list' with optional task because it avoids action, RPC, preflight-contract, digest, metadata, and dependency changes."
  ],
  "residualRisks": [
    "Task and name-role classification is heuristic; unknown intent must remain non-recommending.",
    "The existing core write-tool classifier cannot prove arbitrary MCP/custom tools are non-mutating.",
    "A restrictive allowedTools ceiling can intentionally result in no writer recommendation."
  ],
  "noStagedFiles": true,
  "diffSummary": "No diff; implementation-ready Phase 3 plan only.",
  "reviewFindings": [
    "no blocker: agent-management.ts:675-714 is the existing advisory list owner.",
    "medium: acceptance.ts:89-101 duplicates role heuristics; centralize the existing rule before advisory routing uses it.",
    "medium: agent-memory.ts:33-39 provides a conservative core-tool write signal and should be reused rather than reimplemented."
  ],
  "manualNotes": "Phase 3 deliberately remains advisory-only. No automatic execution, generic role aliases, telemetry, metadata schema, RPC/preflight surface, or contract-version changes are planned."
}
```

⧉ copy assistant: /cp 4055a2