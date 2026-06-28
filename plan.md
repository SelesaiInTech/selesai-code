# Plan: `/prototype` workflow command

## Goal

Register an extension that adds a `/prototype` slash command driving an
8-phase workflow (grill → research → plan → reuse → handoff → loop → audit).
Emit a `prototype-phase` signal that the TUI renders in the statusline
(phase text + themed color) and that an Electron client reads over RPC
(`get_state.workflow`) to know it is in prototype mode.

## Scope decisions (from discussion)

- **Loop driver = LLM-as-orchestrator.** The handler stops at injecting the
  `handoff` skill + telling the agent that `plan.md`/`handoff.md` exist. The
  agent itself calls the `subagent` tool (`chain`) for execute→review→audit.
  *Ceiling:* the LLM can skip review on a trivial task. Upgrade path = a
  `run_prototype_loop` tool that enforces per-task review. Not built now.
  `// ponytail: LLM-honored loop; enforce if it skips review.`
- **TUI = statusline + one themed color, NOT a theme swap.** One phase
  segment in an existing themed color (e.g. `warning`). Border stays default.
  Recoloring the border = a later task (DynamicBorder), YAGNI now.
- **Electron = one `workflow` field on `RpcSessionState`.** No new transport,
  no websocket. The existing JSON-lines `get_state` carries it.
- **Steps 4 & 5 kept** (ask user about relevant code, then explore) per
  user's answer.
- **"Empty project" cutoff:** `git log --oneline` returns nothing (no commits)
  OR the working tree contains only dotfiles. When empty → skip steps 4 & 5.
  `// ponytail: heuristic = no commits OR dotfiles-only; refine when RE shows this mis-fires.`

## Existing art reused (do NOT reinvent)

- `registerCommand` — `src/core/extensions/loader.ts:235`
- `ExtensionCommandContext` actions: `sendUserMessage`, `appendEntry`,
  `waitForIdle` — `src/core/extensions/types.ts:1187`, `:1553`
- Skill expansion `/skill:name args` — `src/core/agent-session.ts:1181`
  (`_expandSkillCommand`). To "load" a skill, send a message whose text is
  `/skill:grill-me <prompt>`.
- `FooterDataProvider.setExtensionStatus(key, text)` — `src/core/footer-data-provider.ts`
  already wired into `interactive-mode.ts:1731`. Used today by the
  `pi-powerline-footer` extension for footer segments.
- `RpcSessionState` + `get_state` builder — `src/modes/rpc/rpc-types.ts:100`,
  `src/modes/rpc/rpc-mode.ts:455`.
- `appendEntry` runtime path — `src/core/extensions/loader.ts:289`.
- Subagent tool (`chain`/`parallel`) — packaged extension, already available
  to the agent as the `subagent` tool. No new orchestrator code.

## Non-goals

- No new CLI flag, no RPC command (the slash command + `get_state.workflow`
  is enough for both surfaces); add an RPC command only if a non-TUI client
  needs to *trigger* `/prototype` headlessly — it can already send `/prototype`
  as a prompt via the existing `prompt` command.
- No theme swap, no border recolor, no Electron badge UI in this pass.
- No deterministic loop driver, no `run_prototype_loop` tool.
- No new dependencies.

---

## Task 1 — Extension scaffold: register `/prototype`

### 1. Discovery
不存在 prototype extension yet. Search:
- `src/extensions/` — existing extension examples (`copy-turn.ts`,
  `pi-powerline-footer/index.ts`) show the factory shape.
- `package.json` `extensions` discovery — confirm how extensions are loaded
  (loader scans `src/extensions` per build; `copy-assets` copies
  `src/extensions/.` → `dist/extensions`).

### 2. Identification
Create **`src/extensions/prototype.ts`**. New file — owns the command and the
phase emitter. Single-file extension (no sub-package needed; `copy-turn.ts` is
a single .ts and works). Do NOT create `src/extensions/prototype/` dir +
package.json — overkill for one command.

Why this file: extensions are discovered from `src/extensions/`; a peer-level
single `.ts` matches the existing pattern (`undo.ts`, `question.ts`).

### 3. Change
Export a default extension factory:
```ts
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

const PROTOTYPE = "prototype";

export default <ExtensionFactory>((api: ExtensionAPI) => {
  api.registerCommand(PROTOTYPE, {
    description: "Run the prototype workflow (grill → research → plan → reuse → handoff → loop → audit)",
    handler: runPrototype,
  });
});
```
`runPrototype(args, ctx)` — orchestrator (filled by Tasks 2–4).
- Read argument prompt: `args` is the user prompt after `/prototype `.
- No tools/shortcuts registered.

