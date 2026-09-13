/**
 * Graft CLI adapter.
 *
 * Graft is an external executable (npm: `@nanonets/graft`). This module is the
 * only place that knows how to find it, install it when missing, check
 * its version, build argument vectors, and turn its output into bounded
 * model-facing text.
 *
 * Safety constraints:
 * - `pi.exec(command, args, { cwd })` only. Never a shell string, so repository
 *   paths, regexes, symbols, and question text cannot become shell injection.
 * - Graft's upstream agent-wiring command (`init`) is never invoked. A missing
 *   compatible CLI is installed once through npm; incompatible CLIs are left alone.
 * - Semantic tools are read-only. Graph builds are command operations gated
 *   behind explicit consent; CLI provisioning is automatic.
 * - Extension-spawned commands default to telemetry opt-out (`DO_NOT_TRACK=1`).
 *
 * Verified against @nanonets/graft 0.18.0 (see {@link MIN_GRAFT_VERSION}).
 */

import { truncateHead, type ExecOptions, type ExecResult } from "@selesai/code";

export const GRAFT_BIN = "graft";
export const GRAFT_PACKAGE = "@nanonets/graft";

/**
 * Lowest Graft CLI whose documented surface this adapter was verified against:
 * `ask --source/--json`, `skeleton`, `callers --direction/-d`, `grep --in/-i/--fixed`,
 * `map --max-dirs`, `check --json`, `build [--deep]`, and `--version`.
 */
export const MIN_GRAFT_VERSION = "0.18.0";
/** Upper bound is exclusive: a 1.x CLI is allowed to change its contract. */
export const MAX_GRAFT_VERSION_EXCLUSIVE = "1.0.0";

/** Local, regenerable graph cache directory Graft creates at the repo root. */
export const GRAPH_DIR_NAME = "graft";
export const GRAFT_CONFIG_PATH = ".graft/config.json";

export const PROBE_TIMEOUT_MS = 5_000;
export const QUERY_TIMEOUT_MS = 60_000;
/** Structural build: tree-sitter only, no model, no network. */
export const BUILD_TIMEOUT_MS = 600_000;
/** Deep build: provider-backed, one call per changed file. */
export const DEEP_BUILD_TIMEOUT_MS = 1_800_000;
/** Global npm installs can be slow on a cold cache. */
export const INSTALL_TIMEOUT_MS = 180_000;

/** Kept on the verified 0.18 minor line; never install a floating latest CLI. */
export const GRAFT_INSTALL_SPEC = `${GRAFT_PACKAGE}@^0.18`;
export const INSTALL_COMMAND = `npm install -g ${GRAFT_INSTALL_SPEC}`;
export const TELEMETRY_ENV = "DO_NOT_TRACK";

