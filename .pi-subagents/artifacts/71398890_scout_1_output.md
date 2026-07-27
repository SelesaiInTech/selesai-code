# Code Context

## Files Retrieved
1. `src/extensions/workflow/adapter.ts` (lines 1-619) - workflow/pi glue: registers start/end/artifact tools, event hooks, subagent output forcing/fallback, fs writes, session rehydrate.
2. `src/extensions/workflow/state-machine.ts` (lines 1-386) - pure phase engine and persisted workflow entry/effect types.
3. `src/extensions/workflow/modes/prototype.ts` (lines 1-186) - prototype workflow phases/prompts and explicit subagent orchestration instructions.
4. `src/extensions/workflow/modes/quick.ts` (lines 1-166) - quick workflow phases/prompts and explicit subagent orchestration instructions.
5. `docs/workflows.md` (lines 1-218) - docs confirming workflow architecture and transition model.
6. `src/extensions/pi-subagents/src/extension/index.ts` (lines 450-526) - registers the `subagent` and `wait` tools.
7. `src/extensions/pi-subagents/src/extension/schemas.ts` (lines 1-310) - `subagent` tool parameter schema for single/parallel/chain, output, context fresh/fork, chainDir, async.
8. `src/extensions/pi-subagents/src/runs/foreground/subagent-executor.ts` (lines 113-209, 1442-1481, 1680-1753, 3336-3561) - execution modes, fresh/fork policy, chain wrapping, fork session resolution, foreground dispatch.
9. `src/extensions/pi-subagents/src/runs/background/subagent-runner.ts` (lines 1-120) - async runner config includes steps, result paths, workflow graph, session/artifact dirs.
10. `src/extensions/pi-subagents/src/runs/shared/workflow-graph.ts` (lines 1-205) - graph snapshot builder for subagent chains/parallel/dynamic phases, not the Selesai workflow engine.
11. `src/extensions/pi-subagents/src/shared/artifacts.ts` (lines 1-91) - subagent artifact directory and file naming.

## Key Code

- Workflow phases do **not** directly call a code API to spawn subagents. They return prompts; the parent model is instructed to use the `subagent` tool. Evidence: mode prompts say “Spawn the ARCHITECT/EXPLORER/RECAPPER/BUILDER/COMMENTATOR sub-agent via the subagent tool” in `src/extensions/workflow/modes/prototype.ts` lines 71-142 and `src/extensions/workflow/modes/quick.ts` lines 60-129.
- The workflow adapter watches the actual `subagent` tool:
  - `tool_call` blocks parent `write`/`edit` during active workflow and mutates `subagent` inputs to force output paths for `plan`, `reuse`, `handoff`, `audit`: `src/extensions/workflow/adapter.ts` lines 45-113 and 481-497.
  - `tool_result` auto-advances after `bash` or `subagent`; for subagent phases it can write returned text to the expected artifact if the child did not: `src/extensions/workflow/adapter.ts` lines 499-526.
- Workflow artifacts:
  - Workflow dir defaults to `./.workflow-artifacts/<timestamp>-<slug>` via config default: `src/extensions/workflow/adapter.ts` lines 28-32 and `state-machine.ts` start logic (artifact path injected through `WorkflowDeps`).
  - Shared tool `write_workflow_artifact` writes `${artifactDir}/${phaseArtifact}` and calls `sm.onArtifactMaybe`: `src/extensions/workflow/adapter.ts` lines 260-309.
  - Prototype files: `requirements.md`, `research.md`, `plan.md`, `reuse.md`, `handoff.md`, `loop-complete.md`, `review.md`: `src/extensions/workflow/modes/prototype.ts` lines 165-174.
  - Quick files: `requirements.md`, `plan.md`, `reuse.md`, `handoff.md`, `loop-complete.md`, `review.md`: `src/extensions/workflow/modes/quick.ts` lines 147-155.
