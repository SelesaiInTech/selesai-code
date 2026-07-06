/**
 * Token-In first-run onboarding extension.
 *
 * On the first interactive session, ask the user whether they want to connect a
 * Token-In token. If yes, open the Token-In dashboard, collect the pasted token,
 * and persist it in auth.json like other provider credentials.
 *
 * Slash command `/tokenin <add|switch|remove>` manages multiple TokenIN accounts
 * stored in ~/.selesai/agent/tokenin-auth.json, writing the active credential to
 * auth.json.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir, getModelsPath } from "@selesai/code";
import type { AuthStorage, ExtensionAPI, ExtensionCommandContext, ExtensionContext, SessionStartEvent } from "@selesai/code";

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

/** Return a new models object with the legacy providers.tokenin.apiKey removed. */
export function removeTokenInApiKey(models: Record<string, unknown>): Record<string, unknown> {
	const next = JSON.parse(JSON.stringify(models)) as Record<string, unknown>;
	const providers = next.providers;
	if (!providers || typeof providers !== "object" || Array.isArray(providers)) return next;
	const tokenin = (providers as Record<string, unknown>)[TOKEN_IN_PROVIDER];
	if (!tokenin || typeof tokenin !== "object" || Array.isArray(tokenin)) return next;
	delete (tokenin as Record<string, unknown>).apiKey;
	return next;
}

export function getStoredTokenInApiKey(authStorage: AuthStorage): string | undefined {
	const credential = authStorage.get(TOKEN_IN_PROVIDER);
	return credential?.type === "api_key" ? credential.key : undefined;
}

export function setStoredTokenInApiKey(authStorage: AuthStorage, token: string): void {
	authStorage.set(TOKEN_IN_PROVIDER, { type: "api_key", key: token });
}

/** Validate a pasted token. Returns normalized token or an error message. */
export function validateTokenInToken(raw: string | undefined): { token?: string; error?: string } {
	if (raw === undefined || raw === null) return { error: "No token entered." };
	const trimmed = raw.trim();
	if (trimmed === "") return { error: "Token cannot be empty." };
	if (!trimmed.startsWith("sk-")) return { error: "Token must start with 'sk-'." };
	return { token: trimmed };
}

// ---------------------------------------------------------------------------
// tokenin-auth.json — multi-account storage
// ---------------------------------------------------------------------------

export interface TokenInAccount {
	id: string;
	label: string;
	apiKey: string;
	baseUrl?: string;
}

export interface TokenInAuth {
	accounts: TokenInAccount[];
	activeId: string | null;
}

const DEFAULT_AUTH: TokenInAuth = { accounts: [], activeId: null };

export function getTokenInAuthPath(agentDir: string = getAgentDir()): string {
	return join(agentDir, "tokenin-auth.json");
}

export function readTokenInAuth(authPath: string = getTokenInAuthPath()): TokenInAuth {
	try {
		const raw = readFileSync(authPath, "utf-8");
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ...DEFAULT_AUTH };
		const obj = parsed as Record<string, unknown>;
		const accounts = Array.isArray(obj.accounts) ? (obj.accounts as unknown[]).filter(isTokenInAccount) : [];
		const activeId = typeof obj.activeId === "string" ? obj.activeId : null;
		return { accounts, activeId };
	} catch {
		return { ...DEFAULT_AUTH };
	}
}

function isTokenInAccount(value: unknown): value is TokenInAccount {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const v = value as Record<string, unknown>;
	return typeof v.id === "string" && typeof v.apiKey === "string";
}

