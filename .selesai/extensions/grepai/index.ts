/**
 * grepai integration (project-level extension).
 *
 * grepai is a project-local semantic code-search CLI. This extension supplies a
 * project config for the OpenAI-compatible embedding endpoint when grepai is
 * first used, and starts grepai's persistent filesystem watcher per project.
 * Defaults only fill gaps: an existing `embedder` block is left intact.
 *
 * Provisioning is PATH-only by design: the extension locates `grepai` on the
 * system PATH (verified via `grepai version`) and does not download a managed
 * binary. Install grepai from https://github.com/yoanbernabeu/grepai and keep
 * it on PATH. The OpenAI-compatible embedding endpoint defaults to the bundled
 * local proxy (`nomic-embedding-proxy.mjs`, see GREPAI_PROXY_PATH); its
 * `api_key` is a placeholder because the proxy handles authentication.
 */

import { fileURLToPath } from "node:url";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import { isToolCallEventType } from "@selesai/code";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, SessionStartEvent } from "@selesai/code";
import { Type } from "typebox";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export const GREPAI_PROVIDER = "openai";
export const GREPAI_STORE_BACKEND = "gob";
/** Override the embedding model/endpoint via env when using a local adapter (e.g. Nomic via nomic-embedding-proxy.mjs). */
export const GREPAI_EMBEDDING_MODEL = process.env.GREPAI_EMBEDDING_MODEL ?? "nomic-embed-text-v1.5";
/** OpenAI-compatible embeddings route is `${endpoint}/embeddings`. */
export const GREPAI_EMBEDDING_ENDPOINT = process.env.GREPAI_EMBEDDING_ENDPOINT ?? "http://127.0.0.1:8787/v1";
/** Nomic code embeddings are 768-dimensional; vector stores need this value. */
export const GREPAI_EMBEDDING_DIMENSIONS = 768;
/** The local embedding proxy handles authentication, so the key is a placeholder. */
export const GREPAI_EMBEDDING_API_KEY = "local";
export const GREPAI_CONFIG_DIR = ".grepai";
export const GREPAI_CONFIG_FILE = "config.yaml";
export const GREPAI_DISABLED_ENV = "GREPAI_DISABLED";
export const GREPAI_SKIP_SETUP_ENV = "SELESAI_SKIP_GREPAI_SETUP";
/** The bundled local embedding proxy that serves GREPAI_EMBEDDING_ENDPOINT. */
export const GREPAI_PROXY_PATH = fileURLToPath(new URL("nomic-embedding-proxy.mjs", import.meta.url));

const GREPAI_INIT_TIMEOUT_MS = 30_000;
const GREPAI_VERSION_TIMEOUT_MS = 5_000;
const GREPAI_WATCH_STATUS_TIMEOUT_MS = 10_000;
const GREPAI_WATCH_START_TIMEOUT_MS = 60_000;
const GREPAI_SEARCH_TIMEOUT_MS = 30_000;
const CONFIG_COMMANDS = new Set(["search", "watch", "status", "trace", "refs", "workspace", "mcp"]);

interface GrepaiConfig {
	[key: string]: unknown;
}

