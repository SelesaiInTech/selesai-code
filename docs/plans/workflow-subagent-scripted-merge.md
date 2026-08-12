# Plan — Merge: workflow extension as durable shell driving `workflowScript` steps

## Goal

Make the bundled `workflow` extension the durable, human-gated process shell, and let
it drive pi-subagents' `workflowScript` orchestration as **one step inside a phase**.
Both extensions stay; nothing is deleted. All workflow-extension guarantees (durable
resume, marker gates, exclusive transitions, loop caps, parent-owned artifacts, slash
commands/footer) survive unchanged.

Executed by: a small coding model with no project knowledge. Everything needed is
written here.

## Scope

- `src/extensions/workflow/adapter.ts` — two small adapter extensions (child-output
  suppression for scripted calls; loop-engine recognition of scripted review waves).
- `src/extensions/workflow/modes/*.ts` — prompt-text doctrine for the scripted-step
  contract (loop phase in all four modes; research phase in prototype/quicktype).
- `src/extensions/workflow/adapter.ts` resume continuation text (loop branch).
- Tests: `src/__tests__/{adapter,loop-workflow,task-workflow}.test.ts`.
- Docs: `doc-web/src/content/docs/capabilities/delegation/{workflow,pi-subagents}.mdx`,
  `doc-web/src/data/capabilities.ts`.
- Skill doctrine: `execution-controls.md` synced 3-way.

Explicitly **out of scope**: deleting either extension, new abstractions, new
dependencies, changing pi-subagents' sandbox API, re-architecting `WorkflowStateMachine`
or `runWorkflowScript`, and creating a new workflow skill.

## Established facts (verified in prior sessions; trust these)

- The workflow extension is a pure consumer of the `subagent` tool. Every mode prompt
  hardcodes single-agent calls with `output: false`; `adapter.ts` enforces
  parent-owns-artifacts. pi-subagents has zero runtime coupling back to it.
- `disableSubagentOutput` (`src/extensions/workflow/adapter.ts:85`) rewrites only
  `input.agent` (string), `input.tasks`, `input.chain` (+ `step.parallel`). It does not
  touch `input.workflowScript`.
- For a `workflowScript` call, the script's **own** result is always inline text
  (foreground workflow branch builds text sections; no result file is written for the
  script). Top-level `output`/`outputMode` are destructured into `workflowChildDefaults`
  and forwarded to the script's **children** as defaults
  (`src/extensions/pi-subagents/src/runs/foreground/subagent-executor.ts:4553` and
  `:4692`). `output: false` therefore means "children stay inline".
- Mode resolution precedence: `workflowScript` beats `chain`/`tasks`/`agent`
  (`subagent-executor.ts:2007` `getRequestedModeLabel`).
- Loop gating (`adapter.ts:713-717` `commentatorTransition`) and the `tool_result` loop
  branches (`adapter.ts:760-780`, `agent === "builder"` / `agent === "commentator"`)
  match only on `event.input.agent`. A scripted call (no agent) is currently invisible
  to the loop engine.
- The sandbox surface is exactly `{ runs, prompts, emit, console, Promise, state? }`
  (`src/extensions/pi-subagents/src/workflows/scripted-workflow.ts:296-297`). No host
  call maps to workflow start/advance/resume. Scripts cannot be driven from inside a
  workflowScript — by design; this plan does not change that.
- Script return rendering (`formatWorkflowValue`, `subagent-executor.ts:4272`): strings
  render verbatim; other JSON renders pretty-printed. The loop marker regex
  `LOOP_STATUS_RE = /WORKFLOW_REVIEW_STATUS\s*:\s*(clean|blocking)\b/i` is not
  line-anchored, so markers match inside either rendering.
- `textFromSubagentResult` (`adapter.ts:70`) already falls back to reading
  `event.details?.results?.[0]?.artifactPaths?.outputPath` when the inline content has
  no marker — reuse it as-is for scripted results.
