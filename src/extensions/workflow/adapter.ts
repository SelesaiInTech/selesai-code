// ponytail: pi adapter over the pure WorkflowStateMachine. Owns all fs/pi
// wiring: tool/command/event registration, node:fs predicates, the git skip
// check, footer rendering, agent continuation, tool-result shaping. Every
// call site is one sm method + one applyEffect switch over domain effects.

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolDefinition,
} from "@selesai/code";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, isAbsolute, resolve } from "node:path";

import {
  WorkflowStateMachine,
  type WorkflowConfig,
  type WorkflowDeps,
  type WorkflowEffect,
  type WorkflowEntry,
  type FooterState,
  type Phase,
  type WorkflowSnapshot,
} from "./state-machine.ts";
import {
  WORKFLOW_STATE_FILENAME,
  type LoopState,
  type PersistedWorkflowRun,
  type WorkflowModes,
  listResumableWorkflowRuns,
  resolveWorkflowRun,
  saveWorkflowRun,
} from "./run-state.ts";
import { MARKERS } from "./validators.ts";

function defaultArtifactPathFor(_goal: string, base: string): string {
  return resolve(base, randomUUID());
}

function artifactsBaseFor(config: WorkflowConfig): string {
  return resolve(config.artifactsBase ?? "./.selesai/artifacts");
}

async function realFileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// ponytail: phases where one spawned subagent owns the phase artifact. Force
// the child `output` path; child processes do not share the parent's workflow
// state, so the parent-scoped write_workflow_artifact tool cannot help there.
// Plan 5: these are also the single-owner phases — parallel/chain calls are
// blocked here because one agent must own plan.md / reuse.md / handoff.md /
// review.md. Loop is engine-owned (Plan 3) and may fan out.
const FORCE_OUTPUT_PHASES = new Set<Phase>(["plan", "reuse", "handoff", "audit"]);

// ponytail: phases where the parent can save subagent text as the artifact
// when the child did not write the file itself (dumb/local models).
const SUBAGENT_FALLBACK_PHASES = new Set<Phase>(["plan", "reuse", "handoff", "audit"]);

function textFromToolResultContent(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const part of content) {
    if (part && typeof part === "object" && (part as any).type === "text" && typeof (part as any).text === "string") {
      parts.push((part as any).text);
    }
  }
  const joined = parts.join("\n\n").trim();
  return joined || undefined;
}

function validatorForPhaseArtifact(config: WorkflowConfig, phase: Phase) {
  const phaseValidator = config.artifactValidators?.[phase];
  if (phaseValidator) return phaseValidator;
  const file = config.phaseArtifacts[phase];
  if (!file) return undefined;
  const isTerminal = config.phases[config.phases.length - 1] === phase;
  if (!isTerminal || !config.closeArtifacts.includes(file)) return undefined;
  return config.closeValidators?.[file];
}

function shouldReplaceInvalidArtifact(
  config: WorkflowConfig,
  phase: Phase,
  currentContent: string,
  fallbackContent: string,
): boolean {
  const validator = validatorForPhaseArtifact(config, phase);
  if (!validator) return false;
  return !validator(currentContent).ok && validator(fallbackContent).ok;
}

// ponytail: rewrite the subagent tool input so the child writes its output
// directly to ${artifactDir}/${file} as an absolute path. Absolute paths pass
// through resolveSingleOutputPath verbatim, so injectOutputPathSystemPrompt
// then forces the child to the correct location instead of repo root.
// Mutates `input` in place (tool_call handlers can patch event.input).
// No-op unless the workflow is active, in a force-output phase, and the call
// targets the `subagent` tool. Respects an explicit absolute caller output.
function forceSubagentOutputToArtifactDir(
  input: Record<string, unknown>,
  artifactDir: string,
  file: string,
  onlyAgents?: Set<string>,
): void {
  const dest = resolve(artifactDir, file);
  const shouldForce = (agent: string) => !onlyAgents || onlyAgents.has(agent);
  // Single-agent call: { agent, task, output?, ... }
  if (typeof input.agent === "string") {
    if (!shouldForce(input.agent)) return;
    const existing = input.output;
    if (typeof existing === "string" && isAbsolute(existing)) return; // caller pinned it
    input.output = dest;
    return;
  }
  // Top-level parallel: { tasks: [{ agent, output? }, ...] }
  if (Array.isArray(input.tasks)) {
    for (const task of input.tasks) {
      if (task && typeof task === "object" && typeof task.agent === "string" && shouldForce(task.agent)) {
        const ex = task.output;
        if (typeof ex === "string" && isAbsolute(ex)) continue;
        task.output = dest;
      }
    }
    return;
  }
  // Chain: { chain: [{ agent, output?, parallel: [{ agent, output? }] }] }
  if (Array.isArray(input.chain)) {
    for (const step of input.chain) {
      if (!step || typeof step !== "object") continue;
      if (typeof step.agent === "string" && shouldForce(step.agent)) {
        const ex = step.output;
        if (!(typeof ex === "string" && isAbsolute(ex))) step.output = dest;
      }
      if (Array.isArray(step.parallel)) {
        for (const task of step.parallel) {
          if (task && typeof task === "object" && typeof task.agent === "string" && shouldForce(task.agent)) {
            const ex = task.output;
            if (!(typeof ex === "string" && isAbsolute(ex))) task.output = dest;
          }
        }
      }
    }
  }
}

export interface WorkflowAdapterOptions {
  toolNames: { start: string; resume: string; end: string };
  toolLabels: { start: string; resume: string; end: string };
  commandName: string;
  commandDescription: string;
}

