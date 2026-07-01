/**
 * Web-Agent first-run onboarding extension.
 *
 * On the first interactive session, ask the user whether they want to use Brave
 * Search. If yes, open the Brave API key dashboard, collect the pasted key, and
 * persist it in ~/.selesai/agent/settings.json under webAgent.braveApiKey, then
 * configure the bundled pi-web-agent backend to use Brave (with DuckDuckGo fallback).
 * If no, the extension falls back to pi-web-agent's default DuckDuckGo backend.
 *
 * Mirrors src/extensions/tokenin-onboarding.ts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir, getSettingsPath } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, SessionStartEvent } from "@earendil-works/pi-coding-agent";

export type OnboardingResult =
	| { kind: "saved" }
	| { kind: "skipped" }
	| { kind: "deferred" }
	| { kind: "error"; message: string };

export const BRAVE_KEYS_URL = "https://api-dashboard.search.brave.com/app/keys";
export const ONBOARDING_MARKER_NAME = ".webAgentOnboardingComplete";
export const WEB_AGENT_CONFIG_SUBPATH = join("extensions", "pi-web-agent", "config.json");

// ponytail: duplicated ~15 lines of marker-file + browser-open logic from
// tokenin-onboarding.ts rather than extracting a shared module nobody asked for.
// Ceiling: if a third onboarding extension appears, extract a shared helper then.

/** Read and parse the current settings.json, returning a deep-ish mutable object. */
export function readSettingsJson(settingsPath: string = getSettingsPath()): Record<string, unknown> {
	try {
		const raw = readFileSync(settingsPath, "utf-8");
		return JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return {};
	}
}

/** Write settings.json back to disk atomically-ish with a trailing newline. */
export function writeSettingsJson(settings: Record<string, unknown>, settingsPath: string = getSettingsPath()): void {
	mkdirSync(dirname(settingsPath), { recursive: true });
	writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
}

/**
 * Return true if the Brave key value is missing, empty. We prompt again for any
 * non-key value.
 */
export function isPlaceholderKey(apiKey: unknown): boolean {
	if (apiKey === undefined || apiKey === null) return true;
	if (typeof apiKey !== "string") return true;
	return apiKey.trim() === "";
}

/** Return the current webAgent.braveApiKey value from settings.json. */
export function getBraveApiKey(settings: Record<string, unknown>): unknown {
	const webAgent = settings.webAgent;
	if (!webAgent || typeof webAgent !== "object" || Array.isArray(webAgent)) return undefined;
	return (webAgent as Record<string, unknown>).braveApiKey;
}

/** Return a new settings object with webAgent.braveApiKey set to key. */
export function setBraveApiKey(settings: Record<string, unknown>, key: string): Record<string, unknown> {
	const next = JSON.parse(JSON.stringify(settings)) as Record<string, unknown>;
	if (!next.webAgent || typeof next.webAgent !== "object" || Array.isArray(next.webAgent)) {
		next.webAgent = {};
	}
	const webAgent = next.webAgent as Record<string, unknown>;
	webAgent.braveApiKey = key;
	return next;
}

/** Validate a pasted Brave key. Returns normalized key or an error message. */
export function validateBraveKey(raw: string | undefined): { key?: string; error?: string } {
	if (raw === undefined || raw === null) return { error: "No key entered." };
	const trimmed = raw.trim();
	if (trimmed === "") return { error: "Key cannot be empty." };
	return { key: trimmed };
}

/** Path to the pi-web-agent global backend config (matches vendored config-store). */
export function getWebAgentConfigPath(agentDir: string = getAgentDir()): string {
	return join(agentDir, WEB_AGENT_CONFIG_SUBPATH);
}

/** Write pi-web-agent backend config selecting brave (with duckduckgo fallback). */
export function writeWebAgentBraveBackendConfig(agentDir: string = getAgentDir()): void {
	const configPath = getWebAgentConfigPath(agentDir);
	mkdirSync(dirname(configPath), { recursive: true });
	// Merge into any existing config so we don't clobber presentation settings.
	let existing: Record<string, unknown> = {};
	try {
		existing = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
	} catch {
		// ENOENT or invalid JSON — start fresh.
	}
	const next = existing;
	const backends = (next.backends ?? {}) as Record<string, unknown>;
	(backends as Record<string, unknown>).search = { provider: "brave", fallback: "duckduckgo" };
	next.backends = backends;
	writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
}