export function writeTokenInAuth(auth: TokenInAuth, authPath: string = getTokenInAuthPath()): void {
	mkdirSync(dirname(authPath), { recursive: true, mode: 0o700 });
	writeFileSync(authPath, `${JSON.stringify(auth, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
	try {
		chmodSync(authPath, 0o600);
	} catch {
		// best-effort
	}
}

function getTokenInBaseUrl(models: Record<string, unknown>): string | undefined {
	const providers = models.providers;
	if (!providers || typeof providers !== "object" || Array.isArray(providers)) return undefined;
	const tokenin = (providers as Record<string, unknown>)[TOKEN_IN_PROVIDER];
	if (!tokenin || typeof tokenin !== "object" || Array.isArray(tokenin)) return undefined;
	const baseUrl = (tokenin as Record<string, unknown>).baseUrl;
	return typeof baseUrl === "string" ? baseUrl : undefined;
}

function makeTokenInLabel(token: string): string {
	const last8 = token.slice(-8);
	return `sk-…${last8}`;
}

/** Upsert an account into tokenin-auth.json. Optionally set it as active. */
export function saveTokenInAccount(
	token: string,
	options?: { baseUrl?: string; setActive?: boolean },
	authPath: string = getTokenInAuthPath(),
): TokenInAuth {
	const auth = readTokenInAuth(authPath);
	const existing = auth.accounts.find((a) => a.id === token);
	const account: TokenInAccount = {
		id: token,
		label: existing?.label ?? makeTokenInLabel(token),
		apiKey: token,
		baseUrl: options?.baseUrl ?? existing?.baseUrl,
	};
	if (!account.baseUrl) delete account.baseUrl;

	if (existing) {
		Object.assign(existing, account);
	} else {
		auth.accounts.push(account);
	}

	if (options?.setActive) {
		auth.activeId = token;
	}

	writeTokenInAuth(auth, authPath);
	return auth;
}

/** Write the given account into auth.json and update tokenin-auth activeId. */
export function applyTokenInAccountToAuth(
	account: TokenInAccount,
	authStorage: AuthStorage,
	authPath: string = getTokenInAuthPath(),
): void {
	setStoredTokenInApiKey(authStorage, account.apiKey);
	const auth = readTokenInAuth(authPath);
	auth.activeId = account.id;
	writeTokenInAuth(auth, authPath);
}

/** Return the id of the account whose apiKey matches auth.json, or null. */
export function getActiveTokenInAccountId(
	authStorage: AuthStorage,
	authPath: string = getTokenInAuthPath(),
): string | null {
	const apiKey = getStoredTokenInApiKey(authStorage);
	if (!apiKey) return null;
	const auth = readTokenInAuth(authPath);
	return auth.accounts.find((a) => a.apiKey === apiKey)?.id ?? null;
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

// ---------------------------------------------------------------------------
// /tokenin subcommand handlers
// ---------------------------------------------------------------------------

async function handleTokenInAdd(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("This command requires interactive mode.", "warning");
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
		return;
	}

	const token = validated.token!;
	const models = readModelsJson();
	const baseUrl = getTokenInBaseUrl(models);
	const auth = readTokenInAuth();
	const wasEmpty = auth.accounts.length === 0;

	saveTokenInAccount(token, { baseUrl });

	if (wasEmpty) {
		const saved = readTokenInAuth().accounts.find((a) => a.id === token)!;
		applyTokenInAccountToAuth(saved, ctx.modelRegistry.authStorage);
		try {
			ctx.modelRegistry.refresh();
		} catch {
			// best-effort
		}
		ctx.ui.notify(`Token-In token saved and activated (${saved.label}).`, "info");
	} else {
		ctx.ui.notify("Account added. Use /tokenin switch to activate it.", "info");
	}
}

// ponytail: ctx.ui.select returns the label string, not an index. We match by
// indexOf on the labels array — if two accounts share the same last-8 suffix
// the first match wins. Acceptable for this use case; upgrade to indexed select
// if multi-account collisions become common.
async function pickAccount(
	ctx: ExtensionCommandContext,
	title: string,
	auth: TokenInAuth,
): Promise<TokenInAccount | undefined> {
	const labels = auth.accounts.map((a) => a.label);
	const selected = await ctx.ui.select(title, labels);
	if (selected === undefined) return undefined;
	const index = labels.indexOf(selected);
	return auth.accounts[index];
}

async function handleTokenInSwitch(ctx: ExtensionCommandContext): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("This command requires interactive mode.", "warning");
		return;
	}

	const auth = readTokenInAuth();
	if (auth.accounts.length === 0) {
		ctx.ui.notify("No saved accounts. Use /tokenin add first.", "warning");
		return;
	}

	const account = await pickAccount(ctx, "Select TokenIN account", auth);
	if (!account) return;

	applyTokenInAccountToAuth(account, ctx.modelRegistry.authStorage);
	try {
		ctx.modelRegistry.refresh();
	} catch {
		// best-effort
	}
	ctx.ui.notify(`Switched to account ${account.label}.`, "info");
}

async function handleTokenInRemove(ctx: ExtensionCommandContext): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("This command requires interactive mode.", "warning");
		return;
	}

	const auth = readTokenInAuth();
	if (auth.accounts.length === 0) {
		ctx.ui.notify("No saved accounts. Use /tokenin add first.", "warning");
		return;
	}

	const account = await pickAccount(ctx, "Select account to remove", auth);
	if (!account) return;

	const activeId = getActiveTokenInAccountId(ctx.modelRegistry.authStorage);
	if (account.id === activeId) {
		ctx.ui.notify("Cannot remove the active account. Use /tokenin switch first.", "warning");
		return;
	}

	const confirmed = await ctx.ui.confirm("Remove account?", `Remove account ${account.label}?`);
	if (!confirmed) return;

	auth.accounts = auth.accounts.filter((a) => a.id !== account.id);
	writeTokenInAuth(auth);
	ctx.ui.notify("Account removed.", "info");
}

async function runOnboarding(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const modelsPath = getModelsPath();
	const models = readModelsJson(modelsPath);
	const storedKey = getStoredTokenInApiKey(ctx.modelRegistry.authStorage);
	const legacyModelsKey = getTokenInApiKey(models);
	const currentKey = storedKey ?? legacyModelsKey;

	// Already configured? Mark complete and skip. Migrate legacy models.json tokens
	// into auth.json so Token-In models stay package-local.
	if (!isPlaceholderToken(currentKey)) {
		if (!storedKey && typeof legacyModelsKey === "string") {
			setStoredTokenInApiKey(ctx.modelRegistry.authStorage, legacyModelsKey);
			saveTokenInAccount(legacyModelsKey, { baseUrl: getTokenInBaseUrl(models), setActive: true });
			if (existsSync(modelsPath)) writeModelsJson(removeTokenInApiKey(models), modelsPath);
		}
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
		ctx.ui.notify("You can add your Token-In token later with /tokenin add.", "info");
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

	const token = validated.token!;
	setStoredTokenInApiKey(ctx.modelRegistry.authStorage, token);
	markOnboardingComplete();

	// Seed tokenin-auth.json so /tokenin switch and /tokenin remove work after onboarding.
	saveTokenInAccount(token, { baseUrl: getTokenInBaseUrl(models), setActive: true });

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

	pi.registerCommand("tokenin", {
		description: "Manage TokenIN accounts: /tokenin add|switch|remove",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			await ctx.waitForIdle();
			const sub = args.trim().split(/\s+/)[0];
			if (sub === "add") {
				await handleTokenInAdd(pi, ctx);
			} else if (sub === "switch") {
				await handleTokenInSwitch(ctx);
			} else if (sub === "remove") {
				await handleTokenInRemove(ctx);
			} else {
				ctx.ui.notify("Usage: /tokenin add|switch|remove", "info");
			}
		},
	});
}
