---
name: workflow-creation
description: Creates durable Selesai workflow modes. Use when a user asks to create or change a workflow mode, phased agent flow, or slash-command workflow.
disable-model-invocation: true
---

# Durable Workflows

**Durable** means `workflow.json`, not session history, is the run authority. Build on the shared engine in `src/extensions/workflow/`; a mode is configuration, not a second orchestrator.

## 1. Choose the smallest fit

Read `docs/workflows.md`, every file in `src/extensions/workflow/modes/`, and the relevant workflow tests.

- Reuse `prototype`, `quick`, or `task` when its phase graph and terminal gate fit; change only its prompts/configuration.
- Add a mode only for a materially different graph, artifact contract, or close gate.

Done when the request is mapped to one existing mode or a named new mode with its phase list and terminal artifact.

## 2. Trace the durable seam

Before changing engine-facing behavior, read completely:

- `state-machine.ts` — graph, artifact gates, terminal-ready, completion;
- `adapter.ts` — tools, event handlers, persistence, reload guards;
- `run-state.ts` — canonical record and resume validation;
- `extension.ts` — single extension mounting all modes.

Done when every proposed behavior has one owner: state machine, shared adapter, or mode configuration.

## 3. Implement the mode

For a new mode, add `src/extensions/workflow/modes/<name>.ts`, modeled on `quick.ts`, with only `WorkflowConfig` and `WorkflowModeRegistration`:

- ordered phases, phase artifacts, prompts, validators, close artifacts/validators;
- unique mode/status/entry identities and slash-command name; shared start/resume/end tools select the mode;
- prompts that name exact artifact paths and use `write_workflow_artifact` only for workflow artifacts.

Register the mode once in `MODES` in `extension.ts`; document its lifecycle and commands in `docs/workflows.md`.

Done when the mode file has no filesystem, persistence, event-registration, or controller code.

## 4. Preserve the durable contract

The shared adapter owns UUID artifact directories, atomic saves, resume, loop review state, and reload safety. Do not reimplement them per mode.

- Persisted state changes after start, artifact/loop transition, resume reconciliation, and explicit end.
- Never auto-resume on `session_start`; an explicit selector attaches a run.
- Artifact completion advances durable state then stops the parent turn; the user deliberately continues the attached mode.
- Terminal-ready stays active. Only `end_workflow({ mode })` marks the record completed and terminates.
- One `ExtensionAPI` hosts all modes: shared writer once, stale reload handlers inert, one attached run total.
- Builder/reviewer loops use adapter-owned rounds, review files, markers, and max-iteration pause.

Done when the new behavior preserves every applicable invariant above.

## 5. Lock the mode with real seams

Extend the existing fake-Pi tests; do not add another framework. Cover the real mode, not only state-machine units:

- start writes valid `workflow.json`; artifact transition updates it; explicit end completes it;
- explicit resume reconciles an artifact written before a phase save;
- loop round/review path resumes when the mode has a loop;
- terminal-ready does not complete early;
- extension reload ignores stale handlers; inactive sibling modes do not react.

Run the narrow mode test, then:

```bash
npx vitest run src/__tests__/state-machine.test.ts src/__tests__/adapter.test.ts src/__tests__/workflow-race.test.ts src/__tests__/workflow-run-state.test.ts src/__tests__/<mode>-workflow.test.ts
npm run build
```

Done when those checks pass and the diff contains only the selected mode, shared-engine changes proven necessary by a failing regression, documentation, and tests.
