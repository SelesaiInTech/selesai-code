/**
 * The `/graft` command surface: setup, build, deep, refresh, status, doctor, mode.
 *
 * Command handlers own two things the tools never touch: consent, and honest
 * reporting. A command that can write to the repository says exactly which
 * files it may create or change and asks first; with no dialog UI it refuses
 * and prints the exact manual command instead.
 *
 * Nothing here ever invokes Graft's upstream agent-wiring command. Selesai's
 * setup installs a missing CLI automatically, explains local effects, and builds
 * a graph — it does not edit Claude, Codex, Cursor, Gemini, Copilot, or any
 * other agent's configuration.
 */

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@selesai/code";
import {
	GRAFT_PACKAGE,
	GRAPH_DIR_NAME,
	INSTALL_COMMAND,
	graftFailureMessage,
	MAX_GRAFT_VERSION_EXCLUSIVE,
	MIN_GRAFT_VERSION,
	TELEMETRY_ENV,
	type GraftInstallRun,
	type GraftRun,
} from "./cli.ts";
import { describeStrategy } from "./prompt.ts";
import {
	DEFAULT_MAX_INJECTION_BYTES,
	DEFAULT_MIN_COVERAGE,
	RETRIEVAL_MODES,
	type RetrievalMode,
	type GraftSettings,
	type GraftState,
	MODE_ENTRY_TYPE,
	recoveryFor,
	type GraphPresence,
	statusDetail,
	statusText,
} from "./state.ts";

/**
 * Structural shape of a slash-command argument completion. Declared locally so
 * this module depends only on `@selesai/code` at runtime.
 */
export interface ArgumentCompletion {
	value: string;
	label: string;
	description?: string;
}

/** Everything the command surface needs from the extension runtime. */
export interface GraftCommandRuntime {
	/** Re-resolve repository root, executable, and graph presence. */
	recheck(ctx: ExtensionContext): Promise<void>;
	state(): GraftState;
	settings(): GraftSettings;
	mode(): RetrievalMode;
	setMode(mode: RetrievalMode, ctx: ExtensionContext): void;
	repoRoot(): string | undefined;
	graphPresence(): GraphPresence;
	/** Install the compatible CLI when probing found none. */
	installCli(ctx: ExtensionContext): Promise<GraftInstallRun>;
	/** Structural or deep build. Call only after consent. */
	runBuild(deep: boolean, ctx: ExtensionContext): Promise<GraftRun>;
	/** Proactive refresh of an existing graph; undefined when there is nothing to refresh. */
	runRefresh(ctx: ExtensionContext): Promise<GraftRun | undefined>;
	/** Names (never values) of Graft provider environment variables already set. */
	providerEnvNames(): string[];
	/** Whether this session actually set the telemetry opt-out default itself. */
	telemetryDefaultApplied(): boolean;
}

export const DOCTOR_USAGE = `/graft <command>

  status          current availability, graph state, and retrieval mode
  doctor          full health report with a recovery step for each problem
  setup           install the CLI if needed, then explain build effects and ask for consent
  build           build graft/ for this repository (structural; no model, no key)
  deep            provider-backed build: adds summaries and per-symbol crux
  refresh         re-index an existing graph after edits
  mode [pull|push|hybrid]   show or set the retrieval strategy
  help            this message`;

/** Provider environment variables Graft reads. Values are never read or shown. */
export const PROVIDER_ENV_NAMES = [
	"GRAFT_PROVIDER",
	"GRAFT_MODEL",
	"GRAFT_BASE_URL",
	"GRAFT_API_KEY",
	"OPENROUTER_API_KEY",
	"ORCAROUTER_API_KEY",
] as const;

/** Console fallback so print/JSON modes still get actionable diagnostics. */
function report(ctx: ExtensionContext, message: string, type?: "info" | "warning" | "error"): void {
	if (ctx.hasUI) {
		ctx.ui.notify(message, type);
		return;
	}
	console.warn(`[graft] ${message}`);
}