interface WorkflowController {
  pi: ExtensionAPI;
  config: WorkflowConfig;
  sm: WorkflowStateMachine;
  deps: WorkflowDeps;
  // The state machine stays pure; the adapter persists this orchestration
  // detail alongside the state-machine snapshot.
  loopState?: LoopState;
  run?: PersistedWorkflowRun;
  seenToolCallIds: Set<string>;
  lastBlockedKey?: string;
}

const WORKFLOW_ARTIFACT_TOOL = "write_workflow_artifact";
// ponytail: shared across all module copies so prototype + quick registration
// can race. Module-level state alone is not enough when the loader runs each
// extension in its own module record.
const WORKFLOW_GLOBAL = Symbol.for("selesai.workflow.registry.v1");
type WorkflowRegistry = { controllers: WorkflowController[]; writerRegisteredFor: WeakSet<object> };
const registry: WorkflowRegistry = ((globalThis as any)[WORKFLOW_GLOBAL] ??= {
  controllers: [],
  writerRegisteredFor: new WeakSet(),
});

// ponytail: tests call this between cases to drop pi references and reset
// writer-registration state. Production code never calls it.
export function __resetWorkflowRegistryForTests(): void {
  registry.controllers.length = 0;
  (registry.writerRegisteredFor as WeakSet<object>) = new WeakSet();
}

function activeControllersFor(pi: ExtensionAPI): WorkflowController[] {
  return registry.controllers.filter((c) => c.pi === pi && c.sm.snapshot.active);
}

function modesFor(config: WorkflowConfig): WorkflowModes {
  return { [config.mode]: config.phases };
}

function snapshotRun(controller: WorkflowController): PersistedWorkflowRun {
  if (!controller.run) throw new Error("No workflow run is attached.");
  const snapshot = controller.sm.snapshot;
  return {
    ...controller.run,
    status: snapshot.active ? "active" : "completed",
    goal: snapshot.userPrompt,
    artifactDir: snapshot.artifactDir,
    phase: snapshot.phase,
    autoArmed: snapshot.autoArmed,
    loopState: controller.loopState,
    updatedAt: new Date().toISOString(),
  };
}

async function persistRun(controller: WorkflowController): Promise<void> {
  const run = snapshotRun(controller);
  await saveWorkflowRun(run);
  controller.run = run;
}

interface ControllerCheckpoint {
  snapshot: WorkflowSnapshot;
  loopState?: LoopState;
  run?: PersistedWorkflowRun;
}

function checkpoint(controller: WorkflowController): ControllerCheckpoint {
  return {
    snapshot: controller.sm.snapshot,
    loopState: controller.loopState && { ...controller.loopState },
    run: controller.run && { ...controller.run, loopState: controller.run.loopState && { ...controller.run.loopState } },
  };
}

function restoreCheckpoint(controller: WorkflowController, before: ControllerCheckpoint): void {
  controller.sm.rehydrate(before.snapshot);
  controller.loopState = before.loopState;
  controller.run = before.run;
}

async function persistAfter(controller: WorkflowController, before: ControllerCheckpoint): Promise<void> {
  try {
    await persistRun(controller);
  } catch (error) {
    restoreCheckpoint(controller, before);
    throw error;
  }
}

async function resumeController(
  controller: WorkflowController,
  ctx: ExtensionContext,
  selector: string,
  endTool: string,
): Promise<any> {
  const { pi, config, sm } = controller;
  if (activeControllersFor(pi).length) {
    return { content: [{ type: "text", text: "A workflow is already active. End it before resuming another run." }], details: { alreadyActive: true } };
  }
  let selected;
  try {
    selected = await resolveWorkflowRun(selector, artifactsBaseFor(config), modesFor(config));
    if (selected.run.status !== "active") throw new Error("Completed workflow runs cannot be resumed.");
    if (selected.run.mode !== config.mode) throw new Error(`This is a ${selected.run.mode} run, not ${config.mode}.`);
  } catch (error) {
    return { content: [{ type: "text", text: `Cannot resume workflow: ${error instanceof Error ? error.message : String(error)}` }], details: { rejected: true } };
  }
  const before = checkpoint(controller);
  sm.rehydrate({ active: true, phase: selected.run.phase, userPrompt: selected.run.goal, artifactDir: selected.run.artifactDir, autoArmed: selected.run.autoArmed });
  controller.run = selected.run;
  controller.loopState = selected.run.loopState;
  controller.seenToolCallIds.clear();
  controller.lastBlockedKey = undefined;
  try {
    await persistAfter(controller, before);
    const reconcileBefore = checkpoint(controller);
    const reconciled = await sm.onArtifactMaybe(controller.deps);
    await persistAfter(controller, reconcileBefore);
    const current = sm.continueCurrent();
    const terminal = config.phases[config.phases.length - 1];
    const terminalReady = reconciled.kind === "terminalReady" || (sm.snapshot.phase === terminal && !sm.snapshot.autoArmed);
    if (terminalReady) {
      if (current.kind === "advanced") {
        applyFooter(ctx, current.footer);
        applyEntry(pi, config, current.entry, controller.run);
      }
      continueAgent(pi, ctx, `Workflow is terminal-ready. Verify ${sm.snapshot.artifactDir} and call ${endTool} to complete it.`);
    } else if (sm.snapshot.phase === "loop" && controller.loopState?.stage === "maxed") {
      if (current.kind === "advanced") {
        applyFooter(ctx, current.footer);
        applyEntry(pi, config, current.entry, controller.run);
      }
      ctx.ui.notify(`Workflow loop is paused after ${controller.loopState.reviewRound}/${controller.loopState.maxIterations} blocking review rounds. Inspect ${sm.snapshot.artifactDir}/${controller.loopState.reviewPath ?? "loop-review-<round>.md"} before continuing.`, "warning");
    } else if (sm.snapshot.phase === "loop" && controller.loopState) {
      if (current.kind === "advanced") {
        applyFooter(ctx, current.footer);
        applyEntry(pi, config, current.entry, controller.run);
      }
      const ls = controller.loopState;
      continueAgent(pi, ctx, ls.stage === "reviewing"
        ? `Resume the loop at review round ${ls.reviewRound + 1}: call the subagent tool now with { agent: "commentator", task: "..." } to review the builder's uncommitted diff against ${sm.snapshot.artifactDir}/plan.md. End the review with WORKFLOW_REVIEW_STATUS: clean or WORKFLOW_REVIEW_STATUS: blocking.`
        : `Resume the loop at review round ${ls.reviewRound}: call the subagent tool now with { agent: "builder", task: "..." } to address the feedback in ${sm.snapshot.artifactDir}/${ls.reviewPath ?? "loop-review-<round>.md"}.`);
    } else {
      applyControllerEffect(controller, ctx, current);
    }
  } catch (error) {
    return { content: [{ type: "text", text: `Cannot resume workflow: state could not be persisted: ${error instanceof Error ? error.message : String(error)}` }], details: { persistenceError: true } };
  }
  return {
    content: [{ type: "text", text: `Resumed ${config.mode} workflow ${controller.run!.id} at ${sm.snapshot.phase}. Artifacts: ${selected.statePath}` }],
    details: { runId: controller.run!.id, statePath: selected.statePath, phase: sm.snapshot.phase },
  };
}

