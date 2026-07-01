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
import { access, mkdir } from "node:fs/promises";

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
    .replace(/[^a-z0-9]+/g, "-")
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
    const { start, next, end } = options.toolNames;
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
                text: `A ${mode} workflow is already active (phase: ${eff.phase}). Use ${next} or ${end}, not ${start}.`,
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

    // ── next tool ──
    pi.registerTool({
      name: next,
      label: options.toolLabels.next,
      description: `Advance the ${mode} workflow one step after the current step is complete. Returns the next step's instructions. Do not call until the current step is fully complete.`,
      promptSnippet: `${next}() - advance the ${mode} workflow one step once the current step is done.`,
      promptGuidelines: [
        `Call ${next} only when the current ${mode} workflow step is genuinely complete.`,
        `From the final step, call ${end} instead.`,
      ],
      parameters: Type.Object({}),
      async execute(_id, _params, _signal, _onUpdate, ctx) {
        const eff = await sm.next(deps);
        applyEffect(pi, ctx, config, eff);
        switch (eff.kind) {
          case "idle":
            return {
              content: [{ type: "text", text: `No active ${mode} workflow. Call ${start} first.` }],
              details: { active: false },
            };
          case "blocked":
            return {
              content: [{ type: "text", text: `Current step (${eff.phase}) is not complete. Write ${sm.snapshot.artifactDir}/${eff.missing} first, then call ${next} again.` }],
              details: { phase: eff.phase, blocked: eff.missing },
            };
          case "terminalNeedsArtifacts":
            return {
              content: [{ type: "text", text: `Audit step is not complete. Write ${sm.snapshot.artifactDir}/${eff.missing} first, then call ${end}.` }],
              details: { phase: eff.phase, blocked: eff.missing },
            };
          case "terminalReady":
            return {
              content: [{ type: "text", text: `Already at the final phase. Call ${end} to close the workflow.` }],
              details: { phase: eff.phase },
            };
          case "advanced": {
            const label = eff.skipped
              ? `Phase advanced to ${eff.phase} (skipped ${eff.skipped}). ${eff.prompt}`
              : `Phase advanced to ${eff.phase}. ${eff.prompt}`;
            return {
              content: [{ type: "text", text: label }],
              details: { phase: eff.phase, skipped: eff.skipped },
            };
          }
          default:
            return {
              content: [{ type: "text", text: `No active ${mode} workflow. Call ${start} first.` }],
              details: { active: false },
            };
        }
      },
      renderResult(result, _options, theme) {
        const d = result.details as {
          phase?: string;
          skipped?: string;
          active?: boolean;
          blocked?: string;
        };
        if (d.active === false) {
          return new Text(theme.fg("dim", "○ no active workflow"), 0, 0);
        }
        if (d.blocked) {
          return new Text(
            theme.fg("warning", `✋ ${d.phase} blocked · missing ${d.blocked}`),
            0,
            0,
          );
        }
        const step = config.phases.indexOf(d.phase as Phase) + 1;
        const label = d.skipped
          ? `${step}/${config.phases.length} ${d.phase} (skipped ${d.skipped})`
          : `${step}/${config.phases.length} ${d.phase}`;
        return new Text(theme.fg("warning", `▲ ${label}`), 0, 0);
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
          case "endBlocked":
            return {
              content: [{ type: "text", text: `Cannot end: ${eff.missing}. Write ${sm.snapshot.artifactDir}/${eff.missing} first.` }],
              details: { phase: eff.phase, blocked: eff.missing },
            };
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

    // ── tool_result: auto-advance. One call, one apply. ──
    pi.on("tool_result", async (event: any, ctx: ExtensionContext) => {
      if (
        event.toolName !== "write" &&
        event.toolName !== "edit" &&
        event.toolName !== "bash"
      )
        return;
      const eff = await sm.onArtifactMaybe(deps);
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