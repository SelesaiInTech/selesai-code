/**
 * pi-graft — native Selesai integration for the Graft codebase-context CLI.
 *
 * Graft builds a local, regenerable graph of a repository (deterministic
 * tree-sitter structure, plus optional provider-backed summaries) and answers
 * semantic questions against it. This extension owns that integration the way a
 * Selesai user expects: executable discovery, graph lifecycle, status, consent,
 * semantic tools, retrieval strategy, and mutation-aware freshness — all native,
 * none of it MCP, and none of it touching another agent's configuration.
 *
 * Scope discipline:
 * - Graft's upstream agent-wiring command (`init`) is never invoked.
 * - A missing compatible CLI is automatically installed once through npm;
 *   incompatible user installations are never overwritten.
 * - Builds require explicit consent; deep (provider-backed) builds need their own.
 * - Every tool is read-only; the graph is a local cache, not a committed artifact.
 * - Graft processes default to telemetry opt-out without touching Graft's settings.
 *
 * Lifecycle: the factory only registers. Repository resolution, probing, status,
 * and the telemetry default all begin in `session_start` and are torn down in
 * `session_shutdown`, so no invocation that skips a session starts any work.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext, SessionStartEvent, SessionShutdownEvent } from "@selesai/code";
import {
	applyTelemetryDefault,
	GRAPH_DIR_NAME,
	graftFailureMessage,
	installGraft,
	parseAskJson,
	probeGraft,
	runGraft,
	type ExecLike,
	type GraftInstallRun,
	type GraftOp,
	type GraftProbe,
	type GraftRun,
	type TelemetryDefaultHandle,
} from "./cli.ts";
import { PROVIDER_ENV_NAMES, registerGraftCommands } from "./commands.ts";
import {
	buildInjectionPack,
	createInjectionGuard,
	injectionBudget,
	injectionMessage,
	planInjection,
} from "./prompt.ts";
import {
	ABSENT_GRAPH,
	DEFAULT_MAX_INJECTION_BYTES,
	DEFAULT_RETRIEVAL_MODE,
	DEFAULT_REFRESH_DEBOUNCE_SECONDS,
	type GraftEvent,
	type GraftSettings,
	type GraftState,
	type GraphPresence,
	INITIAL_GRAFT_STATE,
	INJECTION_ENTRY_TYPE,
	readBranchMode,
	readGraftSettings,
	recoveryFor,
	reduceGraftState,
	type RetrievalMode,
	STATUS_KEY,
	statusText,
} from "./state.ts";
import { GRAFT_TOOL_NAMES, registerGraftTools } from "./tools.ts";

export type { GraftProbe, GraftRun } from "./cli.ts";
export type { GraftSettings, GraftStateName, RetrievalMode } from "./state.ts";

/** The loaded module is the provider foreground children must load. */
export const GRAFT_EXTENSION_PATH = fileURLToPath(import.meta.url);
const BUILTIN_AGENT_AUGMENTATION_REQUEST_EVENT = "pi-subagents:request-builtin-agent-augmentations";
const GRAFT_AWARE_AGENT_NAMES = ["scout", "reviewer", "worker", "delegate", "oracle"];

type BuiltinAgentAugmentationRequest = {
	register(augmentation: {
		id: string;
		agentNames: readonly string[];
		addTools: readonly string[];
		subagentOnlyExtensions: readonly string[];
	}): void;
};

function registerBuiltinAgentAugmentation(pi: ExtensionAPI): void {
	pi.events.on(BUILTIN_AGENT_AUGMENTATION_REQUEST_EVENT, (request: unknown) => {
		if (!request || typeof request !== "object" || typeof (request as BuiltinAgentAugmentationRequest).register !== "function") return;
		(request as BuiltinAgentAugmentationRequest).register({
			id: "pi-graft",
			agentNames: GRAFT_AWARE_AGENT_NAMES,
			addTools: GRAFT_TOOL_NAMES,
			subagentOnlyExtensions: [GRAFT_EXTENSION_PATH],
		});
	});
}