- Tests: workflow tests live in `src/__tests__/` (`adapter.test.ts`,
  `loop-workflow.test.ts`, `task-workflow.test.ts`, `quicktype-workflow.test.ts`,
  `state-machine.test.ts`, `workflow-run-state.test.ts`) using an in-memory harness
  (`createHarness`/`start`/`result` helpers that dispatch fake `subagent` tool events
  through `__resetWorkflowRegistryForTests` + `createWorkflowExtension`). pi-subagents
  integration tests live in `src/extensions/pi-subagents/test/integration/`.
- Skills are synced 3-way and currently byte-identical:
  `src/extensions/pi-subagents/skills/pi-subagents` ↔ `src/skills/pi-subagents` ↔
  `~/.selesai/agent/skills` (verified with `diff -q`).
- Both extensions register via the bundled extension dir through
  `additionalExtensionPaths` (`src/main.ts:726`). Both are listed in
  `doc-web/src/data/capabilities.ts` under `delegation-and-workflows`.

---

## Task 1 — Adapter: force `output: false` on scripted subagent calls

### 1. Discovery

Search `src/extensions/workflow/adapter.ts` for `function disableSubagentOutput` (line
85). Read its three existing branches (agent / tasks / chain) and the call site in the
`pi.on("tool_call", ...)` hook (~line 730) that guards with
`!isSubagentManagementAction(event.input) && event.input`.

### 2. Identification

- **File to modify:** `src/extensions/workflow/adapter.ts` — it owns all tool-call
  rewriting for the workflow; nothing else should change.
- **Why not others:** the executor (`subagent-executor.ts`) never sees `output: false`
  unless the caller passes it; the workflow must impose it because the model may not.

### 3. Change

In `disableSubagentOutput`, after the `input.agent` branch, add:

```ts
// ponytail: a scripted call's own result is always inline text, but top-level
// output is forwarded to the script's children as a default (subagent-executor
// destructures it into workflowChildDefaults). Force it off so children stay
// inline. Per-child `output:` inside the workflowScript string cannot be
// rewritten here; the mode prompts carry that contract.
if (typeof input.workflowScript === "string") input.output = false;
```

Keep the existing agent/tasks/chain branches byte-identical.

**Code explicitly not to add:** rewriting the script string contents, recursion into
`runs.run` param objects, or any new helper.

### 4. Verification

- **Success:** after `disableSubagentOutput({ workflowScript: "return runs.run(...)" })`,
  `input.output === false`; the script text is untouched.
- **Failure:** n/a (pure rewrite; no error paths).
- **Regression:** `{ agent: "x", output: <path> }` → `output: false`; `tasks`/`chain`
  (incl. `step.parallel`) rewrites unchanged. Existing `adapter.test.ts` cases still
  pass.

---

## Task 2 — Adapter: loop engine recognizes scripted review waves

### 1. Discovery

Read `src/extensions/workflow/adapter.ts`:
- `pi.on("tool_call", ...)` hook, `commentatorTransition` at lines 713-717 and the
  `transitionBatchBlock` usage at 717.
- `pi.on("tool_result", ...)` hook, lines ~755-785: the `agent === "builder"` /
  `agent === "commentator"` branches, `parseLoopReviewStatus`, `textFromSubagentResult`,
  loop-complete.md write with `MARKERS.loopComplete`, maxed cap, and the trailing
  `onArtifactMaybe(deps)` call.
- `validators.ts` `MARKERS` and `loopCompleteValidator`.

### 2. Identification

- **File to modify:** `src/extensions/workflow/adapter.ts` — the loop engine lives
  entirely in this adapter (state machine stays pure; it only reacts to artifacts).
- **Why not the state machine:** `loop-complete.md` detection, review-round tracking,
  and loop-state persistence are adapter concerns (deps + `loopState`); the SM has no
  knowledge of `subagent` events.

### 3. Change

**3a.** In the `tool_call` hook, replace the `commentatorTransition` expression with a
version that also matches scripted calls:

```ts
const scriptedLoopCall = tool === "subagent" &&
  typeof event.input?.workflowScript === "string" && snap.phase === "loop" &&
  !isSubagentManagementAction(event.input);
const commentatorTransition = (tool === "subagent" &&
  event.input?.agent === "commentator" && snap.phase === "loop" &&
  !isSubagentManagementAction(event.input)) || scriptedLoopCall;
```