export interface DoctorInput {
	repoRoot: string | undefined;
	gitRepo: boolean;
	state: GraftState;
	presence: GraphPresence;
	mode: RetrievalMode;
	settings: GraftSettings;
	/** True when the extension set DO_NOT_TRACK itself for this session. */
	telemetryDefault: boolean;
	providerEnv: string[];
}

/** Pure health report. Exported so the wording can be asserted directly. */
export function formatDoctor(input: DoctorInput): string {
	const lines: string[] = ["Graft doctor", ""];
	const row = (label: string, value: string) => lines.push(`  ${label.padEnd(12)} ${value}`);

	row("repository", input.repoRoot ? `${input.repoRoot}${input.gitRepo ? " (git ✓)" : " (not a git repository)"}` : "unresolved");
	row(
		"executable",
		input.state.name === "unavailable"
			? `not found on PATH — ${statusDetail(input.state)}`
			: input.state.version
				? `graft ${input.state.version} (supported: >=${MIN_GRAFT_VERSION} <${MAX_GRAFT_VERSION_EXCLUSIVE})`
				: statusDetail(input.state),
	);
	row(
		"graph",
		input.presence.built
			? `${GRAPH_DIR_NAME}/ present — ${input.presence.deep ? "structural + deep summaries" : "structural only"}`
			: `no ${GRAPH_DIR_NAME}/ here`,
	);
	row("state", `${input.state.name} — ${statusDetail(input.state)}`);
	row("mode", describeStrategy(input.mode));
	row(
		"telemetry",
		input.telemetryDefault
			? `${TELEMETRY_ENV}=1 set by this extension for Graft processes (your Graft settings are untouched)`
			: `${TELEMETRY_ENV} left to your environment`,
	);
	row("injection", `min coverage ${input.settings.minCoverage ?? DEFAULT_MIN_COVERAGE}, max ${input.settings.maxInjectionBytes ?? DEFAULT_MAX_INJECTION_BYTES} bytes`);
	row(
		"provider env",
		input.providerEnv.length > 0
			? `${input.providerEnv.join(", ")} set (values never read or copied) — deep builds use Graft's own provider configuration`
			: `none of ${PROVIDER_ENV_NAMES.join(", ")} set — deep builds would need Graft's own provider configuration`,
	);

	const recovery = recoveryFor(input.state);
	if (recovery) {
		lines.push("", `  next step    ${recovery}`);
	} else if (input.state.name === "fresh-deep") {
		lines.push("", "  next step    nothing to fix; deep summaries are active for this graph.");
	} else if (!input.presence.deep) {
		lines.push(
			"",
			"  next step    structural context is active. /graft deep adds provider-backed summaries if you accept that source-derived work leaves the machine.",
		);
	}
	return lines.join("\n");
}

export function formatStatus(input: DoctorInput): string {
	const lines = [
		statusText(input.state),
		`  ${describeStrategy(input.mode)}`,
		`  graph: ${input.presence.built ? (input.presence.deep ? "structural + deep" : "structural only") : "not built"}`,
	];
	if (input.repoRoot) lines.push(`  root: ${input.repoRoot}`);
	return lines.join("\n");
}

/**
 * What a build writes. Shown verbatim before consent so the user is agreeing to
 * a concrete list, not to "some files".
 */
export function buildEffects(deep: boolean): string {
	const effects = [
		`  • creates/updates ./${GRAPH_DIR_NAME}/ (markdown nodes, wiring graph, per-file cards)`,
		"  • adds graft/ to .gitignore and writes .ignore for ripgrep re-admit",
		"  • updates .graft/config.json with this repository's build choices",
	];
	if (deep) {
		effects.push(
			"  • sends source-derived file summaries and symbol cruxes through the LLM provider configured in Graft's own environment (GRAFT_PROVIDER / GRAFT_MODEL / GRAFT_BASE_URL / GRAFT_API_KEY)",
			"  • caches those summaries under graft/ so later deep builds are incremental",
		);
	}
	return effects.join("\n");
}

