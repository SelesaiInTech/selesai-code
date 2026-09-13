/**
 * Graft graph state, project settings, and session-native persistence.
 *
 * The graph is a project-local, regenerable cache — never a committed artifact —
 * so its state machine is mostly about telling the user *what the context they
 * are about to receive actually is*: absent, structural-only, deep-enriched, or
 * known-stale relative to the working tree.
 *
 * State transitions are a pure reducer {@link reduceGraftState} so they can be
 * asserted without a session, a process, or a clock.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@selesai/code";
import type { SessionEntry } from "@selesai/code";
import { INSTALL_COMMAND } from "./cli.ts";

// ---------------------------------------------------------------------------
// Retrieval strategy
// ---------------------------------------------------------------------------

/**
 * How Graft context reaches the model.
 *
 * - `pull`   — the model calls the Graft tools when it needs repository context.
 * - `push`   — an eligible coding turn starts from a bounded source-backed pack.
 * - `hybrid` — a cheap orientation pack for eligible coding turns, tools kept.
 */
export type RetrievalMode = "pull" | "push" | "hybrid";

export const RETRIEVAL_MODES: readonly RetrievalMode[] = ["pull", "push", "hybrid"];
export const DEFAULT_RETRIEVAL_MODE: RetrievalMode = "push";