This routes scripted loop calls through `transitionBatchBlock` (exclusive-call
enforcement) exactly like a commentator call.

**3b.** In the `tool_result` hook, inside the `if (event.toolName === "subagent" &&
sm.snapshot.active && sm.snapshot.phase === "loop")` block, after `const agent =
event.input?.agent;` add `const scripted = typeof event.input?.workflowScript ===
"string";` and change the branch guard from `else if (agent === "commentator")` to
`else if (agent === "commentator" || scripted)`. The entire existing commentator body
(review round increment, `loop-review-N.md` persist, `parseLoopReviewStatus`, clean →
loop-complete.md with `MARKERS.loopComplete`, maxed cap + one-time notify, blocking →
`stage = "building"`) is reused as-is. The builder branch stays `agent === "builder"`
only.

**Contract (documented in Task 3, not code):** a scripted call in loop phase IS one
review round. The script must return/emit the aggregated review text containing the
marker (string return renders verbatim; the regex is not line-anchored so JSON renders
also match). The builder round remains single-agent.

**Code explicitly not to add:** parsing `details.workflow.value`, special-casing
`details.results`, or new loop-state fields.

### 4. Verification

- **Success (loop mode):** scripted `subagent` call in loop phase → `reviewRound`
  increments; inline result containing `WORKFLOW_REVIEW_STATUS: clean` → `loop-review-N.md`
  written, `loop-complete.md` written with `WORKFLOW_LOOP_STATUS: clean`, workflow
  becomes terminal-ready (`terminalReady`), `end_workflow` closes it. Blocking marker →
  `stage = "building"`, next round continues; 3 blocking rounds → `maxed` + exactly one
  warning notify. A scripted call batched with another tool call in loop → `{ block:
  true, reason: "Workflow transition tools must be called alone. ..." }`.
- **Failure:** scripted result with no marker → treated as blocking (same as malformed
  commentator). `event.isError` subagent result → hook returns early (existing guard).
- **Regression:** `{ agent: "commentator" }` loop behavior byte-identical; builder
  rounds unchanged; non-loop phases unchanged; management actions pass through.

---

## Task 3 — Mode prompts + resume text: the scripted-step contract

### 1. Discovery

Read the loop-phase prompt strings in `src/extensions/workflow/modes/loop.ts`,
`modes/task.ts`, `modes/quicktype.ts`, `modes/prototype.ts`, and the research-phase
prompt in `modes/prototype.ts` / `modes/quicktype.ts`. Read the loop resume continuation
text in `adapter.ts` `resumeController` (the `ls.stage === "reviewing"` branch).

### 2. Identification

- **Files to modify:** the four `modes/*.ts` prompt factories + the resume string in
  `adapter.ts`. Mode prompts are the runtime doctrine the model sees; the resume text is
  the only other place that instructs commentator calls.
- **Why not elsewhere:** the pi-subagents skill is the engine's doctrine (Task 6); the
  mode prompts own phase behavior.

### 3. Change

**3a. Loop prompt (all four modes).** After the commentator bullet, append one optional
paragraph (exact wording up to the implementer, must preserve every existing
`WORKFLOW_*` marker string verbatim):

> Alternatively, run the review as ONE scripted wave: call the subagent tool with
> `{ workflowScript: "...", output: false }` that fans out parallel reviewer children
> via `runs.all([...])` and returns a single aggregated review text ending with exactly
> one line `WORKFLOW_REVIEW_STATUS: clean` or `WORKFLOW_REVIEW_STATUS: blocking`. Do not
> set `output` inside `runs.run` params (the adapter forces `output: false`); the script
> must return or emit the review text inline. Use either the single commentator call or
> one scripted wave per round, not both.

**3b. Research prompt (prototype/quicktype only).** Add one optional sentence: a
scripted parallel researcher wave (`{ workflowScript, output: false }`) may replace the
single `{ agent: "researcher" }` call; the parent still writes `research.md` via
`write_workflow_artifact`. (No engine coupling here — this phase is existence-only.)

