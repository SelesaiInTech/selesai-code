/**
 * Token-In first-run onboarding extension.
 *
 * On the first interactive session, ask the user whether they want to connect a
 * Token-In token. If yes, open the Token-In dashboard, collect the pasted token,
 * and persist it in ~/.selesai/agent/models.json under providers.tokenin.apiKey.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir, getModelsPath } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext, SessionStartEvent } from "@earendil-works/pi-coding-agent";

export const TOKEN_IN_PROVIDER = "tokenin";
export const TOKEN_IN_DASHBOARD_URL = "https://token-in.selesai.in/dashboard/tokens";
export const ONBOARDING_MARKER_NAME = ".tokenInOnboardingComplete";
export const PLACEHOLDER_API_KEY = "sk-xxx";

/** Read and parse the current models.json, returning a deep-ish mutable object. */
export function readModelsJson(modelsPath: string = getModelsPath()): Record<string, unknown> {
	try {
		const raw = readFileSync(modelsPath, "utf-8");
		return JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return { providers: {} };
	}
}

/** Write models.json back to disk atomically-ish with a trailing newline. */
export function writeModelsJson(models: Record<string, unknown>, modelsPath: string = getModelsPath()): void {
	mkdirSync(dirname(modelsPath), { recursive: true });
	writeFileSync(modelsPath, `${JSON.stringify(models, null, 2)}\n`, "utf-8");
}

/**
 * Return true if the current apiKey value is missing, empty, or still the
 * bundled placeholder. We prompt again for any non-token value.
 */
export function isPlaceholderToken(apiKey: unknown): boolean {
	if (apiKey === undefined || apiKey === null) return true;
	if (typeof apiKey !== "string") return true;
	const trimmed = apiKey.trim();
	return trimmed === "" || trimmed === PLACEHOLDER_API_KEY;
}

/** Return the current providers.tokenin.apiKey value from models.json. */
export function getTokenInApiKey(models: Record<string, unknown>): unknown {
	const providers = models.providers;
	if (!providers || typeof providers !== "object" || Array.isArray(providers)) return undefined;
	const tokenin = (providers as Record<string, unknown>)[TOKEN_IN_PROVIDER];
	if (!tokenin || typeof tokenin !== "object" || Array.isArray(tokenin)) return undefined;
	return (tokenin as Record<string, unknown>).apiKey;
}

/** Return a new models object with providers.tokenin.apiKey set to token. */
export function setTokenInApiKey(models: Record<string, unknown>, token: string): Record<string, unknown> {
	const next = JSON.parse(JSON.stringify(models)) as Record<string, unknown>;
	if (!next.providers || typeof next.providers !== "object" || Array.isArray(next.providers)) {
		next.providers = {};
	}
	const providers = next.providers as Record<string, unknown>;
	if (!providers[TOKEN_IN_PROVIDER] || typeof providers[TOKEN_IN_PROVIDER] !== "object" || Array.isArray(providers[TOKEN_IN_PROVIDER])) {
		providers[TOKEN_IN_PROVIDER] = {};
	}
	const tokenin = providers[TOKEN_IN_PROVIDER] as Record<string, unknown>;
	tokenin.apiKey = token;
	return next;
}

/** Validate a pasted token. Returns normalized token or an error message. */
export function validateTokenInToken(raw: string | undefined): { token?: string; error?: string } {
	if (raw === undefined || raw === null) return { error: "No token entered." };
	const trimmed = raw.trim();
	if (trimmed === "") return { error: "Token cannot be empty." };
	if (!trimmed.startsWith("sk-")) return { error: "Token must start with 'sk-'." };
	return { token: trimmed };
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

async function openDashboard(pi: ExtensionAPI): Promise<void> {
	const url = TOKEN_IN_DASHBOARD_URL;
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

async function promptForToken(ctx: ExtensionContext): Promise<string | undefined> {
	return ctx.ui.input("Paste your Token-In token", "sk-...");
}

async function runOnboarding(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const modelsPath = getModelsPath();
	const models = readModelsJson(modelsPath);
	const currentKey = getTokenInApiKey(models);

	// Already configured? Mark complete and skip.
	if (!isPlaceholderToken(currentKey)) {
		markOnboardingComplete();
		return;
	}

	// No UI? Defer to a later session.
	if (!ctx.hasUI) {
		return;
	}

	const wantsToken = await ctx.ui.confirm(
		"Connect Token-In?",
		"Do you want to use your Token-In token now?",
	);

	if (!wantsToken) {
		markOnboardingComplete();
		ctx.ui.notify("You can add your Token-In token later by editing ~/.selesai/agent/models.json.", "info");
		return;
	}

	try {
		await openDashboard(pi);
		ctx.ui.notify("Opened Token-In dashboard in your browser.", "info");
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		ctx.ui.notify(`Could not open browser: ${message}`, "warning");
		ctx.ui.notify(`Open this URL manually: ${TOKEN_IN_DASHBOARD_URL}`, "info");
	}

	const rawToken = await promptForToken(ctx);
	const validated = validateTokenInToken(rawToken);

	if (validated.error) {
		ctx.ui.notify(validated.error, "warning");
		// Do not mark complete so the prompt retries on next launch.
		return;
	}

	const updated = setTokenInApiKey(models, validated.token!);
	writeModelsJson(updated, modelsPath);
	markOnboardingComplete();

	// Refresh the in-memory model registry so the key is active immediately.
	try {
		ctx.modelRegistry.refresh();
	} catch {
		// best-effort; registry will pick it up on next startup/reload
	}

	ctx.ui.notify("Token-In token saved.", "info");
}

export default function tokenInOnboardingExtension(pi: ExtensionAPI): void {
	pi.on("session_start", async (event: SessionStartEvent, ctx: ExtensionContext) => {
		if (event.reason !== "startup") return;
		if (isOnboardingComplete()) return;

		// Avoid prompting during tests or non-interactive runs.
		if (process.env.SELESAI_SKIP_TOKENIN_ONBOARDING === "1") return;

		await runOnboarding(pi, ctx);
	});
}