// ponytail: builds the deps bundle the adapter injects into the state machine.
// The skip predicate wraps pi.exec("git"...) — the only true-external seam.
function makeDeps(pi: ExtensionAPI, config: WorkflowConfig): WorkflowDeps {
  return {
    async artifactExists(phase, dir) {
      const file = config.phaseArtifacts[phase];
      if (!file) return true;
      return realFileExists(`${dir}/${file}`);
    },
    async fileExists(path) {
      return realFileExists(path);
    },
    async mkdirArtifactDir(path) {
      await mkdir(path, { recursive: true });
    },
    artifactPathFor: defaultArtifactPathFor,
    // ponytail: Plan 4 — read an artifact for semantic validation. Returns
    // undefined on missing/unreadable so the SM treats it as "not written"
    // rather than an empty-string that would always fail the validator.
    async readArtifact(phase, dir) {
      const file = config.phaseArtifacts[phase];
      if (!file) return undefined;
      try {
        return await readFile(`${dir}/${file}`, "utf8");
      } catch {
        return undefined;
      }
    },
    async readFile(path) {
      try {
        return await readFile(path, "utf8");
      } catch {
        return undefined;
      }
    },
  };
}

// ponytail: the git-based skip predicate shared by both modes today.
// A mode that wants a different skip rule supplies its own SkipRule.
async function isEmptyProject(pi: ExtensionAPI): Promise<boolean> {
  try {
    const result = await pi.exec("git", ["log", "--oneline", "-1"]);
    return result.code !== 0 || !result.stdout.trim();
  } catch {
    return false;
  }
}

// ponytail: Plan 3 — parse the commentator's machine-readable status line.
// First match wins; case-insensitive; trailing whitespace allowed. Returns
// undefined when the marker is absent — the loop treats that as blocking so
// a malformed review never silently advances the workflow.
const LOOP_STATUS_RE = /WORKFLOW_REVIEW_STATUS\s*:\s*(clean|blocking)\b/i;
function parseLoopReviewStatus(text: string | undefined): "clean" | "blocking" | undefined {
  if (!text) return undefined;
  const m = text.match(LOOP_STATUS_RE);
  if (!m) return undefined;
  return m[1]!.toLowerCase() as "clean" | "blocking";
}

function footerText(footer: FooterState, ctx: ExtensionContext): string | undefined {
  if (!footer.visible) return undefined;
  return ctx.ui.theme.fg("warning", footer.text);
}

function applyEntry(pi: ExtensionAPI, config: WorkflowConfig, entry: WorkflowEntry, run?: PersistedWorkflowRun): void {
  pi.appendEntry(config.entryType, {
    ...entry,
    ...(run ? { workflowStatePath: resolve(run.artifactDir, WORKFLOW_STATE_FILENAME), runId: run.id } : {}),
  });
}

function applyFooter(ctx: ExtensionContext, footer: FooterState): void {
  ctx.ui.setStatus(footer.statusKey, footerText(footer, ctx));
}

function continueAgent(pi: ExtensionAPI, ctx: ExtensionContext, prompt: string): void {
  // ponytail: agent is mid-turn (streaming) when tool_result fires, so a bare
  // sendUserMessage() throws "Agent is already processing". deliverAs:"followUp"
  // is the framework-native continuation. In idle state (e.g. session resume)
  // it sends a direct turn.
  if (ctx.isIdle()) {
    pi.sendUserMessage(prompt);
  } else {
    pi.sendUserMessage(prompt, { deliverAs: "followUp" });
  }
}