**3c. Resume text (`adapter.ts`).** In the `ls.stage === "reviewing"` continuation,
append "(or a scripted review wave with `{ workflowScript, output: false }`)" to the
commentator instruction.

**Code explicitly not to add:** marker-string changes, prompt templating infrastructure,
or new prompt files.

### 4. Verification

- **Success:** each modified prompt string contains the new paragraph and still contains
  exactly its required marker strings (`WORKFLOW_PLAN_STATUS: ready`,
  `WORKFLOW_HANDOFF_STATUS: ready`, `WORKFLOW_REVIEW_STATUS: clean|blocking`,
  `WORKFLOW_LOOP_STATUS: clean` where relevant) — grep-able.
- **Failure:** n/a.
- **Regression:** non-loop prompt text byte-identical; existing prompt tests (if any)
  pass.

---

## Task 4 — Tests

### 1. Discovery

Read `src/__tests__/adapter.test.ts` (disableSubagentOutput cases), and the harness in
`src/__tests__/loop-workflow.test.ts` (`createHarness`, `start`, `result` helpers that
dispatch fake `subagent` events through the registry). Note how existing tests simulate
builder/commentator results and how `task-workflow.test.ts` covers phase advancement.

### 2. Identification

- **Files to modify:** `src/__tests__/adapter.test.ts`, `src/__tests__/loop-workflow.test.ts`,
  `src/__tests__/task-workflow.test.ts` — they are the in-repo home for workflow tests.
- **Why not pi-subagents' integration suite:** the changed behavior is adapter-side;
  pi-subagents integration must stay untouched (regression proof).

### 3. Change

Add cases:

- **adapter.test.ts:** `disableSubagentOutput({ workflowScript: "..." })` sets
  `output: false`; agent/tasks/chain cases still assert the old shapes; script text
  untouched.
- **loop-workflow.test.ts (new flow):** dispatch a scripted loop `subagent` result
  (`event.input` has `workflowScript`, `event.content` is inline text containing
  `WORKFLOW_REVIEW_STATUS: clean`) → assert loop-review-1.md + loop-complete.md written
  and terminal-ready; blocking variant → next round; third blocking round → maxed + one
  notify; a batched scripted loop call → blocked result. Use the existing harness
  helpers; extend them only if strictly needed.
- **task-workflow.test.ts (regression + one new flow):** a scripted `subagent` call in a
  non-loop phase is ignored by the engine (parent still must call
  `write_workflow_artifact` to advance); the clean-scripted-loop path ends terminal-ready
  and `end_workflow` closes it.

**Code explicitly not to add:** new test harnesses, mocking frameworks, or touching
pi-subagents' test suites.

### 4. Verification

- **Success:** the new cases pass; targeted run:
  `npx vitest run src/__tests__/adapter.test.ts src/__tests__/loop-workflow.test.ts src/__tests__/task-workflow.test.ts`.