/** Consent-gated mutation step. Returns false when the user declined or has no UI. */
async function confirmMutation(
	ctx: ExtensionCommandContext,
	title: string,
	body: string,
	manualCommand: string,
): Promise<boolean> {
	if (!ctx.hasUI) {
		report(
			ctx,
			`this command changes the repository, so it needs an interactive confirmation. Run it yourself: ${manualCommand}`,
			"warning",
		);
		return false;
	}
	const accepted = await ctx.ui.confirm(
		title,
		`${body}\n\nGraft's own \`init\` command is never run: this extension does not write configuration for other coding agents.\n\nProceed?`,
	);
	if (!accepted) report(ctx, `Cancelled. Nothing was written. To run it yourself: ${manualCommand}`, "info");
	return accepted;
}

/** Install only when probing proved the CLI is absent; never overwrite an incompatible user install. */
async function ensureCli(
	ctx: ExtensionCommandContext,
	runtime: GraftCommandRuntime,
): Promise<boolean> {
	if (runtime.state().name !== "unavailable") return true;
	report(ctx, "Installing Graft CLI…", "info");
	const install = await runtime.installCli(ctx);
	if (install.code !== 0 || install.killed) {
		const detail = (install.stderr.trim() || install.stdout.trim() || `exit status ${install.code}`).split("\n")[0];
		report(ctx, `Graft CLI install failed: ${detail}\nInstall it yourself: ${INSTALL_COMMAND}`, "error");
		return false;
	}

	await runtime.recheck(ctx);
	if (runtime.state().name === "unavailable" || runtime.state().name === "incompatible") {
		report(
			ctx,
			`npm reported success, but Graft is still not usable: ${statusDetail(runtime.state())}. Restart Selesai or install it yourself: ${INSTALL_COMMAND}`,
			"warning",
		);
		return false;
	}
	return true;
}

