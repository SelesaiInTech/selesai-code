Subagent exceeded turn budget after 23 assistant turns (soft limit 20 + grace 3).

Partial output before turn-budget abort:
 Now I have a good understanding. Let me plan the implementation carefully.

**Plan interpretation:**
1. Define a task-specific plan validator in validators.ts — must have ready marker + numbered AC-* IDs, implementation outline, verification step for every criterion.
2. Define a task-specific review validator — clean status only when complete plan coverage and passed verification, each plan criterion represented.
3. Extend WorkflowConfig or adapter contract with an optional task review-validation hook that reads plan.md and commentator output.
4. In adapter.ts, treat persisted loop stage as authority: building accepts builder result, reviewing accepts commentator result. Block wrong-role subagent calls in task loop (but retain harmless management actions).
5. Malformed/unsupported clean review → blocking review with saved loop-review-<n>.md and clear reason; only contract-valid clean review may write loop-complete.md.
6. Auto-continue: after builder tool result → queue one follow-up to invoke commentator. After blocking/invalid review persisted and review limit not reached → queue one follow-up to invoke builder. No queue after valid clean, maxed, errors, quick/prototype.
7. Strengthen task prompts (architect, builder, commentator) to demand/use the acceptance/verification contract.
8. Update docs/workflows.md.
9. Add/update tests.

I need to be careful about scope: the plan says "Scope task workflow only; preserve quick/prototype behavior". So changes to adapter.ts should only affect task mode (config.mode === "task"), and quick/prototype should keep existing behavior.

Let me think about a minimal design.

**Validators:**
- Need `taskPlanValidator(content)` which checks: WORKFLOW_PLAN_STATUS: ready, has acceptance criteria section with stable AC-<n> IDs, implementation outline, verification step for every criterion.
- Need `taskReviewValidator(planContent, reviewContent)` which checks: WORKFLOW_REVIEW_STATUS: clean, reports complete plan coverage, passed verification, each plan criterion represented. Returns { ok, reason? }.

Where to put these?
- Could go in `validators.ts` as they are pure functions.
- Could go in a small companion module `task-validators.ts` inside workflow modes.
- Since validators.ts already exports `planValidator`, `loopCompleteValidator`, etc., and task.ts imports from validators.ts, I think putting task-specific validators in validators.ts or a new `src/extensions/workflow/task-validators.ts` is fine.

The plan says "Add task-specific plan/review validators in src/extensions/workflow/validators.ts (or a small pure companion module)". A companion module is cleaner to avoid bloating validators.ts.

**Hook in config/adapter:**
The plan says: "Extend the workflow configuration/adapter contract with an optional task review-validation hook that can read the persisted plan.md and commentator output without adding task-specific branches to the state machine."

So we need a new optional field on WorkflowConfig, e.g.:
```typescript
loopReviewValidator?: (ctx: { readArtifact: (phase: Phase, dir: string) => Promise<string | undefined>; readFile: (path: string) => Promise<string | undefined>; artifactDir: string; reviewText: string; reviewRound: number }) => Promise<{ ok: true } | { ok: false; reason: string }>;
```

Actually, the signature should be simpler. It needs to read plan.md and the current review text. The review text comes from the subagent result. So in adapter.ts, when we process a commentator result, we call this hook if configured.

Wait, but the plan says "read the persisted plan.md and commentator output". So the hook receives the reviewText and can read plan.md via deps.

Let me define:
```typescript
export interface TaskReviewValidationContext {
  reviewText: string;
  reviewRound: number;
  planContent: string | undefined;
}
export type TaskReviewValidator = (ctx: TaskReviewValidationContext) => { ok: true } | { ok: false; reason: string };
```

But the plan content is async to read. We could make it async, or have the adapter read it and pass it. In the spirit of keeping the SM pure, the adapter already uses deps.readArtifact. So adapter reads plan.md and passes it to the hook.

But the hook needs to be in config. Let me add to WorkflowConfig:
```typescript
loopReviewValidator?: (ctx: { reviewText: string; reviewRound: number; planContent: string | undefined }) => { ok: true } | { ok: false; reason: string };
```

Actually, looking at the plan again: "Extend the workflow configuration/adapter contract with an optional task review-validation hook that can read the persisted plan.md and commentator output without adding task-specific branches to the state machine."

This suggests the hook can read plan.md itself, so maybe give it a `readFile` function or the deps. But the simplest is adapter reads plan.md and passes it. The hook is still testable: pass planContent.

I'll add an optional field `loopReviewValidator` to `WorkflowConfig`. Actually, since it might be used by other modes, I should name it generically but document that task uses it. Or call it `reviewValidation` / `loopReviewValidation`.

Let me use `loopReviewValidator` in WorkflowConfig with type:
```typescript
loopReviewValidator?: (input: { reviewText: string; reviewRound: number; planContent: string | undefined }) => { ok: true } | { ok: false; reason: string };
```

**Adapter changes:**
In tool_result loop processing:
- Currently: when commentator result arrives, write review file, parse status, if clean write loop-complete.md, else if maxed set maxed, else set building.
- New: 
  - Validate stage: if stage is "building" and agent is not "builder" (and not management), block/warn? The plan says "block a subagent execution call that uses the wrong role for the current stage (while retaining harmless subagent management actions)".
  - When commentator result arrives and stage is "reviewing": run loopReviewValidator if configured.
  - If validator fails and reviewRound >= maxIterations: treat as blocking? Or maxed? The plan says "retain the maximum of three blocking review rounds; at the limit, save evidence and pause for explicit user intervention". So if invalid, it counts as a blocking review. If invalid at maxIt, maxed.
  - If validator fails before maxIt: save as loop-review-<n>.md with reason appended, stage=building, queue builder follow-up.
  - If status is not clean (blocking or missing): same as today.
  - If status is clean but validator fails: save as loop-review-<n>.md with reason, stage=building (unless maxed), queue builder.
  - If status is clean and validator passes: write loop-complete.md, stage=clean.

Wait, the plan says: "only a contract-valid clean review may cause the adapter to write loop-complete.md." And "Make a malformed/unsupported clean review a blocking review with a saved loop-review-<n>.md artifact and a clear reason". 

