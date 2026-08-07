/**
 * grepai integration.
 *
 * grepai is a project-local semantic code-search CLI. Selesai provisions the
 * official release into its managed binary directory, then supplies a project
 * config for the OpenAI-compatible LiteLLM embedding endpoint when grepai is
 * first used. The embedding credential is resolved from Token-In's auth store;
 * it is written only to grepai's 0600 project config because grepai itself only
 * understands OPENAI_API_KEY or a literal `embedder.api_key`.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ensureTool, isToolCallEventType } from "@selesai/code";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, SessionStartEvent } from "@selesai/code";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export const GREPAI_PROVIDER = "openai";
export const GREPAI_EMBEDDING_MODEL = "nomic-code";
export const GREPAI_STORE_BACKEND = "gob";
/** LiteLLM's OpenAI-compatible embeddings route is `${endpoint}/embeddings`. */
export const GREPAI_EMBEDDING_ENDPOINT = "https://lite.andlet.me/v1";
/** Nomic code embeddings are 768-dimensional; vector stores need this value. */
export const GREPAI_EMBEDDING_DIMENSIONS = 768;
export const TOKEN_IN_PROVIDER = "tokenin";
export const GREPAI_CONFIG_DIR = ".grepai";
export const GREPAI_CONFIG_FILE = "config.yaml";
export const GREPAI_DISABLED_ENV = "GREPAI_DISABLED";
export const GREPAI_SKIP_SETUP_ENV = "SELESAI_SKIP_GREPAI_SETUP";

const GREPAI_INIT_TIMEOUT_MS = 30_000;
const GREPAI_WATCH_STATUS_TIMEOUT_MS = 10_000;
const GREPAI_WATCH_START_TIMEOUT_MS = 60_000;
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

/** Apply Selesai's embedding defaults without changing unrelated grepai settings. */
export function applyGrepaiDefaults(config: GrepaiConfig, apiKey: string): GrepaiConfig {
	const currentEmbedder = isRecord(config.embedder) ? config.embedder : {};
	const currentStore = isRecord(config.store) ? config.store : {};
	return {
		...config,
		version: typeof config.version === "number" ? config.version : 1,
		store: {
			...currentStore,
			backend: GREPAI_STORE_BACKEND,
		},
		embedder: {
			...currentEmbedder,
			provider: GREPAI_PROVIDER,
			model: GREPAI_EMBEDDING_MODEL,
			endpoint: GREPAI_EMBEDDING_ENDPOINT,
			api_key: apiKey,
			dimensions: GREPAI_EMBEDDING_DIMENSIONS,
			parallelism: 4,
		},
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

function configureProjectConfig(projectRoot: string, apiKey: string): boolean {
	const configPath = getGrepaiConfigPath(projectRoot);
	const before = readGrepaiConfig(configPath);
	const after = applyGrepaiDefaults(before, apiKey);
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

async function getTokenInApiKey(ctx: ExtensionContext): Promise<string | undefined> {
	try {
		const key = await ctx.modelRegistry.getApiKeyForProvider(TOKEN_IN_PROVIDER);
		return typeof key === "string" && key.trim() !== "" ? key.trim() : undefined;
	} catch {
		return undefined;
	}
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

let grepaiInstallPromise: Promise<string | undefined> | undefined;
const grepaiWatcherPromises = new Map<string, Promise<void>>();

function ensureGrepaiBinary(silent = false): Promise<string | undefined> {
	if (!grepaiInstallPromise) {
		grepaiInstallPromise = ensureTool("grepai", silent).then((path) => {
			if (!path) grepaiInstallPromise = undefined;
			return path;
		});
	}
	return grepaiInstallPromise;
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
	const apiKey = await getTokenInApiKey(ctx);
	if (!apiKey) {
		if (showNotice) notify(ctx, "Token-In is not configured. Run /tokenin add before setting up grepai.", "warning");
		return undefined;
	}

	let projectRoot = findGrepaiProjectRoot(ctx.cwd);
	if (!projectRoot) {
		if (!initializeIfMissing) return undefined;
		projectRoot = resolve(ctx.cwd);
		await runGrepaiInit(pi, grepaiPath, projectRoot);
	}

	const changed = configureProjectConfig(projectRoot, apiKey);
	if (showNotice) {
		notify(
			ctx,
			changed
				? `grepai configured for ${GREPAI_EMBEDDING_MODEL} at ${GREPAI_EMBEDDING_ENDPOINT}/embeddings.`
				: "grepai is already configured for the Selesai embedding proxy.",
			"info",
		);
	}
	return projectRoot;
}

async function configureExistingProject(pi: ExtensionAPI, grepaiPath: string, ctx: ExtensionContext): Promise<void> {
	const projectRoot = findGrepaiProjectRoot(ctx.cwd);
	if (!projectRoot) return;
	const apiKey = await getTokenInApiKey(ctx);
	if (!apiKey) return;
	try {
		configureProjectConfig(projectRoot, apiKey);
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
		void ensureGrepaiBinary()
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
			const grepaiPath = await ensureGrepaiBinary(true);
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
		description: "Install grepai, configure its project embedding provider, and start indexing",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const grepaiPath = await ensureGrepaiBinary();
			if (!grepaiPath) {
				notify(ctx, "grepai is unavailable; install it from https://github.com/yoanbernabeu/grepai", "warning");
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
}