Verify the build still copies it: `copy-assets` uses
`shx cp -r src/extensions/. dist/extensions/` — single file is included
automatically. No `copy-assets` change.

### 4. Verification
- **Success:** after build, `./dist/cli.js` → type `/prototype <prompt>` →
  command is discovered (appears in `/help` or command list), handler runs.
  `get_commands` over RPC includes `prototype`.
- **Failure:** missing `args` → handler emits a user-facing message and returns
  without crashing the session. Unknown skill names → agent falls back to the
  raw `/skill:x` text passing through (existing `_expandSkillCommand` no-op).
- **Regression:** other commands (`/settings`, `/model`, extension commands)
  unchanged. No change to `slash-commands.ts` builtins.

---

## Task 2 — Phase emitter: `prototype-phase` custom entry + RPC `workflow` field

### 1. Discovery
- `appendEntry(customType, data)` — `src/core/extensions/loader.ts:289`,
  types `:1520`. Persists a non-LLM `CustomEntry` to the session JSONL
  (`session-manager.ts:959`).
- `RpcSessionState` — `src/modes/rpc/rpc-types.ts:100`.
- `get_state` builder — `src/modes/rpc/rpc-mode.ts:455` (`session` is the live
  `AgentSession`).
- How to read the latest phase back in `get_state`: entries are available via
  `session.sessionManager.getEntries()`. Filter for `type === "custom"` &&
  `customType === "prototype-phase"`; take last.

### 2. Identification
- **Add** field to `RpcSessionState` in `src/modes/rpc/rpc-types.ts`.
- **Populate** in the `get_state` case of `src/modes/rpc/rpc-mode.ts`.
- **Emit** from `src/extensions/prototype.ts` via `ctx.appendEntry`.
- Do NOT touch `InteractiveMode` for state — the TUI footer reads the same
  entry (Task 3).

### 3. Change
`rpc-types.ts` — add to `RpcSessionState`:
```ts
export interface WorkflowState {
  mode: "prototype";
  phase: PrototypePhase;
  step: number; // 1..8
  done: boolean;
}
export type PrototypePhase =
  | "grilling" | "research" | "plan"
  | "reuse" | "handoff" | "loop" | "audit" | "complete";
export interface RpcSessionState {
  // ...existing...
  workflow?: WorkflowState;
}
```
`rpc-mode.ts` `get_state` case — after building `state`, attach:
```ts
const phase = latestPrototypePhase(session);
if (phase) state.workflow = phase;
```
where `latestPrototypePhase(session)` scans `session.sessionManager.getEntries()`
for the last `prototype-phase` custom entry, maps it to `WorkflowState`, and
returns `undefined` when none / when `done: true` (clears the mode signal).
`// ponytail: linear scan of entries; the workflow is short-lived so O(n) per get_state is fine.`

`prototype.ts` helper:
```ts
function setPhase(ctx: ExtensionCommandContext, phase, step, done = false) {
  ctx.appendEntry("prototype-phase", { mode: "prototype", phase, step, done });
}
```

### 3b. Decide "empty project" cutoff now (used in Task 4 runner)
Reuse existing shell util: `ctx.exec("git", ["log","--oneline","-1"])` returns
non-zero / empty stdout → no commits. Plus a working-tree check is heavier
than needed; **cutoff = no commits only.** `// ponytail: dotfiles-only check dropped; git-log empty is enough — refine if RE mis-fires.`

### 4. Verification
- **Success:** `appendEntry("prototype-phase", …)` → next `get_state` returns
  `state.workflow.phase === "grilling"` and `step === 1`. Restarting the
  session (resumes from JSONL) → `get_state` still reports the last phase
  (entry is persisted). On `done: true`, `workflow` is `undefined` (mode cleared).
- **Failure:** corrupt/garbage entry → `latestPrototypePhase` returns
  `undefined`; never throws inside `get_state` (wrap in try/catch).
- **Regression:** sessions with no prototype entries → `state.workflow` is
  `undefined`; existing `get_state` consumers see no change. RPC clients that
  ignore the new field keep working (additive only).

---

## Task 3 — TUI statusline segment for prototype phase

### 1. Discovery
- `FooterComponent.render(width)` — `src/modes/interactive/components/footer.ts:83`.
  Reads `this.session.state`; builds `statsParts` for the left side.
- `FooterDataProvider.setExtensionStatus(key, text)` —
  `src/core/footer-data-provider.ts`; already called from
  `interactive-mode.ts:1731` on extension status events. The footer renders
  extension statuses on the right side.