So clean status + invalid contract → blocking review. Persist to loop-review-<n>.md with the reason, increment reviewRound, and if not maxed queue builder.

**Wrong-role blocking:**
"During a task loop, block a subagent execution call that uses the wrong role for the current stage (while retaining harmless subagent management actions)."

Where does this block happen? In the `tool_call` event handler. We have access to controller.loopState and sm.snapshot.phase. If phase === "loop" and loopState exists, we can check:
- If loopState.stage === "building" and agent is not "builder" (and not management), block.
- If loopState.stage === "reviewing" and agent is not "commentator" (and not management), block.

But the plan says "subagent execution call" — does this include write/edit? No, write/edit already blocked. Only subagent calls with agent/chain/tasks should be role-checked.

Need to handle parallel arrays: if any task in `tasks` has wrong agent, block. Same for chain.

But wait, loop stage is engine-owned. The plan says "block a subagent execution call that uses the wrong role for the current stage". So yes, in tool_call handler.

**Auto-continue follow-ups:**
"After a builder tool result is persisted, queue exactly one follow-up instructing the parent to invoke the commentator..."
Today, builder result sets stage=reviewing but doesn't queue. We need to queue a follow-up.

"After a blocking or invalid review is persisted and the review limit has not been reached, queue exactly one follow-up instructing the parent to invoke the builder..."
Today, blocking result sets stage=building but doesn't queue.

"Do not queue after a valid clean review, after maxed, after errors, or for quick/prototype."

