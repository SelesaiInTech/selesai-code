/**
 * The six read-only Graft tools.
 *
 * Names and jobs deliberately mirror Graft's own MCP tool surface, so a model
 * that already knows Graft needs no new vocabulary:
 *
 *   graft_find_code       → graft ask --source --json
 *   graft_file_api        → graft skeleton <file>
 *   graft_trace_calls     → graft callers <symbol> [--direction out] [-d N]
 *   graft_find_all        → graft grep <regex> [--in P] [-i] [--fixed]
 *   graft_repo_map        → graft map [--max-dirs N]
 *   graft_check_freshness → graft check --json
 *
 * Every one of them is read-only under Selesai's capability model. Nothing here
 * can build, mutate, install, or configure anything — the build operations live
 * behind the consent-gated commands in `commands.ts`.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@selesai/code";
import { Type } from "typebox";
import {
	askReferences,
	boundText,
	graftFailureMessage,
	MAX_FIND_LIMIT,
	MAX_TRACE_DEPTH,
	parseAskJson,
	renderAsk,
	RESULT_MAX_BYTES,
	RESULT_MAX_LINES,
	type GraftOp,
	type GraftReference,
	type GraftRun,
} from "./cli.ts";
import type { GraftSettings, GraftState, GraftStateName } from "./state.ts";

export const GRAFT_TOOL_NAMES = [
	"graft_check_freshness",
	"graft_file_api",
	"graft_find_all",
	"graft_find_code",
	"graft_repo_map",
	"graft_trace_calls",
] as const;

export interface GraftToolRuntime {
	/** Run a read-only Graft operation against the resolved repository root. */
	run(ctx: ExtensionContext, op: GraftOp, signal?: AbortSignal): Promise<GraftRun>;
	settings(): GraftSettings;
	state(): GraftState;
	/** A query answered; the graph is fresh as of now. */
	noteQuery(ctx: ExtensionContext, run: GraftRun): void;
}

/** Structured details attached to every Graft tool result. */
export interface GraftToolDetails {
	operation: string;
	/** Full argv, for support reports and TUI expansion. */
	argv: string[];
	cwd: string;
	exitCode: number;
	graphState: GraftStateName;
	bytes: number;
	truncated: boolean;
	truncatedBy: "lines" | "bytes" | null;
	/** `file` or `file:Lx-Ly` pointers the result references. */
	references: GraftReference[];
	/** Command diagnostics. Kept out of model-facing text on purpose. */
	stderr?: string;
	mode?: string;
	/** Share of the query terms the top hit matched (`ask` only). */
	coverage?: number;
	saved?: { files: number; baselineChars: number };
}

const GUIDELINES = [
	"Use graft_find_code to locate the systems, files, and symbols relevant to a repository question before reading widely.",
	"Use graft_trace_calls before changing a shared symbol, to see its callers (or, with direction out, what it depends on) and the blast radius.",
	"Use graft_file_api to see a file's signatures without reading its implementation bodies.",
	"Use graft_find_all for exhaustive regex discovery across indexed files, grouped by enclosing symbol.",
	"Use graft_repo_map to orient in an unfamiliar repository, and graft_check_freshness when you need to know whether Graft context describes the code as it is now.",
	"Graft results are derived and may be incomplete: verify anything you are about to change with read or grep, and treat Graft pointers as leads rather than proof.",
];

function throwIfFailed(run: GraftRun, allowNonZero = false): void {
	if (run.cancelled) throw new Error("Graft command cancelled.");
	if (run.code === 0 || allowNonZero) return;
	throw new Error(graftFailureMessage(run));
}

function textResult(text: string, details: GraftToolDetails) {
	return { content: [{ type: "text" as const, text }], details };
}

function baseDetails(run: GraftRun, state: GraftStateName): Omit<GraftToolDetails, "bytes" | "truncated" | "truncatedBy" | "references"> {
	return {
		operation: run.op.kind,
		argv: run.argv,
		cwd: run.cwd,
		exitCode: run.code,
		graphState: state,
		...(run.stderr.trim() ? { stderr: run.stderr.trim().slice(0, 4000) } : {}),
	};
}

/** `graft ask` renders from its JSON when it parses, and from stdout otherwise. */
export function renderAskResult(
	run: GraftRun,
	limits: { maxBytes: number; maxLines: number },
): { text: string; references: GraftReference[]; bounded: ReturnType<typeof boundText>; payload: ReturnType<typeof parseAskJson> } {
	const payload = parseAskJson(run.stdout);
	if (payload) {
		const bounded = boundText(renderAsk(payload), limits);
		return { text: bounded.text, references: askReferences(payload), bounded, payload };
	}
	const bounded = boundText(run.stdout, limits);
	return { text: bounded.text || "Graft returned no matching context.", references: [], bounded, payload: undefined };
}