- **Failure:** n/a.
- **Regression:** full unit suite (previously 1833 passing) and pi-subagents integration
  suite (previously 737 passing) stay green:
  `npx vitest run` and the pi-subagents integration runner used previously (confirm the
  exact command from the prior session's verification log).

---

## Task 5 — Docs

### 1. Discovery

Read `doc-web/src/content/docs/capabilities/delegation/workflow.mdx` and
`pi-subagents.mdx`; read the workflow entry in `doc-web/src/data/capabilities.ts`
(lines ~58-70).

### 2. Identification

- **Files to modify:** the two `.mdx` pages and the `capabilities.ts` benefit string for
  `workflow`.
- **Why not others:** these are the registered capability pages under
  `delegation-and-workflows`; the skill reference is handled in Task 6.

### 3. Change

- **workflow.mdx:** add a "Scripted subagent steps" section (after "What you can do" or
  in "Limits and safety"): the workflow extension is the durable shell; a phase may call
  `subagent({ workflowScript, output: false })` as one step; in loop phase a scripted
  call counts as one review round (script must return/emit the review text with the
  marker); per-child `output:` inside the script is not rewritten — instruct scripts to
  omit it; scripted steps remain child-level and ephemeral (no durable process state —
  the workflow run file is still the source of truth).
- **pi-subagents.mdx:** one paragraph under "Limits and safety": the bundled workflow
  extension can drive a `workflowScript` as a phase step; `workflowScript` stays
  child-level/ephemeral and is not resumable as a process — pair it with the workflow
  extension when durable/resumable/human-gated execution is needed.
- **capabilities.ts:** extend the `workflow` benefit string with "scripted subagent
  steps" (one clause, keep existing wording).

### 4. Verification

- **Success:** pages render (run the doc-web build or the repo's markdown check if one
  exists; at minimum the frontmatter/imports stay intact); new text greps to the two
  pages.
- **Failure:** n/a.
- **Regression:** existing anchors/links in both pages unchanged.

---

## Task 6 — Skill doctrine sync (3-way)

### 1. Discovery

Read `src/extensions/pi-subagents/skills/pi-subagents/references/execution-controls.md`
"### Scripted workflows" section (line ~54). Confirm the three synced copies are
byte-identical (they are, per prior verification):
`src/extensions/pi-subagents/skills/pi-subagents` ↔ `src/skills/pi-subagents` ↔
`~/.selesai/agent/skills`.

### 2. Identification

- **Files to modify:** all three copies of `references/execution-controls.md` (identical
  bytes after the change). The extension copy is canonical; the other two mirror it.

### 3. Change

Append a short "Durable-shell integration" note to the Scripted workflows section:
- The bundled workflow extension may drive a script as one step inside a phase; it
  forces `output: false` on the call (children stay inline). Per-child `output:` inside
  the script string is not rewritten — omit it.
- In the workflow's loop phase, a scripted call counts as ONE review round; the script
  must return/emit the aggregated review text containing `WORKFLOW_REVIEW_STATUS:
  clean|blocking` inline.
- `workflowScript` remains child-level and ephemeral; the workflow extension's
  `workflow.json` is the durable process state.

Apply the identical diff to all three copies, then verify.

### 4. Verification

- **Success:** `diff -q` between the three copies reports identical; the new note greps
  in all three.
- **Failure:** n/a.
- **Regression:** all other sections byte-identical.

---

## Task order and dependencies

1. Task 1 (adapter rewrite) — independent.
2. Task 2 (loop recognition) — independent of Task 1; same file, do both before tests.
3. Task 3 (prompts/resume text) — depends on the contract fixed in Tasks 1-2.
4. Task 4 (tests) — after Tasks 1-2 (behavior) and 3 (contract for wording assertions).
5. Tasks 5-6 (docs/skill) — after behavior is stable; can run in parallel.

## Definition of done

- `npx vitest run src/__tests__/adapter.test.ts src/__tests__/loop-workflow.test.ts src/__tests__/task-workflow.test.ts` green.
- Full unit suite (1833) + pi-subagents integration suite (737) green.
- Typecheck clean with the repo's established command (the one used for the previous
  pi-subagents 0.47.1 verification; run `npx tsc --noEmit` from the repo root if no
  other command is recorded).
- `diff -q` clean across the 3-way skill sync.
- `git status` shows only: `adapter.ts`, `modes/*.ts`, the three test files, two `.mdx`
  pages, `capabilities.ts`, three `execution-controls.md` copies, and this plan.

## Final review checklist (planger)

- [x] Discovery: every touched file/line cited; no assumptions about ownership.
- [x] Ownership: adapter owns tool-call rewriting + loop engine; SM stays pure;
      prompts own runtime doctrine; tests live in `src/__tests__`.
- [x] Simplest acceptable: two small predicates + one prompt paragraph + docs; no new
      abstractions, deps, or services.
- [x] Reuse: `textFromSubagentResult`, `parseLoopReviewStatus`, `MARKERS`, the loop
      engine body, and the existing harness are all reused as-is.
- [x] Scope: no extension deletions, no sandbox/API changes, no SM refactor.
- [x] Verification: success/failure/regression per task + full-suite Definition of done.
- [x] Executable without assumptions: exact paths, line refs, predicates, and commands.