// ponytail: apply side effects for effects that carry entry/footer/prompt.
// Terminal/blocked/idle/noOp/alreadyActive carry none — the adapter's call
// site formats the tool result from the effect's domain fields + config.
function applyEffect(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  config: WorkflowConfig,
  eff: WorkflowEffect,
  run?: PersistedWorkflowRun,
  queuePrompt = true,
): void {
  switch (eff.kind) {
    case "started":
    case "advanced":
      if ("entry" in eff) applyEntry(pi, config, eff.entry, run);
      if ("footer" in eff) applyFooter(ctx, eff.footer);
      if (queuePrompt && eff.prompt) continueAgent(pi, ctx, eff.prompt);
      return;
    case "closed":
      if ("entry" in eff) applyEntry(pi, config, eff.entry, run);
      if ("footer" in eff) applyFooter(ctx, eff.footer);
      ctx.ui.notify(
        `${config.footerLabel} workflow complete. Artifacts: ${eff.artifactDir}`,
        "info",
      );
      return;
    case "terminalNeedsArtifacts":
      if (queuePrompt && eff.promptToQueue) continueAgent(pi, ctx, eff.promptToQueue);
      return;
    case "blocked":
      if (queuePrompt && eff.reason) {
        continueAgent(pi, ctx, `Phase ${eff.phase} artifact exists but is not approved: ${eff.reason}. Edit it via write_workflow_artifact to add the required marker, then the workflow will advance.`);
      }
      return;
    case "terminalReady":
      if (queuePrompt) continueAgent(pi, ctx, `Terminal artifacts are ready. Call the explicit end workflow tool to complete this run.`);
      return;
    case "endBlocked":
    case "idle":
    case "noOp":
    case "alreadyActive":
      return;
  }
}

function blockedKeyFor(eff: WorkflowEffect): string | undefined {
  if (eff.kind !== "blocked") return undefined;
  return `${eff.phase}:${eff.missing}:${eff.reason ?? ""}`;
}

function applyControllerEffect(
  controller: WorkflowController,
  ctx: ExtensionContext,
  eff: WorkflowEffect,
  options: { queuePrompt?: boolean } = {},
): void {
  const blockedKey = blockedKeyFor(eff);
  if (blockedKey) {
    if (controller.lastBlockedKey === blockedKey) return;
    controller.lastBlockedKey = blockedKey;
  } else if (eff.kind !== "noOp") {
    controller.lastBlockedKey = undefined;
  }
  applyEffect(controller.pi, ctx, controller.config, eff, controller.run, options.queuePrompt);
}

function isSubagentManagementAction(input: Record<string, unknown> | undefined): boolean {
  return typeof input?.action === "string";
}

function commandHelp(config: WorkflowConfig, options: WorkflowAdapterOptions): string {
  const command = `/${options.commandName}`;
  return [
    `${config.footerLabel} workflow`,
    `${command} <goal> — start a new durable run.`,
    `${command} resume — list resumable runs.`,
    `${command} resume <run-id|artifact-dir|workflow.json> — explicitly resume one.`,
    `Phases advance when their artifacts are written. Runs never auto-resume after reload.`,
    `Only one run may be attached; ${options.toolNames.end} explicitly completes a terminal-ready run.`,
  ].join("\n");
}