export function registerGraftTools(pi: ExtensionAPI, runtime: GraftToolRuntime): void {
	const limits = () => {
		const maxBytes = runtime.settings().maxResultBytes ?? RESULT_MAX_BYTES;
		return { maxBytes, maxLines: RESULT_MAX_LINES };
	};

	const scoped = (explicit: string | undefined): string | undefined => explicit ?? runtime.settings().in;

	pi.registerTool({
		name: "graft_find_code",
		label: "Graft: find code",
		description:
			"Find the code relevant to a natural-language question about this repository. Returns ranked graph nodes with exact file:line pointers and the source inlined at each hit, so it is usually the whole answer and no follow-up read is needed. Use it to orient before editing or to locate the systems a change touches. The result is a derived summary — verify with read before changing anything.",
		promptSnippet: "Find repository code relevant to a question (ranked nodes, file:line, source inlined)",
		promptGuidelines: GUIDELINES,
		parameters: Type.Object({
			question: Type.String({ description: "What you want to understand, in plain words." }),
			limit: Type.Optional(
				Type.Integer({ minimum: 1, maximum: MAX_FIND_LIMIT, description: "Max hits (default 8)." }),
			),
			in: Type.Optional(
				Type.String({ description: "Narrow to one sub-project: a repository-relative path prefix." }),
			),
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			const run = await runtime.run(
				ctx,
				{
					kind: "find-code",
					question: params.question,
					limit: params.limit,
					in: scoped(params.in),
				},
				signal,
			);
			throwIfFailed(run);
			runtime.noteQuery(ctx, run);

			const { text, references, bounded, payload } = renderAskResult(run, limits());
			return textResult(text, {
				...baseDetails(run, runtime.state().name),
				bytes: Buffer.byteLength(text, "utf-8"),
				truncated: bounded.truncated,
				truncatedBy: bounded.truncatedBy,
				references,
				...(payload?.mode ? { mode: payload.mode } : {}),
				...(payload?.coverage !== undefined ? { coverage: payload.coverage } : {}),
				...(payload?.saved ? { saved: payload.saved } : {}),
			});
		},
	});

	pi.registerTool({
		name: "graft_file_api",
		label: "Graft: file API",
		description:
			"Show every signature in one file without the implementation bodies — the file's API surface for roughly a tenth of the tokens of reading it. Use it to learn what a file offers before deciding which bodies to read. Accepts a repository-relative path or a unique basename.",
		promptSnippet: "Show one file's signatures without implementation bodies",
		parameters: Type.Object({
			path: Type.String({ description: "Repository-relative path, or a unique file basename." }),
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			const run = await runtime.run(ctx, { kind: "file-api", path: params.path }, signal);
			throwIfFailed(run);
			runtime.noteQuery(ctx, run);
			const bounded = boundText(run.stdout, limits());
			const text = bounded.text || `No indexed signatures for ${params.path}.`;
			return textResult(text, {
				...baseDetails(run, runtime.state().name),
				bytes: Buffer.byteLength(text, "utf-8"),
				truncated: bounded.truncated,
				truncatedBy: bounded.truncatedBy,
				references: [],
			});
		},
	});

	pi.registerTool({
		name: "graft_trace_calls",
		label: "Graft: trace calls",
		description:
			"Trace a symbol's call graph. Default direction is 'in': who calls, references, implements, or extends it — the blast radius of changing it. Direction 'out' answers the reverse: what the symbol itself calls, references, or imports. Raise depth to walk transitively. Use it before modifying shared behavior.",
		promptSnippet: "Trace who calls a symbol, or what it calls (blast radius)",
		parameters: Type.Object({
			symbol: Type.String({ description: "Symbol name; a qualified name like Cache.get is supported." }),
			direction: Type.Optional(
				StringEnum(["in", "out"] as const, {
					description: "in = callers/dependents (default); out = what this symbol depends on.",
				}),
			),
			depth: Type.Optional(
				Type.Integer({ minimum: 1, maximum: MAX_TRACE_DEPTH, description: "Transitive depth (default 1)." }),
			),
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			const run = await runtime.run(
				ctx,
				{
					kind: "trace-calls",
					symbol: params.symbol,
					direction: params.direction ?? "in",
					depth: params.depth,
				},
				signal,
			);
			throwIfFailed(run);
			runtime.noteQuery(ctx, run);
			const bounded = boundText(run.stdout, limits());
			const direction = params.direction ?? "in";
			const text = bounded.text || `No indexed ${direction === "in" ? "callers" : "callees"} for ${params.symbol}.`;
			return textResult(text, {
				...baseDetails(run, runtime.state().name),
				bytes: Buffer.byteLength(text, "utf-8"),
				truncated: bounded.truncated,
				truncatedBy: bounded.truncatedBy,
				references: [],
			});
		},
	});

	pi.registerTool({
		name: "graft_find_all",
		label: "Graft: find all",
		description:
			"Exhaustive regex search over every indexed file, with hits grouped by the symbol that encloses them and ranked by how coupled that symbol is. Prefer it over a plain text search when a broad pattern needs semantic context, and over graft_find_code when you need every occurrence rather than a ranked few.",
		promptSnippet: "Exhaustive regex search over indexed files, grouped by enclosing symbol",
		parameters: Type.Object({
			pattern: Type.String({ description: "Regular expression to search for." }),
			ignore_case: Type.Optional(Type.Boolean({ description: "Case-insensitive matching." })),
			fixed: Type.Optional(Type.Boolean({ description: "Treat the pattern as a literal string, not a regex." })),
			in: Type.Optional(Type.String({ description: "Narrow to files at or under this path prefix." })),
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			const run = await runtime.run(
				ctx,
				{
					kind: "find-all",
					pattern: params.pattern,
					ignoreCase: params.ignore_case,
					fixed: params.fixed,
					in: scoped(params.in),
				},
				signal,
			);
			throwIfFailed(run);
			runtime.noteQuery(ctx, run);
			const bounded = boundText(run.stdout, limits());
			const text = bounded.text || `No matches for ${params.pattern} in the indexed files.`;
			return textResult(text, {
				...baseDetails(run, runtime.state().name),
				bytes: Buffer.byteLength(text, "utf-8"),
				truncated: bounded.truncated,
				truncatedBy: bounded.truncatedBy,
				references: [],
			});
		},
	});

	pi.registerTool({
		name: "graft_repo_map",
		label: "Graft: repo map",
		description:
			"Token-budgeted orientation for an unfamiliar repository: directory clusters with file and symbol counts, each directory's local hubs, and the repository's global hotspots, ranked by in-degree. Use it as a first look before narrower queries.",
		promptSnippet: "Directory clusters, hubs, and hotspots for an unfamiliar repository",
		parameters: Type.Object({
			max_dirs: Type.Optional(Type.Integer({ minimum: 1, maximum: 60, description: "Directories to show." })),
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			const run = await runtime.run(ctx, { kind: "repo-map", maxDirs: params.max_dirs }, signal);
			throwIfFailed(run);
			runtime.noteQuery(ctx, run);
			const bounded = boundText(run.stdout, limits());
			const text = bounded.text || "Graft returned an empty repository map.";
			return textResult(text, {
				...baseDetails(run, runtime.state().name),
				bytes: Buffer.byteLength(text, "utf-8"),
				truncated: bounded.truncated,
				truncatedBy: bounded.truncatedBy,
				references: [],
			});
		},
	});

	pi.registerTool({
		name: "graft_check_freshness",
		label: "Graft: check freshness",
		description:
			"Report whether the local Graft graph has drifted from the code. Use it when an earlier Graft answer might predate an edit, or when you need to tell the user that repository context is stale. It never rebuilds anything — it is the drift report.",
		promptSnippet: "Report whether the local Graft graph has drifted from the code",
		parameters: Type.Object({}),
		async execute(_id, _params, signal, _onUpdate, ctx) {
			// `graft check` exits 1 when the graph has drifted. That is the answer,
			// not a failure, so a non-zero exit is allowed here and interpreted below.
			const run = await runtime.run(ctx, { kind: "check-freshness" }, signal);
			throwIfFailed(run, true);

			const inSync = run.code === 0;
			const bounded = boundText(run.stdout, limits());
			const headline = inSync
				? "Graft graph is in sync with the working tree."
				: "Graft graph has drifted from the working tree (or has not been built yet). Run /graft build to rebuild it; Graft queries still refresh the graph they read.";
			const text = `${headline}\n\n${bounded.text}`.trim();

			return textResult(text, {
				...baseDetails(run, runtime.state().name),
				bytes: Buffer.byteLength(text, "utf-8"),
				truncated: bounded.truncated,
				truncatedBy: bounded.truncatedBy,
				references: [],
			});
		},
	});
}