export function registerGraftCommands(pi: ExtensionAPI, runtime: GraftCommandRuntime): void {
	const doctorInput = (): DoctorInput => ({
		repoRoot: runtime.repoRoot(),
		gitRepo: runtime.repoRoot() !== undefined,
		state: runtime.state(),
		presence: runtime.graphPresence(),
		mode: runtime.mode(),
		settings: runtime.settings(),
		telemetryDefault: runtime.telemetryDefaultApplied(),
		providerEnv: runtime.providerEnvNames(),
	});

	pi.registerCommand("graft", {
		description: "Graft codebase-context: status, doctor, setup, build, deep, refresh, mode",
		getArgumentCompletions: (prefix: string): ArgumentCompletion[] | null => {
			const items: ArgumentCompletion[] = [
				{ value: "status", label: "status", description: "availability, graph state, retrieval mode" },
				{ value: "doctor", label: "doctor", description: "full health report and recovery steps" },
				{ value: "setup", label: "setup", description: "install CLI if needed, then build graft/" },
				{ value: "build", label: "build", description: "build graft/ (structural; no model, no key)" },
				{ value: "deep", label: "deep", description: "provider-backed build (needs Graft provider config)" },
				{ value: "refresh", label: "refresh", description: "re-index an existing graph after edits" },
				{ value: "mode", label: "mode", description: "show or set pull | push | hybrid" },
				{ value: "help", label: "help", description: "usage" },
			];
			for (const mode of RETRIEVAL_MODES) {
				items.push({ value: `mode ${mode}`, label: `mode ${mode}`, description: describeStrategy(mode) });
			}
			const filtered = prefix ? items.filter((item) => item.value.startsWith(prefix)) : items;
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const [subcommand = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);

			switch (subcommand) {
				case "help":
					report(ctx, DOCTOR_USAGE, "info");
					return;

				case "status": {
					await runtime.recheck(ctx);
					report(ctx, formatStatus(doctorInput()), "info");
					return;
				}

				case "doctor": {
					await runtime.recheck(ctx);
					report(ctx, formatDoctor(doctorInput()), "info");
					const recovery = recoveryFor(runtime.state());
					if (recovery && ctx.hasUI) ctx.ui.notify(recovery, "warning");
					return;
				}

				case "mode": {
					const requested = rest[0];
					if (!requested) {
						report(ctx, `${describeStrategy(runtime.mode())}\n\n${DOCTOR_USAGE}`, "info");
						return;
					}
					if (!(RETRIEVAL_MODES as readonly string[]).includes(requested)) {
						report(ctx, `Unknown mode "${requested}". Choose one of: ${RETRIEVAL_MODES.join(", ")}.`, "error");
						return;
					}
					const mode = requested as RetrievalMode;
					runtime.setMode(mode, ctx);
					pi.appendEntry(MODE_ENTRY_TYPE, { mode });
					report(ctx, `Retrieval mode: ${describeStrategy(mode)}`, "info");
					return;
				}

				// `build --deep` and `deep` are the same operation, so they get the same
				// consent: a deep build must never reach the provider under weaker
				// framing than the dedicated command.
				case "setup":
				case "build":
				case "deep": {
					const deep = subcommand === "deep" || rest.includes("--deep");
					await runtime.recheck(ctx);
					if (!(await ensureCli(ctx, runtime))) return;
					const repo = runtime.repoRoot() ?? "this repository";
					const manualCommand = `cd ${runtime.repoRoot() ?? "."} && graft build${deep ? " --deep" : ""}`;
					const accepted = await confirmMutation(
						ctx,
						deep
							? "Run the provider-backed deep build?"
							: subcommand === "setup"
								? "Set up Graft for this repository?"
								: "Build the Graft graph?",
						deep
							? `This runs \`graft build --deep\` in ${repo}.\n\nThe structural graph stays local and deterministic. The deep pass is different: Graft summarizes each changed file and extracts per-symbol cruxes using the LLM provider configured in Graft's own environment, so source-derived content leaves this machine.\n\nSelesai does not read, copy, or forward its own provider credentials to Graft.\n\nFiles it can write:\n${buildEffects(true)}`
							: `This runs \`graft build\` in ${repo} and can write:\n\n${buildEffects(false)}`,
						manualCommand,
					);
					if (!accepted) return;
					await runAndReport(ctx, runtime, () => runtime.runBuild(deep, ctx));
					return;
				}

				case "refresh": {
					await runtime.recheck(ctx);
					if (!runtime.graphPresence().built) {
						report(
							ctx,
							`No ${GRAPH_DIR_NAME}/ here yet — /graft build creates one (refresh only re-indexes an existing graph).`,
							"warning",
						);
						return;
					}
					await runAndReport(ctx, runtime, () => runtime.runRefresh(ctx));
					return;
				}

				default:
					report(ctx, `Unknown command "${subcommand}".\n\n${DOCTOR_USAGE}`, "error");
			}
		},
	});
}

async function runAndReport(
	ctx: ExtensionCommandContext,
	runtime: GraftCommandRuntime,
	action: () => Promise<GraftRun | undefined>,
): Promise<void> {
	const run = await action();
	if (!run) {
		report(ctx, "Nothing to refresh: the graph is already in sync with the working tree.", "info");
		return;
	}
	await runtime.recheck(ctx);
	const state = runtime.state();
	if (run.code !== 0) {
		// A degraded deep pass still keeps everything it computed, so it is a
		// warning with the command's own explanation rather than a plain failure.
		const detail = (run.stderr.trim() || run.stdout.trim()).split("\n").slice(-12).join("\n");
		report(
			ctx,
			`${graftFailureMessage(run)}\n${detail}`,
			state.name === "failed" ? "error" : "warning",
		);
		return;
	}
	report(ctx, `Done. ${statusText(state)} — ${statusDetail(state)}`, "info");
}

/** Where the deep-build guidance points a user whose provider is not configured. */
export const DEEP_PROVIDER_HINT =
	`Set GRAFT_PROVIDER, GRAFT_MODEL, and GRAFT_API_KEY in your own environment (or a repo .env), then re-run /graft deep. ` +
	`${GRAFT_PACKAGE} reads them itself; this extension never forwards Selesai credentials.`;