- `theme.fg("warning"/"success"/"error", text)` — the same themed colors the
  footer already uses (`footer.ts:226`).
- Alternative heavier path: `customFooter` factory (`interactive-mode.ts:1920`)
  — rejected; overkill for one segment.

### 2. Identification
**Do NOT modify `FooterComponent` or `FooterDataProvider`** for the segment
data — use the existing extension-status slot. Modify only:
- `src/extensions/prototype.ts` — emit a footer status update at each phase.

But: there is no public extension hook to push a string into the footer from
an extension directly. The existing path is `interactive-mode.ts:1731`
`setExtensionStatus(key, text)` reacting to *extension events*. So:
- **Add an extension runtime event** `workflow_phase` (emitted from the
  command handler) OR reuse the existing `extension_status` event.
  Find which event `interactive-mode.ts:1731` listens to and emit it. Prefer
  reusing the existing event so no new event type enters `ExtensionAPI`.

Confirm by reading `interactive-mode.ts:1720–1740` (Task 3 execution step)
to see the exact event name + payload shape, then emit that from `prototype.ts`.

### 3. Change
In `prototype.ts`, at each `setPhase(...)`, also push a footer segment:
```ts
// Reuse the existing extension-status event the interactive-mode already
// listens to; checksum the exact event name from interactive-mode.ts:1720+.
api.on(...) // only if a subscription is needed — likely not.
// Instead, emit via the runner's event the same way pi-powerline-footer does.
```
Segment text: `theme.fg("warning", "● prototype · 3/8 plan")`.
Color choice: `warning` (amber) — visible, doesn't read as error. One token.
`// ponytail: one phase segment in 'warning'; add a 2nd token when a 2nd workflow ships.`

If the existing event path is awkward to drive from a *command handler* (it
fires on extension lifecycle, not arbitrarily), the fallback is the lighter,
still-lazy route: in `FooterComponent.render`, read the latest
`prototype-phase` entry directly (same scan as `latestPrototypePhase`) and
prepend a segment. This couples the footer to the workflow entry type — but
the footer already reads `session.sessionManager.getEntries()` for usage
(`footer.ts:103`), so it's the same data source. **Preferred if the event path
needs >15 lines.** Pick whichever is fewer lines at implementation time.

### 4. Verification
- **Success:** typing `/prototype <prompt>` → footer shows
  `● prototype · 1/8 grilling` in amber; advances `2/8 research`, …, `8/8
  audit`; on `done:true` the segment disappears and footer reverts.
- **Failure:** a workspace without the prototype extension → footer unchanged.
- **Regression:** other extension statuses (`pi-powerline-footer`) still render
  on the right; no color bleed into the border or the message view.

---

## Task 4 — The phase runner (orchestrator) in `prototype.ts`

### 1. Discovery
- `ExtensionCommandContextActions` (`types.ts:1553`): `waitForIdle()` — block
  until the agent finishes its current turn.
- `ctx.sendUserMessage(text)` — enqueue a user message; for skill injection
  send `/skill:<name> <args>`. `agent-session.ts:1181` expands it.
- `ctx.exec(cmd, args)` — for `git log` cutoff check.
- Skills confirmed available (user-prompt will `grill-me`, `planger`,
  `handoff`, `ponytail-review`, `ponytail-audit`) — they must be discovered by
  the resource loader (they live in `~/.agents/skills/...`). Confirm they are
  on the skill path; if not installed, the `/skill:x` passthrough leaves the
  text as-is and the agent still tries the named skill once available.
- Subagent tool (`chain {:[...] }`) — available to the agent when the
  `pi-subagents` package is present. No handler code for the loop; the agent
  calls it after reading `handoff.md`.

### 2. Identification
Only `src/extensions/prototype.ts`. The runner is one async function with 8
sequential sections gated on `waitForIdle()`.

