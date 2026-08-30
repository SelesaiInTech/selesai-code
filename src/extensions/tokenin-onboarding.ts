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
import {
	createAssistantMessageEventStream,
	lazyStream,
	type AssistantMessageEvent,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";

export const TOKEN_IN_PROVIDER = "tokenin";
export const TOKEN_IN_DASHBOARD_URL = "https://token.selesai.in/dashboard/tokens";
export const TOKEN_IN_DEFAULT_BASE_URL = "https://lite.andlet.me/v1";
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

// ---------------------------------------------------------------------------
// Multi-key load balancing / auto-failover
// ---------------------------------------------------------------------------

export const DEFAULT_TOKENIN_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/** In-memory cooldown tracker mapping token/accountId -> cooldown expires timestamp (ms). */
const tokenCooldowns = new Map<string, number>();

/** Clear all in-memory cooldowns. Exported for tests. */
export function clearTokenInCooldowns(): void {
	tokenCooldowns.clear();
}

/** Check if a token/account is currently on cooldown. */
export function isTokenInOnCooldown(tokenId: string, now: number = Date.now()): boolean {
	const expires = tokenCooldowns.get(tokenId);
	if (expires === undefined) return false;
	if (now >= expires) {
		tokenCooldowns.delete(tokenId);
		return false;
	}
	return true;
}

/** Put a token/account on cooldown for a given duration. */
export function setTokenInCooldown(tokenId: string, durationMs: number = DEFAULT_TOKENIN_COOLDOWN_MS, now: number = Date.now()): void {
	tokenCooldowns.set(tokenId, now + durationMs);
}

/** Detect if an error message or AssistantMessage stop indicates an auth/quota failure eligible for failover. */
export function isRotateableTokenInError(error: unknown): boolean {
	if (!error) return false;
	let text = "";
	if (typeof error === "string") {
		text = error;
	} else if (error instanceof Error) {
		text = `${error.name}: ${error.message}`;
	} else if (typeof error === "object" && error !== null) {
		const obj = error as Record<string, unknown>;
		if (typeof obj.errorMessage === "string") {
			text = obj.errorMessage;
		} else if (typeof obj.message === "string") {
			text = obj.message;
		} else if (Array.isArray(obj.content)) {
			// AssistantMessage with content blocks containing error text or errorMessage
			for (const block of obj.content) {
				if (typeof block === "object" && block !== null) {
					const b = block as Record<string, unknown>;
					if (typeof b.errorMessage === "string") text += ` ${b.errorMessage}`;
					if (typeof b.text === "string") text += ` ${b.text}`;
				}
			}
		}
		if (!text) text = JSON.stringify(error);
	} else {
		text = JSON.stringify(error);
	}

	const lower = text.toLowerCase();
	// HTTP 401 / Invalid Key
	if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid_api_key") || lower.includes("invalid api key") || lower.includes("authentication_error")) {
		return true;
	}
	// HTTP 429 / Rate limit
	if (lower.includes("429") || lower.includes("rate_limit") || lower.includes("rate limit") || lower.includes("too many requests")) {
		return true;
	}
	// Budget / Quota / Credits
	if (
		lower.includes("budget has been exceeded") ||
		lower.includes("budget_exceeded") ||
		lower.includes("max_budget") ||
		lower.includes("insufficient_quota") ||
		lower.includes("quota exceeded") ||
		lower.includes("exceeds max_budget") ||
		lower.includes("credit limit") ||
		lower.includes("out of credits")
	) {
		return true;
	}
	return false;
}