/** Session-scoped state. Created in `session_start`, cleared in `session_shutdown`. */
interface GraftSession {
	settings: GraftSettings;
	enabled: boolean;
	repoRoot: string | undefined;
	presence: GraphPresence;
	state: GraftState;
	probe: GraftProbe | undefined;
	mode: RetrievalMode;
	telemetry: TelemetryDefaultHandle | undefined;
	disposed: boolean;
	lastRefreshAt: number;
}

function freshSession(): GraftSession {
	return {
		settings: {},
		enabled: false,
		repoRoot: undefined,
		presence: ABSENT_GRAPH,
		state: INITIAL_GRAFT_STATE,
		probe: undefined,
		mode: DEFAULT_RETRIEVAL_MODE,
		telemetry: undefined,
		disposed: true,
		lastRefreshAt: 0,
	};
}

/**
 * Best-effort graph detection on disk.
 *
 * `ponytail:` a filesystem check, not `graft check`. It answers "is there a
 * graph here" cheaply, which is what a session-start status line needs; it does
 * not pretend to answer "is it current" — that is `graft_check_freshness`'s job,
 * for which Graft itself is authoritative.
 */
export function detectGraphPresence(repoRoot: string): GraphPresence {
	if (!repoRoot) return ABSENT_GRAPH;
	const graphDir = join(repoRoot, GRAPH_DIR_NAME);
	const built = existsSync(join(graphDir, ".graph", "wiring.json")) || existsSync(join(graphDir, "INDEX.md"));
	if (!built) return ABSENT_GRAPH;
	let deep = false;
	try {
		deep = readdirSync(graphDir).some((entry) => entry.endsWith(".md") && entry !== "INDEX.md");
	} catch {
		deep = false;
	}
	return { built: true, deep };
}

/**
 * Bash commands that surely change the working tree.
 *
 * `ponytail:` a lexical list, not a shell parser, and deliberately biased toward
 * false negatives. A missed mutation costs only a stale status label: Graft
 * refreshes its graph against the working tree before every query, so retrieval
 * correctness never depends on this. Upgrade path is a real parser if the label
 * ever becomes load-bearing.
 */
const MUTATING_BASH =
	/(^|[;&|]\s*)(rm|rmdir|mv|cp|mkdir|touch|chmod|chown|ln|tee|truncate|patch|dd)\b|>>?\s*[^&|\s]|sed\s+-i|perl\s+-i|\bgit\s+(add|rm|mv|checkout|switch|restore|apply|commit|merge|rebase|cherry-pick|reset|stash|clean|revert)\b|\b(npm|pnpm|yarn|bun)\s+(install|i|add|remove|uninstall|update|upgrade)\b|\b(pip|poetry|uv|cargo|go|gem|composer)\s+(install|add|get|remove|update)\b/;

export function bashLooksMutating(command: string): boolean {
	return MUTATING_BASH.test(command);
}

/** True when a successful tool result changed the working tree. */
export function isMutatingResult(event: { toolName: string; input: Record<string, unknown> }): boolean {
	if (event.toolName === "edit" || event.toolName === "write") return true;
	if (event.toolName === "bash") {
		const command = event.input.command;
		return typeof command === "string" && bashLooksMutating(command);
	}
	return false;
}