- Workflow state persistence is session custom entries, not files: `WorkflowEntry` has `mode`, `phase`, `step`, `done`, `userPrompt`, `artifactDir`; adapter writes via `pi.appendEntry` and rehydrates on `session_start`: `src/extensions/workflow/state-machine.ts` lines 63-74; `src/extensions/workflow/adapter.ts` lines 187-189 and 434-476.
- Subagent tool supports single (`agent`/`task`), parallel (`tasks`), and chain (`chain`) modes; chain steps can be sequential, static parallel, or dynamic fanout: `src/extensions/pi-subagents/src/extension/schemas.ts` lines 83-215 and 251-253.
- Context/fork:
  - Schema exposes `context: "fresh" | "fork"`; explicit context overrides all children; omitted uses each agent’s `defaultContext`, with default fresh: `src/extensions/pi-subagents/src/extension/schemas.ts` lines 254-258.
  - Executor resolves explicit/default policy; `defaultContext === "fork"` forks, otherwise fresh: `src/extensions/pi-subagents/src/runs/foreground/subagent-executor.ts` lines 1442-1468.
  - Forked tasks are wrapped with `wrapForkTask(...)`, fork session files are preflighted and assigned per child: `src/extensions/pi-subagents/src/runs/foreground/subagent-executor.ts` lines 1680-1753 and 3373-3422.
  - Workflow prompts explicitly say “Do NOT pass a model parameter” but do **not** specify `context`; therefore workflow-driven subagents inherit pi-subagents default/agent-specific fresh/fork behavior.
- Subagent artifacts are separate from workflow artifacts:
  - Project root `.pi-subagents/artifacts` and `.pi-subagents/chain-runs`, or session/temp fallback: `src/extensions/pi-subagents/src/shared/artifacts.ts` lines 7-24.
  - Per-child files include `_input.md`, `_output.md`, `.jsonl`, `_transcript.jsonl`, `_meta.json`: `src/extensions/pi-subagents/src/shared/artifacts.ts` lines 26-38.
- Subagent “workflow graph” is only a visualization/status model for chain/parallel/dynamic runs. It groups nodes by optional `phase`, tracks statuses/current node, and defaults mode to `chain`: `src/extensions/pi-subagents/src/runs/shared/workflow-graph.ts` lines 1-205. It is not wired into `src/extensions/workflow/`.

## Architecture

Selesai workflows are prompt/state-machine driven. `start_*_workflow` creates an artifact directory, persists a custom entry, sets the footer, and sends the phase prompt. The phase prompt tells the parent model what to do. For subagent phases, the model calls the registered `subagent` tool; the workflow adapter does not spawn the child itself.

Artifact/context flow:
1. Workflow prompt gives absolute artifact paths and prior artifact paths to the parent model.
2. Parent model passes a tailored task to `subagent` (single, parallel, or chain supported by pi-subagents generally; built-in workflow prompts use single subagent calls/repeated calls, not native `chain`).
3. During `tool_call`, workflow adapter may inject `output: ${artifactDir}/${file}` into subagent input for plan/reuse/handoff/audit.
4. Child writes that output, or returns text; on `tool_result`, adapter writes fallback text if needed, then calls `sm.onArtifactMaybe()`.
5. State machine gates phase advancement on files existing, emits next prompt, and adapter sends it as follow-up/direct user message.

Implement-review loops exist by instruction, not engine-enforced control flow:
- `loop` phase instructs builder → commentator → builder fixes → commentator until clean, then write `loop-complete.md` (`prototype.ts` lines 121-134; `quick.ts` lines 108-121).
- `audit` phase instructs commentator review → builder fixes actionable issues → re-dispatch commentator until clean; workflow closes when `review.md` exists (`prototype.ts` lines 135-147; `quick.ts` lines 122-134).
- The state machine only checks that `loop-complete.md`/`review.md` exist; it does not parse “clean” or enforce repeated loops.

## Start Here

Start at `src/extensions/workflow/adapter.ts`: it is the actual bridge between workflow state and pi-subagents (`tool_call` output forcing, `tool_result` fallback/auto-advance, artifact writer, session rehydrate). Then open the mode file (`prototype.ts` or `quick.ts`) for phase-specific subagent instructions.

## Review Findings

- medium: `src/extensions/workflow/modes/prototype.ts` lines 135-147 and `src/extensions/workflow/modes/quick.ts` lines 122-134 - docs/prompts say audit closes once `review.md` exists **and** commentator reports no outstanding issues, but engine only gates on `review.md` existence (`closeArtifacts: ["review.md"]`; `state-machine.ts` close artifact checks). A non-clean review file can satisfy closure if the parent proceeds.
- low: `src/extensions/workflow/adapter.ts` lines 481-497 - workflow blocks parent `write`/`edit` globally while active, not just under `.workflow-artifacts`; this is intentional per reason text (“workspace edits must be delegated to subagents”) but broader than artifact protection.
- no blocker: Workflow → subagent coupling is prompt/event based, with artifact path injection and fallback text write; no direct engine dependency on pi-subagents internals beyond tool name `subagent`.

## Residual Risks

- Did not run tests (read-only source/docs investigation only).
- Did not inspect every pi-subagents runner branch; enough source was checked to verify execution modes, artifact paths, and fresh/fork policy.