/** Helper to persist active credential to auth.json and tokenin-auth.json without needing AuthStorage instance. */
function persistActiveTokenInAccount(account: TokenInAccount, authPath: string = getTokenInAuthPath()): void {
	try {
		// Update tokenin-auth.json
		const auth = readTokenInAuth(authPath);
		auth.activeId = account.id;
		writeTokenInAuth(auth, authPath);

		// Update auth.json
		const agentDir = dirname(authPath);
		const globalAuthPath = join(agentDir, "auth.json");
		const current = existsSync(globalAuthPath) ? JSON.parse(readFileSync(globalAuthPath, "utf-8")) as Record<string, unknown> : {};
		current[TOKEN_IN_PROVIDER] = { type: "api_key", key: account.apiKey };
		mkdirSync(dirname(globalAuthPath), { recursive: true, mode: 0o700 });
		writeFileSync(globalAuthPath, `${JSON.stringify(current, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
		try {
			chmodSync(globalAuthPath, 0o600);
		} catch {
			// best-effort
		}
	} catch {
		// best-effort sync
	}
}

/**
 * Custom streamSimple implementation for tokenin provider that wraps OpenAI completions
 * and automatically rotates to alternative saved keys on 401/429/budget exceeded errors.
 */
export function createTokenInStreamSimple(options?: {
	authPath?: string;
	getAuthStorage?: () => AuthStorage | undefined;
	onRotate?: (failedAccount: TokenInAccount, nextAccount: TokenInAccount, reason: string) => void;
	streamSimple?: (model: Model<any>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream;
}) {
	const authPath = options?.authPath ?? getTokenInAuthPath();
	const baseApi = options?.streamSimple ? undefined : getApiProvider("openai-completions");
	const streamSimple = options?.streamSimple ?? baseApi!.streamSimple.bind(baseApi!);

	const activate = (account: TokenInAccount): void => {
		const authStorage = options?.getAuthStorage?.();
		if (authStorage) {
			applyTokenInAccountToAuth(account, authStorage, authPath);
		} else {
			persistActiveTokenInAccount(account, authPath);
		}
	};

	const withAccountAuthorization = (streamOptions: SimpleStreamOptions | undefined, account: TokenInAccount): SimpleStreamOptions => {
		const headers = Object.fromEntries(
			Object.entries(streamOptions?.headers ?? {}).filter(([name]) => name.toLowerCase() !== "authorization"),
		);
		return {
			...streamOptions,
			apiKey: account.apiKey,
			headers: { ...headers, Authorization: `Bearer ${account.apiKey}` },
		};
	};

	return function tokenInStreamSimple(
		model: Model<any>,
		context: Context,
		streamOptions?: SimpleStreamOptions,
	): AssistantMessageEventStream {
		return lazyStream(model, async () => {
			const auth = readTokenInAuth(authPath);
			const accounts = auth.accounts;

			// If no accounts saved, fall back directly to base implementation
			if (accounts.length === 0) {
				return streamSimple(model, context, streamOptions);
			}

			// Order accounts: active account first, followed by remaining accounts
			const activeIndex = accounts.findIndex((a) => a.id === auth.activeId || a.apiKey === streamOptions?.apiKey);
			const orderedAccounts: TokenInAccount[] = [];
			if (activeIndex >= 0) {
				orderedAccounts.push(accounts[activeIndex]!);
				for (let i = 0; i < accounts.length; i++) {
					if (i !== activeIndex) orderedAccounts.push(accounts[i]!);
				}
			} else {
				orderedAccounts.push(...accounts);
			}

			// Filter/order candidates: prioritize those not currently on cooldown
			const availableAccounts = orderedAccounts.filter((a) => !isTokenInOnCooldown(a.id));
			const candidateAccounts = (availableAccounts.length > 0 ? availableAccounts : orderedAccounts).map((account) => ({ ...account }));

			let lastErrorEvent: AssistantMessageEvent | undefined;
			let lastThrownError: unknown;

			for (let i = 0; i < candidateAccounts.length; i++) {
				const currentAccount = candidateAccounts[i]!;

				const requestOptions = withAccountAuthorization(streamOptions, currentAccount);

				let underlyingStream: AssistantMessageEventStream;
				try {
					underlyingStream = streamSimple(model, context, requestOptions);
				} catch (err) {
					lastThrownError = err;
					if (isRotateableTokenInError(err) && i + 1 < candidateAccounts.length) {
						setTokenInCooldown(currentAccount.id);
						const nextAccount = candidateAccounts[i + 1]!;
						activate(nextAccount);
						options?.onRotate?.(currentAccount, nextAccount, String(err));
						continue;
					}
					throw err;
				}

				// Hold a leading start event until the request proves it produced output. This
				// permits an immediate upstream error to be retried without exposing two starts.
				const iterator = underlyingStream[Symbol.asyncIterator]();
				let firstResult: IteratorResult<AssistantMessageEvent>;
				try {
					firstResult = await iterator.next();
				} catch (err) {
					lastThrownError = err;
					if (isRotateableTokenInError(err) && i + 1 < candidateAccounts.length) {
						setTokenInCooldown(currentAccount.id);
						const nextAccount = candidateAccounts[i + 1]!;
						activate(nextAccount);
						options?.onRotate?.(currentAccount, nextAccount, String(err));
						continue;
					}
					throw err;
				}

				if (firstResult.done) {
					const passthrough = createAssistantMessageEventStream();
					passthrough.end();
					return passthrough;
				}

				const bufferedEvents = [firstResult.value];
				if (bufferedEvents[0].type === "start") {
					try {
						const next = await iterator.next();
						if (!next.done) bufferedEvents.push(next.value);
					} catch (err) {
						lastThrownError = err;
						if (isRotateableTokenInError(err) && i + 1 < candidateAccounts.length) {
							setTokenInCooldown(currentAccount.id);
							const nextAccount = candidateAccounts[i + 1]!;
							activate(nextAccount);
							options?.onRotate?.(currentAccount, nextAccount, String(err));
							continue;
						}
						throw err;
					}
				}

				const immediateError = bufferedEvents.find((event) => event.type === "error");
				if (immediateError?.type === "error" && isRotateableTokenInError(immediateError.error)) {
					lastErrorEvent = immediateError;
					setTokenInCooldown(currentAccount.id);
					if (i + 1 < candidateAccounts.length) {
						const nextAccount = candidateAccounts[i + 1]!;
						activate(nextAccount);
						options?.onRotate?.(currentAccount, nextAccount, immediateError.error.errorMessage ?? "Error");
						continue;
					}
				}

				const outputStream = createAssistantMessageEventStream();
				(async () => {
					try {
						for (const event of bufferedEvents) outputStream.push(event);
						while (true) {
							const next = await iterator.next();
							if (next.done) break;
							outputStream.push(next.value);
						}
						outputStream.end();
					} catch {
						outputStream.end();
					}
				})();

				return outputStream;
			}

			// If loop exhausted with a rotateable error event, return a stream with that error
			if (lastErrorEvent) {
				const errorStream = createAssistantMessageEventStream();
				errorStream.push(lastErrorEvent);
				errorStream.end();
				return errorStream;
			}

			if (lastThrownError) {
				throw lastThrownError;
			}

			return streamSimple(model, context, streamOptions);
		});
	};
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
// /tokenin usage — LiteLLM /key/info quota lookup
// ---------------------------------------------------------------------------

export interface TokenInUsage {
	spend: number;
	maxBudget?: number;
	budgetResetAt?: string;
}

/** Parse a LiteLLM /key/info payload into spend/budget/reset. Exported for tests. */
export function parseTokenInUsage(payload: unknown): TokenInUsage | undefined {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
	const obj = payload as Record<string, unknown>;
	const info =
		obj.info && typeof obj.info === "object" && !Array.isArray(obj.info)
			? (obj.info as Record<string, unknown>)
			: obj;
	const spend = Number(info.spend);
	if (!Number.isFinite(spend) || spend < 0) return undefined;
	const usage: TokenInUsage = { spend };
	const maxBudget = Number(info.max_budget);
	if (Number.isFinite(maxBudget) && maxBudget > 0) usage.maxBudget = maxBudget;
	if (typeof info.budget_reset_at === "string") usage.budgetResetAt = info.budget_reset_at;
	return usage;
}

/** Format usage as a boxed multi-line display with a progress bar. Exported for tests. */
export function formatTokenInUsage(usage: TokenInUsage): string {
	const money = (v: number) => `$${v.toFixed(2)}`;
	const pct = usage.maxBudget !== undefined ? (usage.spend / usage.maxBudget) * 100 : 0;
	const barWidth = 40;
	const filled = usage.maxBudget !== undefined ? Math.min(barWidth, Math.round((pct / 100) * barWidth)) : 0;
	const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
	const pctText = usage.maxBudget !== undefined ? `${pct.toFixed(1)}%` : "—";

	let summary = `Spent ${money(usage.spend)}`;
	if (usage.maxBudget !== undefined) {
		summary += ` of ${money(usage.maxBudget)} budget (${pct.toFixed(1)}%)`;
	} else {
		summary += " (no budget limit set)";
	}

	let footer = usage.maxBudget !== undefined ? `${money(Math.max(0, usage.maxBudget - usage.spend))} remaining` : "";
	if (usage.budgetResetAt) {
		const d = new Date(usage.budgetResetAt);
		if (!Number.isNaN(d.getTime())) {
			const ms = d.getTime() - Date.now();
			if (ms > 0) {
				const days = Math.floor(ms / 86_400_000);
				const hours = Math.floor((ms % 86_400_000) / 3_600_000);
				const reset = days > 0 ? `${days}d ${hours}h` : `${Math.max(1, Math.ceil(ms / 3_600_000))}h`;
				footer += footer ? ` · resets in ${reset}` : `resets in ${reset}`;
			}
		}
	}

	const W = 50; // total box width
	const inner = W - 4; // content width between │ padding
	const pad = (s: string) => s + " ".repeat(Math.max(0, inner - s.length));
	const top = `╭─ Token-In usage ${"─".repeat(W - 19)}╮`;
	const bottom = `╰${"─".repeat(W - 2)}╯`;
	return [
		top,
		`│ ${pad(summary)} │`,
		`│ ${bar} ${pctText.padStart(5)} │`,
		`│ ${pad(footer)} │`,
		bottom,
	].join("\n");
}

/** Query LiteLLM /key/info at the proxy root with the account key. Exported for tests. */
export async function fetchTokenInUsage(apiKey: string, baseUrl: string): Promise<TokenInUsage> {
	const root = baseUrl.replace(/\/v1\/?$/, "");
	const response = await fetch(`${root}/key/info`, {
		headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
		signal: AbortSignal.timeout(5_000),
	});
	if (!response.ok) {
		throw new Error(`Token-In usage endpoint returned HTTP ${response.status}`);
	}
	const payload: unknown = await response.json();
	const usage = parseTokenInUsage(payload);
	if (!usage) throw new Error("Token-In usage endpoint returned an unexpected payload");
	return usage;
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
			await ctx.modelRegistry.refresh();
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
		await ctx.modelRegistry.refresh();
	} catch {
		// best-effort
	}
	ctx.ui.notify(`Switched to account ${account.label}.`, "info");
}

async function handleTokenInUsage(ctx: ExtensionCommandContext): Promise<void> {
	const apiKey = getStoredTokenInApiKey(ctx.modelRegistry.authStorage);
	if (!apiKey) {
		ctx.ui.notify("No active Token-In token. Use /tokenin add first.", "warning");
		return;
	}
	const auth = readTokenInAuth();
	const activeId = getActiveTokenInAccountId(ctx.modelRegistry.authStorage);
	const account = auth.accounts.find((a) => a.id === activeId);
	const baseUrl = account?.baseUrl ?? getTokenInBaseUrl(readModelsJson()) ?? TOKEN_IN_DEFAULT_BASE_URL;
	try {
		const usage = await fetchTokenInUsage(apiKey, baseUrl);
		ctx.ui.notify(formatTokenInUsage(usage), "info");
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		ctx.ui.notify(`Could not fetch Token-In usage: ${message}`, "warning");
	}
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
			// legacyModelsKey is only non-empty when models.json parsed successfully,
			// so the file always exists here.
			/* v8 ignore next 1 */
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
		await ctx.modelRegistry.refresh();
	} catch {
		// best-effort; registry will pick it up on next startup/reload
	}

	ctx.ui.notify("Token-In token saved.", "info");
}

export default function tokenInOnboardingExtension(pi: ExtensionAPI): void {
	let authStorage: AuthStorage | undefined;
	pi.registerProvider("tokenin", {
		api: "openai-completions",
		streamSimple: createTokenInStreamSimple({ getAuthStorage: () => authStorage }),
	});

	pi.on("session_start", async (event: SessionStartEvent, ctx: ExtensionContext) => {
		authStorage = ctx.modelRegistry.authStorage;
		if (event.reason !== "startup") return;
		if (isOnboardingComplete()) return;

		// Avoid prompting during tests or non-interactive runs.
		if (process.env.SELESAI_SKIP_TOKENIN_ONBOARDING === "1") return;

		await runOnboarding(pi, ctx);
	});

	pi.registerCommand("tokenin", {
		description: "Manage TokenIN accounts: /tokenin add|switch|remove|usage",
		getArgumentCompletions: (prefix: string) => {
			const subcommands = [
				{ name: "add", description: "Add a TokenIN account" },
				{ name: "switch", description: "Switch active account" },
				{ name: "remove", description: "Remove a saved account" },
				{ name: "usage", description: "Show Token-IN quota usage" },
			];
			const lowerPrefix = prefix.toLowerCase();
			const items = subcommands.filter((s) => s.name.toLowerCase().startsWith(lowerPrefix));
			return items.length > 0
				? items.map((s) => ({ value: s.name, label: s.name, description: s.description }))
				: null;
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			await ctx.waitForIdle();
			const sub = args.trim().split(/\s+/)[0];
			if (sub === "add") {
				await handleTokenInAdd(pi, ctx);
			} else if (sub === "switch") {
				await handleTokenInSwitch(ctx);
			} else if (sub === "remove") {
				await handleTokenInRemove(ctx);
			} else if (sub === "usage") {
				await handleTokenInUsage(ctx);
			} else {
				ctx.ui.notify("Usage: /tokenin add|switch|remove|usage", "info");
			}
		},
	});
}