### 3. Change
```ts
async function runPrototype(args: string, ctx) {
  if (!args.trim()) { ctx.sendUserMessage("Usage: /prototype <what to build>"); return; }
  setPhase(ctx, "grilling", 1);
  await ctx.sendUserMessage(`/skill:grill-me ${args}`);
  await ctx.waitForIdle();

  setPhase(ctx, "research", 2);
  // grill-me clears itself; agent researches in the same idle window.
  await ctx.waitForIdle();

  setPhase(ctx, "plan", 3);
  await ctx.sendUserMessage("/skill:planger Create plan.md for the prototype. Path: ./plan.md");
  await ctx.waitForIdle();

  // Empty-project cutoff (Task 2 §3b): no git commits => skip 4 & 5.
  const r = await ctx.exec("git", ["log","--oneline","-1"]);
  const empty = !r.stdout?.trim();
  if (!empty) {
    setPhase(ctx, "reuse", 4);
    await ctx.sendUserMessage(
      "Are there existing files/repositories relevant to this request? List paths or say \"none\"."
    );
    await ctx.waitForIdle();

    setPhase(ctx, "reuse", 5);
    await ctx.sendUserMessage(
      "Explore the codebase for reusable components/knowledge related to these requirements; summarize candidates."
    );
    await ctx.waitForIdle();
  }

  setPhase(ctx, "handoff", 6);
  await ctx.sendUserMessage("/skill:handoff Generate handoff.md for a subagent. Path: ./handoff.md");
  await ctx.waitForIdle();

  setPhase(ctx, "loop", 7);
  await ctx.sendUserMessage(
    "You are the orchestrator. Read ./plan.md and ./handoff.md. For each task in plan.md, " +
    "run a subagent chain: execute → review → audit (use the `subagent` tool, `chain` mode, " +
    "agents: plan-executor, reviewer, auditor). Honor the order in plan.md."
  );
  await ctx.waitForIdle();

  setPhase(ctx, "audit", 8);
  await ctx.sendUserMessage(
    "/skill:ponytail-review Review all changes from this workflow. " +
    "Then (queueing) /skill:ponytail-audit Whole-repo over-engineering audit."
  );
  await ctx.waitForIdle();

  setPhase(ctx, "complete", 8, true);
  ctx.sendUserMessage("Prototype workflow complete.");
}
```
Notes / deliberate simplifications:
- Phases advance by `waitForIdle()` between `sendUserMessage` calls. This is
  the LLM-honored loop: once the agent is told to drive the subagent chain, it
  does so within that one turn. We do NOT parse `plan.md` or call `subagent`
  ourselves. `// ponytail: LLM-honored loop; enforce per-task if review gets skipped.`
- `sendUserMessage` with `/skill:ponytail-review ... /skill:ponytail-audit ...`
  in one message: actually send them as two sequential turns (review →
  waitForIdle → audit). Refactor step 8 into two sends so audit truly queues
  after review. (Single-line fix at impl time.)
- The 3 subagent definitions (plan-executor, reviewer, auditor) are **not
  configured here.** They must exist as subagents (user said "i will define it
  by default"). The handler only names them. If they don't exist the
  `subagent` tool errors per-task — that surfaces as a normal tool error, not
  a crash. Add a precondition check (read the subagent registry) only if the
  UX demands it — YAGNI now.

### 4. Verification
- **Success:** `/prototype build a todo app` → footer steps 1→8, the agent
  runs grilling, then research, `plan.md` appears, (skips 4/5 on an empty
  repo), `handoff.md` appears, the agent emits `subagent` chain calls,
  finally `ponytail-review` + `ponytail-audit` run. `get_state` reports
  `workflow.step` advancing.
- **Failure:** a skill missing → message passes through as text; agent
  responds it can't find it; workflow continues (doesn't hang). User aborts
  (`abort` RPC) → all in-flight stops; the next `get_state.workflow.phase`
  reflects where it stopped (entry already persisted) — acceptable.
- **Regression:** running the agent without issuing `/prototype` → no phase
  entries, no footer segment, no `workflow` field. Existing extensions and
  commands unaffected. `getInstance` for the command must not change command
  resolution precedence over builtins.

---

## Implementation order

1. Task 1 (scaffold + register) — proves discovery & build.
2. Task 2 (entry + RPC field) — proves the signal both surfaces will read.
3. Task 4 (runner) — wires the 8 phases using Task 2's emitter; visible over
   RPC and (for now) as persisted entries.
4. Task 3 (TUI footer) — last, because it consumes the signal Task 2 emits
   and only changes pixels.

Build & test gate after each task: `npm run clean && npm run build`, then
`./dist/cli.js` for the local TUI check and a one-off RPC client script
(send `get_state` during a `/prototype` run) for the Electron-ready check.

## Defined-done

- `/prototype` command present in TUI and via RPC `get_commands`.
- TUI footer shows advancing phase; clears on completion.
- `get_state` carries `workflow` only while a workflow is active.
- Skills injected by canonical `/skill:` expansion; no new injection API.
- Subagent loop is LLM-driven; no deterministic orchestrator code shipped.
- No new dependencies, no theme swap, no new transport.