This is a significant behavior change. Previously, the task loop relied on the parent to choose. Now we queue follow-ups. We need to make sure only one follow-up is queued per event, and not duplicate on resume (resumeController already emits prompts; don't double-queue). Also tool_call wrong-role block prevents the call so no follow-up needed.

Where to queue? In `applyControllerEffect` after processing the tool_result. We can inspect `eff` and `controller.loopState`. But we also need to know what event was processed. Maybe better: at the end of tool_result handler, after persist, based on loopState and whether it's task mode, queue.

Wait, but plan→loop auto-advance already queues the loop prompt (builder/review loop) via `applyControllerEffect(..., { queuePrompt: config.continueAfterArtifact === true && eff.kind === "advanced" })`. That sends the LOOP phase prompt which tells the parent to start with builder. So the first builder call is not automatically queued; the prompt says to call builder. That's fine.

After the builder tool result: we've just persisted, loopState.stage is "reviewing". We should queue a follow-up: "call commentator now". But note that the parent is in streaming mode (tool_result fires mid-turn). Use `continueAgent` with `deliverAs: "followUp"`.

Hmm, but we don't want to queue after every builder result twice. The builder result already has the parent's normal continuation. We add one follow-up. That's exactly what the plan says.

Actually wait: if the parent is mid-turn and the tool_result handler queues a follow-up with deliverAs:"followUp", will this create a new turn? Yes, that's the intent. The parent model will receive the follow-up after finishing its current turn.

Need to be careful about dedupe. Use a sentinel? Or just queue once per event. Since tool_result handler is called once per tool result (deduped by toolCallId), each event queues at most one follow-up. But if a tool_result is for a wrong-role call that's blocked at tool_call, it never produces a result... actually, if blocked at tool_call, is there a tool_result? Probably not. So no issue.

What about resume? `resumeController` emits prompts directly for the current stage. We should NOT auto-queue after a resume because the resume itself already gave the instruction. The tool_result handler only fires when a tool actually returned. So resume doesn't trigger tool_result. Good.

What about `onArtifactMaybe` writing loop-complete.md from a clean review and advancing to audit? At that point loopState.stage === "clean". We should not queue builder/commentator. That's covered by "Do not queue after a valid clean review".

What about maxed? "After a blocking or invalid review is persisted and the review limit has not been reached". So if maxIt reached, don't queue. But we already notify maxed. Good.

What about errors? "after errors" — if event.isError, don't queue. The existing error branch already handles onArtifactMaybe. We should check.

So implementation:
- At end of tool_result handler, after applyControllerEffect, if config.mode === "task" and loopState:
  - If event.isError: do nothing (covered).
  - If loopState.stage === "reviewing" and previous stage was "building" (i.e., we just processed a builder result): queue commentator follow-up.
  - If loopState.stage === "building" and previous stage was "reviewing" (i.e., we just processed a blocking/invalid review) and reviewRound < maxIterations: queue builder follow-up.

But how do we know "previous stage"? We can capture it before processing.

Actually, simpler: at the time we process the builder result, after setting stage="reviewing", queue. At the time we process commentator result, after setting stage="building" (blocking), if reviewRound < maxIt, queue.

But careful: if onArtifactMaybe advances phase to audit (clean review), loopState is cleared at the end of handler (because sm.snapshot.phase !== "loop"). So we must queue before clearing? Actually clean review shouldn't queue. Good.

Also: if commentator result is invalid contract, we set stage=building and queue if not maxed. Need to save review file with reason appended.

Let's also consider: what if the parent calls commentator before builder? tool_call blocks it if stage=building and agent=commentator. So no result arrives.

**Prompts:**
- Architect prompt: demand acceptance/verification contract (AC-* IDs, implementation outline, verification step per criterion).
- Builder prompt: implement every AC-* item and run verification steps.
- Commentator prompt: inspect plan and uncommitted diff, run applicable verification, list criterion-by-criterion evidence, only use clean when all criteria pass.

**Tests:**
- Existing task-workflow.test.ts already covers many cases. Need to extend for:
  - valid strict plan acceptance (plan validator)
  - automatic builder→commentator and blocking-review→builder follow-ups
  - no duplicate follow-ups
  - missing coverage/verification rejects claimed clean review and leaves loop
  - valid evidence-backed clean review creates loop-complete.md
  - wrong-role subagent calls blocked by stage
  - persisted resume continues correct role
  - third blocking review pauses without fourth automatic call

Need to update tests to use strict plan content with AC-* IDs.

Also need to add validator unit tests maybe.

**Key decisions:**
- Use a separate `task-validators.ts` file for task-specific validators.
- Use generic `loopReviewValidator` in WorkflowConfig. Add it to task.ts config.
- Adapter changes conditional on `config.mode === "task"` for role-blocking and auto-continuations, but loopReviewValidator can be generic.

Actually, the plan says "During a task loop" for role-blocking. So conditional on task. But loopReviewValidator is the mechanism; task config provides it. If another mode provides one, the adapter would use it too, but we can also guard by the presence of the validator. The plan says "optional task review-validation hook". I'll make the adapter invoke it whenever it's configured. The role-blocking can be guarded by task mode or by the presence of loopState + config. Since only task has the strict loop, and the config can indicate this with `continueAfterArtifact`, but prototype/quick also have loop with continueAfterArtifact=false. Hmm.

Maybe the role-blocking should apply in loop phase whenever `loopReviewValidator` is configured, because that's the contract. But the plan explicitly says "task loop". To be safe, I'll make role-blocking conditional on `config.loopReviewValidator !== undefined` OR `config.mode === "task"`. Since only task will configure it, that's effectively task-only.

Actually, let's just use `config.loopReviewValidator` presence. That way it's a generic contract.

But for auto-continue follow-ups, plan says "for task" and "do not queue ... for quick/prototype". So auto-continue follow-ups conditional on task. Use `config.mode === "task"`.

Wait, but if loopReviewValidator is the generic mechanism, why not auto-continue for any mode with it? The plan is specific. I'll follow plan: auto-continue only for task.

**Wrong-role detection at tool_call:**
Need to extract agent list from subagent input. We already parse for forceSubagentOutputToArtifactDir. We can add a helper `subagentAgents(input)` that returns set of agents for execution calls. If loopState.stage is "building" and the set doesn't include "builder" (or set is empty?), block. If stage is "reviewing" and set doesn't include "commentator", block.

Need to be careful: stage could be "clean" or "maxed" (unlikely at tool_call time but possible after resume). If not building/reviewing, no role block.

Also need to block only execution calls. Management actions return early.

Where to insert in tool_call handler? After write/edit block and before force-output. Or after force-output? It doesn't matter much, but blocking should happen early. Let me put it after the active check and before force output.

**Reading plan.md for validator:**
In adapter.ts, in commentator processing:
```typescript
const planContent = await deps.readArtifact("plan", sm.snapshot.artifactDir);
```
But `readArtifact` takes phase. In task mode, phaseArtifacts["plan"] = "plan.md". Good.

If planContent is undefined, validator fails with reason "cannot read plan.md".

**Saving invalid/malformed review:**
When validator fails or status not clean, we write the reviewText to loop-review-<round>.md. For validator failure, we append or prepend the reason. The plan says "with a clear reason". I'll prepend a header like `<!-- WORKFLOW_REVIEW_STATUS: blocking -->\nReason: ...\n\n` or just add to text. Since the marker is case-insensitive and can be anywhere, let's add at top:
```markdown
WORKFLOW_REVIEW_STATUS: blocking
Reason: Review claimed clean but does not satisfy the task review contract: ...
<original text>
```

This ensures parseLoopReviewStatus sees "blocking".

**Tests need adjusted plan content:**
Existing tests use plan content "# Plan\nWORKFLOW_PLAN_STATUS: ready" which would now fail taskPlanValidator. We need to update task-workflow.test.ts fixtures to include AC-* IDs, outline, verification.

Also adapter.test.ts uses PLAN_OK constant for prototype. Task tests are in task-workflow.test.ts. We can update that file's plan fixtures. But the `PLAN_OK` in adapter.test.ts is for prototype, so no change needed.

Wait, in task-workflow.test.ts the architect text fallback test uses "# Plan\nWORKFLOW_PLAN_STATUS: ready" which would fail the new taskPlanValidator. So that artifact won't advance. Need to update to valid strict plan content.

**Plan validator implementation:**
What counts as valid?
- Must contain `WORKFLOW_PLAN_STATUS: ready` (case-insensitive). We can reuse markerValidator but combine with AC checks.
- Must contain acceptance criteria section. Look for `/^##\s*Acceptance Criteria\b/im`.
- Must contain AC-<n> IDs. Regex `/\bAC-\d+\b/g`. At least one.
- Each AC-<n> must have a verification step. How to verify? Strict: after each AC-<n> heading/line, there should be a "Verification:" line. Could be in the same section. We can parse sections. Simpler: require the text contains "Verification:" at least once per AC. But the plan says "a verification step for every criterion". We could check count(AC-* IDs) <= count("Verification:"). Or use a stricter parser.

Let's do:
- Find all AC-* IDs: regex `/\b(AC-\d+)\b/g`.
- For each AC-* ID, look for a line starting with `- Verification:` or `Verification:` following the AC-* line. Hmm, unstructured markdown.

Given this is a contract for AI-generated plans, we can be reasonably lenient but deterministic. A good check:
1. Contains `## Acceptance Criteria` section.
2. All `AC-<n>` IDs are unique.
3. Contains at least as many occurrences of `Verification:` (case-insensitive) as AC-* IDs (or each AC-* has a verification nearby).

For "each plan criterion represented" in review, we need to know the AC-* list from plan. So validator returns set of AC-* IDs? Or we can recompute in review validator.

The simplest robust design for taskPlanValidator:
- Parse acceptance criteria section with regex extracting `AC-<n>` IDs.
- Ensure non-empty and unique.
- Check for `## Implementation Outline` or `## Implementation` section.
- Check each AC-* has a nearby "Verification:" mention. For simplicity, count `Verification:` occurrences >= AC count.

The review validator:
- Parse plan AC-* IDs.
- Parse review AC-* IDs and state per criterion (pass/fail/block). We can require the review mentions each plan AC-* ID at least once, and contains `WORKFLOW_REVIEW_STATUS: clean`.
- Check `WORKFLOW_REVIEW_STATUS: clean` present.
- Check `Verification:` or "passed" for each AC? Simpler: require review text contains each AC-* from plan. Also require evidence phrase like "evidence" or "passed".

Actually, let's think: the contract needs to be machine-checkable but also not so strict that reasonable AI output fails. The acceptance criteria are critical. The review must reference each one. The prompt will tell commentator to do so. The validator checks that.

Plan:
- `taskPlanValidator`:
  - marker `WORKFLOW_PLAN_STATUS: ready` present.
  - Contains `## Acceptance Criteria` heading.
  - Has at least one `AC-` followed by digits, all unique.
  - Contains `## Implementation Outline` heading.
  - Count of (case-insensitive) standalone "Verification:" occurrences is at least AC count.
  
`taskReviewValidator`:
  - marker `WORKFLOW_REVIEW_STATUS: clean` present.
  - plan AC-* IDs are all mentioned in review text.
  - Review text contains "evidence" (case-insensitive) at least once per AC? Or at least once total.
  - Review text contains "passed" or "verification" at least once? Let's require at least one case-insensitive occurrence of "evidence" and one of "verification" or "passed".

Hmm, the plan specifically says: "task review: accepted clean status only when it reports complete plan coverage and passed verification, with each plan criterion represented."

So review validator should:
- Check status is clean (already done by adapter parse? We'll also check).
- Ensure each plan AC-* ID appears in review.
- Ensure review says verification passed. Could check for "Verification passed" or each AC has "passed". 

I'll implement:
```typescript
function taskReviewValidator(planContent: string | undefined, reviewText: string) {
  const planIds = extractACIds(planContent ?? "");
  const reviewIds = extractACIds(reviewText);
  // ... check clean marker
  // ... check planIds subset of reviewIds (all represented)
  // ... check reviewId uniqueness
  // ... check some evidence/verification passed indicator
}
```

For "passed verification", require the review text to contain "verification passed" (case-insensitive) or each AC-* line includes "passed".

Maybe simpler: require review text contains "Verification passed" (case-insensitive). But if multiple ACs, maybe one "All verifications passed" is fine. 

Let's require:
- Contains "verification" (case-insensitive) and "passed" (case-insensitive) somewhere.

This is low bar but matches the instruction. The prompt will require per-criterion evidence.

Concern: this might be too easy to fake. But the goal is deterministic machine-checkable contract. Combined with human/AI review quality, it's a guardrail.

**Where to put validators?**
Create `src/extensions/workflow/task-validators.ts` importing `MARKERS` from validators.ts or duplicating.

Actually, validators.ts currently has markerValidator. I can make task-validators.ts depend on it. Or put all in validators.ts. The plan says "or a small pure companion module". Companion is clean. Let's create `src/extensions/workflow/task-validators.ts`.

**Prompts in task.ts:**
- plan: update to say plan MUST include "## Acceptance Criteria" with AC-<n> IDs, "## Implementation Outline", and a verification step per criterion; end with WORKFLOW_PLAN_STATUS: ready.
- loop (builder/commentator orchestration): already has builder/commentator. Need to update to reference AC-* items and verification.
- Actually task only has plan and loop phases. The loop prompt is the orchestrator prompt. The builder/commentator prompts are not separate files? They are generated by the orchestrator. The prompt tells the orchestrator what to instruct builder and commentator. So we update the loop prompt to say:
  - Builder: implement every AC-* item, run verification steps, report results.
  - Commentator: inspect plan and diff, run applicable verification, list criterion-by-criterion evidence with each AC-*, only use clean when all criteria pass and verification succeeded.

Also architect prompt has this. So plan prompt also demands acceptance criteria.

**Update docs/workflows.md task section:**
- Define task clean status (contract-valid clean review).
- Automatic task-loop continuations.
- Three-round safety cap.
- Limitation that AI review is evidence-based not mathematical proof.

**Tests:**
Update `src/__tests__/task-workflow.test.ts`:
- Provide valid strict plan content.
- Add tests for wrong-role block, auto-follow-ups, invalid clean review, etc.

We might also add unit tests for task validators in a new test file or in task-workflow.test.ts. The plan says "Add/update focused tests". I can add tests in task-workflow.test.ts or create `src/__tests__/task-validators.test.ts`. Given "focused", a new test file for validators is clean. But task-workflow.test.ts also needs updating.

Given limited turn budget, I should implement the changes, run tests, and write acceptance report.

Let me proceed step by step.

First, implement task-validators.ts.
Then update state-machine.ts WorkflowConfig type with loopReviewValidator.
Then update task.ts config with validators and loopReviewValidator and updated prompts.
Then update adapter.ts for role-blocking, review validation, auto-continuations.
Then update docs/workflows.md.
Then update tests.
Then run build and tests.

Let me draft task-validators.ts.

```typescript
// ponytail: task-specific validators enforce the acceptance/verification
// contract used only by task mode. Pure string functions; no fs/pi.

import { markerValidator } from "./validators.ts";

const PLAN_READY = markerValidator("WORKFLOW_PLAN_STATUS", "ready");
const REVIEW_CLEAN = markerValidator("WORKFLOW_REVIEW_STATUS", "clean");

const AC_ID_RE = /\bAC-(\d+)\b/gi;
const ACCEPTANCE_CRITERIA_HEADING_RE = /^##\s+Acceptance Criteria\b/im;
const IMPLEMENTATION_HEADING_RE = /^##\s+Implementation Outline\b/im;
const VERIFICATION_RE = /\bVerification\s*:/gi;

function extractACIds(text: string): string[] {
  const ids: string[] = [];
  let m: RegExpExecArray | null;
  AC_ID_RE.lastIndex = 0;
  while ((m = AC_ID_RE.exec(text)) !== null) {
    ids.push(m[0]!.toUpperCase());
  }
  return ids;
}

export const taskPlanValidator = (content: string) => {
  const marker = PLAN_READY(content);
  if (!marker.ok) return marker;

  if (!ACCEPTANCE_CRITERIA_HEADING_RE.test(content)) {
    return { ok: false, reason: "missing `## Acceptance Criteria` section" };
  }
  const ids = extractACIds(content);
  if (ids.length === 0) {
    return { ok: false, reason: "acceptance criteria section must contain at least one AC-<n> ID" };
  }
  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    return { ok: false, reason: "acceptance criteria AC-<n> IDs must be unique" };
  }
  if (!IMPLEMENTATION_HEADING_RE.test(content)) {
    return { ok: false, reason: "missing `## Implementation Outline` section" };
  }
  const verifications = (content.match(VERIFICATION_RE) ?? []).length;
  if (verifications < unique.size) {
    return { ok: false, reason: "each AC-<n> must have a Verification: step" };
  }
  return { ok: true } as const;
};