function registerSharedArtifactWriter(pi: ExtensionAPI): void {
  if (registry.writerRegisteredFor.has(pi)) return;
  registry.writerRegisteredFor.add(pi);
  pi.registerTool({
    name: WORKFLOW_ARTIFACT_TOOL,
    label: "Write Workflow Artifact",
    description: "Write the current workflow phase artifact. The workflow enforces the destination path; provide content only.",
    promptSnippet: `${WORKFLOW_ARTIFACT_TOOL}(content) - write the active workflow artifact; path is chosen by the workflow, not the agent.`,
    promptGuidelines: [
      `During any workflow, use ${WORKFLOW_ARTIFACT_TOOL} instead of write/edit for workflow artifacts.`,
      "Provide artifact content only; do not provide a path.",
    ],
    parameters: Type.Object({
      content: Type.String({ description: "Artifact markdown/text content to save." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const active = activeControllersFor(pi);
      if (active.length !== 1) {
        const msg = active.length === 0
          ? "No active workflow."
          : `Multiple active workflows (${active.map((c) => c.config.mode).join(", ")}); close one first.`;
        return { content: [{ type: "text", text: msg }], details: { active: active.length } };
      }
      const controller = active[0]!;
      const snap = controller.sm.snapshot;
      const file = controller.config.phaseArtifacts[snap.phase];
      if (!file) {
        return {
          content: [{ type: "text", text: `Phase ${snap.phase} has no workflow artifact.` }],
          details: { phase: snap.phase, blocked: true },
        };
      }
      const path = resolve(snap.artifactDir, file);
      await mkdir(snap.artifactDir, { recursive: true });
      await writeFile(path, params.content, "utf8");
      const before = checkpoint(controller);
      let eff: WorkflowEffect;
      try {
        eff = await controller.sm.onArtifactMaybe(controller.deps);
        await persistAfter(controller, before);
      } catch (error) {
        return {
          content: [{ type: "text", text: `Wrote ${path}, but could not persist workflow state: ${error instanceof Error ? error.message : String(error)}` }],
          details: { mode: controller.config.mode, phase: snap.phase, path, persistenceError: true },
        };
      }
      // A phase boundary is user-controlled: persist and show the new phase,
      // but do not inject a follow-up turn that immediately starts it.
      applyControllerEffect(controller, ctx, eff, { queuePrompt: false });
      if (eff.kind === "blocked" && eff.reason) {
        return {
          content: [{ type: "text", text: `Wrote ${path}, but it is not approved: ${eff.reason}. Re-write it via write_workflow_artifact to add the required marker.` }],
          details: { mode: controller.config.mode, phase: snap.phase, path, file, blocked: true, reason: eff.reason },
        };
      }
      const advanced = eff.kind === "advanced";
      return {
        content: [{ type: "text", text: advanced
          ? `Wrote ${path}. Phase advanced to ${eff.phase}; wait for the user to continue the workflow.`
          : `Wrote ${path}.` }],
        details: { mode: controller.config.mode, phase: snap.phase, path, file, advanced },
        // Stop the parent turn at a user-approved artifact boundary. Without
        // this, the queued phase prompt can immediately launch the next agent.
        terminate: advanced,
      };
    },
    renderResult(result, _options, theme) {
      const d = result.details as { path?: string; blocked?: boolean; reason?: string };
      if (d.blocked) return new Text(theme.fg("warning", `○ workflow artifact not approved: ${d.reason ?? "missing marker"}`), 0, 0);
      return new Text(theme.fg(d.path ? "success" : "warning", d.path ? `✓ wrote ${d.path}` : "○ no active workflow"), 0, 0);
    },
  } satisfies ToolDefinition);
}

export function createWorkflowExtension(
  config: WorkflowConfig,
  options: WorkflowAdapterOptions,
): (pi: ExtensionAPI) => void {
  return function workflowExtension(pi: ExtensionAPI): void {
    const deps = makeDeps(pi, config);
    // ponytail: default skip rule — reuse is skipped on empty projects (no git
    // commits). Shared by every mode today; a mode that wants a different rule
    // supplies its own skipRules in config and we respect them as-is.
    const skipRules = config.skipRules ?? [
      {
        phase: "reuse",
        shouldSkip: async () => isEmptyProject(pi),
      },
    ];
    const sm = new WorkflowStateMachine({ ...config, skipRules });
    const controller: WorkflowController = { pi, config, sm, deps, seenToolCallIds: new Set() };
    registry.controllers.push(controller);
    registerSharedArtifactWriter(pi);
    const { start, resume, end } = options.toolNames;
    const { mode, footerLabel } = config;

    // ── start tool ──
    pi.registerTool({
      name: start,
      label: options.toolLabels.start,
      description: `Start the ${mode} workflow for the given goal. Sets up grilling as the first phase and returns the grilling prompt. Do not call if a workflow is already active.`,
      promptSnippet: `${start}(goal) - start the ${mode} workflow; goal is what the user wants to build.`,
      promptGuidelines: [
        `Call ${start} only when the user explicitly asks to start a ${mode} workflow and none is active.`,
        "Pass the user's full goal as the goal parameter.",
      ],
      parameters: Type.Object({
        goal: Type.String({
          description: `What the user wants the ${mode} workflow to build or accomplish.`,
        }),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        const other = activeControllersFor(pi).find((c) => c.sm !== sm);
        if (other) {
          return {
            content: [{ type: "text", text: `A ${other.config.mode} workflow is already active (phase: ${other.sm.snapshot.phase}). Close it before starting ${mode}.` }],
            details: { phase: other.sm.snapshot.phase, alreadyActive: true },
          };
        }
        const before = checkpoint(controller);
        const eff = await sm.start(params.goal, deps);
        if (eff.kind === "started") {
          controller.run = {
            version: 1,
            id: basename(sm.snapshot.artifactDir),
            mode,
            status: "active",
            goal: sm.snapshot.userPrompt,
            artifactDir: sm.snapshot.artifactDir,
            phase: sm.snapshot.phase,
            autoArmed: sm.snapshot.autoArmed,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          try {
            await persistAfter(controller, before);
          } catch (error) {
            return {
              content: [{ type: "text", text: `Could not start durable workflow: ${error instanceof Error ? error.message : String(error)}` }],
              details: { persistenceError: true },
            };
          }
          controller.seenToolCallIds.clear();
          controller.lastBlockedKey = undefined;
        }
        // The start tool result already contains the grilling prompt. Queueing
        // it again creates a duplicate autonomous turn.
        applyControllerEffect(controller, ctx, eff, { queuePrompt: false });
        if (eff.kind === "alreadyActive") {
          return {
            content: [
              {
                type: "text",
                text: `A ${mode} workflow is already active (phase: ${eff.phase}). Do not call ${start} again. Phases auto-advance as artifacts land; call ${end} only from the final phase.`,
              },
            ],
            details: { phase: eff.phase, alreadyActive: true },
          };
        }
        return {
          content: [
            { type: "text", text: `${footerLabel} workflow started. ${eff.prompt}` },
          ],
          details: { phase: eff.phase },
        };
      },
      renderResult(_result, _options, theme) {
        return new Text(
          theme.fg("warning", `● ${footerLabel} started · 1/${config.phases.length} ${config.phases[0]}`),
          0,
          0,
        );
      },
    } satisfies ToolDefinition);

    // ── explicit resume tool ──
    pi.registerTool({
      name: resume,
      label: options.toolLabels.resume,
      description: `Resume an explicitly selected ${mode} workflow run. Pass a run id, artifact directory, or workflow.json path.`,
      promptSnippet: `${resume}(run) - resume an explicit ${mode} workflow run; run is its id, artifact directory, or workflow.json path.`,
      promptGuidelines: [
        `Call ${resume} only when the user explicitly selects a ${mode} workflow run.`,
        "Workflow runs never resume automatically after reload.",
      ],
      parameters: Type.Object({ run: Type.String({ description: "Run id, artifact directory, or workflow.json path." }) }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        return resumeController(controller, ctx, params.run, end);
      },
      renderResult(result, _options, theme) {
        const d = result.details as { rejected?: boolean; persistenceError?: boolean; phase?: string };
        const failed = d.rejected || d.persistenceError;
        return new Text(theme.fg(failed ? "warning" : "success", failed ? "○ workflow resume rejected" : `✓ workflow resumed · ${d.phase}`), 0, 0);
      },
    } satisfies ToolDefinition);

    // ── end tool ──
    pi.registerTool({
      name: end,
      label: options.toolLabels.end,
      description: `Close the ${mode} workflow. Must be called when the final phase is complete. Marks the workflow finished and stops the agent loop.`,
      promptSnippet: `${end}() - close the finished ${mode} workflow; no further phase transitions allowed.`,
      promptGuidelines: [
        `Call ${end} exactly once, from the terminal phase, when all close artifacts are complete.`,
      ],
      parameters: Type.Object({}),
      async execute(_id, _params, _signal, _onUpdate, ctx) {
        const before = checkpoint(controller);
        const eff = await sm.end(deps);
        if (eff.kind === "closed") {
          try {
            await persistAfter(controller, before);
          } catch (error) {
            return {
              content: [{ type: "text", text: `Cannot end: workflow state could not be persisted: ${error instanceof Error ? error.message : String(error)}` }],
              details: { persistenceError: true },
            };
          }
        }
        applyControllerEffect(controller, ctx, eff);
        if (eff.kind === "closed") {
          controller.seenToolCallIds.clear();
          controller.lastBlockedKey = undefined;
        }
        switch (eff.kind) {
          case "closed":
            return {
              content: [{ type: "text", text: `Workflow ended and closed. It can no longer be used. Artifacts saved at ${eff.artifactDir}.` }],
              details: { closed: true, phase: eff.phase, artifactDir: eff.artifactDir },
              terminate: true,
            };
          case "endBlocked": {
            // ponytail: missing is either a filename (existence failure),
            // a phase description like "not at terminal (audit)", or — Plan 4 —
            // a filename whose validator failed (reason set). Only suggest
            // writing when it's an actual artifact file existence miss.
            if (eff.reason) {
              return {
                content: [{ type: "text", text: `Cannot end: ${eff.missing} is incomplete: ${eff.reason}.` }],
                details: { phase: eff.phase, blocked: eff.missing, reason: eff.reason },
              };
            }
            const isArtifactFile =
              !eff.missing.includes(" ") && eff.missing.includes(".");
            const hint = isArtifactFile
              ? ` Write ${sm.snapshot.artifactDir}/${eff.missing} first.`
              : ` Continue through the phases to ${config.phases[config.phases.length - 1]}.`;
            return {
              content: [{ type: "text", text: `Cannot end: ${eff.missing}.${hint}` }],
              details: { phase: eff.phase, blocked: eff.missing },
            };
          }
          default:
            return {
              content: [{ type: "text", text: `No active ${mode} workflow to end.` }],
              details: { active: false },
            };
        }
      },
      renderResult(result, _options, theme) {
        const d = result.details as { closed?: boolean; artifactDir?: string };
        if (!d.closed) {
          return new Text(theme.fg("dim", "○ no workflow to end"), 0, 0);
        }
        return new Text(
          theme.fg("success", `✓ ${footerLabel} closed · ${d.artifactDir}`),
          0,
          0,
        );
      },
    } satisfies ToolDefinition);

    // ── session_start: disk state is never auto-attached. A session entry is
    // merely a convenience pointer for rendering a stale-but-useful footer. ──
    pi.on("session_start", async (_event: any, ctx: ExtensionContext) => {
      const entries = ctx.sessionManager.getEntries();
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i] as { type: string; customType?: string; data?: any };
        const data = entry.data;
        if (entry.type !== "custom" || entry.customType !== config.entryType || !data || data.mode !== mode || typeof data.workflowStatePath !== "string") continue;
        try {
          const { run } = await resolveWorkflowRun(data.workflowStatePath, artifactsBaseFor(config), modesFor(config));
          if (run.status === "active") {
            ctx.ui.setStatus(config.statusKey, ctx.ui.theme.fg(
              "warning",
              `● ${config.footerLabel} · ${config.phases.indexOf(run.phase) + 1}/${config.phases.length} ${run.phase} (resume required)`,
            ));
          }
        } catch {
          // Old/custom entries are intentionally non-authoritative.
        }
        break;
      }
    });

    // ── tool_call: enforce workflow boundaries. ──
    pi.on("tool_call", (event: any, _ctx: ExtensionContext) => {
      const tool = event.toolName;
      if (tool !== "subagent" && tool !== "write" && tool !== "edit") return;
      const snap = sm.snapshot;
      if (!snap.active) return;
      if (tool === "subagent" && isSubagentManagementAction(event.input)) return;
      const file = config.phaseArtifacts[snap.phase];
      if (tool === "write" || tool === "edit") {
        return {
          block: true,
          reason: `Workflow is active (${mode}/${snap.phase}). Use ${WORKFLOW_ARTIFACT_TOOL} for workflow artifacts; workspace edits must be delegated to subagents.`,
        };
      }
      if (!file || !event.input || !FORCE_OUTPUT_PHASES.has(snap.phase)) return;
      // ponytail: Plan 5 — single-owner phases reject parallel/chain. One agent
      // must own the artifact; tasks/chain split ownership and the output
      // injector cannot pin one file per agent. Loop is exempt (engine-owned).
      if (Array.isArray(event.input.tasks) || Array.isArray(event.input.chain)) {
        return {
          block: true,
          reason: `Workflow phase ${snap.phase} expects one subagent owner for ${file}; use a single { agent, task } call, not tasks/chain.`,
        };
      }
      // ponytail: Plan 5 — workflow-spawned subagents run fresh by default so
      // no hidden parent context leaks into the phase owner. Only override
      // when the caller explicitly pins a context.
      if (typeof event.input.context !== "string") {
        event.input.context = "fresh";
      }
      // ponytail: Plan 5 — ban model override on workflow-owned phases. The
      // workflow, not the parent model, picks the agent; a model pin would
      // silently change cost/quality without the workflow knowing.
      if (typeof event.input.model === "string") {
        return {
          block: true,
          reason: `Workflow phase ${snap.phase} does not allow a model override on subagent calls; remove the model parameter.`,
        };
      }
      const onlyAgents = snap.phase === "audit" ? new Set(["commentator", "reviewer"]) : undefined;
      forceSubagentOutputToArtifactDir(event.input, snap.artifactDir, file, onlyAgents);
    });

    // ── tool_result: auto-advance after subagent/bash artifacts. ──
    pi.on("tool_result", async (event: any, ctx: ExtensionContext) => {
      if (event.toolName !== "bash" && event.toolName !== "subagent") return;
      const eventBefore = checkpoint(controller);
      if (sm.snapshot.active && typeof event.toolCallId === "string") {
        if (controller.seenToolCallIds.has(event.toolCallId)) return;
        controller.seenToolCallIds.add(event.toolCallId);
      }
      // ponytail: a failed phase-owner tool used to leave the workflow quiet
      // until the user manually typed /prototype or /quick continue. Re-check
      // first (in case the tool wrote the artifact before failing), then if
      // nothing advanced, re-queue the current phase prompt automatically.
      if (event.isError && sm.snapshot.active) {
        if (event.toolName === "subagent" && isSubagentManagementAction(event.input)) return;
        const eff = await sm.onArtifactMaybe(deps);
        try {
          await persistAfter(controller, eventBefore);
        } catch (error) {
          ctx.ui.notify(`Workflow state was not saved: ${error instanceof Error ? error.message : String(error)}`, "warning");
          return;
        }
        applyControllerEffect(controller, ctx, eff, { queuePrompt: false });
        if (eff.kind === "noOp") {
          const retry = sm.continueCurrent();
          continueAgent(
            pi,
            ctx,
            `The previous ${event.toolName} call failed during the ${retry.phase} phase. Stay in this phase and try again.\n\n${retry.prompt}`,
          );
        }
        if (sm.snapshot.phase !== "loop") {
          controller.loopState = undefined;
        }
        return;
      }
      // ponytail: if a subagent returned text but did not write the expected
      // artifact (common with dumb/local models), save the returned text as
      // the artifact so the workflow can still advance.
      if (event.toolName === "subagent" && sm.snapshot.active && SUBAGENT_FALLBACK_PHASES.has(sm.snapshot.phase)) {
        const phase = sm.snapshot.phase;
        const file = config.phaseArtifacts[phase];
        if (file) {
          // ponytail: management actions (list/get/models/doctor/status/...)
          // return text but are NOT the architect/recapper/... execution
          // result. Writing their text to plan.md would advance the workflow
          // on agent-listing output (the `subagent list` result is plain
          // text). Execution calls set `agent`/`chain`/`tasks`; management
          // calls set `action`. Only fall back for execution calls.
          if (!isSubagentManagementAction(event.input)) {
            const expectedPath = resolve(sm.snapshot.artifactDir, file);
            const text = textFromToolResultContent(event.content);
            if (text) {
              const validator = validatorForPhaseArtifact(config, phase);
              let shouldWrite = false;
              if (!(await realFileExists(expectedPath))) {
                shouldWrite = !validator || validator(text).ok;
              } else {
                try {
                  const current = await readFile(expectedPath, "utf8");
                  shouldWrite = shouldReplaceInvalidArtifact(config, phase, current, text);
                } catch {
                  shouldWrite = false;
                }
              }
              if (shouldWrite) {
                await mkdir(sm.snapshot.artifactDir, { recursive: true });
                await writeFile(expectedPath, text, "utf8");
              }
            }
          }
        }
      }
      // ponytail: Plan 3 — engine-owned loop orchestration. The parent model
      // does NOT track iterations; the adapter counts review rounds, parses the
      // commentator's WORKFLOW_REVIEW_STATUS marker, and drives the next step
      // via followUp. Ceiling: there is no pi.callTool() API, so the engine
      // cannot invoke the subagent tool directly — it sends a followUp the
      // model is expected to act on. If the model deviates, the loop stalls
      // until the next tool_result nudges again. loopState is cleared when the
      // phase leaves "loop" (below).
      let loopPrompt: string | undefined;
      if (event.toolName === "subagent" && sm.snapshot.active && sm.snapshot.phase === "loop") {
        const dir = sm.snapshot.artifactDir;
        const maxIt = config.loopMaxIterations ?? 3;
        if (!controller.loopState) {
          controller.loopState = { reviewRound: 0, maxIterations: maxIt, stage: "building" };
        }
        const ls = controller.loopState;
        const agent = event.input?.agent;

        if (agent === "builder") {
          // Build step done → drive the commentator review.
          ls.stage = "reviewing";
          loopPrompt = `Builder finished. Call the subagent tool now with { agent: "commentator", task: "..." } to review the builder's uncommitted diff against ${dir}/plan.md. Craft the review task yourself based on what matters for this task. End the review with exactly one line on its own:
  WORKFLOW_REVIEW_STATUS: clean
or
  WORKFLOW_REVIEW_STATUS: blocking`; 
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
            // onArtifactMaybe below sees loop-complete.md and advances to audit.
          } else if (ls.reviewRound >= ls.maxIterations) {
            // Cap reached without a clean review. Notify once, stop driving.
            const wasMaxed = ls.stage === "maxed";
            ls.stage = "maxed";
            if (!wasMaxed) {
              ctx.ui.notify(
                `Workflow loop hit max iterations (${ls.maxIterations}) without a clean review. Last review status: ${status ?? "no marker"}. Resolve issues manually or re-run.`,
                "warning",
              );
            }
            // A genuine clean review on a later round still advances — the
            // clean branch above runs first.
          } else {
            // Blocking (or no marker) → drive a builder fix round.
            ls.stage = "building";
            const reason = status === "blocking"
              ? "the blocking issues listed in the review"
              : "the review (no WORKFLOW_REVIEW_STATUS: clean|blocking marker was found)";
            loopPrompt = `Review round ${ls.reviewRound} was blocking. Call the subagent tool now with { agent: "builder", task: "..." } to fix ${reason}. Give the builder the feedback in ${dir}/${ls.reviewPath ?? `loop-review-${ls.reviewRound}.md`} and the relevant artifact paths. After the builder returns, the workflow will drive the next review automatically.`;
          }
        }
        // Non-builder/commentator subagent calls in loop fall through to
        // onArtifactMaybe (a no-op unless loop-complete.md exists).
      }
      const eff = await sm.onArtifactMaybe(deps);
      // Clear loop state once we have left the loop phase (advanced to audit).
      if (sm.snapshot.phase !== "loop") {
        controller.loopState = undefined;
      }
      try {
        await persistAfter(controller, eventBefore);
      } catch (error) {
        ctx.ui.notify(`Workflow state was not saved: ${error instanceof Error ? error.message : String(error)}`, "warning");
        return;
      }
      // Do not turn an artifact/subagent result into a new parent turn.
      // The user resumes the next phase deliberately via the workflow command.
      applyControllerEffect(controller, ctx, eff, { queuePrompt: false });
      if (loopPrompt && sm.snapshot.active) continueAgent(pi, ctx, loopPrompt);
    });

    // ── /<command> ──
    pi.registerCommand(options.commandName, {
      description: options.commandDescription,
      handler: async (args: string, ctx: ExtensionCommandContext) => {
        const trimmed = args.trim();
        if (trimmed === "help") {
          ctx.ui.notify(commandHelp(config, options), "info");
          return;
        }
        if (!ctx.isIdle()) {
          ctx.ui.notify(
            `Agent is busy. Wait for it to finish before calling /${options.commandName}.`,
            "warning",
          );
          return;
        }

        if (trimmed === "resume" || trimmed.startsWith("resume ")) {
          if (sm.snapshot.active) {
            ctx.ui.notify("A workflow is already active. End it before resuming another run.", "warning");
            return;
          }
          const selector = trimmed.slice("resume".length).trim();
          if (!selector) {
            const runs = await listResumableWorkflowRuns(artifactsBaseFor(config), modesFor(config));
            if (!runs.length) {
              ctx.ui.notify(`No resumable ${mode} workflows found.`, "info");
              return;
            }
            if (!ctx.hasUI) {
              ctx.ui.notify(runs.map(({ run }) => `/${options.commandName} resume ${run.id}  # ${run.phase}, ${run.goal}, ${run.updatedAt}`).join("\n"), "info");
              return;
            }
            const labels = runs.map(({ run }) => `${run.id} · ${run.phase} · ${run.goal} · ${run.updatedAt}`);
            const choice = await ctx.ui.select(`Resume ${mode} workflow`, labels);
            if (choice === undefined) return;
            const index = labels.indexOf(choice);
            if (index < 0) return;
            const result = await resumeController(controller, ctx, runs[index]!.run.id, end);
            ctx.ui.notify(result.content[0].text, result.details.rejected || result.details.persistenceError ? "warning" : "info");
            return;
          }
          const result = await resumeController(controller, ctx, selector, end);
          ctx.ui.notify(result.content[0].text, result.details.rejected || result.details.persistenceError ? "warning" : "info");
          return;
        }

        if (sm.snapshot.active) {
          let goal = args.trim();
          const choice = ctx.hasUI
            ? await ctx.ui.select(
                `Workflow already active (phase: ${sm.snapshot.phase}). What do you want to do?`,
                [
                  `Continue current workflow at ${sm.snapshot.phase}`,
                  "Close current and start a new one",
                ],
              )
            : undefined;
          if (choice === undefined) return;
          if (choice.startsWith("Continue")) {
            const eff = sm.continueCurrent();
            // The explicit Continue action below sends exactly one prompt.
            applyControllerEffect(controller, ctx, eff, { queuePrompt: false });
            if (eff.kind === "advanced" && eff.prompt) {
              // continueCurrent already applied footer+entry; send the prompt.
              continueAgent(pi, ctx, eff.prompt);
            }
            return;
          }
          if (!goal && ctx.hasUI) {
            goal = (await ctx.ui.input("Goal for the new workflow:")) ?? "";
          }
          if (!goal.trim()) {
            ctx.ui.notify(
              "No goal provided. Keeping current workflow active.",
              "warning",
            );
            return;
          }
          const closed = sm.closeCurrent();
          if (closed) {
            // Detach only: the on-disk active record remains resumable. Only
            // end_*_workflow writes status: completed.
            applyEntry(pi, config, { ...closed, done: false }, controller.run);
            ctx.ui.notify(`Detached ${mode} workflow at ${closed.artifactDir}; it remains resumable.`, "info");
          }
          args = goal;
        } else if (!args.trim()) {
          ctx.ui.notify(commandHelp(config, options), "info");
          return;
        }

        const other = activeControllersFor(pi).find((c) => c.sm !== sm);
        if (other) {
          ctx.ui.notify(
            `${other.config.footerLabel} workflow already active at ${other.sm.snapshot.phase}. Close it before starting ${mode}.`,
            "warning",
          );
          return;
        }
        const before = checkpoint(controller);
        const eff = await sm.start(args, deps);
        if (eff.kind === "started") {
          controller.run = {
            version: 1,
            id: basename(sm.snapshot.artifactDir),
            mode,
            status: "active",
            goal: sm.snapshot.userPrompt,
            artifactDir: sm.snapshot.artifactDir,
            phase: sm.snapshot.phase,
            autoArmed: sm.snapshot.autoArmed,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          try {
            await persistAfter(controller, before);
          } catch (error) {
            ctx.ui.notify(`Could not start durable workflow: ${error instanceof Error ? error.message : String(error)}`, "warning");
            return;
          }
          controller.seenToolCallIds.clear();
          controller.lastBlockedKey = undefined;
        }
        applyControllerEffect(controller, ctx, eff);
      },
    });
  };
}