export default function graftExtension(pi: ExtensionAPI): void {
	registerBuiltinAgentAugmentation(pi);
	const exec: ExecLike = (command, args, options) => pi.exec(command, args, options);
	let session = freshSession();
	let installPromise: Promise<GraftInstallRun> | undefined;
	const guard = createInjectionGuard();

	const applyEvent = (ctx: ExtensionContext | undefined, event: GraftEvent): void => {
		session.state = reduceGraftState(session.state, event);
		if (ctx?.hasUI) ctx.ui.setStatus(STATUS_KEY, statusText(session.state));
	};

	const setMode = (mode: RetrievalMode, ctx?: ExtensionContext): void => {
		session.mode = mode;
		if (ctx?.hasUI) ctx.ui.setStatus(`${STATUS_KEY}-mode`, `graft mode: ${mode}`);
	};

	/** Share one global npm install between startup and a concurrent `/graft` command. */
	const installCli = (ctx: ExtensionContext): Promise<GraftInstallRun> => {
		if (installPromise) return installPromise;
		const pending = installGraft(exec, ctx.cwd);
		installPromise = pending;
		void pending.finally(() => {
			if (installPromise === pending) installPromise = undefined;
		});
		return pending;
	};

	/** Resolve the repository root the way Graft does: the Git working tree. */
	const resolveRepoRoot = async (ctx: ExtensionContext): Promise<string | undefined> => {
		try {
			const result = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: ctx.cwd, timeout: 5_000 });
			if (result.killed || result.code !== 0) return undefined;
			return result.stdout.trim() || undefined;
		} catch {
			return undefined;
		}
	};

	/**
	 * Re-resolve repository, executable, and graph presence.
	 *
	 * Called from `session_start`, from the `/graft` commands, and lazily before
	 * the first tool call. Never from the factory, never on a timer.
	 */
	const recheck = async (ctx: ExtensionContext): Promise<void> => {
		if (!session.enabled || session.disposed) return;
		const repoRoot = await resolveRepoRoot(ctx);
		session.repoRoot = repoRoot;
		applyEvent(ctx, { type: "resolved", gitRepo: repoRoot !== undefined });
		if (!repoRoot) {
			session.probe = undefined;
			return;
		}
		session.presence = detectGraphPresence(repoRoot);
		const probe = await probeGraft(exec, repoRoot, ctx.signal);
		session.probe = probe;
		if (probe.kind === "ok") {
			applyEvent(ctx, { type: "probe-ok", version: probe.version, graph: session.presence });
		} else if (probe.kind === "missing") {
			applyEvent(ctx, { type: "probe-missing", detail: probe.detail });
		} else {
			applyEvent(ctx, { type: "probe-incompatible", version: probe.version, detail: probe.detail });
		}
	};

	/** Install a missing CLI without blocking session startup or racing another session. */
	const autoInstall = (ctx: ExtensionContext, activeSession: GraftSession): void => {
		if (ctx.hasUI) ctx.ui.notify("Installing Graft CLI…", "info");
		void (async () => {
			const install = await installCli(ctx);
			if (session !== activeSession || activeSession.disposed) return;
			if (install.code !== 0 || install.killed) {
				const detail = (install.stderr.trim() || install.stdout.trim() || `exit status ${install.code}`).split("\n")[0];
				if (ctx.hasUI) ctx.ui.notify(`Graft CLI install failed: ${detail}`, "warning");
				return;
			}
			await recheck(ctx);
			if (session !== activeSession || activeSession.disposed) return;
			if (session.state.name === "unavailable" || session.state.name === "incompatible") {
				if (ctx.hasUI) ctx.ui.notify("Graft CLI installed, but is not yet usable. Restart Selesai and run /graft doctor.", "warning");
				return;
			}
			if (ctx.hasUI) ctx.ui.notify("Graft CLI installed.", "info");
		})();
	};

	/**
	 * Refuse a call that cannot produce an honest answer, with the recovery step
	 * for the current state. `graft check` is the exception among reads: it is the
	 * drift report, so it is allowed to answer for a graph that is not there.
	 */
	const ensureReady = async (ctx: ExtensionContext, op: GraftOp): Promise<void> => {
		if (session.disposed) throw new Error("Graft is not ready: no active Selesai session.");
		if (!session.enabled) {
			throw new Error(
				"The Graft extension is disabled by settings. Set `graft.enabled: true` in Selesai settings to use its tools.",
			);
		}
		// Re-resolve when an earlier attempt could not resolve anything: the user
		// may have installed the CLI or opened the repository since.
		if (!session.probe || session.repoRoot === undefined) await recheck(ctx);
		if (!session.repoRoot) {
			throw new Error("Graft needs a Git repository, and this working directory is not inside one. Run /graft doctor.");
		}
		if (session.probe?.kind !== "ok") {
			const detail = session.probe?.detail ?? "the graft executable is unavailable";
			throw new Error(`Graft is not usable here: ${detail} Run /graft doctor for a recovery step.`);
		}
		if (!session.presence.built && op.kind !== "check-freshness" && op.kind !== "build") {
			throw new Error(
				`There is no ${GRAPH_DIR_NAME}/ graph in ${session.repoRoot} yet. ${
					recoveryFor(session.state) ?? "Run /graft build to index this repository."
				}`,
			);
		}
	};

	const runOp = async (ctx: ExtensionContext, op: GraftOp, signal?: AbortSignal): Promise<GraftRun> => {
		await ensureReady(ctx, op);
		return runGraft(exec, session.repoRoot!, op, { signal });
	};

	/** A read-only query answered, and Graft refreshed the graph before answering. */
	const noteQuery = (ctx: ExtensionContext, run: GraftRun): void => {
		if (run.code !== 0) return;
		if (run.op.kind === "check-freshness" || run.op.kind === "build") return;
		session.presence = detectGraphPresence(session.repoRoot ?? ctx.cwd);
		applyEvent(ctx, { type: "query-succeeded", presence: session.presence });
	};

	const recordBuild = (ctx: ExtensionContext, run: GraftRun, deep: boolean): void => {
		session.presence = detectGraphPresence(session.repoRoot ?? ctx.cwd);
		applyEvent(
			ctx,
			run.code === 0
				? { type: "build-succeeded", deep, presence: session.presence }
				: { type: "build-failed", detail: graftFailureMessage(run) },
		);
	};

	// -------------------------------------------------------------------------
	// Lifecycle
	// -------------------------------------------------------------------------

	pi.on("session_start", async (event: SessionStartEvent, ctx: ExtensionContext) => {
		// A start without a preceding shutdown (a reload that raced one, a second
		// start in the same process) must not leak the previous defaults.
		session.telemetry?.restore();
		session = freshSession();
		session.disposed = false;
		session.settings = readGraftSettings({ cwd: ctx.cwd, trusted: ctx.isProjectTrusted() });
		session.enabled = session.settings.enabled !== false;
		if (!session.enabled) {
			if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		if (session.settings.telemetry !== "inherit") session.telemetry = applyTelemetryDefault();
		setMode(readBranchMode(ctx.sessionManager.getBranch()) ?? session.settings.mode ?? DEFAULT_RETRIEVAL_MODE, ctx);

		await recheck(ctx);
		if (session.state.name === "unavailable") autoInstall(ctx, session);
	});

	pi.on("session_shutdown", (_event: SessionShutdownEvent, ctx: ExtensionContext) => {
		session.disposed = true;
		session.telemetry?.restore();
		if (ctx.hasUI) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			ctx.ui.setStatus(`${STATUS_KEY}-mode`, undefined);
		}
		guard.beginTurn();
		session = freshSession();
	});

	pi.on("turn_start", () => {
		guard.beginTurn();
	});

	// -------------------------------------------------------------------------
	// Retrieval strategy
	// -------------------------------------------------------------------------

	pi.on("before_agent_start", async (event, ctx) => {
		if (!session.enabled || session.disposed) return;
		const plan = planInjection({
			mode: session.mode,
			prompt: event.prompt,
			state: session.state,
			enabled: session.enabled,
		});
		if (!plan.inject || !guard.shouldInject()) return;

		try {
			const budget = injectionBudget(
				plan.mode,
				session.settings.maxInjectionBytes ?? DEFAULT_MAX_INJECTION_BYTES,
			);
			const run = await runOp(
				ctx,
				{ kind: "find-code", question: plan.query, limit: budget.limit, in: session.settings.in },
				ctx.signal,
			);
			if (run.code !== 0) {
				// The turn proceeds without context, but not silently: a failed
				// lookup the user cannot see is a context gap they cannot explain.
				if (ctx.hasUI) ctx.ui.notify(`Graft context unavailable: ${graftFailureMessage(run)}`, "warning");
				return;
			}
			if (session.disposed) return;
			noteQuery(ctx, run);

			const payload = parseAskJson(run.stdout);
			if (!payload) return;
			const pack = buildInjectionPack(payload, {
				maxBytes: budget.maxBytes,
				minCoverage: session.settings.minCoverage,
			});
			// A low-coverage pack is noise the model would have to reason around, so
			// it is dropped rather than injected.
			if (!pack) return;

			guard.markInjected();
			const references = pack.references.map((r) => (r.span ? `${r.path}:${r.span}` : r.path));
			pi.appendEntry(INJECTION_ENTRY_TYPE, {
				mode: plan.mode,
				query: plan.query,
				state: session.state.name,
				references,
				bytes: pack.bytes,
				truncated: pack.truncated,
				coverage: pack.coverage,
			});

			return {
				message: {
					customType: "graft-context",
					content: injectionMessage({ pack, mode: plan.mode, state: session.state.name }),
					display: true,
					details: {
						mode: plan.mode,
						references: pack.references,
						bytes: pack.bytes,
						truncated: pack.truncated,
						coverage: pack.coverage,
					},
				},
			};
		} catch (error) {
			// Injection must never break a turn: a failed Graft query just means the
			// model starts without a pack, exactly as in pull mode.
			if (ctx.hasUI) {
				ctx.ui.notify(
					`Graft context unavailable: ${error instanceof Error ? error.message : String(error)}`,
					"warning",
				);
			}
			return;
		}
	});

	// -------------------------------------------------------------------------
	// Mutation awareness
	// -------------------------------------------------------------------------

	pi.on("tool_result", async (event, ctx) => {
		if (!session.enabled || session.disposed || event.isError) return;
		if (!isMutatingResult({ toolName: event.toolName, input: event.input })) return;
		applyEvent(ctx, { type: "mutation-observed" });
	});

	/**
	 * Debounced, idle-aware proactive refresh.
	 *
	 * `agent_end` is the runtime's own idle boundary, so this needs no timer: a
	 * burst of edits inside one turn costs at most one rebuild, and a structural
	 * rebuild is free and offline. Refresh never *creates* a graph — an unbuilt
	 * repository stays unbuilt until the user consents to a build.
	 */
	pi.on("agent_end", (_event, ctx) => {
		if (!session.enabled || session.disposed) return;
		if (session.state.name !== "changed" || !session.presence.built) return;
		const debounceMs = (session.settings.refreshDebounceSeconds ?? DEFAULT_REFRESH_DEBOUNCE_SECONDS) * 1000;
		if (Date.now() - session.lastRefreshAt < debounceMs) return;
		session.lastRefreshAt = Date.now();
		if (ctx.hasUI) {
			ctx.ui.setStatus(STATUS_KEY, statusText(reduceGraftState(session.state, { type: "refresh-started" })));
		}

		void (async () => {
			try {
				const run = await runGraft(exec, session.repoRoot!, { kind: "build", deep: false });
				if (session.disposed) return;
				recordBuild(ctx, run, false);
			} catch (error) {
				if (session.disposed) return;
				applyEvent(ctx, {
					type: "build-failed",
					detail: error instanceof Error ? error.message : String(error),
				});
			}
		})();
	});

	// -------------------------------------------------------------------------
	// Registration
	// -------------------------------------------------------------------------

	registerGraftTools(pi, {
		run: runOp,
		settings: () => session.settings,
		state: () => session.state,
		noteQuery,
	});

	registerGraftCommands(pi, {
		recheck,
		state: () => session.state,
		settings: () => session.settings,
		mode: () => session.mode,
		setMode,
		repoRoot: () => session.repoRoot,
		graphPresence: () => session.presence,
		installCli,
		runBuild: async (deep, ctx) => {
			await ensureReady(ctx, { kind: "build", deep });
			applyEvent(ctx, { type: "build-started", deep });
			const run = await runGraft(exec, session.repoRoot!, { kind: "build", deep });
			recordBuild(ctx, run, deep);
			return run;
		},
		runRefresh: async (ctx) => {
			if (!session.presence.built) return undefined;
			await ensureReady(ctx, { kind: "build", deep: false });
			session.lastRefreshAt = Date.now();
			applyEvent(ctx, { type: "refresh-started" });
			const run = await runGraft(exec, session.repoRoot!, { kind: "build", deep: false });
			recordBuild(ctx, run, false);
			return run;
		},
		providerEnvNames: () => PROVIDER_ENV_NAMES.filter((name) => Boolean(process.env[name])),
		telemetryDefaultApplied: () => session.telemetry !== undefined,
	});
}