function getOnboardingMarkerPath(agentDir: string = getAgentDir()): string {
	return join(agentDir, ONBOARDING_MARKER_NAME);
}

function markOnboardingComplete(agentDir: string = getAgentDir()): void {
	writeFileSync(getOnboardingMarkerPath(agentDir), "1", "utf-8");
}

function isOnboardingComplete(agentDir: string = getAgentDir()): boolean {
	return existsSync(getOnboardingMarkerPath(agentDir));
}

async function openBraveKeysUrl(pi: ExtensionAPI): Promise<void> {
	const url = BRAVE_KEYS_URL;
	let command: string;
	let args: string[];
	if (process.platform === "darwin") {
		command = "open";
		args = [url];
	} else if (process.platform === "win32") {
		command = "cmd";
		args = ["/c", "start", "", url];
	} else {
		command = "xdg-open";
		args = [url];
	}
	const result = await pi.exec(command, args, { timeout: 10_000 });
	if (result.code !== 0) {
		throw new Error(`Failed to open ${url}: ${result.stderr || result.stdout || "unknown error"}`);
	}
}

async function promptForKey(ctx: ExtensionContext): Promise<string | undefined> {
	return ctx.ui.input("Paste your Brave API key", "");
}

async function runOnboarding(pi: ExtensionAPI, ctx: ExtensionContext): Promise<OnboardingResult> {
	const settingsPath = getSettingsPath();
	const settings = readSettingsJson(settingsPath);
	const currentKey = getBraveApiKey(settings);

	// Already configured? Mark complete and skip.
	if (!isPlaceholderKey(currentKey)) {
		markOnboardingComplete();
		return { kind: "deferred" };
	}

	// No UI? Defer to a later session.
	if (!ctx.hasUI) {
		return { kind: "deferred" };
	}

	const wantsBrave = await ctx.ui.confirm(
		"Use Brave Search?",
		"Brave gives reliable web results for the web_explore tool. You can get an API key at https://api-dashboard.search.brave.com/app/keys. Use Brave now?",
	);

	if (!wantsBrave) {
		markOnboardingComplete();
		ctx.ui.notify("Brave skipped — web search will use the default DuckDuckGo backend.", "info");
		return { kind: "skipped" };
	}

	try {
		await openBraveKeysUrl(pi);
		ctx.ui.notify("Opened the Brave API key dashboard in your browser.", "info");
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		ctx.ui.notify(`Could not open browser: ${message}`, "warning");
		ctx.ui.notify(`Open this URL manually: ${BRAVE_KEYS_URL}`, "info");
	}

	const rawKey = await promptForKey(ctx);
	const validated = validateBraveKey(rawKey);

	if (validated.error) {
		ctx.ui.notify(validated.error, "warning");
		// Do not mark complete so the prompt retries on next launch.
		return { kind: "deferred" };
	}

	const updated = setBraveApiKey(settings, validated.key!);
	writeSettingsJson(updated, settingsPath);
	// Select Brave as the pi-web-agent search backend (DuckDuckGo fallback).
	writeWebAgentBraveBackendConfig();
	markOnboardingComplete();

	ctx.ui.notify("Brave API key saved — web search will use Brave.", "info");
	return { kind: "saved" };
}

export default function webAgentOnboardingExtension(pi: ExtensionAPI): void {
	pi.on("session_start", async (event: SessionStartEvent, ctx: ExtensionContext) => {
		if (event.reason !== "startup") return;
		if (isOnboardingComplete()) return;

		// Avoid prompting during tests or non-interactive runs.
		if (process.env.SELESAI_SKIP_WEB_AGENT_ONBOARDING === "1") return;

		await runOnboarding(pi, ctx);
	});

	// ponytail: command reuses runOnboarding() instead of duplicating the flow.
	// On "saved" -> ctx.reload() so pi-web-agent re-applies the Brave backend config.
	// On skipped/deferred -> no reload (nothing changed). The post-reload session_start
	// fires with reason "reload" but the auto handler only acts on "startup", so no double prompt.
	pi.registerCommand("setup-web-search", {
		description: "Re-run the Brave Search onboarding flow, then reload extensions",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const result = await runOnboarding(pi, ctx);
			if (result.kind === "saved") {
				ctx.ui.notify("Brave key saved — reloading extensions…", "info");
				await ctx.reload();
			}
		},
	});
}