export function isRetrievalMode(value: unknown): value is RetrievalMode {
	return typeof value === "string" && (RETRIEVAL_MODES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Project settings
// ---------------------------------------------------------------------------

export interface GraftSettings {
	/** Set false to keep Graft tools and commands out of the session entirely. */
	enabled?: boolean;
	/** Default retrieval strategy; a session choice overrides it. */
	mode?: RetrievalMode;
	/** `opt-out` (default) forces `DO_NOT_TRACK=1`; `inherit` leaves the user's own Graft choice alone. */
	telemetry?: "opt-out" | "inherit";
	/** Hybrid/push relevance gate: skip injection below this `coverage` share. */
	minCoverage?: number;
	/** Cap on the bytes of a pushed pack. */
	maxInjectionBytes?: number;
	/** Cap on the bytes of a tool result. */
	maxResultBytes?: number;
	/** Repository-relative prefix every query is narrowed to. */
	in?: string;
	/** Seconds a mutation stays "changed" before a proactive refresh is attempted. */
	refreshDebounceSeconds?: number;
}

export const SETTINGS_KEY = "graft";

/** Relevance gate default for push/hybrid. Graft's own hooks use the same idea. */
export const DEFAULT_MIN_COVERAGE = 0.25;
export const DEFAULT_MAX_INJECTION_BYTES = 12 * 1024;
export const DEFAULT_REFRESH_DEBOUNCE_SECONDS = 20;

function readSettingsFile(path: string): Record<string, unknown> | undefined {
	let raw: string;
	try {
		raw = readFileSync(path, "utf-8");
	} catch {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
	} catch {
		// A malformed settings file must not break a session; ignore it.
		return undefined;
	}
}

function normalizeSettings(raw: unknown): GraftSettings {
	if (typeof raw !== "object" || raw === null) return {};
	const value = raw as Record<string, unknown>;
	const settings: GraftSettings = {};
	if (typeof value.enabled === "boolean") settings.enabled = value.enabled;
	if (isRetrievalMode(value.mode)) settings.mode = value.mode;
	if (value.telemetry === "opt-out" || value.telemetry === "inherit") settings.telemetry = value.telemetry;
	if (typeof value.minCoverage === "number" && value.minCoverage >= 0 && value.minCoverage <= 1) {
		settings.minCoverage = value.minCoverage;
	}
	for (const key of ["maxInjectionBytes", "maxResultBytes", "refreshDebounceSeconds"] as const) {
		const candidate = value[key];
		if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) settings[key] = candidate;
	}
	if (typeof value.in === "string" && value.in.trim()) settings.in = value.in.trim();
	return settings;
}

/**
 * Resolve Graft settings from the global agent settings and, for a trusted
 * project only, the project settings. Project values win.
 *
 * Untrusted projects contribute nothing: reading project-local configuration
 * before project trust is established is exactly the behavior Selesai's trust
 * gate exists to prevent.
 */
export function readGraftSettings(options: {
	cwd: string;
	trusted: boolean;
	agentDir?: string;
}): GraftSettings {
	const agentDir = options.agentDir ?? getAgentDir();
	const global = normalizeSettings(readSettingsFile(join(agentDir, "settings.json"))?.[SETTINGS_KEY]);
	if (!options.trusted) return global;
	const project = normalizeSettings(
		readSettingsFile(join(options.cwd, CONFIG_DIR_NAME, "settings.json"))?.[SETTINGS_KEY],
	);
	return { ...global, ...project };
}

// ---------------------------------------------------------------------------
// Graph state
// ---------------------------------------------------------------------------

export type GraftStateName =
	| "unsupported"
	| "unavailable"
	| "incompatible"
	| "unbuilt"
	| "building"
	| "fresh-structural"
	| "fresh-deep"
	| "changed"
	| "refreshing"
	| "failed";

export interface GraftState {
	name: GraftStateName;
	/** Executable version, when one was read. */
	version?: string;
	/** The graph on disk carries provider-backed summaries. */
	deep?: boolean;
	/** One actionable sentence for the user. */
	detail?: string;
}

export const INITIAL_GRAFT_STATE: GraftState = { name: "unsupported", detail: "not checked yet" };

export type GraftEvent =
	/** Repository root resolution finished. */
	| { type: "resolved"; gitRepo: boolean }
	| { type: "probe-ok"; version: string; graph: GraphPresence }
	| { type: "probe-missing"; detail: string }
	| { type: "probe-incompatible"; version?: string; detail: string }
	| { type: "build-started"; deep: boolean }
	| { type: "build-succeeded"; deep: boolean; presence: GraphPresence }
	| { type: "build-failed"; detail: string }
	| { type: "refresh-started" }
	/** A query returned; Graft refreshed the graph against the working tree first. */
	| { type: "query-succeeded"; presence?: GraphPresence }
	/** A successful edit/write/mutating bash was observed. */
	| { type: "mutation-observed" }
	| { type: "reset" };

/** What is actually on disk for a resolved repository. */
export interface GraphPresence {
	/** A `graft/` directory with an index exists. */
	built: boolean;
	/** Provider-backed summaries are present for the current code. */
	deep: boolean;
}

export const ABSENT_GRAPH: GraphPresence = { built: false, deep: false };

function applyPresence(presence: GraphPresence): GraftState {
	if (!presence.built) return { name: "unbuilt", detail: "no graph here yet — run /graft build" };
	if (presence.deep) return { name: "fresh-deep", deep: true };
	return { name: "fresh-structural", deep: false };
}

/**
 * Pure state transition.
 *
 * Invariants worth stating because callers depend on them:
 * - `mutation-observed` never *downgrades* a terminal failure or an unbuilt
 *   repository; there is nothing to mark stale.
 * - `query-succeeded` returns a stale graph to fresh, because Graft refreshes
 *   against the working tree before it answers. That is what makes the state
 *   honest without a synchronous rebuild after every edit.
 */
export function reduceGraftState(current: GraftState, event: GraftEvent): GraftState {
	switch (event.type) {
		case "resolved":
			if (!event.gitRepo) {
				return { name: "unsupported", detail: "Graft needs a Git repository (the working tree is its file set)" };
			}
			return current.name === "unsupported" && current.detail === "not checked yet"
				? { name: "unavailable", detail: "checking for the graft executable…" }
				: current;
		case "probe-ok":
			return { ...applyPresence(event.graph), version: event.version };
		case "probe-missing":
			return { name: "unavailable", detail: event.detail };
		case "probe-incompatible":
			return { name: "incompatible", version: event.version, detail: event.detail };
		case "build-started":
			return { name: "building", deep: event.deep, version: current.version };
		case "build-succeeded":
			return { ...applyPresence(event.presence), version: current.version };
		case "build-failed":
			return { name: "failed", version: current.version, detail: event.detail };
		case "refresh-started":
			return current.name === "changed" ? { ...current, name: "refreshing" } : current;
		case "query-succeeded": {
			const presence = event.presence ?? { built: true, deep: current.deep === true };
			return { ...applyPresence(presence), version: current.version };
		}
		case "mutation-observed":
			switch (current.name) {
				case "fresh-structural":
				case "fresh-deep":
				case "changed":
				case "refreshing":
					return { name: "changed", deep: current.deep, version: current.version };
				default:
					return current;
			}
		case "reset":
			return INITIAL_GRAFT_STATE;
	}
}

/** Whether a graph-state name means "a query can answer from this repository". */
export function isQueryable(state: GraftState): boolean {
	switch (state.name) {
		case "unbuilt":
		case "unavailable":
		case "incompatible":
		case "unsupported":
			return false;
		default:
			return true;
	}
}

/** Whether the state is a terminal setup problem that only the user can clear. */
export function isSetupProblem(state: GraftState): boolean {
	return state.name === "unavailable" || state.name === "incompatible";
}

// ---------------------------------------------------------------------------
// Status rendering
// ---------------------------------------------------------------------------

export const STATUS_KEY = "graft";

const STATUS_LABELS: Record<GraftStateName, string> = {
	unsupported: "✕ n/a",
	unavailable: "✕ no cli",
	incompatible: "! version",
	unbuilt: "○ unbuilt",
	building: "⚙ building",
	"fresh-structural": "● structural",
	"fresh-deep": "● deep",
	changed: "◐ changed",
	refreshing: "⚙ syncing",
	failed: "✕ failed",
};

/** Short footer text for the current state. */
export function statusText(state: GraftState): string {
	const version = state.version ? ` v${state.version}` : "";
	return `graft: ${STATUS_LABELS[state.name]}${version}`;
}

/** Actionable one-liner, the same words the doctor reports. */
export function statusDetail(state: GraftState): string {
	return state.detail ?? STATUS_LABELS[state.name];
}

/** Human-readable recovery step for a state, or undefined when nothing is wrong. */
export function recoveryFor(state: GraftState): string | undefined {
	switch (state.name) {
		case "unsupported":
			return "Graft indexes a Git working tree. Run `git init` (or open the repository itself) and try again.";
		case "unavailable":
			return `Run /graft setup to install the compatible CLI, or install it yourself: ${INSTALL_COMMAND}`;
		case "incompatible":
			return `Upgrade or pin a supported version: ${INSTALL_COMMAND}`;
		case "unbuilt":
			return "Run /graft build to index this repository (structural, no model, no key).";
		case "failed":
			return "Run /graft doctor for the failing command, then /graft build to retry.";
		default:
			return undefined;
	}
}

// ---------------------------------------------------------------------------
// Session-native persistence
// ---------------------------------------------------------------------------

export const MODE_ENTRY_TYPE = "graft-mode";
export const INJECTION_ENTRY_TYPE = "graft-injection";

export interface GraftModeEntryData {
	mode: RetrievalMode;
}

/** What was injected into one turn, for session observability after resume/fork. */
function dataOf(entry: SessionEntry, customType: string): Record<string, unknown> | undefined {
	if (entry.type !== "custom") return undefined;
	const custom = entry as SessionEntry & { customType?: string; data?: unknown };
	if (custom.customType !== customType) return undefined;
	if (typeof custom.data !== "object" || custom.data === null) return undefined;
	return custom.data as Record<string, unknown>;
}

/**
 * The retrieval mode most recently chosen on this branch.
 *
 * Reading the branch (not the whole session) keeps fork and tree navigation
 * honest: a fork from before a mode change keeps the older mode.
 */
export function readBranchMode(entries: readonly SessionEntry[]): RetrievalMode | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const data = dataOf(entries[i]!, MODE_ENTRY_TYPE);
		if (data && isRetrievalMode(data.mode)) return data.mode;
	}
	return undefined;
}