function isRecord(value: unknown): value is GrepaiConfig {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function notify(ctx: ExtensionContext, message: string, type: "info" | "warning" | "error" = "info"): void {
	if (ctx.hasUI) ctx.ui.notify(message, type);
}

export function getGrepaiConfigPath(projectRoot: string): string {
	return join(projectRoot, GREPAI_CONFIG_DIR, GREPAI_CONFIG_FILE);
}

/** Find an existing grepai project config by walking from cwd toward the root. */
export function findGrepaiProjectRoot(cwd: string): string | undefined {
	let current = resolve(cwd);
	while (true) {
		if (existsSync(getGrepaiConfigPath(current))) return current;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

/** Return the grepai subcommand at the start of a shell command. */
export function getGrepaiSubcommand(command: string): string | undefined {
	const trimmed = command.trimStart();
	const match = trimmed.match(/^(?:env\s+)?grepai(?:\.exe)?(?:\s+|$)/i);
	if (!match) return undefined;
	return trimmed.slice(match[0].length).trim().split(/\s+/)[0]?.toLowerCase();
}

/** Return true for grepai subcommands that require a project config/index. */
export function isGrepaiConfigCommand(command: string): boolean {
	const subcommand = getGrepaiSubcommand(command);
	return subcommand !== undefined && CONFIG_COMMANDS.has(subcommand);
}

/** Avoid starting a second watcher when the user explicitly controls watch/status. */
export function shouldAutoStartGrepaiWatcher(command: string): boolean {
	const subcommand = getGrepaiSubcommand(command);
	return subcommand !== undefined && CONFIG_COMMANDS.has(subcommand) && subcommand !== "watch" && subcommand !== "status";
}

/** grepai tool modes: semantic search, or symbol callers/callees traces. */
export type GrepaiToolMode = "search" | "callers" | "callees";

/** Build the CLI args for the registered grepai tool. */
export function buildGrepaiToolCommand(mode: GrepaiToolMode, query: string, limit?: number, path?: string): string[] {
	if (mode === "search") {
		const args = ["search", query, "--limit", String(limit ?? 10), "--json"];
		if (path) args.push("--path", path);
		return args;
	}
	return ["trace", mode, query, "--json"];
}

interface GrepaiSearchHit {
	file_path: string;
	start_line: number;
	end_line: number;
	score: number;
	content: string;
}

interface GrepaiTraceSite {
	symbol?: { file?: string; line?: number; signature?: string };
	call_site?: { file?: string; line?: number; context?: string };
}

interface GrepaiTraceResult {
	query?: string;
	symbol?: { name?: string; signature?: string };
	callers?: GrepaiTraceSite[];
	callees?: GrepaiTraceSite[];
}

/** Render `grepai search --json` output as a compact, token-efficient result. */
export function formatGrepaiSearchResult(stdout: string): string {
	let hits: unknown;
	try {
		hits = JSON.parse(stdout);
	} catch {
		return stdout.trim() || "grepai returned no output.";
	}
	if (!Array.isArray(hits)) return stdout.trim() || "grepai returned no output.";
	if (hits.length === 0) return "No matching code found. Try rephrasing the query with different terms.";
	return hits
		.map((hit, index) => {
			const h = hit as GrepaiSearchHit;
			const snippet = h.content.replace(/\r\n/g, "\n").trim();
			return `${index + 1}. ${h.file_path}:${h.start_line}-${h.end_line} (score ${typeof h.score === "number" ? h.score.toFixed(3) : "?"})\n${snippet}`;
		})
		.join("\n\n");
}

/** Render `grepai trace <mode> --json` output as a compact, token-efficient result. */
export function formatGrepaiTraceResult(stdout: string, mode: "callers" | "callees"): string {
	let data: GrepaiTraceResult;
	try {
		data = JSON.parse(stdout) as GrepaiTraceResult;
	} catch {
		return stdout.trim() || "grepai returned no output.";
	}
	const sites = mode === "callers" ? data.callers : data.callees;
	const title = data.symbol?.name
		? `${mode} of ${data.symbol.name}${data.symbol.signature ? ` \u00b7 ${data.symbol.signature}` : ""}`
		: `${mode} of ${data.query ?? "?"}`;
	if (!Array.isArray(sites) || sites.length === 0) return `${title}\nNo ${mode} found in the index.`;
	const body = sites
		.map((site, index) => {
			const file = site.call_site?.file ?? site.symbol?.file ?? "?";
			const line = site.call_site?.line ?? site.symbol?.line ?? 0;
			const context = (site.call_site?.context ?? "").replace(/\r\n/g, "\n").trim();
			return `${index + 1}. ${file}:${line}${context ? `\n${context}` : ""}`;
		})
		.join("\n\n");
	return `${title}\n${body}`;
}

/** Fill only missing keys so an existing grepai config is never overwritten. */
function fillDefaults(user: Record<string, unknown>, defaults: Record<string, unknown>): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...user };
	for (const [key, value] of Object.entries(defaults)) {
		if (merged[key] === undefined) merged[key] = value;
	}
	return merged;
}

/** Apply Selesai's embedding defaults without changing unrelated grepai settings. */
export function applyGrepaiDefaults(config: GrepaiConfig): GrepaiConfig {
	const currentEmbedder = isRecord(config.embedder) ? config.embedder : {};
	const currentStore = isRecord(config.store) ? config.store : {};
	return {
		...config,
		version: typeof config.version === "number" ? config.version : 1,
		store: fillDefaults(currentStore, { backend: GREPAI_STORE_BACKEND }),
		embedder: fillDefaults(currentEmbedder, {
			provider: GREPAI_PROVIDER,
			model: GREPAI_EMBEDDING_MODEL,
			endpoint: GREPAI_EMBEDDING_ENDPOINT,
			api_key: GREPAI_EMBEDDING_API_KEY,
			dimensions: GREPAI_EMBEDDING_DIMENSIONS,
			parallelism: 4,
		}),
	};
}

function readGrepaiConfig(configPath: string): GrepaiConfig {
	let parsed: unknown;
	try {
		parsed = parseYaml(readFileSync(configPath, "utf-8")) as unknown;
	} catch {
		// Do not surface YAML parser context: it may include the stored API key.
		throw new Error(`invalid grepai config: ${configPath}`);
	}
	if (!isRecord(parsed)) throw new Error(`grepai config is not a YAML object: ${configPath}`);
	return parsed;
}

function writeGrepaiConfig(configPath: string, config: GrepaiConfig): void {
	mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
	const yaml = stringifyYaml(config);
	writeFileSync(configPath, yaml.endsWith("\n") ? yaml : `${yaml}\n`, { encoding: "utf-8", mode: 0o600 });
	try {
		chmodSync(configPath, 0o600);
	} catch {
		// Best effort on platforms that do not expose POSIX file modes.
	}
}

function configureProjectConfig(projectRoot: string): boolean {
	const configPath = getGrepaiConfigPath(projectRoot);
	const before = readGrepaiConfig(configPath);
	const after = applyGrepaiDefaults(before);
	const changed = JSON.stringify(before) !== JSON.stringify(after);
	if (changed) {
		writeGrepaiConfig(configPath, after);
	} else {
		try {
			chmodSync(configPath, 0o600);
		} catch {
			// Best effort on platforms that do not expose POSIX file modes.
		}
	}
	return changed;
}

async function runGrepaiInit(pi: ExtensionAPI, grepaiPath: string, projectRoot: string): Promise<void> {
	const result = await pi.exec(
		grepaiPath,
		[
			"init",
			"--provider",
			GREPAI_PROVIDER,
			"--model",
			GREPAI_EMBEDDING_MODEL,
			"--backend",
			GREPAI_STORE_BACKEND,
			"--yes",
		],
		{ cwd: projectRoot, timeout: GREPAI_INIT_TIMEOUT_MS },
	);
	if (result.killed || result.code !== 0) {
		throw new Error(`grepai init failed with exit status ${result.code}`);
	}
}

let grepaiCheckPromise: Promise<string | undefined> | undefined;
const grepaiWatcherPromises = new Map<string, Promise<void>>();

/**
 * Locate grepai on PATH and verify it is the official CLI (which prints
 * `grepai version ...`). Returns the command name to spawn, or undefined.
 * PATH-only: this extension never downloads a managed binary.
 */
export function findGrepaiOnPath(pi: ExtensionAPI, silent = false): Promise<string | undefined> {
	if (!grepaiCheckPromise) {
		grepaiCheckPromise = pi
			.exec("grepai", ["version"], { timeout: GREPAI_VERSION_TIMEOUT_MS })
			.then((result) => {
				const verified = !result.killed && result.code === 0 && /grepai\s+version/i.test(`${result.stdout}\n${result.stderr}`);
				if (verified) return "grepai";
				if (!silent) console.warn("[grepai] grepai not found on PATH; install it from https://github.com/yoanbernabeu/grepai");
				return undefined;
			})
			.then((path) => {
				if (!path) grepaiCheckPromise = undefined;
				return path;
			});
	}
	return grepaiCheckPromise;
}

/** Start grepai's initial scan and persistent filesystem watcher once per project. */
function ensureGrepaiWatcher(pi: ExtensionAPI, grepaiPath: string, projectRoot: string): Promise<void> {
	const existing = grepaiWatcherPromises.get(projectRoot);
	if (existing) return existing;

	const start = (async () => {
		// PI_OFFLINE also suppresses watcher startup because indexing calls the remote embedder.
		if (process.env.PI_OFFLINE === "1") return;

		const status = await pi.exec(grepaiPath, ["watch", "--status"], {
			cwd: projectRoot,
			timeout: GREPAI_WATCH_STATUS_TIMEOUT_MS,
		});
		if (!status.killed && status.code === 0 && /status:\s*running/i.test(`${status.stdout}\n${status.stderr}`)) return;

		const result = await pi.exec(grepaiPath, ["watch", "--background"], {
			cwd: projectRoot,
			timeout: GREPAI_WATCH_START_TIMEOUT_MS,
		});
		if (result.killed || result.code !== 0) {
			throw new Error("grepai watcher failed to start; check the grepai watcher log");
		}
	})();

	const tracked = start.then(
		(value) => {
			if (grepaiWatcherPromises.get(projectRoot) === tracked) grepaiWatcherPromises.delete(projectRoot);
			return value;
		},
		(error) => {
			if (grepaiWatcherPromises.get(projectRoot) === tracked) grepaiWatcherPromises.delete(projectRoot);
			throw error;
		},
	);
	grepaiWatcherPromises.set(projectRoot, tracked);
	return tracked;
}

async function setupProject(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	grepaiPath: string,
	initializeIfMissing: boolean,
	showNotice: boolean,
): Promise<string | undefined> {
	let projectRoot = findGrepaiProjectRoot(ctx.cwd);
	if (!projectRoot) {
		if (!initializeIfMissing) return undefined;
		projectRoot = resolve(ctx.cwd);
		await runGrepaiInit(pi, grepaiPath, projectRoot);
	}

	const changed = configureProjectConfig(projectRoot);
	if (showNotice) {
		notify(
			ctx,
			changed
				? `grepai configured for ${GREPAI_EMBEDDING_MODEL} at ${GREPAI_EMBEDDING_ENDPOINT}/embeddings. Start the embedding proxy with: node ${GREPAI_PROXY_PATH}`
				: "grepai is already configured for the Selesai embedding proxy.",
			"info",
		);
	}
	return projectRoot;
}

async function configureExistingProject(pi: ExtensionAPI, grepaiPath: string, ctx: ExtensionContext): Promise<void> {
	const projectRoot = findGrepaiProjectRoot(ctx.cwd);
	if (!projectRoot) return;
	try {
		configureProjectConfig(projectRoot);
		await ensureGrepaiWatcher(pi, grepaiPath, projectRoot);
	} catch (error) {
		console.warn(`[grepai] could not configure or index ${getGrepaiConfigPath(projectRoot)}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export default function grepaiExtension(pi: ExtensionAPI): void {
	if (process.env[GREPAI_DISABLED_ENV] === "1") return;

	// Keep startup non-blocking, matching the deferred RTK provisioning pattern.
	pi.on("session_start", async (event: SessionStartEvent, ctx: ExtensionContext) => {
		if (event.reason !== "startup") return;
		if (process.env[GREPAI_SKIP_SETUP_ENV] === "1") return;
		void findGrepaiOnPath(pi, true)
			.then(async (grepaiPath) => {
				if (grepaiPath) await configureExistingProject(pi, grepaiPath, ctx);
			})
			.catch((error) => {
				console.warn(`[grepai] startup setup failed: ${error instanceof Error ? error.message : String(error)}`);
			});
	});

	// If the model uses grepai before an explicit setup command, initialize and
	// configure the current project just before the Bash call executes.
	pi.on("tool_call", async (event, ctx) => {
		try {
			if (!isToolCallEventType("bash", event)) return;
			if (process.env[GREPAI_SKIP_SETUP_ENV] === "1") return;
			if (typeof event.input.command !== "string" || !isGrepaiConfigCommand(event.input.command)) return;
			const grepaiPath = await findGrepaiOnPath(pi, true);
			if (!grepaiPath) return;
			const projectRoot = await setupProject(pi, ctx, grepaiPath, true, false);
			if (projectRoot && shouldAutoStartGrepaiWatcher(event.input.command)) {
				await ensureGrepaiWatcher(pi, grepaiPath, projectRoot);
			}
		} catch (error) {
			// Never block Bash because optional semantic-search setup failed.
			console.warn(`[grepai] setup failed; continuing with the original command: ${error instanceof Error ? error.message : String(error)}`);
		}
	});

	pi.registerCommand("setup-grepai", {
		description: "Configure grepai's project embedding provider and start indexing",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const grepaiPath = await findGrepaiOnPath(pi);
			if (!grepaiPath) {
				notify(
					ctx,
					`grepai is unavailable; install it from https://github.com/yoanbernabeu/grepai and ensure it is on PATH. Start the embedding proxy with: node ${GREPAI_PROXY_PATH}`,
					"warning",
				);
				return;
			}
			try {
				const projectRoot = await setupProject(pi, ctx, grepaiPath, true, true);
				if (projectRoot) await ensureGrepaiWatcher(pi, grepaiPath, projectRoot);
			} catch (error) {
				notify(ctx, `grepai setup failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});

	// First-class grepai tool: always listed in the system prompt so the model
	// knows when to use grepai and that it is preferred over the built-in grep
	// tool for code search (semantic, ~93% cheaper in tokens).
	pi.registerTool({
		name: "grepai",
		label: "grepai Search",
		description:
			"Semantic codebase search with grepai: natural-language queries against the project's indexed meaning, plus caller/callee traces. Prefer this over the built-in grep tool for code discovery: results are ranked by relevance with file paths, line ranges, and snippets, using far fewer tokens than raw grep output. Modes: search ('find code that handles X'), callers ('who calls this function?'), callees ('what does this function call?').",
		promptSnippet: "Search this codebase by meaning with grepai (semantic, ~93% cheaper than grep)",
		promptGuidelines: [
			"Use the grepai tool instead of the built-in grep tool for code search: it queries the project's semantic index, returns ranked file paths with line ranges and snippets, and costs ~93% fewer tokens than raw grep output.",
			"Use the grepai tool in callers/callees mode to trace symbol dependencies instead of grepping for usages or reading whole files.",
			"Keep the built-in grep tool only for exact literal or regular-expression matches (error strings, UUIDs, import paths) that semantic search cannot express.",
		],
		parameters: Type.Object({
			mode: StringEnum(["search", "callers", "callees"] as const, {
				description: "What to do: natural-language search, or trace a symbol's callers/callees.",
				default: "search",
			}),
			query: Type.String({ minLength: 1, description: "Natural-language query (search mode) or symbol name (callers/callees mode)." }),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: "Maximum results for search mode; defaults to 10." })),
			path: Type.Optional(Type.String({ description: "Restrict search results to files under this path prefix." })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (process.env[GREPAI_DISABLED_ENV] === "1") throw new Error("grepai is disabled (GREPAI_DISABLED=1).");
			if (process.env[GREPAI_SKIP_SETUP_ENV] === "1") throw new Error("grepai setup is skipped (SELESAI_SKIP_GREPAI_SETUP=1).");
			const grepaiPath = await findGrepaiOnPath(pi, true);
			if (!grepaiPath) throw new Error("grepai is not installed; install it from https://github.com/yoanbernabeu/grepai and keep it on PATH.");
			const projectRoot = await setupProject(pi, ctx, grepaiPath, true, false);
			if (!projectRoot) throw new Error("grepai could not be set up for this project.");
			try {
				await ensureGrepaiWatcher(pi, grepaiPath, projectRoot);
			} catch (error) {
				// Search still works off the persisted index; a stale index is
				// better than failing the tool call.
				console.warn(`[grepai] watcher unavailable; searching the existing index: ${error instanceof Error ? error.message : String(error)}`);
			}
			const result = await pi.exec(grepaiPath, buildGrepaiToolCommand(params.mode, params.query, params.limit, params.path), {
				cwd: projectRoot,
				timeout: GREPAI_SEARCH_TIMEOUT_MS,
			});
			if (signal?.aborted) throw signal.reason ?? new Error("cancelled");
			if (result.killed || result.code !== 0) {
				const detail = `${result.stdout}\n${result.stderr}`.trim().slice(0, 2000);
				throw new Error(`grepai ${params.mode} failed${detail ? `: ${detail}` : ""}`);
			}
			const text = params.mode === "search" ? formatGrepaiSearchResult(result.stdout) : formatGrepaiTraceResult(result.stdout, params.mode);
			return {
				content: [{ type: "text", text }],
				details: { mode: params.mode, query: params.query },
			};
		},
	});
}