/** `pi.exec` shape, narrowed so tests can inject a stub. */
export type ExecLike = (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;

// ---------------------------------------------------------------------------
// Executable resolution
// ---------------------------------------------------------------------------

/**
 * Build the executable/argument pair for a Graft invocation.
 *
 * `pi.exec` spawns without a shell, so Windows needs the `.cmd` shim launched
 * through `cmd.exe` (same rule as the agent-browser and rtk extensions).
 */
export function graftCommand(args: string[]): { command: string; args: string[] } {
	if (process.platform === "win32") {
		return { command: "cmd", args: ["/c", GRAFT_BIN, ...args] };
	}
	return { command: GRAFT_BIN, args };
}

/** npm is a .cmd shim on Windows, so it follows the same spawn rule as Graft. */
export function npmCommand(args: string[]): { command: string; args: string[] } {
	if (process.platform === "win32") {
		return { command: "cmd", args: ["/c", "npm", ...args] };
	}
	return { command: "npm", args };
}

/** First semantic version in arbitrary CLI output, `v` prefix and suffixes included. */
export function parseVersion(text: string): string | undefined {
	const match = /(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?/.exec(text);
	return match ? match[0] : undefined;
}

/** Numeric-segment comparison. Pre-release/build suffixes are ignored. */
export function compareVersions(a: string, b: string): number {
	const nums = (v: string) => (/(\d+)\.(\d+)\.(\d+)/.exec(v)?.slice(1) ?? ["0", "0", "0"]).map(Number);
	const [a1, a2, a3] = nums(a);
	const [b1, b2, b3] = nums(b);
	return a1 - b1 || a2 - b2 || a3 - b3;
}

export function isCompatibleVersion(version: string): boolean {
	return (
		compareVersions(version, MIN_GRAFT_VERSION) >= 0 &&
		compareVersions(version, MAX_GRAFT_VERSION_EXCLUSIVE) < 0
	);
}

export type GraftProbe =
	| { kind: "ok"; version: string; argv: string[] }
	| { kind: "missing"; detail: string }
	| { kind: "incompatible"; version?: string; detail: string };

/**
 * Locate a usable Graft executable.
 *
 * A binary that answers but reports no parseable version is treated as
 * incompatible rather than assumed-good: we only claim compatibility for a
 * version we actually read.
 */
export async function probeGraft(exec: ExecLike, cwd: string, signal?: AbortSignal): Promise<GraftProbe> {
	const args = ["--version"];
	const { command, args: argv } = graftCommand(args);
	let result: ExecResult;
	try {
		result = await exec(command, argv, { cwd, timeout: PROBE_TIMEOUT_MS, signal });
	} catch (error) {
		return { kind: "missing", detail: error instanceof Error ? error.message : String(error) };
	}

	const output = `${result.stdout}\n${result.stderr}`;
	const version = parseVersion(output);
	if (version === undefined) {
		if (result.killed || result.code !== 0) {
			return { kind: "missing", detail: humanizeFailure(result, output) };
		}
		return { kind: "incompatible", detail: `could not read a version from \`${GRAFT_BIN} --version\`` };
	}
	if (!isCompatibleVersion(version)) {
		return {
			kind: "incompatible",
			version,
			detail: `graft ${version} is outside the supported range >=${MIN_GRAFT_VERSION} <${MAX_GRAFT_VERSION_EXCLUSIVE}`,
		};
	}
	return { kind: "ok", version, argv };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * The read-only operations this adapter exposes, plus the two consent-gated
 * build operations. Every other Graft subcommand (including `init`, `viz`, and
 * `uninstall`) is deliberately unreachable from tool calls.
 */
export type GraftOp =
	| { kind: "find-code"; question: string; limit?: number; in?: string }
	| { kind: "file-api"; path: string }
	| { kind: "trace-calls"; symbol: string; direction: "in" | "out"; depth?: number }
	| { kind: "find-all"; pattern: string; ignoreCase?: boolean; fixed?: boolean; in?: string }
	| { kind: "repo-map"; maxDirs?: number }
	| { kind: "check-freshness" }
	| { kind: "build"; deep: boolean };

/** Default hit count for `graft ask`, matching the CLI's own default. */
export const DEFAULT_FIND_LIMIT = 8;
export const MAX_FIND_LIMIT = 25;
export const MAX_TRACE_DEPTH = 6;

export function graftArgs(op: GraftOp): string[] {
	switch (op.kind) {
		case "find-code": {
			// `--source` inlines the source at each file:line hit, so the pack is the
			// answer and the model does not pay a second read for the same file.
			// `--json` keeps `coverage`, `saved`, and the per-hit pointers available
			// to the extension for rendering and for the relevance gate.
			const args = ["ask", op.question, "--source", "--json"];
			if (op.limit !== undefined) args.push("-n", String(op.limit));
			if (op.in) args.push("--in", op.in);
			return args;
		}
		case "file-api":
			return ["skeleton", op.path];
		case "trace-calls": {
			const args = ["callers", op.symbol];
			if (op.direction === "out") args.push("--direction", "out");
			if (op.depth !== undefined && op.depth !== 1) args.push("-d", String(op.depth));
			return args;
		}
		case "find-all": {
			const args = ["grep", op.pattern];
			if (op.ignoreCase) args.push("-i");
			if (op.fixed) args.push("--fixed");
			if (op.in) args.push("--in", op.in);
			return args;
		}
		case "repo-map": {
			const args = ["map"];
			if (op.maxDirs !== undefined) args.push("--max-dirs", String(op.maxDirs));
			return args;
		}
		case "check-freshness":
			return ["check", "--json"];
		case "build":
			return op.deep ? ["build", "--deep"] : ["build"];
	}
}

export interface GraftInstallRun {
	argv: string[];
	cwd: string;
	code: number;
	stdout: string;
	stderr: string;
	killed: boolean;
	cancelled: boolean;
	timedOut: boolean;
}

/** Install the compatible CLI when probing found none. */
export async function installGraft(
	exec: ExecLike,
	cwd: string,
	options: { signal?: AbortSignal } = {},
): Promise<GraftInstallRun> {
	const args = ["install", "-g", GRAFT_INSTALL_SPEC];
	const { command, args: argv } = npmCommand(args);
	try {
		const result = await exec(command, argv, {
			cwd,
			timeout: INSTALL_TIMEOUT_MS,
			signal: options.signal,
		});
		const cancelled = options.signal?.aborted === true;
		return {
			argv: [command, ...argv],
			cwd,
			code: result.code,
			stdout: result.stdout,
			stderr: result.stderr,
			killed: result.killed,
			cancelled,
			timedOut: result.killed && !cancelled,
		};
	} catch (error) {
		return {
			argv: [command, ...argv],
			cwd,
			code: 1,
			stdout: "",
			stderr: error instanceof Error ? error.message : String(error),
			killed: false,
			cancelled: options.signal?.aborted === true,
			timedOut: false,
		};
	}
}

export interface GraftRun {
	op: GraftOp;
	/** Full argv including the executable, for diagnostics. */
	argv: string[];
	cwd: string;
	code: number;
	stdout: string;
	stderr: string;
	killed: boolean;
	/** The caller's abort signal fired. */
	cancelled: boolean;
	/** The timeout fired rather than the caller aborting. */
	timedOut: boolean;
}

function timeoutFor(op: GraftOp): number {
	switch (op.kind) {
		case "build":
			return op.deep ? DEEP_BUILD_TIMEOUT_MS : BUILD_TIMEOUT_MS;
		default:
			return QUERY_TIMEOUT_MS;
	}
}

/**
 * Run one Graft operation against `repoRoot`.
 *
 * The repository root is always passed as the process working directory and
 * never as a positional argument, so a monorepo's scoping stays Graft's own
 * `nearestGraftRoot` decision.
 */
export async function runGraft(
	exec: ExecLike,
	repoRoot: string,
	op: GraftOp,
	options: { signal?: AbortSignal; timeout?: number } = {},
): Promise<GraftRun> {
	const args = graftArgs(op);
	const { command, args: argv } = graftCommand(args);
	const displayArgv = [command, ...argv];
	let result: ExecResult;
	try {
		result = await exec(command, argv, {
			cwd: repoRoot,
			timeout: options.timeout ?? timeoutFor(op),
			signal: options.signal,
		});
	} catch (error) {
		return {
			op,
			argv: displayArgv,
			cwd: repoRoot,
			code: 1,
			stdout: "",
			stderr: error instanceof Error ? error.message : String(error),
			killed: false,
			cancelled: options.signal?.aborted === true,
			timedOut: false,
		};
	}

	const cancelled = options.signal?.aborted === true;
	return {
		op,
		argv: displayArgv,
		cwd: repoRoot,
		code: result.code,
		stdout: result.stdout,
		stderr: result.stderr,
		killed: result.killed,
		cancelled,
		timedOut: result.killed && !cancelled,
	};
}

function humanizeFailure(result: ExecResult, output: string): string {
	if (result.killed) return `\`${GRAFT_BIN}\` did not answer within ${PROBE_TIMEOUT_MS}ms`;
	if (output.trim()) return output.trim().split("\n")[0] ?? "command failed";
	return "command failed";
}

/** One readable line for a failed command; the full output stays in tool details. */
export function graftFailureMessage(run: GraftRun): string {
	if (run.cancelled) return "Graft command cancelled.";
	if (run.timedOut) return `Graft command timed out after ${timeoutFor(run.op)}ms.`;
	const detail = (run.stderr.trim() || run.stdout.trim()).split("\n")[0]?.trim();
	return `graft ${run.argv.slice(1).join(" ")} failed (exit ${run.code})${detail ? `: ${detail}` : ""}`;
}

// ---------------------------------------------------------------------------
// Output normalization
// ---------------------------------------------------------------------------

export interface BoundedText {
	text: string;
	truncated: boolean;
	truncatedBy: "lines" | "bytes" | null;
	totalBytes: number;
}

/** Default model-facing ceiling per Graft result. */
export const RESULT_MAX_LINES = 400;
export const RESULT_MAX_BYTES = 32 * 1024;

/**
 * Bound text with Selesai's own truncation utility, and say so when it cut.
 * Truncation must never be silent: the model needs to know it is seeing a
 * partial result and how to see more.
 */
export function boundText(
	raw: string,
	limits: { maxLines?: number; maxBytes?: number } = {},
): BoundedText {
	const result = truncateHead(raw.trimEnd(), {
		maxLines: limits.maxLines ?? RESULT_MAX_LINES,
		maxBytes: limits.maxBytes ?? RESULT_MAX_BYTES,
	});
	if (!result.truncated) {
		return { text: result.content, truncated: false, truncatedBy: null, totalBytes: result.totalBytes };
	}
	const kept = result.truncatedBy === "lines" ? `${result.outputLines} of ${result.totalLines} lines` : `${result.outputBytes} of ${result.totalBytes} bytes`;
	const note = `[graft] output truncated (${kept}). Narrow the request — a subdirectory, a tighter regex, or a lower limit — to see the rest.`;
	return {
		text: `${result.content}\n\n${note}`,
		truncated: true,
		truncatedBy: result.truncatedBy,
		totalBytes: result.totalBytes,
	};
}

/** A `file` or `file:Lx-Ly` pointer the model can open directly. */
export interface GraftReference {
	path: string;
	span?: string;
}

export interface AskHit {
	kind: string;
	title: string;
	pointer: string;
	snippet: string;
	relation?: string;
	code?: string;
	scope?: string;
}

/**
 * `graft ask --json` result, as emitted by `AskResult` upstream (0.18.0).
 *
 * Every field is optional on read: a CLI that changes shape degrades to raw
 * text rather than to a wrong summary, and callers must never treat the parse
 * as authoritative for anything but display.
 */
export interface AskPayload {
	query?: string;
	mode?: string;
	subject?: string;
	note?: string;
	hits: AskHit[];
	/** Share (0..1) of the query's terms the top hit matched. Lexical mode only. */
	coverage?: number;
	coverageStrong?: number;
	saved?: { files: number; baselineChars: number };
	rules?: Array<{ id?: string; text?: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Parse `graft ask --json`. Returns undefined for anything unrecognized. */
export function parseAskJson(stdout: string): AskPayload | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		return undefined;
	}
	if (!isRecord(parsed) || !Array.isArray(parsed.hits)) return undefined;

	const hits: AskHit[] = [];
	for (const raw of parsed.hits) {
		if (!isRecord(raw)) continue;
		const pointer = asString(raw.pointer);
		if (!pointer) continue;
		hits.push({
			kind: asString(raw.kind) ?? "symbol",
			title: asString(raw.title) ?? pointer,
			pointer,
			snippet: asString(raw.snippet) ?? "",
			relation: asString(raw.relation),
			code: asString(raw.code),
			scope: asString(raw.scope),
		});
	}

	const saved = isRecord(parsed.saved) ? parsed.saved : undefined;
	const rules = Array.isArray(parsed.rules) ? parsed.rules.filter(isRecord).map((rule) => ({
		id: asString(rule.id),
		text: asString(rule.text),
	})) : undefined;

	return {
		query: asString(parsed.query),
		mode: asString(parsed.mode),
		subject: asString(parsed.subject),
		note: asString(parsed.note),
		hits,
		coverage: typeof parsed.coverage === "number" ? parsed.coverage : undefined,
		coverageStrong: typeof parsed.coverageStrong === "number" ? parsed.coverageStrong : undefined,
		saved: saved && typeof saved.files === "number" && typeof saved.baselineChars === "number"
			? { files: saved.files, baselineChars: saved.baselineChars }
			: undefined,
		rules,
	};
}

/** Split a `file` or `file:Lx-Ly` pointer into its parts. */
export function parsePointer(pointer: string): GraftReference {
	const match = /^(.*?):(L\d+(?:-L\d+)?)$/.exec(pointer);
	if (!match) return { path: pointer };
	return { path: match[1] ?? pointer, span: match[2] };
}

/** Compact markdown rendering of an ask payload: pointers first, source last. */
export function renderAsk(payload: AskPayload): string {
	const lines: string[] = [];
	const header = payload.mode ? `graft ask (${payload.mode}${payload.subject ? `: ${payload.subject}` : ""})` : "graft ask";
	lines.push(`${header} — ${payload.hits.length} hit(s)`);
	if (payload.note) lines.push(payload.note);

	payload.hits.forEach((hit, index) => {
		const label = hit.scope ? `${hit.scope}/${hit.pointer}` : hit.pointer;
		const relation = hit.relation ? ` (${hit.relation})` : "";
		lines.push("", `${index + 1}. ${hit.title}${relation} — ${label}`);
		if (hit.snippet) lines.push(`   ${hit.snippet}`);
		if (hit.code) {
			lines.push("", ...hit.code.split("\n").map((line) => `   ${line}`), "");
		}
	});

	if (payload.rules && payload.rules.length > 0) {
		lines.push("", "governing rules:");
		for (const rule of payload.rules) if (rule.text) lines.push(`- ${rule.text}`);
	}
	if (payload.saved) {
		lines.push(
			"",
			`(pack inlines ${payload.saved.files} file(s); reading them instead would cost ~${Math.round(payload.saved.baselineChars / 4)} tokens)`,
		);
	}
	return lines.join("\n").trim();
}

/** Pointers from an ask payload, used for session metadata and tool details. */
export function askReferences(payload: AskPayload): GraftReference[] {
	return payload.hits.map((hit) => parsePointer(hit.pointer));
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

export interface TelemetryDefaultHandle {
	/** Undo the default, restoring the process environment to its prior state. */
	restore(): void;
}

/**
 * Default Graft to telemetry opt-out without touching the user's Graft
 * configuration.
 *
 * `pi.exec` inherits the pi process environment and offers no per-spawn env
 * override, so the only place to set this is the process itself. We therefore
 * set it once per session and only when the user has not already expressed a
 * preference, record that we were the one to set it, and remove it again on
 * session shutdown. `DO_NOT_TRACK` is a cross-tool convention that Graft
 * honors; the user's own `graft telemetry disable` setting is never touched.
 */
export function applyTelemetryDefault(env: NodeJS.ProcessEnv = process.env): TelemetryDefaultHandle {
	if (env[TELEMETRY_ENV] !== undefined) {
		return { restore: () => {} };
	}
	env[TELEMETRY_ENV] = "1";
	return {
		restore: () => {
			delete env[TELEMETRY_ENV];
		},
	};
}