export function taskReviewValidator(planContent: string | undefined, reviewText: string) {
  const marker = REVIEW_CLEAN(reviewText);
  if (!marker.ok) return marker;

  const planIds = extractACIds(planContent ?? "");
  if (planIds.length === 0) {
    return { ok: false, reason: "plan contains no AC-<n> criteria; cannot verify coverage" };
  }
  const reviewIds = extractACIds(reviewText);
  const missing = planIds.filter((id) => !reviewIds.includes(id));
  if (missing.length > 0) {
    return { ok: false, reason: `review is missing coverage for ${missing.join(", ")}` };
  }
  if (!/\bpassed\b/i.test(reviewText) || !/\bverification\b/i.test(reviewText)) {
    return { ok: false, reason: "review must report that verification passed" };
  }
  return { ok: true } as const;
}
```

Note: `taskReviewValidator` returns `{ ok:true } | { ok:false; reason:string }`, same shape as WorkflowArtifactValidator. But since it needs planContent, it can't be used as a direct artifact validator. It will be used as loopReviewValidator.

Add to WorkflowConfig:
```typescript
loopReviewValidator?: (input: { reviewText: string; reviewRound: number; planContent: string | undefined }) => { ok: true } | { ok: false; reason: string };
```

Add to task.ts config:
```typescript
artifactValidators: {
  plan: taskPlanValidator,
  loop: loopCompleteValidator,
},
loopReviewValidator: ({ reviewText, planContent }) => taskReviewValidator(planContent, reviewText),
```

Also need to import taskPlanValidator, taskReviewValidator.

**Adapter changes:**

1. In `tool_call` handler, add role-blocking for task loop. Need to capture controller.loopState. Place within active workflow, after write/edit block.

Add helper:
```typescript
function wrongRoleForTaskLoop(controller: WorkflowController, input: Record<string, unknown>): { block: true; reason: string } | undefined {
  if (controller.config.mode !== "task") return;
  const ls = controller.loopState;
  if (!ls || sm.snapshot.phase !== "loop") return;
  if (ls.stage !== "building" && ls.stage !== "reviewing") return;
  const agents = new Set(extractAgents(input));
  if (agents.size === 0) return;
  if (ls.stage === "building" && !agents.has("builder")) {
    return { block: true, reason: `Loop stage is ${ls.stage}; expected agent "builder", got ${[...agents].join(", ")}.` };
  }
  if (ls.stage === "reviewing" && !agents.has("commentator")) {
    return { block: true, reason: `Loop stage is ${ls.stage}; expected agent "commentator", got ${...agents].join(", ")}.` };
  }
}
```

Need extractAgents function similar to forceSubagentOutputToArtifactDir but simpler. We already traverse input for forcing output. Maybe reuse by adding an `agents` helper. Let's write `collectSubagentAgents(input): string[]`.

Add in tool_call:
```typescript
if (tool === "subagent" && isSubagentManagementAction(event.input)) return;
const roleBlock = wrongRoleForTaskLoop(controller, event.input);
if (roleBlock) return roleBlock;
const file = config.phaseArtifacts[snap.phase];
...
```

Wait, wrongRoleForTaskLoop references `sm` (state machine). It should use `controller.sm`. Also `controller` is not in the tool_call handler's scope at that point? The tool_call handler has access to `sm` and `config`, and `controller` is in outer scope. Actually `controller` is defined in the closure after `registry.controllers.push(controller)`. So yes, accessible.

But careful: the handler is registered per mode, and `controller` uses that mode's controller. However, there could be multiple active controllers for the same pi. The `tool_call` handler runs for every registered mode's controller. We need to only block if the active controller for this mode is in task loop. But there can be only one active at a time. Yet each mode's handler will be called. The existing handler already checks `if (!isRegisteredController(controller)) return;` and `if (!sm.snapshot.active) return;`. If prototype is active, prototype's handler will run and block wrong role? We add `config.mode !== "task"` so prototype won't block. Good.

But if task is active, task's handler will run. If quick is active, quick's handler won't block. Good.

However, if we use presence of loopReviewValidator instead of mode, both task would block and any other mode with validator would block. To be safe for plan, use `config.mode !== "task"`. But maybe a better generic condition: `config.loopReviewValidator && controller.loopState && sm.snapshot.phase === "loop"`. Since only task configures it, quick/prototype unaffected. I'll use `if (!config.loopReviewValidator) return;` so it's generic and tied to the contract. But the plan specifically says "task". Since there are no other modes with it, both are equivalent. Use the generic one.

Actually, for clarity and to avoid surprising future modes, use the generic presence. But add a comment noting task-specific behavior.

2. In `tool_result` handler loop commentator processing:
Current logic:
```typescript
} else if (agent === "commentator") {
  const reviewRound = ls.reviewRound + 1;
  const reviewText = textFromToolResultContent(event.content);
  if (reviewText) {
    const reviewPath = `loop-review-${reviewRound}.md`;
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, reviewPath), reviewText, "utf8");
    ls.reviewPath = reviewPath;
  }
  ls.reviewRound = reviewRound;
  const status = parseLoopReviewStatus(reviewText);
  if (status === "clean") {
    ls.stage = "clean";
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, config.phaseArtifacts["loop"]!), `Loop complete after ${ls.reviewRound} review round(s).\n${MARKERS.loopComplete}`, "utf8");
  } else if (ls.reviewRound >= ls.maxIterations) {
    ...
    ls.stage = "maxed";
  } else {
    ls.stage = "building";
  }
}
```

New logic:
```typescript
} else if (agent === "commentator") {
  const reviewRound = ls.reviewRound + 1;
  let reviewText = textFromToolResultContent(event.content) ?? "";
  const contract = config.loopReviewValidator && ls.stage === "reviewing"
    ? config.loopReviewValidator({ reviewText, reviewRound, planContent: await deps.readArtifact("plan", dir) })
    : { ok: true };
  const status = parseLoopReviewStatus(reviewText);
  const effectiveStatus: "clean" | "blocking" = (() => {
    if (status !== "clean") return "blocking";
    if (!contract.ok) return "blocking";
    return "clean";
  })();
  
  // Save review file with reason if blocking
  const reviewPath = `loop-review-${reviewRound}.md`;
  await mkdir(dir, { recursive: true });
  if (effectiveStatus === "blocking") {
    let textToSave = reviewText;
    if (status === "clean" && !contract.ok) {
      textToSave = `WORKFLOW_REVIEW_STATUS: blocking\nReason: Review claimed clean but does not satisfy the task review contract: ${contract.reason}\n\n${reviewText}`;
    } else if (status !== "clean") {
      // ensure marker? Not necessary; we can prepend if missing to make it explicit.
      if (!status) {
        textToSave = `WORKFLOW_REVIEW_STATUS: blocking\nReason: missing required WORKFLOW_REVIEW_STATUS marker (treated as blocking)\n\n${reviewText}`;
      }
    }
    await writeFile(resolve(dir, reviewPath), textToSave, "utf8");
  } else {
    await writeFile(resolve(dir, reviewPath), reviewText, "utf8");
  }
  ls.reviewPath = reviewPath;
  ls.reviewRound = reviewRound;
  
  if (effectiveStatus === "clean") {
    ls.stage = "clean";
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, config.phaseArtifacts["loop"]!), `Loop complete after ${reviewRound} review round(s).\n${MARKERS.loopComplete}`, "utf8");
  } else if (ls.reviewRound >= ls.maxIterations) {
    const wasMaxed = ls.stage === "maxed";
    ls.stage = "maxed";
    if (!wasMaxed) notify max;
  } else {
    ls.stage = "building";
  }
}
```

Wait, the original saved review file only if reviewText existed. Now we always want to save for bookkeeping, even if empty? If reviewText is empty, we can't save much. But empty review no marker → blocking. We can save a file with "no review text" reason. Let's always save if effectiveStatus blocking. If clean, save. But original only saved if reviewText. I think we should save always for blocking/invalid because it's evidence. For empty, we save a reason.

But note: if reviewText is empty and status undefined, we prepend reason. Good.

However, writing review file for clean review: Do we need to save clean reviews? The plan says "save loop-review-<n>.md artifact" for malformed/unsupported clean review. For valid clean, we also write loop-complete.md. It doesn't say to not save clean reviews. Existing code saved clean reviews too. Keep that.

Also note reviewRound variable: use it consistently.

3. Auto-continue follow-ups.
Need to capture `const previousLoopStage = ls.stage;` before agent processing? Actually we can know after processing. Let me think.

After builder result: we set `ls.stage = "reviewing"`. We want to queue commentator follow-up if not error and not maxed/clean. So after processing builder and before/after persist, queue.

After commentator result with effectiveStatus blocking and not maxed: we set `ls.stage = "building"`. Queue builder follow-up.

Where to queue? After persist is safer, because if persist fails we don't queue. But we currently return early on persist error. Actually, persist error logs notify and returns, not throwing. In `tool_result` handler, after `await persistAfter`, if error, `return`. So if we queue after persist, persistence failures won't queue. Good.

But `applyControllerEffect` is called after persist. Maybe combine.

Let's add a function `maybeQueueTaskLoopFollowUp(controller, ctx, beforeStage)`:
- If config.mode !== "task" return.
- If beforeStage === "building" and after stage === "reviewing": queue commentator.
- If beforeStage === "reviewing" and after stage === "building" and reviewRound < maxIterations: queue builder.

Wait, `beforeStage` is the stage before processing this tool result. For builder result, beforeStage should be "building"? Actually before processing builder, stage is "building" (set when previous review was blocking or initial loop start). But is it? After a clean plan advances to loop, there is no loopState. The first builder result creates loopState with stage=building (default). So before processing builder, ls.stage is "building". After processing, it becomes "reviewing". Good.

For commentator result, before stage is "reviewing". After, either "clean", "maxed", or "building".

What about initial state where ls is undefined and builder is called? We create ls with stage "building" at start of processing. So beforeStage from `controller.loopState` before creation is undefined. We need to know if this was a builder result. We can just use `agent === "builder"` to queue.

Plan: at end of `tool_result` handler, after persist and applyControllerEffect, if config.mode === "task" and !event.isError:
```typescript
if (agent === "builder" && controller.loopState?.stage === "reviewing") {
  continueAgent(pi, ctx, `Builder result recorded. Call the subagent tool now with { agent: "commentator", task: "..." } to review the uncommitted diff against ${sm.snapshot.artifactDir}/plan.md.`);
} else if (agent === "commentator" && controller.loopState?.stage === "building" && controller.loopState.reviewRound < controller.loopState.maxIterations) {
  continueAgent(pi, ctx, `Review recorded as ${controller.loopState.reviewPath}. Call the subagent tool now with { agent: "builder", task: "..." } to address the feedback in ${sm.snapshot.artifactDir}/${controller.loopState.reviewPath}.`);
}
```

But need to ensure only one per event. Since we check `agent`, and each subagent result has one agent, fine.

But what if a commentator result is clean → stage becomes "clean", not "building", so no queue. Good.
What if commentator result is invalid clean → stage becomes "building" (if not maxed), queue builder. Good.
What if commentator result is blocking → stage becomes "building", queue builder. Good.
What if commentator result at maxIt → stage becomes "maxed", no queue. Good.
What if builder result → stage becomes "reviewing", queue commentator. Good.

Wait, but the loop prompt at start already says "Call builder, then commentator". The first builder result will queue commentator. But also the parent might already call commentator on its own after builder result. With follow-up, it might double-call? The plan says "queue exactly one follow-up instructing the parent to invoke the commentator". So this is intentional. The parent model gets a follow-up after its current turn. If it already decided to call commentator, the follow-up may be redundant but harmless? The test "no duplicate follow-ups" refers to not queuing multiple for same event, not necessarily parent not calling on its own.

Actually, with this design, after builder tool_result, the parent receives a follow-up to call commentator. But the parent might be in the middle of a turn where it already called commentator immediately after builder (two tool calls in one turn). The second tool_result (commentator) would then set stage=building and queue builder before the follow-up for commentator is even delivered. Hmm. But tool_result events are sequential. If parent calls builder then commentator in same turn, first tool_result processes builder and queues commentator follow-up. Then second tool_result processes commentator and queues builder follow-up. The parent turn ends. It receives two follow-ups: one to call commentator, one to call builder. This could be conflicting.

But in practice, the parent can't call commentator until builder result returns (streaming). If it calls commentator in the same turn, it's because the loop prompt told it to. The follow-ups are additional. After a blocking review, it gets builder follow-up (correct). After a builder result, it gets commentator follow-up (correct). If both happen in same turn (builder then commentator), the last follow-up is builder, which is the correct next role. However the earlier commentator follow-up is still in follow-up queue; how does framework handle multiple follow-ups? The docs mention `deliverAs: "followUp"` but not multiple. In streaming mode, multiple follow-ups might overwrite or queue. The test says no duplicate follow-ups. We need to make sure we don't send two for same event. But across two events in same turn, it's not duplicate per event.

Actually, maybe the intent is: after a builder tool result, queue commentator follow-up and ALSO prevent the parent from making another decision? But the parent is autonomous.

Alternative: maybe we should queue follow-ups only if the parent is idle? But tool_result fires mid-turn. deliverAs followUp is appropriate.

The plan says: "queue exactly one follow-up instructing the parent to invoke the commentator with the plan and current diff." So per builder result, one.

I think the test will verify `sent` array length increments by 1 after builder result and by 1 after blocking review. If parent calls both in same turn, sent will have 2. But the tests likely use sequential events.

Potential issue: after plan→loop auto-advance, the prompt already instructs to call builder. Then when builder result returns, we queue commentator. So parent gets loop prompt, runs builder, then receives follow-up to run commentator. Good.

After blocking review, parent gets follow-up to run builder. Good.

For valid clean review, no follow-up; the onArtifactMaybe will advance to terminal-ready? Wait, task's phases are ["plan", "loop"]. Loop is terminal. onArtifactMaybe sees loop-complete.md and returns terminalReady. applyControllerEffect then queues terminalReady prompt: "Terminal artifacts are ready. Call the explicit end workflow tool...". So parent is told to call end_task_workflow. Good.

For invalid clean at maxIt: stage=maxed, no follow-up, notify maxed. The onArtifactMaybe doesn't advance (loop-complete.md not written). The workflow remains in loop phase maxed. Good.

**Resume logic:**
resumeController currently emits prompts based on loopState. Need to ensure it still works. With auto-continuations, resume should not queue additional follow-ups. It doesn't call tool_result. It uses continueAgent directly. Good.

But resume when stage="reviewing" should instruct commentator. Stage="building" should instruct builder. Stage="maxed" should notify pause. Existing code already handles. Good.

**Prompt updates:**

Update task.ts plan prompt:
```
Produce a concrete implementation plan with three required sections:

1. ## Implementation Outline
   - Ordered list of files/components to change and how.

2. ## Acceptance Criteria
   - Numbered criteria with stable IDs: AC-1, AC-2, ...
   - Each criterion must be concrete and testable.

3. ## Verification
   - For every AC-<n> above, include a verification step that says how to confirm it passes.

The plan MUST end with exactly one machine-readable line on its own:
  WORKFLOW_PLAN_STATUS: ready
```

Update loop prompt:
```
Use read to inspect ${artifactDir}/plan.md. Using that context, GENERATE YOUR OWN delegation prompt.

Call the subagent tool with { agent: "builder", task: "..." }. Instruct the builder to:
- Implement every AC-* item from plan.md in order.
- Run the plan's verification steps and report the results.
- Make all code changes in the workspace, never in ${artifactDir}.

After the builder returns and has reported verification results, call the commentator. Instruct the commentator to:
- Read ${artifactDir}/plan.md and inspect the uncommitted diff.
- Run any applicable verification steps from the plan.
- List evidence for each AC-* criterion explicitly (AC-1 evidence, AC-2 evidence, ...).
- Use WORKFLOW_REVIEW_STATUS: clean only when all criteria pass and verification succeeded; otherwise use WORKFLOW_REVIEW_STATUS: blocking.

