// ponytail: pi adapter over the pure WorkflowStateMachine. Owns all fs/pi
// wiring: tool/command/event registration, node:fs predicates, the git skip
// check, footer rendering, agent continuation, tool-result shaping. Every
// call site is one sm method + one applyEffect switch over domain effects.

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { access, copyFile, mkdir } from "node:fs/promises";
import { basename, isAbsolute, resolve, sep } from "node:path";

import {
  WorkflowStateMachine,
  type WorkflowConfig,
  type WorkflowDeps,
  type WorkflowEffect,
  type WorkflowEntry,
  type FooterState,
  type Phase,
} from "./state-machine.ts";

function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    // ponytail: u-flag so Unicode chars (Chinese, emoji, etc.) are also
    // treated as non-alphanumeric and replaced with dashes — without /u,
    // JS’s \W shorthand only matches ASCII, leaving Unicode in paths
    // which confuses agents and tools.
    .replace(/[^a-z0-9]+/ug, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "workflow";
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function defaultArtifactPathFor(goal: string, base: string): string {
  return `${base}/${timestamp()}-${slugify(goal)}`;
}

async function realFileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// ponytail: phases where exactly one artifact is produced by one spawned
// subagent call. In these we can deterministically force the child's output
// path via the subagent tool's `output` param so it writes directly into
// artifactDir instead of the repo root (the frontmatter default resolves
// relative to cwd). Audit is excluded: it produces two files (review.md +
// audit.md) across two commentator calls in one phase, so a single forced
// path can't target both — upgrade path is a per-call artifact counter.
const FORCE_OUTPUT_PHASES = new Set<Phase>(["plan", "reuse", "handoff"]);

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
): void {
  const dest = resolve(artifactDir, file);
  // Single-agent call: { agent, task, output?, ... }
  if (typeof input.agent === "string") {
    const existing = input.output;
    if (typeof existing === "string" && isAbsolute(existing)) return; // caller pinned it
    input.output = dest;
    return;
  }
  // Top-level parallel: { tasks: [{ agent, output? }, ...] }
  if (Array.isArray(input.tasks)) {
    for (const task of input.tasks) {
      if (task && typeof task === "object" && typeof task.agent === "string") {
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
      if (typeof step.agent === "string") {
        const ex = step.output;
        if (!(typeof ex === "string" && isAbsolute(ex))) step.output = dest;
      }
      if (Array.isArray(step.parallel)) {
        for (const task of step.parallel) {
          if (task && typeof task === "object" && typeof task.agent === "string") {
            const ex = task.output;
            if (!(typeof ex === "string" && isAbsolute(ex))) task.output = dest;
          }
        }
      }
    }
  }
}

// ponytail: the agent frequently mangles the artifactDir into a single
// repo-root filename like "./.selesai-requirements.md" instead of
// "./.selesai/artifacts/<run>/requirements.md". Catch it BEFORE the write
// lands: if the target path isn't already inside artifactDir but its basename
// equals OR ends with the expected filename (so ".selesai-requirements.md"
// still matches "requirements.md"), rewrite the path to the correct location.
// Mutates `input` in place. Returns true if it redirected (so callers can log).
function redirectWriteToArtifactDir(
  input: Record<string, unknown>,
  artifactDir: string,
  file: string,
): boolean {
  const raw = input.path;
  if (typeof raw !== "string" || !raw) return false;
  const src = resolve(raw);
  const dest = resolve(artifactDir, file);
  if (src === dest) return false; // already correct
  // Inside artifactDir already (e.g. a non-phase run subdir)? leave it.
  if (src.startsWith(resolve(artifactDir) + sep)) return false;
  const name = basename(src);
  if (name === file || name.endsWith("-" + file) || name.endsWith("_" + file)) {
    input.path = dest;
    return true;
  }
  return false;
}

// ponytail: if the agent wrote an artifact to the wrong place (e.g. repo root
// instead of the workflow's artifactDir), copy it into the artifactDir so the
// invariant "artifacts live in artifactDir" holds and downstream close-gate
// checks (which look in artifactDir) pass. No-op if already there or not a match.
// Post-hoc safety net for paths the tool_call redirect didn't catch (e.g. a
// basename the agent invented that neither equals nor suffixes the expected file).
async function rescueMisplacedArtifact(
  writtenPath: string | undefined,
  artifactDir: string,
  expectedFiles: readonly string[],
): Promise<void> {
  if (!writtenPath) return;
  const name = basename(writtenPath);
  // ponytail: accept exact match OR a mangled suffix like
  // ".selesai-requirements.md" (agent collapsed artifactDir into the filename).
  // Use the canonical expected filename as the dest so downstream exact-name
  // gate checks (artifactExistsFor) pass.
  const canonical = expectedFiles.find(
    (f) => name === f || name.endsWith("-" + f) || name.endsWith("_" + f),
  );
  if (!canonical) return;
  const src = resolve(writtenPath);
  const dest = resolve(artifactDir, canonical);
  if (src === dest) return;
  try {
    await copyFile(src, dest);
  } catch {
    // best-effort; the basename match in the state machine still advances.
  }
}

export interface WorkflowAdapterOptions {
  toolNames: { start: string; next: string; end: string };
  toolLabels: { start: string; next: string; end: string };
  commandName: string;
  commandDescription: string;
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

function footerText(footer: FooterState, ctx: ExtensionContext): string | undefined {
  if (!footer.visible) return undefined;
  return ctx.ui.theme.fg("warning", footer.text);
}

function applyEntry(pi: ExtensionAPI, config: WorkflowConfig, entry: WorkflowEntry): void {
  pi.appendEntry(config.entryType, entry);
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
): void {
  switch (eff.kind) {
    case "started":
    case "advanced":
      if ("entry" in eff) applyEntry(pi, config, eff.entry);
      if ("footer" in eff) applyFooter(ctx, eff.footer);
      if (eff.prompt) continueAgent(pi, ctx, eff.prompt);
      return;
    case "closed":
      if ("entry" in eff) applyEntry(pi, config, eff.entry);
      if ("footer" in eff) applyFooter(ctx, eff.footer);
      ctx.ui.notify(
        `${config.footerLabel} workflow complete. Artifacts: ${eff.artifactDir}`,
        "info",
      );
      return;
    case "terminalNeedsArtifacts":
      if (eff.promptToQueue) continueAgent(pi, ctx, eff.promptToQueue);
      return;
    case "blocked":
    case "terminalReady":
    case "endBlocked":
    case "idle":
    case "noOp":
    case "alreadyActive":
      return;
  }
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
    const { start, end } = options.toolNames;
    // ponytail: next tool removed — transitions are hook-driven now.
    // toolNames.next stays in the type for config backwards-compat (unused).
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
        const eff = await sm.start(params.goal, deps);
        applyEffect(pi, ctx, config, eff);
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
        const eff = await sm.end(deps);
        applyEffect(pi, ctx, config, eff);
        switch (eff.kind) {
          case "closed":
            return {
              content: [{ type: "text", text: `Workflow ended and closed. It can no longer be used. Artifacts saved at ${eff.artifactDir}.` }],
              details: { closed: true, phase: eff.phase, artifactDir: eff.artifactDir },
              terminate: true,
            };
          case "endBlocked": {
            // ponytail: missing is either a filename (closeArtifacts loop)
            // or a phase description like "not at terminal (audit)". Only
            // suggest writing when it's an actual artifact file.
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

    // ── session_start: restore state from persisted entries ──
    pi.on("session_start", async (_event: any, ctx: ExtensionContext) => {
      const entries = ctx.sessionManager.getEntries();
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i] as { type: string; customType?: string; data?: any };
        if (e.type === "custom" && e.customType === config.entryType && e.data) {
          if (e.data.done) {
            sm.rehydrate({
              active: false,
              phase: e.data.phase as Phase,
              userPrompt: e.data.userPrompt ?? "",
              artifactDir: e.data.artifactDir ?? "",
              autoArmed: false,
            });
          } else {
            sm.rehydrate({
              active: true,
              phase: e.data.phase as Phase,
              userPrompt: e.data.userPrompt ?? "",
              artifactDir: e.data.artifactDir ?? "",
              autoArmed: true,
            });
          }
          // ponytail: re-render footer from snapshot without advancing.
          if (sm.snapshot.active) {
            ctx.ui.setStatus(
              config.statusKey,
              ctx.ui.theme.fg(
                "warning",
                `● ${config.footerLabel} · ${config.phases.indexOf(sm.snapshot.phase) + 1}/${config.phases.length} ${sm.snapshot.phase}`,
              ),
            );
          } else {
            ctx.ui.setStatus(config.statusKey, undefined);
          }
          break;
        }
      }
    });

    // ── tool_call: redirect artifact writes into artifactDir (deterministic). ──
    // ponytail: two leak modes converge on the same fix — rewrite the tool
    // input before it runs so the file never lands in the wrong place.
    //
    // 1. subagent tool (plan/reuse/handoff): the subagent extension resolves a
    //    relative frontmatter `output` against ctx.cwd → repo root, then
    //    hard-forces the child there. We set `output` to the absolute
    //    ${artifactDir}/${file} so the child is forced to the right place.
    //
    // 2. write/edit (grilling/loop/audit — orchestrator-written artifacts): the
    //    agent often mangles ${artifactDir}/requirements.md into a repo-root
    //    "./.selesai-requirements.md". If the target path isn't already inside
    //    artifactDir but its basename equals or suffixes the expected file,
    //    rewrite `path` to the canonical artifactDir location.
    pi.on("tool_call", (event: any, _ctx: ExtensionContext) => {
      const tool = event.toolName;
      if (tool !== "subagent" && tool !== "write" && tool !== "edit") return;
      const snap = sm.snapshot;
      if (!snap.active) return;
      const file = config.phaseArtifacts[snap.phase];
      if (!file || !event.input) return;
      if (tool === "subagent") {
        if (!FORCE_OUTPUT_PHASES.has(snap.phase)) return;
        forceSubagentOutputToArtifactDir(event.input, snap.artifactDir, file);
      } else {
        redirectWriteToArtifactDir(event.input, snap.artifactDir, file);
      }
    });

    // ── tool_result: auto-advance. One call, one apply. ──
    // ponytail: fire on write/edit/bash (the agent's own artifact writes) AND on
    // the subagent tool — subagent-driven phases (plan/reuse/handoff/audit)
    // delegate artifact writing to child agents whose own writes don't bubble
    // up here, so we re-check when the subagent tool returns to the parent.
    pi.on("tool_result", async (event: any, ctx: ExtensionContext) => {
      if (
        event.toolName !== "write" &&
        event.toolName !== "edit" &&
        event.toolName !== "bash" &&
        event.toolName !== "subagent"
      )
        return;
      // ponytail: the agent sometimes ignores the exact artifactDir path in the
      // phase prompt and writes the artifact to the repo root. Rescue it: if the
      // just-written file's basename matches a workflow artifact filename, copy
      // it into the artifactDir before re-checking so the phase advances.
      const writtenPath = event.input?.path as string | undefined;
      if (writtenPath) {
        await rescueMisplacedArtifact(
          writtenPath,
          sm.snapshot.artifactDir,
          Object.values(config.phaseArtifacts),
        );
      }
      const eff = await sm.onArtifactMaybe(deps, writtenPath);
      applyEffect(pi, ctx, config, eff);
    });

    // ── /<command> ──
    pi.registerCommand(options.commandName, {
      description: options.commandDescription,
      handler: async (args: string, ctx: ExtensionCommandContext) => {
        if (!ctx.isIdle()) {
          ctx.ui.notify(
            `Agent is busy. Wait for it to finish before calling /${options.commandName}.`,
            "warning",
          );
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
            applyEffect(pi, ctx, config, eff);
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
            applyEntry(pi, config, closed);
            ctx.ui.notify(`Closed ${mode} workflow at ${closed.artifactDir}.`, "info");
          }
          args = goal;
        } else if (!args.trim()) {
          ctx.ui.notify(`Usage: /${options.commandName} <what to build>`, "warning");
          return;
        }

        const eff = await sm.start(args, deps);
        applyEffect(pi, ctx, config, eff);
        if (eff.kind === "started") {
          pi.sendUserMessage(eff.prompt);
        }
      },
    });
  };
}