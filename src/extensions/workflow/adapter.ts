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
import { basename, resolve } from "node:path";

import {
  WorkflowStateMachine,
  type WorkflowConfig,
  type WorkflowDeps,
  type WorkflowEffect,
  type WorkflowEntry,
  type FooterState,
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

// Intercom-enabled foreground subagents replace normal inline tool content
// with a delivery receipt. Their real inline response remains in the result's
// output artifact, so the workflow loop must read that before parsing markers.
async function textFromSubagentResult(event: any): Promise<string | undefined> {
  const inline = textFromToolResultContent(event.content);
  if (inline?.match(LOOP_STATUS_RE)) return inline;
  const outputPath = event.details?.results?.[0]?.artifactPaths?.outputPath;
  if (typeof outputPath !== "string") return inline;
  try {
    return await readFile(outputPath, "utf8");
  } catch {
    return inline;
  }
}

// Mutates a workflow subagent invocation to suppress both its configured
// default output and any caller-provided child output path. `output: false`
// preserves the normal inline result, which the parent must write explicitly.
function disableSubagentOutput(input: Record<string, unknown>): void {
  if (typeof input.agent === "string") input.output = false;
  if (Array.isArray(input.tasks)) {
    for (const task of input.tasks) {
      if (task && typeof task === "object") task.output = false;
    }
  }
  if (Array.isArray(input.chain)) {
    for (const step of input.chain) {
      if (!step || typeof step !== "object") continue;
      step.output = false;
      if (Array.isArray(step.parallel)) {
        for (const task of step.parallel) {
          if (task && typeof task === "object") task.output = false;
        }
      }
    }
  }
}

export interface WorkflowAdapterOptions {
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
const WORKFLOW_CONTROL_MESSAGE = "selesai-workflow-control";
// ponytail: shared across all module copies so prototype + quick registration
// can race. Module-level state alone is not enough when the loader runs each
// extension in its own module record.
const WORKFLOW_GLOBAL = Symbol.for("selesai.workflow.registry.v1");
type WorkflowRegistry = {
  controllers: WorkflowController[];
  writerRegisteredFor: WeakSet<object>;
  toolsRegisteredFor: WeakSet<object>;
};
const registry: WorkflowRegistry = ((globalThis as any)[WORKFLOW_GLOBAL] ??= {
  controllers: [],
  writerRegisteredFor: new WeakSet(),
  toolsRegisteredFor: new WeakSet(),
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

function isRegisteredController(controller: WorkflowController): boolean {
  return registry.controllers.includes(controller);
}

// Extension reload can reuse the same ExtensionAPI object while this module's
// global registry survives. Replace a mode's old controller so its active,
// pre-reload state cannot handle new tool results without a persisted run.
function replaceControllerFor(pi: ExtensionAPI, mode: string): void {
  for (let i = registry.controllers.length - 1; i >= 0; i--) {
    const controller = registry.controllers[i]!;
    if (controller.pi === pi && controller.config.mode === mode) {
      registry.controllers.splice(i, 1);
    }
  }
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
    let reconciled: WorkflowEffect = { kind: "noOp" };
    try {
      reconciled = await sm.onArtifactMaybe(controller.deps);
      await persistRun(controller);
      // ponytail: when a resumed run has multiple already-written parent-owned
      // artifacts, one onArtifactMaybe only advances one phase. Keep reconciling
      // until we either catch up to the durable file state or hit a blocked/
      // terminal effect, so resume lands on the furthest valid phase.
      while (sm.snapshot.active && sm.snapshot.autoArmed) {
        const further = await sm.onArtifactMaybe(controller.deps);
        if (
          further.kind === "noOp" ||
          further.kind === "blocked" ||
          further.kind === "terminalNeedsArtifacts"
        ) break;
        reconciled = further;
        await persistRun(controller);
        if (further.kind === "terminalReady") break;
      }
    } catch (error) {
      // Atomic rollback: on any failure during reconciliation, restore both
      // in-memory state and durable state to the checkpoint before the whole
      // reconcile sequence. Do not leave the controller at an intermediate
      // phase while the run file has already advanced further.
      restoreCheckpoint(controller, reconcileBefore);
      try {
        await persistRun(controller);
      } catch {
        // Best-effort rollback failed; still report the original error.
      }
      throw error;
    }
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
async function hasNoGitHistory(pi: ExtensionAPI): Promise<boolean> {
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

function continueAgent(pi: ExtensionAPI, _ctx: ExtensionContext, prompt: string): void {
  // Engine prompts are hidden custom messages. steer delivers after the current
  // tool batch; triggerTurn starts the continuation when the agent is idle.
  pi.sendMessage(
    { customType: WORKFLOW_CONTROL_MESSAGE, content: prompt, display: false },
    { triggerTurn: true, deliverAs: "steer" },
  );
}

function isSoleToolCall(ctx: ExtensionContext, toolCallId: unknown): boolean {
  if (typeof toolCallId !== "string") return false;
  try {
    const manager = (ctx as any)?.sessionManager;
    if (!manager || typeof manager.getBranch !== "function") return false;
    const entries = manager.getBranch();
    if (!Array.isArray(entries)) return false;
    const assistant = [...entries].reverse().find((entry: any) =>
      entry?.type === "message" && entry.message?.role === "assistant",
    )?.message;
    if (!assistant || !Array.isArray(assistant.content)) return false;
    const calls = assistant.content.filter((part: any) => part?.type === "toolCall");
    return calls.length === 1 && calls[0]?.id === toolCallId;
  } catch {
    return false;
  }
}

function transitionBatchBlock(ctx: ExtensionContext, toolCallId: unknown): { block: true; reason: string } | undefined {
  if (isSoleToolCall(ctx, toolCallId)) return undefined;
  return {
    block: true,
    reason: "Workflow transition tools must be called alone. Retry this call without any other tool calls in the same assistant turn.",
  };
}

// Apply side effects for effects that carry entry/footer/prompt. Engine prompts
// are hidden custom messages; tool results remain concise and user-facing.
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
    "Only one run may be attached; end_workflow explicitly completes a terminal-ready run.",
  ].join("\n");
}

function registerSharedArtifactWriter(pi: ExtensionAPI): void {
  if (registry.writerRegisteredFor.has(pi)) return;
  registry.writerRegisteredFor.add(pi);
  pi.registerTool({
    name: WORKFLOW_ARTIFACT_TOOL,
    label: "Write Workflow Artifact",
    description: "Write the current workflow phase artifact. The workflow enforces the destination path; provide content only.",
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
      // Every valid artifact boundary is an engine transition. Queue exactly
      // one hidden continuation and terminate this assistant turn.
      const transition = eff.kind === "advanced" || eff.kind === "terminalReady" || eff.kind === "terminalNeedsArtifacts";
      applyControllerEffect(controller, ctx, eff, { queuePrompt: transition });
      if (eff.kind === "blocked" && eff.reason) {
        return {
          content: [{ type: "text", text: `Wrote ${path}, but it is not approved: ${eff.reason}. Re-write it via write_workflow_artifact to add the required marker.` }],
          details: { mode: controller.config.mode, phase: snap.phase, path, file, blocked: true, reason: eff.reason },
        };
      }
      const advanced = eff.kind === "advanced";
      return {
        content: [{ type: "text", text: advanced
          ? `Wrote ${path}. Phase advanced to ${eff.phase}; the next workflow phase is queued.`
          : `Wrote ${path}.` }],
        details: { mode: controller.config.mode, phase: snap.phase, path, file, advanced },
        terminate: transition,
      };
    },
    renderResult(result, _options, theme) {
      const d = result.details as { path?: string; blocked?: boolean; reason?: string };
      if (d.blocked) return new Text(theme.fg("warning", `○ workflow artifact not approved: ${d.reason ?? "missing marker"}`), 0, 0);
      return new Text(theme.fg(d.path ? "success" : "warning", d.path ? `✓ wrote ${d.path}` : "○ no active workflow"), 0, 0);
    },
  } satisfies ToolDefinition);
}

function controllerForMode(pi: ExtensionAPI, mode: string): WorkflowController | undefined {
  return registry.controllers.find((controller) =>
    controller.pi === pi && controller.config.mode === mode && isRegisteredController(controller),
  );
}

function unknownMode(mode: string) {
  return {
    content: [{ type: "text" as const, text: `Unknown workflow mode: ${mode}. Use an installed mode (prototype, quick, or task).` }],
    details: { rejected: true, mode },
  };
}

async function endController(controller: WorkflowController, ctx: ExtensionContext) {
  const { config, sm, deps } = controller;
  const before = checkpoint(controller);
  const eff = await sm.end(deps);
  if (eff.kind === "closed") {
    try {
      await persistAfter(controller, before);
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Cannot end: workflow state could not be persisted: ${error instanceof Error ? error.message : String(error)}` }],
        details: { persistenceError: true },
      };
    }
  }
  applyControllerEffect(controller, ctx, eff);
  if (eff.kind === "closed") {
    controller.seenToolCallIds.clear();
    controller.lastBlockedKey = undefined;
    return {
      content: [{ type: "text" as const, text: `Workflow ended and closed. It can no longer be used. Artifacts saved at ${eff.artifactDir}.` }],
      details: { closed: true, mode: config.mode, phase: eff.phase, artifactDir: eff.artifactDir },
      terminate: true,
    };
  }
  if (eff.kind === "endBlocked") {
    if (eff.reason) {
      return {
        content: [{ type: "text" as const, text: `Cannot end: ${eff.missing} is incomplete: ${eff.reason}.` }],
        details: { mode: config.mode, phase: eff.phase, blocked: eff.missing, reason: eff.reason },
      };
    }
    const isArtifactFile = !eff.missing.includes(" ") && eff.missing.includes(".");
    const hint = isArtifactFile
      ? ` Write ${sm.snapshot.artifactDir}/${eff.missing} first.`
      : ` Continue through the phases to ${config.phases[config.phases.length - 1]}.`;
    return {
      content: [{ type: "text" as const, text: `Cannot end: ${eff.missing}.${hint}` }],
      details: { mode: config.mode, phase: eff.phase, blocked: eff.missing },
    };
  }
  return {
    content: [{ type: "text" as const, text: `No active ${config.mode} workflow to end.` }],
    details: { active: false, mode: config.mode },
  };
}

function registerSharedWorkflowTools(pi: ExtensionAPI): void {
  if (registry.toolsRegisteredFor.has(pi)) return;
  registry.toolsRegisteredFor.add(pi);
  // Starting and resuming are user-only slash-command actions. Exposing them
  // as model tools lets an agent opt the user into a workflow unprompted.
  pi.registerTool({
    name: "end_workflow",
    label: "End Workflow",
    description: "Close a terminal-ready durable workflow. Select its mode.",
    parameters: Type.Object({
      mode: Type.String({ description: "Workflow mode: prototype, quick, task, or another installed mode." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const controller = controllerForMode(pi, params.mode);
      return controller ? endController(controller, ctx) : unknownMode(params.mode);
    },
  } satisfies ToolDefinition);
}

export function createWorkflowExtension(
  config: WorkflowConfig,
  options: WorkflowAdapterOptions,
): (pi: ExtensionAPI) => void {
  return function workflowExtension(pi: ExtensionAPI): void {
    replaceControllerFor(pi, config.mode);
    const deps = makeDeps(pi, config);
    // ponytail: default skip rule — reuse is skipped when the project has no
    // git history. Shared by every mode today; a mode that wants a different
    // rule supplies its own skipRules in config and we respect them as-is.
    const skipRules = config.skipRules ?? [
      {
        phase: "reuse",
        shouldSkip: async () => hasNoGitHistory(pi),
      },
    ];
    const sm = new WorkflowStateMachine({ ...config, skipRules });
    const controller: WorkflowController = { pi, config, sm, deps, seenToolCallIds: new Set() };
    registry.controllers.push(controller);
    registerSharedArtifactWriter(pi);
    registerSharedWorkflowTools(pi);
    const { mode, footerLabel } = config;
    const end = "end_workflow";

    // Workflow tools are registered once per Pi instance below. Starting and
    // resuming remain user-only through the mode-specific slash commands.
    // ── session_start: disk state is never auto-attached. A session entry is
    // merely a convenience pointer for rendering a stale-but-useful footer. ──
    pi.on("session_start", async (_event: any, ctx: ExtensionContext) => {
      if (!isRegisteredController(controller)) return;
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

    // ── tool_call: enforce parent-owned artifact boundaries and exclusive
    // transition calls. The session manager exposes the current assistant
    // message, so fail closed when its sole-call shape cannot be proven. ──
    pi.on("tool_call", (event: any, ctx: ExtensionContext) => {
      if (!isRegisteredController(controller)) return;
      const tool = event.toolName;
      const snap = sm.snapshot;
      if (!snap.active) return;
      const commentatorTransition = tool === "subagent" &&
        event.input?.agent === "commentator" && snap.phase === "loop" &&
        !isSubagentManagementAction(event.input);
      const endTransition = tool === "end_workflow" && event.input?.mode === mode;
      if (tool === WORKFLOW_ARTIFACT_TOOL || endTransition || commentatorTransition) {
        const blocked = transitionBatchBlock(ctx, event.toolCallId);
        if (blocked) return blocked;
      }
      if (tool !== "subagent" && tool !== "write" && tool !== "edit") return;
      if (tool === "write" || tool === "edit") {
        return {
          block: true,
          reason: `Workflow is active (${mode}/${snap.phase}). Use ${WORKFLOW_ARTIFACT_TOOL} for workflow artifacts; workspace edits must be delegated to subagents.`,
        };
      }
      if (!isSubagentManagementAction(event.input) && event.input) {
        // All child results return inline. The parent persists normal phase
        // artifacts; the loop engine persists its own review files/marker.
        disableSubagentOutput(event.input);
      }
    });

    // ── tool_result: only the engine-owned loop persists subagent output. ──
    pi.on("tool_result", async (event: any, ctx: ExtensionContext) => {
      if (!isRegisteredController(controller)) return;
      if (event.toolName !== "subagent" || event.isError) return;
      // Parent-owned phases intentionally do nothing here: the main agent must
      // inspect the inline child result and call write_workflow_artifact.
      if (!sm.snapshot.active || sm.snapshot.phase !== "loop" || isSubagentManagementAction(event.input)) return;
      const eventBefore = checkpoint(controller);
      if (typeof event.toolCallId === "string") {
        if (controller.seenToolCallIds.has(event.toolCallId)) return;
        controller.seenToolCallIds.add(event.toolCallId);
      }
      // The adapter owns durable loop state; the normal subagent tool-result
      // continuation lets the parent choose the next builder/commentator call.
      // No synthetic follow-up chat is queued. loopState clears when the phase
      // leaves "loop" (below).
      if (event.toolName === "subagent" && sm.snapshot.active && sm.snapshot.phase === "loop") {
        const dir = sm.snapshot.artifactDir;
        const maxIt = config.loopMaxIterations ?? 3;
        if (!controller.loopState) {
          controller.loopState = { reviewRound: 0, maxIterations: maxIt, stage: "building" };
        }
        const ls = controller.loopState;
        const agent = event.input?.agent;

        if (agent === "builder") {
          // The normal subagent result resumes the parent turn; record the
          // next loop stage but do not inject a duplicate follow-up message.
          ls.stage = "reviewing";
        } else if (agent === "commentator") {
          const reviewRound = ls.reviewRound + 1;
          const reviewText = await textFromSubagentResult(event);
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
            // Blocking (or no marker) → the parent continues with a builder
            // fix round from the normal subagent result, without a queued chat.
            ls.stage = "building";
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
      // The only artifact written in this handler is loop-complete.md, which
      // is engine-owned. Parent-written phase artifacts advance inside
      // write_workflow_artifact instead. A clean review is an exclusive
      // transition boundary, so terminate and let the hidden steer continue.
      const transition = eff.kind === "advanced" || eff.kind === "terminalReady" || eff.kind === "terminalNeedsArtifacts";
      applyControllerEffect(controller, ctx, eff, { queuePrompt: transition });
      return transition ? { terminate: true } : undefined;
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
            // end_workflow({ mode }) writes status: completed.
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