If a review is blocking, call the builder again with the recorded issues. This repeats up to ${loopMaxIterations ?? 3} round(s). When a review is contract-valid clean, the engine writes loop-complete.md and the workflow becomes terminal-ready. Do NOT write loop-complete.md yourself. Call end_task_workflow to complete the workflow.
```

**WorkflowConfig type:**
Add loopReviewValidator.

**Tests:**

Update task-workflow.test.ts createHarness maybe? It currently uses h.ctx.isIdle false. For follow-ups, `continueAgent` checks ctx.isIdle. If false, uses deliverAs followUp. The test harness ctx.isIdle is `() => false`, so followUps sent. Good.

But for auto-continuations, in tool_result handler, ctx is passed from event. In tests, h.ctx is fixed isIdle false. Good.

Need to update plan contents in task-workflow.test.ts.

Let's list plan usages in task-workflow.test.ts:
- line 59 (approx): content.set("/task-run/plan.md", "# Plan");
- line 64: content.set("/task-run/plan.md", "# Plan\nWORKFLOW_PLAN_STATUS: ready");
- line 117: writeFileSync(join(dir, "plan.md"), "# Plan\nWORKFLOW_PLAN_STATUS: ready");
- line 152: architect content "# Plan\nWORKFLOW_PLAN_STATUS: ready";
- line 169: architect content "WORKFLOW_PLAN_STATUS: ready";
- test "requires a ready plan..." uses pure SM with taskMode.config; taskPlanValidator now applies, so need valid content.

I'll create a helper constant `TASK_PLAN_OK` with valid strict plan content, and use it throughout.

Also for adapter-level tests, the state machine's artifactValidator for plan is taskPlanValidator. The write_workflow_artifact test uses content "# Plan\nWORKFLOW_PLAN_STATUS: ready" which will fail. Need to use TASK_PLAN_OK.

Also for commentator clean reviews, need to include AC IDs and evidence/verification/passed. Since the taskPlanValidator creates plan with AC-1, AC-2, the review must mention AC-1, AC-2 and contain "Verification" and "passed". Create `TASK_REVIEW_CLEAN` constant.

Potential subtlety: existing adapter.test.ts uses `taskMode`? No, adapter.test.ts uses prototypeMode. So no changes needed there.

But task-workflow.test.ts might also test wrong-role blocking via tool_call. Need to add.

Test for missing coverage/verification rejects clean review:
- Set valid plan.
- Builder result.
- Commentator result with clean marker but missing AC evidence → loopState stage should be building, review file saved with reason, no loop-complete.md, follow-up queued to builder.
- Then maybe max out? Not needed.

Test for valid evidence-backed clean review creates loop-complete.md:
- Already covered somewhat, but need to include evidence.

Test for wrong-role subagent calls blocked by stage:
- Start task, write valid plan → loop.
- Simulate builder result → stage reviewing.
- tool_call with agent builder → should be blocked? Wait stage is reviewing; expected commentator. So builder call blocked.
- Simulate commentator result → stage building.
- tool_call with agent commentator → should be blocked.

Test for auto-follow-ups:
- After builder result, h.sent contains commentator instruction.
- After blocking review result, h.sent contains builder instruction.
- No duplicate follow-ups: after builder result, exactly one commentator follow-up; after commentator result, exactly one builder follow-up.

Test for third blocking review pauses without fourth automatic call:
- After 3 rounds, stage=maxed, no builder follow-up queued for the third blocking event (because round >= max). Actually after third blocking review, reviewRound=3, maxIt=3, stage=maxed, no queue. Ensure h.sent doesn't have a builder follow-up from that event.

Wait, but the builder result for round 3 queues a commentator follow-up. The third blocking review doesn't queue builder. So sent might contain commentator follow-up from builder. That's ok. Test should verify after third blocking review, no builder follow-up is added, and total comments? It can check the last sent message is the commentator follow-up (from builder round 3), not a builder follow-up.

Actually, we need to track that "third blocking review pauses without a fourth automatic call". After the third commentator result, no follow-up. So `h.sent` length increments by 0 from that event (but it might have incremented earlier). Good.

Also `resumeController` for maxed stage should emit paused notification and no follow-up. Existing test covers.

**Test harness modifications:**
The `createHarness` in task-workflow.test.ts currently uses h.ctx.isIdle = () => false. `continueAgent` will use deliverAs:"followUp". Good for capturing sent.

But `resumeController` checks `if (ctx.isIdle()) { pi.sendUserMessage(prompt); } else { pi.sendUserMessage(prompt, { deliverAs: "followUp" }); }`. In h.ctx isIdle=false, so it uses followUp. Good.

**Build:**
`npm run build` excludes extensions and tests? Wait tsconfig.build.json excludes "src/extensions", "src/__tests__". So build won't compile our changes? But the extension files are copied as-is by copy-assets. The runtime uses jiti? Actually, pi loads extensions. The build output copies src/extensions to dist/extensions but does not compile them. How are they run? The package.json copy-assets copies them. They are TypeScript imported by jiti at runtime in the extension host? Or maybe the extension host compiles them. In any case, build may not type-check extensions. But tests do type-check via vitest. So build might pass even if extension has types issues, but tests catch them.

We should still run tests and build.

**Potential issue: TypeScript import of task-validators.ts from task.ts.**
Need to ensure vitest can resolve.

**Potential issue: WorkflowConfig.loopReviewValidator type.**
Will add to state-machine.ts.

**Potential issue: Applying wrongRoleForTaskLoop before `sm.snapshot` vs active controller.**
The tool_call handler uses `sm` (the state machine for this mode's controller). But if multiple controllers exist, only one active. The active controller's loopState is used. Good.

But `controller` variable is accessible? Yes.

**Potential issue: `wrongRoleForTaskLoop` uses snap.phase === "loop".**
But the subagent call might be for another reason in loop, e.g., user calls subagent action list. We already returned early for management actions. Good.

**Potential issue: multiple agents in tasks/chain.**
If stage=reviewing and tasks contains builder+commentator, we allow? It has commentator, so OK. But builder in reviewing stage might be wrong? The plan says "expected agent commentator". If a chain includes builder, that might be a wrong role. But chains in loop phase are allowed per existing code. However, the plan says "block a subagent execution call that uses the wrong role for the current stage". So if any execution agent doesn't match, block. So if stage=reviewing and tasks agents = {builder, commentator}, block because builder is wrong. Or should we allow because commentator is present? The intent is one role per stage. So require all agents match expected role? A parallel with both builder and commentator in reviewing stage is suspicious. But maybe a legitimate use: commentator and another assistant. To be strict, if stage=reviewing, only agent commentator is allowed. So block if any agent is not commentator. Similarly for building, only builder allowed.

Let's implement: collect agents, if any agent is not the expected one, block. Also block if no agents (but management already returned). This is stricter.

But wait, in loop phase, the parent might call e.g. `subagent({ agent: "coder" })`. With loopReviewValidator present, we want to enforce builder/commentator only. So yes, block.

**Construction of review file for invalid clean review:**
We prepend `WORKFLOW_REVIEW_STATUS: blocking\nReason: ...\n\n` to preserve original. parseLoopReviewStatus will find "blocking" in the prepended line. The original "clean" marker later doesn't matter because first match wins (the function returns first match). Good.

**Writing loop-complete.md marker:**
Uses MARKERS.loopComplete from validators.ts. Already correct.

**Resume prompt stage detection:**
resumeController's existing code handles `ls.stage === "reviewing"` -> commentator, else builder. With invalid clean review setting stage=building, resume will instruct builder with reviewPath. Good.

**Run state validation:**
LoopState stage enum currently includes "building", "reviewing", "clean", "maxed". No change.

**Potential issue: `loopReviewValidator` receives `reviewRound` but not used. Fine.**

**Potential issue: `onArtifactMaybe` with task plan validator.**
When SM sees plan.md content, it calls artifactValidators.plan = taskPlanValidator. If valid, advances. If invalid, blocked. Good.

**Potential issue: tests that write plan.md with `write_workflow_artifact` with invalid content might rely on old behavior. Need to update.**

Let me now start implementing.

First, create task-validators.ts.

Then update validators.ts? No, task-validators imports from validators.ts.

Then update state-machine.ts WorkflowConfig.

Then update task.ts.

Then update adapter.ts.

Then update docs.

Then update tests.

Then run.

Let me code now. </think>