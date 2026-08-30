import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the self-package alias that the extension imports under at runtime.
vi.mock("@selesai/code", () => ({
	getAgentDir: () => process.env.SELESAI_CODING_AGENT_DIR ?? join(homedir(), ".selesai", "agent"),
	getModelsPath: () => join(process.env.SELESAI_CODING_AGENT_DIR ?? join(homedir(), ".selesai", "agent"), "models.json"),
}));

import { homedir } from "node:os";
import {
	applyTokenInAccountToAuth,
	clearTokenInCooldowns,
	createTokenInStreamSimple,
	DEFAULT_TOKENIN_COOLDOWN_MS,
	fetchTokenInUsage,
	formatTokenInUsage,
	getActiveTokenInAccountId,
	getStoredTokenInApiKey,
	getTokenInApiKey,
	getTokenInAuthPath,
	isPlaceholderToken,
	isRotateableTokenInError,
	isTokenInOnCooldown,
	parseTokenInUsage,
	PLACEHOLDER_API_KEY,
	readModelsJson,
	readTokenInAuth,
	removeTokenInApiKey,
	saveTokenInAccount,
	setTokenInCooldown,
	TOKEN_IN_DASHBOARD_URL,
	validateTokenInToken,
	writeTokenInAuth,
} from "../extensions/tokenin-onboarding.ts";

// Import the handler factory for session_start behavior tests.
import {
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	type AssistantMessageEvent,
	type Context,
	type Model,
} from "@earendil-works/pi-ai";
import tokenInOnboardingExtension from "../extensions/tokenin-onboarding.ts";
import { AuthStorage } from "../core/auth-storage.ts";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, SessionStartEvent } from "../core/extensions/types.ts";

describe("tokenin-onboarding helpers", () => {
	it("isPlaceholderToken returns true for missing/empty/placeholder values", () => {
		expect(isPlaceholderToken(undefined)).toBe(true);
		expect(isPlaceholderToken(null)).toBe(true);
		expect(isPlaceholderToken("")).toBe(true);
		expect(isPlaceholderToken("   ")).toBe(true);
		expect(isPlaceholderToken(PLACEHOLDER_API_KEY)).toBe(true);
		expect(isPlaceholderToken("sk-real")).toBe(false);
	});

	it("getTokenInApiKey reads nested value safely", () => {
		expect(getTokenInApiKey({})).toBeUndefined();
		expect(getTokenInApiKey({ providers: {} })).toBeUndefined();
		expect(getTokenInApiKey({ providers: { tokenin: {} } })).toBeUndefined();
		expect(getTokenInApiKey({ providers: { tokenin: { apiKey: "sk-abc" } } })).toBe("sk-abc");
	});

	it("removeTokenInApiKey removes only the legacy tokenin apiKey", () => {
		const models = {
			providers: {
				other: { apiKey: "other-key", baseUrl: "https://other.example" },
				tokenin: { apiKey: PLACEHOLDER_API_KEY, baseUrl: "https://token.in" },
			},
		};
		const updated = removeTokenInApiKey(models);
		const providers = updated.providers as Record<string, any>;
		expect(providers.tokenin.apiKey).toBeUndefined();
		expect(providers.tokenin.baseUrl).toBe("https://token.in");
		expect(providers.other.apiKey).toBe("other-key");
	});

	it("removeTokenInApiKey tolerates missing or non-object providers", () => {
		expect(removeTokenInApiKey({})).toEqual({});
		expect(removeTokenInApiKey({ providers: "not-an-object" })).toEqual({ providers: "not-an-object" });
		expect(removeTokenInApiKey({ providers: { tokenin: "not-an-object" } })).toEqual({ providers: { tokenin: "not-an-object" } });
	});

	it("stored Token-In apiKey uses auth storage", () => {
		const authStorage = AuthStorage.inMemory();
		expect(getStoredTokenInApiKey(authStorage)).toBeUndefined();
		authStorage.set("tokenin", { type: "api_key", key: "sk-new" });
		expect(getStoredTokenInApiKey(authStorage)).toBe("sk-new");
	});

	it("validateTokenInToken trims and enforces sk- prefix", () => {
		expect(validateTokenInToken("  sk-abc  ")).toEqual({ token: "sk-abc" });
		expect(validateTokenInToken("")).toEqual({ error: "Token cannot be empty." });
		expect(validateTokenInToken("abc")).toEqual({ error: "Token must start with 'sk-'." });
		expect(validateTokenInToken(undefined)).toEqual({ error: "No token entered." });
	});

	it("readModelsJson returns parsed object or fallback", () => {
		const dir = mkdtempSync(join(tmpdir(), "tokenin-read-"));
		const path = join(dir, "models.json");
		writeFileSync(path, '{"providers":{"tokenin":{"apiKey":"sk-test"}}}', "utf-8");
		expect(readModelsJson(path)).toEqual({ providers: { tokenin: { apiKey: "sk-test" } } });
		expect(readModelsJson(join(dir, "missing.json"))).toEqual({ providers: {} });
		rmSync(dir, { recursive: true, force: true });
	});
});

describe("tokenin-auth.json helpers", () => {
	it("getTokenInAuthPath returns agentDir/tokenin-auth.json", () => {
		const dir = mkdtempSync(join(tmpdir(), "tokenin-auth-path-"));
		expect(getTokenInAuthPath(dir)).toBe(join(dir, "tokenin-auth.json"));
		rmSync(dir, { recursive: true, force: true });
	});

	it("readTokenInAuth returns default shape when file is missing", () => {
		const dir = mkdtempSync(join(tmpdir(), "tokenin-auth-missing-"));
		const authPath = join(dir, "tokenin-auth.json");
		expect(readTokenInAuth(authPath)).toEqual({ accounts: [], activeId: null });
		rmSync(dir, { recursive: true, force: true });
	});

	it("readTokenInAuth returns default shape when file is corrupt", () => {
		const dir = mkdtempSync(join(tmpdir(), "tokenin-auth-corrupt-"));
		const authPath = join(dir, "tokenin-auth.json");
		writeFileSync(authPath, "{not valid json", "utf-8");
		expect(readTokenInAuth(authPath)).toEqual({ accounts: [], activeId: null });
		rmSync(dir, { recursive: true, force: true });
	});

	it("readTokenInAuth returns default shape for non-object JSON", () => {
		const dir = mkdtempSync(join(tmpdir(), "tokenin-auth-nonobj-"));
		const authPath = join(dir, "tokenin-auth.json");
		writeFileSync(authPath, "\"just a string\"", "utf-8");
		expect(readTokenInAuth(authPath)).toEqual({ accounts: [], activeId: null });
		rmSync(dir, { recursive: true, force: true });
	});

	it("readTokenInAuth returns default shape for array JSON", () => {
		const dir = mkdtempSync(join(tmpdir(), "tokenin-auth-array-"));
		const authPath = join(dir, "tokenin-auth.json");
		writeFileSync(authPath, "[1,2,3]", "utf-8");
		expect(readTokenInAuth(authPath)).toEqual({ accounts: [], activeId: null });
		rmSync(dir, { recursive: true, force: true });
	});

	it("readTokenInAuth returns empty accounts when accounts is not an array", () => {
		const dir = mkdtempSync(join(tmpdir(), "tokenin-auth-noarr-"));
		const authPath = join(dir, "tokenin-auth.json");
		writeFileSync(authPath, JSON.stringify({ accounts: "not-an-array", activeId: "sk-x" }), "utf-8");
		expect(readTokenInAuth(authPath)).toEqual({ accounts: [], activeId: "sk-x" });
		rmSync(dir, { recursive: true, force: true });
	});

	it("writeTokenInAuth / readTokenInAuth roundtrip", () => {
		const dir = mkdtempSync(join(tmpdir(), "tokenin-auth-rw-"));
		const authPath = join(dir, "tokenin-auth.json");
		const auth = {
			accounts: [{ id: "sk-abc", label: "sk-…sk-abc", apiKey: "sk-abc", baseUrl: "https://token.in" }],
			activeId: "sk-abc",
		};
		writeTokenInAuth(auth, authPath);
		expect(readTokenInAuth(authPath)).toEqual(auth);
		rmSync(dir, { recursive: true, force: true });
	});

	it("saveTokenInAccount upserts and optionally sets active", () => {
		const dir = mkdtempSync(join(tmpdir(), "tokenin-auth-save-"));
		const authPath = join(dir, "tokenin-auth.json");
		// First save — new account, set active
		let auth = saveTokenInAccount("sk-token1", { baseUrl: "https://token.in", setActive: true }, authPath);
		expect(auth.accounts).toHaveLength(1);
		expect(auth.accounts[0].apiKey).toBe("sk-token1");
		expect(auth.activeId).toBe("sk-token1");

		// Second save — different account, not active
		auth = saveTokenInAccount("sk-token2", {}, authPath);
		expect(auth.accounts).toHaveLength(2);
		expect(auth.activeId).toBe("sk-token1"); // unchanged

		// Re-save first token — update in place, not a duplicate
		auth = saveTokenInAccount("sk-token1", { baseUrl: "https://updated.in" }, authPath);
		expect(auth.accounts).toHaveLength(2);
		const first = auth.accounts.find((a) => a.id === "sk-token1")!;
		expect(first.baseUrl).toBe("https://updated.in");

		rmSync(dir, { recursive: true, force: true });
	});

	it("applyTokenInAccountToAuth updates auth.json and sets activeId", () => {
		const dir = mkdtempSync(join(tmpdir(), "tokenin-apply-"));
		const authPath = join(dir, "tokenin-auth.json");
		const authStorage = AuthStorage.create(join(dir, "auth.json"));

		// Seed auth with two accounts
		saveTokenInAccount("sk-old", {}, authPath);
		saveTokenInAccount("sk-new", { baseUrl: "https://token.in" }, authPath);

		const account = readTokenInAuth(authPath).accounts.find((a) => a.id === "sk-new")!;
		applyTokenInAccountToAuth(account, authStorage, authPath);

		expect(getStoredTokenInApiKey(authStorage)).toBe("sk-new");
		expect(readTokenInAuth(authPath).activeId).toBe("sk-new");

		rmSync(dir, { recursive: true, force: true });
	});

	it("getActiveTokenInAccountId returns matching id or null", () => {
		const dir = mkdtempSync(join(tmpdir(), "tokenin-active-"));
		const authPath = join(dir, "tokenin-auth.json");
		const authStorage = AuthStorage.create(join(dir, "auth.json"));

		saveTokenInAccount("sk-active", {}, authPath);
		saveTokenInAccount("sk-other", {}, authPath);
		authStorage.set("tokenin", { type: "api_key", key: "sk-active" });

		expect(getActiveTokenInAccountId(authStorage, authPath)).toBe("sk-active");

		authStorage.set("tokenin", { type: "api_key", key: "sk-unknown" });
		expect(getActiveTokenInAccountId(authStorage, authPath)).toBeNull();

		authStorage.remove("tokenin");
		expect(getActiveTokenInAccountId(authStorage, authPath)).toBeNull();

		rmSync(dir, { recursive: true, force: true });
	});
	describe("parseTokenInUsage", () => {
		it("parses spend/max_budget/budget_reset_at from info", () => {
			expect(
				parseTokenInUsage({
					key: "sk-x",
					info: { spend: 1.25, max_budget: 10, budget_reset_at: "2026-08-19T12:00:00+00:00" },
				}),
			).toEqual({ spend: 1.25, maxBudget: 10, budgetResetAt: "2026-08-19T12:00:00+00:00" });
		});

		it("falls back to top-level fields when info is absent", () => {
			expect(parseTokenInUsage({ spend: 0.5 })).toEqual({ spend: 0.5 });
		});

		it("omits maxBudget when unset or non-positive", () => {
			expect(parseTokenInUsage({ info: { spend: 1 } })).toEqual({ spend: 1 });
			expect(parseTokenInUsage({ info: { spend: 1, max_budget: 0 } })).toEqual({ spend: 1 });
		});

		it("returns undefined for invalid payloads", () => {
			expect(parseTokenInUsage(undefined)).toBeUndefined();
			expect(parseTokenInUsage("junk")).toBeUndefined();
			expect(parseTokenInUsage({ info: { spend: "nope" } })).toBeUndefined();
			expect(parseTokenInUsage({ info: { spend: -1 } })).toBeUndefined();
		});
	});

	describe("formatTokenInUsage", () => {
		it("formats spend with budget and remaining", () => {
			const text = formatTokenInUsage({ spend: 2.5, maxBudget: 10 });
			expect(text).toContain("Spent $2.50 of $10.00 budget (25.0%)");
			expect(text).toContain("$7.50 remaining");
			expect(text).toContain("╭─ Token-In usage");
			expect(text).toContain("╰");
		});

		it("formats spend without a budget limit", () => {
			expect(formatTokenInUsage({ spend: 0 })).toContain("Spent $0.00 (no budget limit set)");
		});

		it("draws a full bar at 100% and empty bar at 0%", () => {
			const full = formatTokenInUsage({ spend: 10, maxBudget: 10 });
			expect(full).toContain("█".repeat(40));
			const empty = formatTokenInUsage({ spend: 0, maxBudget: 10 });
			expect(empty).toContain("░".repeat(40));
		});

		it("appends days/hours until reset when parseable", () => {
			const future = new Date(Date.now() + 3 * 86_400_000 + 5 * 3_600_000).toISOString();
			const text = formatTokenInUsage({ spend: 1, maxBudget: 5, budgetResetAt: future });
			expect(text).toContain("resets in 3d 5h");
		});

		it("shows hours only when reset is under a day away", () => {
			const future = new Date(Date.now() + 2 * 3_600_000).toISOString();
			const text = formatTokenInUsage({ spend: 1, maxBudget: 5, budgetResetAt: future });
			expect(text).toContain("resets in 2h");
		});

		it("omits reset when it is in the past or unparseable", () => {
			const past = new Date(Date.now() - 3_600_000).toISOString();
			expect(formatTokenInUsage({ spend: 1, budgetResetAt: past })).not.toContain("resets");
			expect(formatTokenInUsage({ spend: 1, budgetResetAt: "not-a-date" })).not.toContain("resets");
		});
	});

	describe("fetchTokenInUsage", () => {
		afterEach(() => {
			vi.unstubAllGlobals();
		});

		it("queries /key/info at the proxy root and parses the payload", async () => {
			const fetchMock = vi.fn(async () => ({
				ok: true,
				json: async () => ({ info: { spend: 3, max_budget: 20 } }),
			}));
			vi.stubGlobal("fetch", fetchMock);
			const usage = await fetchTokenInUsage("sk-test", "https://lite.andlet.me/v1");
			expect(usage).toEqual({ spend: 3, maxBudget: 20 });
			const [url, init] = fetchMock.mock.calls[0];
			expect(url).toBe("https://lite.andlet.me/key/info");
			expect(init.headers.Authorization).toBe("Bearer sk-test");
		});

		it("throws on non-OK responses", async () => {
			vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401 })));
			await expect(fetchTokenInUsage("sk-test", "https://lite.andlet.me/v1")).rejects.toThrow("HTTP 401");
		});

		it("throws on unexpected payloads", async () => {
			vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
			await expect(fetchTokenInUsage("sk-test", "https://lite.andlet.me/v1")).rejects.toThrow("unexpected payload");
		});
	});
});

describe("tokenin-onboarding extension", () => {
	let dir: string;
	let modelsPath: string;
	let authPath: string;
	let markerPath: string;
	let fakeCtx: ExtensionCommandContext;
	let confirmValue = false;
	let inputValue: string | undefined = undefined;
	let selectValue: string | undefined = undefined;
	const notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "tokenin-ext-"));
		process.env.SELESAI_CODING_AGENT_DIR = dir;
		process.env.PI_CODING_AGENT_DIR = dir;
		modelsPath = join(dir, "models.json");
		authPath = join(dir, "tokenin-auth.json");
		writeTokenInAuth({ accounts: [], activeId: null }, authPath);
		markerPath = join(dir, ".tokenInOnboardingComplete");
		confirmValue = false;
		inputValue = undefined;
		selectValue = undefined;
		notifications.length = 0;

		fakeCtx = {
			hasUI: true,
			ui: {
				confirm: vi.fn(async () => confirmValue),
				input: vi.fn(async () => inputValue),
				select: vi.fn(async () => selectValue),
				notify: vi.fn((message, type) => {
					notifications.push({ message, type });
				}),
			} as unknown as ExtensionContext["ui"],
			modelRegistry: {
				refresh: vi.fn(),
				authStorage: AuthStorage.create(join(dir, "auth.json")),
			} as unknown as ExtensionContext["modelRegistry"],
			waitForIdle: vi.fn(async () => {}),
		} as unknown as ExtensionCommandContext;
	});

	afterEach(() => {
		delete process.env.SELESAI_CODING_AGENT_DIR;
		delete process.env.PI_CODING_AGENT_DIR;
		rmSync(dir, { recursive: true, force: true });
	});

	function makeApi(execResult?: { code: number; stdout: string; stderr: string }): {
		pi: ExtensionAPI;
		handlers: Record<string, unknown>;
		commands: Map<string, { description?: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>;
	} {
		const handlers: Record<string, unknown> = {};
		const commands = new Map<string, { description?: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>();
		const pi = {
			on: vi.fn((event: string, h: unknown) => {
				handlers[event] = h;
			}),
			exec: vi.fn(async () => execResult ?? { code: 0, stdout: "", stderr: "" }),
			registerCommand: vi.fn((name: string, options: { description?: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }) => {
				commands.set(name, options);
			}),
			registerProvider: vi.fn(),
		} as unknown as ExtensionAPI;
		return { pi, handlers, commands };
	}

	async function trigger(): Promise<void> {
		const { pi, handlers } = makeApi();
		tokenInOnboardingExtension(pi);
		const handler = handlers["session_start"] as ((event: SessionStartEvent, ctx: ExtensionContext) => Promise<void>) | undefined;
		expect(handler).toBeDefined();
		await handler!({ type: "session_start", reason: "startup" } as SessionStartEvent, fakeCtx);
	}

	it("migrates only legacy tokenin apiKey from models.json into auth storage", async () => {
		writeFileSync(modelsPath, JSON.stringify({ providers: { other: { apiKey: "sk-other" }, tokenin: { apiKey: "sk-configured" } } }), "utf-8");
		await trigger();
		expect(existsSync(markerPath)).toBe(true);
		expect(getStoredTokenInApiKey(fakeCtx.modelRegistry.authStorage)).toBe("sk-configured");
		const saved = JSON.parse(readFileSync(modelsPath, "utf-8"));
		expect(saved.providers.tokenin.apiKey).toBeUndefined();
		expect(saved.providers.other.apiKey).toBe("sk-other");
		expect(fakeCtx.ui.confirm).not.toHaveBeenCalled();
	});

	it("does not migrate models.json when it has no tokenin key", async () => {
		writeFileSync(modelsPath, JSON.stringify({ providers: { other: { apiKey: "sk-other" } } }), "utf-8");
		confirmValue = false;
		await trigger();
		expect(getStoredTokenInApiKey(fakeCtx.modelRegistry.authStorage)).toBeUndefined();
		expect(JSON.parse(readFileSync(modelsPath, "utf-8")).providers.other.apiKey).toBe("sk-other");
		expect(fakeCtx.ui.confirm).toHaveBeenCalled();
	});

	it("skips prompt when user declines and writes marker", async () => {
		writeFileSync(modelsPath, JSON.stringify({ providers: { tokenin: { apiKey: PLACEHOLDER_API_KEY } } }), "utf-8");
		confirmValue = false;
		await trigger();
		expect(fakeCtx.ui.confirm).toHaveBeenCalled();
		expect(existsSync(markerPath)).toBe(true);
		expect(JSON.parse(readFileSync(modelsPath, "utf-8")).providers.tokenin.apiKey).toBe(PLACEHOLDER_API_KEY);
	});

	it("writes token to auth storage and refreshes registry when user accepts", async () => {
		writeFileSync(modelsPath, JSON.stringify({ providers: { tokenin: { apiKey: PLACEHOLDER_API_KEY } } }), "utf-8");
		confirmValue = true;
		inputValue = "  sk-live-token  ";
		await trigger();
		expect(fakeCtx.ui.confirm).toHaveBeenCalled();
		expect(fakeCtx.ui.input).toHaveBeenCalled();
		expect(existsSync(markerPath)).toBe(true);
		expect(getStoredTokenInApiKey(fakeCtx.modelRegistry.authStorage)).toBe("sk-live-token");
		expect(JSON.parse(readFileSync(modelsPath, "utf-8")).providers.tokenin.apiKey).toBe(PLACEHOLDER_API_KEY);
		expect(fakeCtx.modelRegistry.refresh).toHaveBeenCalled();
	});

	it("does not mark complete when pasted token is invalid", async () => {
		writeFileSync(modelsPath, JSON.stringify({ providers: { tokenin: { apiKey: PLACEHOLDER_API_KEY } } }), "utf-8");
		confirmValue = true;
		inputValue = "not-starting-with-sk";
		await trigger();
		expect(existsSync(markerPath)).toBe(false);
		expect(JSON.parse(readFileSync(modelsPath, "utf-8")).providers.tokenin.apiKey).toBe(PLACEHOLDER_API_KEY);
	});

	it("onboarding seeds tokenin-auth.json with active account", async () => {
		writeFileSync(modelsPath, JSON.stringify({ providers: { tokenin: { apiKey: PLACEHOLDER_API_KEY } } }), "utf-8");
		confirmValue = true;
		inputValue = "sk-onboard-token";
		await trigger();
		const auth = readTokenInAuth(authPath);
		expect(auth.accounts).toHaveLength(1);
		expect(auth.accounts[0].apiKey).toBe("sk-onboard-token");
		expect(auth.activeId).toBe("sk-onboard-token");
	});

	it("onboarding skips when the marker exists", async () => {
		writeFileSync(markerPath, "1", "utf-8");
		const { pi, handlers } = makeApi();
		tokenInOnboardingExtension(pi);
		const handler = handlers["session_start"] as any;
		await handler({ type: "session_start", reason: "startup" }, fakeCtx);
		expect(fakeCtx.ui.confirm).not.toHaveBeenCalled();
	});

	it("onboarding skips when the skip env var is set", async () => {
		process.env.SELESAI_SKIP_TOKENIN_ONBOARDING = "1";
		try {
			const { pi, handlers } = makeApi();
			tokenInOnboardingExtension(pi);
			const handler = handlers["session_start"] as any;
			await handler({ type: "session_start", reason: "startup" }, fakeCtx);
			expect(fakeCtx.ui.confirm).not.toHaveBeenCalled();
		} finally {
			delete process.env.SELESAI_SKIP_TOKENIN_ONBOARDING;
		}
	});

	it("onboarding ignores non-startup sessions", async () => {
		const { pi, handlers } = makeApi();
		tokenInOnboardingExtension(pi);
		const handler = handlers["session_start"] as any;
		await handler({ type: "session_start", reason: "reload" }, fakeCtx);
		expect(fakeCtx.ui.confirm).not.toHaveBeenCalled();
	});

	it("onboarding defers without UI", async () => {
		fakeCtx.hasUI = false;
		const { pi, handlers } = makeApi();
		tokenInOnboardingExtension(pi);
		const handler = handlers["session_start"] as any;
		await handler({ type: "session_start", reason: "startup" }, fakeCtx);
		expect(existsSync(markerPath)).toBe(false);
	});

	it("onboarding notifies when the browser fails to open", async () => {
		const { pi, handlers } = makeApi({ code: 1, stdout: "", stderr: "no browser" });
		tokenInOnboardingExtension(pi);
		const handler = handlers["session_start"] as any;
		confirmValue = true;
		inputValue = "sk-token";
		await handler({ type: "session_start", reason: "startup" }, fakeCtx);
		expect(notifications.some((n) => n.message.includes("Could not open browser"))).toBe(true);
		expect(notifications.some((n) => n.message.includes("Open this URL manually"))).toBe(true);
	});

	it("onboarding tolerates a refresh failure after saving", async () => {
		fakeCtx.modelRegistry.refresh = vi.fn(async () => {
			throw new Error("refresh failed");
		});
		confirmValue = true;
		inputValue = "sk-token";
		await trigger();
		expect(existsSync(markerPath)).toBe(true);
		expect(notifications.some((n) => n.message.includes("Token-In token saved"))).toBe(true);
	});

	it("onboarding migrates a legacy models.json token with baseUrl", async () => {
		writeFileSync(modelsPath, JSON.stringify({ providers: { tokenin: { apiKey: "sk-legacy", baseUrl: "https://token.in" } } }), "utf-8");
		await trigger();
		expect(getStoredTokenInApiKey(fakeCtx.modelRegistry.authStorage)).toBe("sk-legacy");
		const auth = readTokenInAuth(authPath);
		expect(auth.accounts[0].baseUrl).toBe("https://token.in");
		expect(auth.activeId).toBe("sk-legacy");
	});

	it("onboarding marks complete when the user declines", async () => {
		confirmValue = false;
		await trigger();
		expect(existsSync(markerPath)).toBe(true);
		expect(notifications.some((n) => n.message.includes("You can add your Token-In token later"))).toBe(true);
	});

	it("onboarding with no models.json still prompts and saves", async () => {
		confirmValue = true;
		inputValue = "sk-fresh";
		await trigger();
		expect(existsSync(markerPath)).toBe(true);
		expect(getStoredTokenInApiKey(fakeCtx.modelRegistry.authStorage)).toBe("sk-fresh");
	});

	it("onboarding with a non-string tokenin apiKey prompts again", async () => {
		writeFileSync(modelsPath, JSON.stringify({ providers: { tokenin: { apiKey: 42 } } }), "utf-8");
		confirmValue = true;
		inputValue = "sk-new";
		await trigger();
		expect(getStoredTokenInApiKey(fakeCtx.modelRegistry.authStorage)).toBe("sk-new");
	});

	it("onboarding with a non-object tokenin provider prompts again", async () => {
		writeFileSync(modelsPath, JSON.stringify({ providers: { tokenin: "not-an-object" } }), "utf-8");
		confirmValue = true;
		inputValue = "sk-new";
		await trigger();
		expect(getStoredTokenInApiKey(fakeCtx.modelRegistry.authStorage)).toBe("sk-new");
	});

	it("onboarding with a non-object providers map prompts again", async () => {
		writeFileSync(modelsPath, JSON.stringify({ providers: "not-an-object" }), "utf-8");
		confirmValue = true;
		inputValue = "sk-new";
		await trigger();
		expect(getStoredTokenInApiKey(fakeCtx.modelRegistry.authStorage)).toBe("sk-new");
	});

	it("onboarding with a non-object models file prompts again", async () => {
		writeFileSync(modelsPath, JSON.stringify("not-an-object"), "utf-8");
		confirmValue = true;
		inputValue = "sk-new";
		await trigger();
		expect(getStoredTokenInApiKey(fakeCtx.modelRegistry.authStorage)).toBe("sk-new");
	});

	it("onboarding with a non-string baseUrl omits it", async () => {
		writeFileSync(modelsPath, JSON.stringify({ providers: { tokenin: { apiKey: "sk-legacy", baseUrl: 42 } } }), "utf-8");
		await trigger();
		const auth = readTokenInAuth(authPath);
		expect(auth.accounts[0].baseUrl).toBeUndefined();
	});

	it("onboarding notifies with a stringified error when the browser throws a non-Error", async () => {
		const { pi, handlers } = makeApi();
		(pi.exec as any).mockRejectedValue("plain string failure");
		tokenInOnboardingExtension(pi);
		const handler = handlers["session_start"] as any;
		confirmValue = true;
		inputValue = "sk-token";
		await handler({ type: "session_start", reason: "startup" }, fakeCtx);
		expect(notifications.some((n) => n.message.includes("plain string failure"))).toBe(true);
	});

	it("onboarding uses xdg-open on non-darwin non-win32 platforms", async () => {
		const original = process.platform;
		Object.defineProperty(process, "platform", { value: "linux" });
		try {
			const { pi, handlers } = makeApi();
			tokenInOnboardingExtension(pi);
			const handler = handlers["session_start"] as any;
			confirmValue = true;
			inputValue = "sk-token";
			await handler({ type: "session_start", reason: "startup" }, fakeCtx);
			const execCalls = (pi.exec as any).mock.calls;
			expect(execCalls[0][0]).toBe("xdg-open");
			expect(execCalls[0][1]).toEqual([TOKEN_IN_DASHBOARD_URL]);
		} finally {
			Object.defineProperty(process, "platform", { value: original });
		}
	});

	it("onboarding uses cmd start on win32", async () => {
		const original = process.platform;
		Object.defineProperty(process, "platform", { value: "win32" });
		try {
			const { pi, handlers } = makeApi();
			tokenInOnboardingExtension(pi);
			const handler = handlers["session_start"] as any;
			confirmValue = true;
			inputValue = "sk-token";
			await handler({ type: "session_start", reason: "startup" }, fakeCtx);
			const execCalls = (pi.exec as any).mock.calls;
			expect(execCalls[0][0]).toBe("cmd");
			expect(execCalls[0][1]).toEqual(["/c", "start", "", TOKEN_IN_DASHBOARD_URL]);
		} finally {
			Object.defineProperty(process, "platform", { value: original });
		}
	});

	it("onboarding uses open on darwin", async () => {
		const original = process.platform;
		Object.defineProperty(process, "platform", { value: "darwin" });
		try {
			const { pi, handlers } = makeApi();
			tokenInOnboardingExtension(pi);
			const handler = handlers["session_start"] as any;
			confirmValue = true;
			inputValue = "sk-token";
			await handler({ type: "session_start", reason: "startup" }, fakeCtx);
			const execCalls = (pi.exec as any).mock.calls;
			expect(execCalls[0][0]).toBe("open");
			expect(execCalls[0][1]).toEqual([TOKEN_IN_DASHBOARD_URL]);
		} finally {
			Object.defineProperty(process, "platform", { value: original });
		}
	});

	it("onboarding throws when the browser command fails with empty output", async () => {
		const { pi, handlers } = makeApi({ code: 1, stdout: "", stderr: "" });
		tokenInOnboardingExtension(pi);
		const handler = handlers["session_start"] as any;
		confirmValue = true;
		inputValue = "sk-token";
		await handler({ type: "session_start", reason: "startup" }, fakeCtx);
		expect(notifications.some((n) => n.message.includes("unknown error"))).toBe(true);
	});

	it("onboarding throws when the browser command fails with stdout only", async () => {
		const { pi, handlers } = makeApi({ code: 1, stdout: "stdout msg", stderr: "" });
		tokenInOnboardingExtension(pi);
		const handler = handlers["session_start"] as any;
		confirmValue = true;
		inputValue = "sk-token";
		await handler({ type: "session_start", reason: "startup" }, fakeCtx);
		expect(notifications.some((n) => n.message.includes("stdout msg"))).toBe(true);
	});

	it("onboarding with a stored key and no models.json skips migration", async () => {
		fakeCtx.modelRegistry.authStorage.set("tokenin", { type: "api_key", key: "sk-stored" });
		await trigger();
		expect(existsSync(markerPath)).toBe(true);
		expect(getStoredTokenInApiKey(fakeCtx.modelRegistry.authStorage)).toBe("sk-stored");
	});

	it("onboarding with a stored key and legacy models key keeps the stored key", async () => {
		fakeCtx.modelRegistry.authStorage.set("tokenin", { type: "api_key", key: "sk-stored" });
		writeFileSync(modelsPath, JSON.stringify({ providers: { tokenin: { apiKey: "sk-legacy" } } }), "utf-8");
		await trigger();
		expect(existsSync(markerPath)).toBe(true);
		expect(getStoredTokenInApiKey(fakeCtx.modelRegistry.authStorage)).toBe("sk-stored");
		// The stored key wins; the legacy models key is left untouched.
		const saved = JSON.parse(readFileSync(modelsPath, "utf-8"));
		expect(saved.providers.tokenin.apiKey).toBe("sk-legacy");
	});

	it("onboarding with a stored key and no models file skips the write", async () => {
		fakeCtx.modelRegistry.authStorage.set("tokenin", { type: "api_key", key: "sk-stored" });
		await trigger();
		expect(existsSync(markerPath)).toBe(true);
		expect(existsSync(modelsPath)).toBe(false);
	});
});

describe("/tokenin command", () => {
	let dir: string;
	let modelsPath: string;
	let authPath: string;
	let fakeCtx: ExtensionCommandContext;
	let confirmValue = false;
	let inputValue: string | undefined = undefined;
	let selectValue: string | undefined = undefined;
	const notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "tokenin-cmd-"));
		modelsPath = join(dir, "models.json");
		authPath = join(dir, "tokenin-auth.json");
		writeTokenInAuth({ accounts: [], activeId: null }, authPath);
		confirmValue = false;
		inputValue = undefined;
		selectValue = undefined;
		notifications.length = 0;

		fakeCtx = {
			hasUI: true,
			ui: {
				confirm: vi.fn(async () => confirmValue),
				input: vi.fn(async () => inputValue),
				select: vi.fn(async () => selectValue),
				notify: vi.fn((message, type) => {
					notifications.push({ message, type });
				}),
			} as unknown as ExtensionContext["ui"],
			modelRegistry: {
				refresh: vi.fn(),
				authStorage: AuthStorage.create(join(dir, "auth.json")),
			} as unknown as ExtensionContext["modelRegistry"],
			waitForIdle: vi.fn(async () => {}),
		} as unknown as ExtensionCommandContext;

		process.env.SELESAI_CODING_AGENT_DIR = dir;
		process.env.PI_CODING_AGENT_DIR = dir;
	});

	afterEach(() => {
		delete process.env.SELESAI_CODING_AGENT_DIR;
		delete process.env.PI_CODING_AGENT_DIR;
		rmSync(dir, { recursive: true, force: true });
	});

	function makeApi(execResult?: { code: number; stdout: string; stderr: string }): {
		pi: ExtensionAPI;
		commands: Map<string, { description?: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>;
	} {
		const commands = new Map<string, { description?: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>();
		const pi = {
			on: vi.fn(),
			exec: vi.fn(async () => execResult ?? { code: 0, stdout: "", stderr: "" }),
			registerCommand: vi.fn((name: string, options: { description?: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }) => {
				commands.set(name, options);
			}),
			registerProvider: vi.fn(),
		} as unknown as ExtensionAPI;
		return { pi, commands };
	}

	async function runCommand(args: string): Promise<void> {
		const { pi, commands } = makeApi();
		tokenInOnboardingExtension(pi);
		const cmd = commands.get("tokenin");
		expect(cmd).toBeDefined();
		await cmd!.handler(args, fakeCtx);
	}

	it("registers a 'tokenin' command", () => {
		const { pi, commands } = makeApi();
		tokenInOnboardingExtension(pi);
		expect(commands.has("tokenin")).toBe(true);
	});

	it("/tokenin getArgumentCompletions returns subcommands and filters by prefix", () => {
		const { pi, commands } = makeApi();
		tokenInOnboardingExtension(pi);
		const cmd = commands.get("tokenin") as any;
		expect(cmd.getArgumentCompletions).toBeDefined();
		const all = cmd.getArgumentCompletions("");
		expect(all).toHaveLength(4);
		expect(all.map((i: any) => i.value).sort()).toEqual(["add", "remove", "switch", "usage"]);
		expect(cmd.getArgumentCompletions("sw")).toHaveLength(1);
		expect(cmd.getArgumentCompletions("sw")[0].value).toBe("switch");
		expect(cmd.getArgumentCompletions("us")).toHaveLength(1);
		expect(cmd.getArgumentCompletions("us")[0].value).toBe("usage");
		expect(cmd.getArgumentCompletions("xyz")).toBeNull();
	});

	it("shows usage for empty or unknown subcommand", async () => {
		await runCommand("");
		expect(notifications.some((n) => n.message.includes("Usage: /tokenin"))).toBe(true);

		notifications.length = 0;
		await runCommand("bogus");
		expect(notifications.some((n) => n.message.includes("Usage: /tokenin"))).toBe(true);
	});

	it("/tokenin add stores first account in auth storage", async () => {
		inputValue = "sk-first-token";
		await runCommand("add");
		expect(existsSync(modelsPath)).toBe(false);
		expect(getStoredTokenInApiKey(fakeCtx.modelRegistry.authStorage)).toBe("sk-first-token");
		const auth = readTokenInAuth(authPath);
		expect(auth.accounts).toHaveLength(1);
		expect(auth.activeId).toBe("sk-first-token");
		expect(fakeCtx.modelRegistry.refresh).toHaveBeenCalled();
	});

	it("/tokenin add does not activate a second account", async () => {
		// Seed first account as active
		saveTokenInAccount("sk-first", { setActive: true });
		fakeCtx.modelRegistry.authStorage.set("tokenin", { type: "api_key", key: "sk-first" });

		inputValue = "sk-second-token";
		await runCommand("add");

		expect(getStoredTokenInApiKey(fakeCtx.modelRegistry.authStorage)).toBe("sk-first");
		const auth = readTokenInAuth(authPath);
		expect(auth.accounts).toHaveLength(2);
		expect(auth.activeId).toBe("sk-first");
		expect(notifications.some((n) => n.message.includes("Account added"))).toBe(true);
	});

	it("/tokenin usage notifies quota from /key/info", async () => {
		fakeCtx.modelRegistry.authStorage.set("tokenin", { type: "api_key", key: "sk-active" });
		saveTokenInAccount("sk-active", { setActive: true });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				json: async () => ({
					info: { spend: 2.5, max_budget: 10, budget_reset_at: new Date(Date.now() + 86_400_000).toISOString() },
				}),
			})),
		);
		try {
			await runCommand("usage");
			expect(notifications.some((n) => n.message.includes("Spent $2.50 of $10.00 budget"))).toBe(true);
			expect(notifications.some((n) => n.message.includes("resets in"))).toBe(true);
			expect(notifications.some((n) => n.message.includes("╭─ Token-In usage"))).toBe(true);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("/tokenin usage notifies when no active token", async () => {
		await runCommand("usage");
		expect(notifications.some((n) => n.message.includes("No active Token-In token"))).toBe(true);
	});

	it("/tokenin usage notifies when the endpoint fails", async () => {
		fakeCtx.modelRegistry.authStorage.set("tokenin", { type: "api_key", key: "sk-active" });
		saveTokenInAccount("sk-active", { setActive: true });
		vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401 })));
		try {
			await runCommand("usage");
			expect(notifications.some((n) => n.message.includes("Could not fetch Token-In usage: Token-In usage endpoint returned HTTP 401"))).toBe(true);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("/tokenin usage uses the account baseUrl when saved", async () => {
		fakeCtx.modelRegistry.authStorage.set("tokenin", { type: "api_key", key: "sk-active" });
		saveTokenInAccount("sk-active", { baseUrl: "https://custom.example/v1", setActive: true });
		const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ info: { spend: 1 } }) }));
		vi.stubGlobal("fetch", fetchMock);
		try {
			await runCommand("usage");
			expect(fetchMock.mock.calls[0][0]).toBe("https://custom.example/key/info");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("/tokenin switch updates auth storage and activeId", async () => {
		// Seed two accounts
		saveTokenInAccount("sk-first", { setActive: true });
		saveTokenInAccount("sk-second");
		fakeCtx.modelRegistry.authStorage.set("tokenin", { type: "api_key", key: "sk-first" });

		const auth = readTokenInAuth(authPath);
		const secondLabel = auth.accounts.find((a) => a.id === "sk-second")!.label;
		selectValue = secondLabel;

		await runCommand("switch");

		expect(getStoredTokenInApiKey(fakeCtx.modelRegistry.authStorage)).toBe("sk-second");
		const savedAuth = readTokenInAuth(authPath);
		expect(savedAuth.activeId).toBe("sk-second");
		expect(fakeCtx.modelRegistry.refresh).toHaveBeenCalled();
		expect(notifications.some((n) => n.message.includes("Switched"))).toBe(true);
	});

	it("/tokenin switch notifies when no saved accounts", async () => {
		await runCommand("switch");
		expect(notifications.some((n) => n.message.includes("No saved accounts"))).toBe(true);
	});

	it("/tokenin remove blocks removal of active account", async () => {
		saveTokenInAccount("sk-active", { setActive: true });
		saveTokenInAccount("sk-inactive");
		fakeCtx.modelRegistry.authStorage.set("tokenin", { type: "api_key", key: "sk-active" });

		const auth = readTokenInAuth(authPath);
		const activeLabel = auth.accounts.find((a) => a.id === "sk-active")!.label;
		selectValue = activeLabel;

		await runCommand("remove");

		expect(notifications.some((n) => n.message.includes("Cannot remove the active account"))).toBe(true);
		// Account still present
		expect(readTokenInAuth(authPath).accounts).toHaveLength(2);
	});

	it("/tokenin remove removes inactive account after confirm", async () => {
		saveTokenInAccount("sk-active", { setActive: true });
		saveTokenInAccount("sk-inactive");
		fakeCtx.modelRegistry.authStorage.set("tokenin", { type: "api_key", key: "sk-active" });

		const auth = readTokenInAuth(authPath);
		const inactiveLabel = auth.accounts.find((a) => a.id === "sk-inactive")!.label;
		selectValue = inactiveLabel;
		confirmValue = true;

		await runCommand("remove");

		const savedAuth = readTokenInAuth(authPath);
		expect(savedAuth.accounts).toHaveLength(1);
		expect(savedAuth.accounts.find((a) => a.id === "sk-inactive")).toBeUndefined();
		expect(notifications.some((n) => n.message.includes("Account removed"))).toBe(true);
		expect(getStoredTokenInApiKey(fakeCtx.modelRegistry.authStorage)).toBe("sk-active");
	});

	it("/tokenin remove does not remove when confirm is declined", async () => {
		saveTokenInAccount("sk-active", { setActive: true });
		saveTokenInAccount("sk-inactive");
		fakeCtx.modelRegistry.authStorage.set("tokenin", { type: "api_key", key: "sk-active" });

		const auth = readTokenInAuth(authPath);
		const inactiveLabel = auth.accounts.find((a) => a.id === "sk-inactive")!.label;
		selectValue = inactiveLabel;
		confirmValue = false;

		await runCommand("remove");

		expect(readTokenInAuth(authPath).accounts).toHaveLength(2);
	});

	it("/tokenin add guards no-UI", async () => {
		fakeCtx.hasUI = false;
		inputValue = "sk-token";
		await runCommand("add");
		expect(notifications.some((n) => n.message.includes("interactive mode"))).toBe(true);
	});

	it("/tokenin add notifies when the browser fails to open", async () => {
		const { pi, commands } = makeApi({ code: 1, stdout: "", stderr: "no browser" });
		tokenInOnboardingExtension(pi);
		const cmd = commands.get("tokenin");
		inputValue = "sk-token";
		await cmd!.handler("add", fakeCtx);
		expect(notifications.some((n) => n.message.includes("Could not open browser"))).toBe(true);
		expect(notifications.some((n) => n.message.includes("Open this URL manually"))).toBe(true);
	});

	it("/tokenin add stringifies a non-Error browser failure", async () => {
		const { pi, commands } = makeApi();
		(pi.exec as any).mockRejectedValue("plain string failure");
		tokenInOnboardingExtension(pi);
		const cmd = commands.get("tokenin");
		inputValue = "sk-token";
		await cmd!.handler("add", fakeCtx);
		expect(notifications.some((n) => n.message.includes("plain string failure"))).toBe(true);
	});

	it("/tokenin add notifies when the pasted token is invalid", async () => {
		inputValue = "not-a-token";
		await runCommand("add");
		expect(notifications.some((n) => n.message.includes("Token must start with 'sk-'"))).toBe(true);
	});

	it("/tokenin switch cancels when the user picks nothing", async () => {
		saveTokenInAccount("sk-first", { setActive: true });
		selectValue = undefined;
		await runCommand("switch");
		expect(notifications.some((n) => n.message.includes("Switched"))).toBe(false);
	});

	it("/tokenin switch tolerates a refresh failure", async () => {
		saveTokenInAccount("sk-first", { setActive: true });
		saveTokenInAccount("sk-second");
		fakeCtx.modelRegistry.authStorage.set("tokenin", { type: "api_key", key: "sk-first" });
		fakeCtx.modelRegistry.refresh = vi.fn(async () => {
			throw new Error("refresh failed");
		});
		const auth = readTokenInAuth(authPath);
		const secondLabel = auth.accounts.find((a) => a.id === "sk-second")!.label;
		selectValue = secondLabel;
		await runCommand("switch");
		expect(notifications.some((n) => n.message.includes("Switched"))).toBe(true);
	});

	it("/tokenin remove cancels when the user picks nothing", async () => {
		saveTokenInAccount("sk-active", { setActive: true });
		selectValue = undefined;
		await runCommand("remove");
		expect(notifications.some((n) => n.message.includes("Account removed"))).toBe(false);
	});

	it("/tokenin remove notifies when there are no saved accounts", async () => {
		await runCommand("remove");
		expect(notifications.some((n) => n.message.includes("No saved accounts"))).toBe(true);
	});

	it("/tokenin switch guards no-UI", async () => {
		fakeCtx.hasUI = false;
		await runCommand("switch");
		expect(notifications.some((n) => n.message.includes("interactive mode"))).toBe(true);
	});

	it("/tokenin remove guards no-UI", async () => {
		fakeCtx.hasUI = false;
		await runCommand("remove");
		expect(notifications.some((n) => n.message.includes("interactive mode"))).toBe(true);
	});

	it("readTokenInAuth filters invalid accounts", async () => {
		const dir = mkdtempSync(join(tmpdir(), "tokenin-filter-"));
		const authPath = join(dir, "tokenin-auth.json");
		writeFileSync(authPath, JSON.stringify({ accounts: [{ id: "sk-ok", apiKey: "sk-ok" }, { id: "no-key" }, "junk"], activeId: "sk-ok" }), "utf-8");
		expect(readTokenInAuth(authPath)).toEqual({ accounts: [{ id: "sk-ok", apiKey: "sk-ok" }], activeId: "sk-ok" });
		rmSync(dir, { recursive: true, force: true });
	});

	it("readTokenInAuth returns defaults for non-object activeId", async () => {
		const dir = mkdtempSync(join(tmpdir(), "tokenin-activeid-"));
		const authPath = join(dir, "tokenin-auth.json");
		writeFileSync(authPath, JSON.stringify({ accounts: [], activeId: 42 }), "utf-8");
		expect(readTokenInAuth(authPath)).toEqual({ accounts: [], activeId: null });
		rmSync(dir, { recursive: true, force: true });
	});

	it("saveTokenInAccount preserves the existing label on re-save", async () => {
		const dir = mkdtempSync(join(tmpdir(), "tokenin-label-"));
		const authPath = join(dir, "tokenin-auth.json");
		saveTokenInAccount("sk-token1", { setActive: true }, authPath);
		const first = readTokenInAuth(authPath).accounts[0];
		expect(first.label).toBe("sk-…" + "sk-token1".slice(-8));
		saveTokenInAccount("sk-token1", {}, authPath);
		const second = readTokenInAuth(authPath).accounts[0];
		expect(second.label).toBe(first.label);
		rmSync(dir, { recursive: true, force: true });
	});
});

describe("Token-In auto-failover and key rotation", () => {
	const model: Model<any> = {
		id: "celestial-pro",
		name: "Celestial Pro",
		api: "openai-completions",
		provider: "tokenin",
		baseUrl: "https://lite.andlet.me/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100_000,
		maxTokens: 4000,
	};
	const context: Context = { messages: [{ role: "user", content: "hello" }] };

	beforeEach(() => {
		clearTokenInCooldowns();
	});

	afterEach(() => {
		clearTokenInCooldowns();
	});

	it("isRotateableTokenInError detects 401, 429, and budget/quota failures", () => {
		expect(isRotateableTokenInError("401 Unauthorized")).toBe(true);
		expect(isRotateableTokenInError("Invalid API Key: AuthenticationError")).toBe(true);
		expect(isRotateableTokenInError("429 Too Many Requests (rate limit exceeded)")).toBe(true);
		expect(isRotateableTokenInError("LiteLLM: Budget has been exceeded for key")).toBe(true);
		expect(isRotateableTokenInError("Key spend (10.5) exceeds max_budget (10.0)")).toBe(true);
		expect(isRotateableTokenInError("insufficient_quota error from upstream")).toBe(true);
		expect(isRotateableTokenInError("Out of credits")).toBe(true);
		expect(isRotateableTokenInError(new Error("HTTP 401: Unauthorized access"))).toBe(true);
		expect(isRotateableTokenInError({ errorMessage: "429: rate_limit_exceeded" })).toBe(true);

		expect(isRotateableTokenInError(null)).toBe(false);
		expect(isRotateableTokenInError(undefined)).toBe(false);
		expect(isRotateableTokenInError("Context window exceeded")).toBe(false);
		expect(isRotateableTokenInError(new Error("Network timeout connection refused"))).toBe(false);
	});

	it("cooldown tracking sets and checks expiration properly", () => {
		expect(isTokenInOnCooldown("sk-1")).toBe(false);
		setTokenInCooldown("sk-1", 1000, 100);
		expect(isTokenInOnCooldown("sk-1", 500)).toBe(true);
		expect(isTokenInOnCooldown("sk-1", 1100)).toBe(false);
		expect(isTokenInOnCooldown("sk-1", 1200)).toBe(false);
	});

	it("createTokenInStreamSimple rotates from failing account to healthy account on 429 event", async () => {
		const dir = mkdtempSync(join(tmpdir(), "tokenin-rot-"));
		const authPath = join(dir, "tokenin-auth.json");
		writeTokenInAuth({ accounts: [], activeId: null }, authPath);
		saveTokenInAccount("sk-failing", { setActive: true }, authPath);
		saveTokenInAccount("sk-working", {}, authPath);

		const calls: string[] = [];
		const requestHeaders: Array<Record<string, string | null> | undefined> = [];
		const requestStream = vi.fn((m, c, options) => {
			calls.push(options?.apiKey!);
			requestHeaders.push(options?.headers);
			const stream = createAssistantMessageEventStream();
			if (options?.apiKey === "sk-failing") {
				setTimeout(() => {
					stream.push({ type: "start", partial: fauxAssistantMessage({ stopReason: "pending" }) });
					stream.push({
						type: "error",
						reason: "error",
						error: fauxAssistantMessage({ stopReason: "error", errorMessage: "429 Rate limit exceeded" }),
					});
					stream.end();
				}, 5);
			} else {
				setTimeout(() => {
					stream.push({ type: "text_delta", contentIndex: 0, delta: "success from backup" });
					stream.push({
						type: "done",
						message: fauxAssistantMessage({ content: [{ type: "text", text: "success from backup" }] }),
					});
					stream.end();
				}, 5);
			}
			return stream;
		});

		try {
			const rotations: Array<{ from: string; to: string; reason: string }> = [];
			const authStorage = AuthStorage.inMemory();
			const streamSimple = createTokenInStreamSimple({
				authPath,
				getAuthStorage: () => authStorage,
				streamSimple: requestStream,
				onRotate: (from, to, reason) => rotations.push({ from: from.id, to: to.id, reason }),
			});

			expect(readTokenInAuth(authPath).accounts.map((account) => account.apiKey)).toEqual(["sk-failing", "sk-working"]);
			const stream = streamSimple(model, context, {
				headers: { authorization: "Bearer stale-key", "X-Test": "preserved" },
			});
			const events: AssistantMessageEvent[] = [];
			for await (const ev of stream) {
				events.push(ev);
			}

			expect(calls).toEqual(["sk-failing", "sk-working"]);
			expect(requestHeaders).toEqual([
				{ Authorization: "Bearer sk-failing", "X-Test": "preserved" },
				{ Authorization: "Bearer sk-working", "X-Test": "preserved" },
			]);
			expect(rotations.length).toBe(1);
			expect(rotations[0].from).toBe("sk-failing");
			expect(rotations[0].to).toBe("sk-working");
			expect(isTokenInOnCooldown("sk-failing")).toBe(true);
			expect(events.some((e) => e.type === "text_delta" && (e as any).delta === "success from backup")).toBe(true);

			// Active account in tokenin-auth.json should be updated to sk-working
			const updatedAuth = readTokenInAuth(authPath);
			expect(updatedAuth.activeId).toBe("sk-working");
			expect(getStoredTokenInApiKey(authStorage)).toBe("sk-working");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("createTokenInStreamSimple rotates when stream creation throws a rotateable error", async () => {
		const dir = mkdtempSync(join(tmpdir(), "tokenin-rot-throw-"));
		const authPath = join(dir, "tokenin-auth.json");
		writeTokenInAuth({ accounts: [], activeId: null }, authPath);
		saveTokenInAccount("sk-bad", { setActive: true }, authPath);
		saveTokenInAccount("sk-good", {}, authPath);

		const calls: string[] = [];
		const requestStream = vi.fn((m, c, options) => {
			calls.push(options?.apiKey!);
			if (options?.apiKey === "sk-bad") {
				throw new Error("401 Unauthorized: Invalid API Key");
			}
			const stream = createAssistantMessageEventStream();
			setTimeout(() => {
				stream.push({ type: "text_delta", contentIndex: 0, delta: "recovered" });
				stream.push({ type: "done", message: fauxAssistantMessage({ content: [{ type: "text", text: "recovered" }] }) });
				stream.end();
			}, 5);
			return stream;
		});

		try {
			const streamSimple = createTokenInStreamSimple({ authPath, streamSimple: requestStream });
			const stream = streamSimple(model, context, {});
			const events: AssistantMessageEvent[] = [];
			for await (const ev of stream) {
				events.push(ev);
			}

			expect(calls).toEqual(["sk-bad", "sk-good"]);
			expect(isTokenInOnCooldown("sk-bad")).toBe(true);
			expect(events.some((e) => e.type === "text_delta" && (e as any).delta === "recovered")).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("createTokenInStreamSimple returns original error when all accounts are exhausted", async () => {
		const dir = mkdtempSync(join(tmpdir(), "tokenin-rot-exhaust-"));
		const authPath = join(dir, "tokenin-auth.json");
		writeTokenInAuth({ accounts: [], activeId: null }, authPath);
		saveTokenInAccount("sk-1", { setActive: true }, authPath);
		saveTokenInAccount("sk-2", {}, authPath);

		const requestStream = vi.fn((m, c, options) => {
			const stream = createAssistantMessageEventStream();
			setTimeout(() => {
				stream.push({
					type: "error",
					reason: "error",
					error: fauxAssistantMessage({ stopReason: "error", errorMessage: `429 exhausted for ${options?.apiKey}` }),
				});
				stream.end();
			}, 5);
			return stream;
		});

		try {
			const streamSimple = createTokenInStreamSimple({ authPath, streamSimple: requestStream });
			const stream = streamSimple(model, context, {});
			const events: AssistantMessageEvent[] = [];
			for await (const ev of stream) {
				events.push(ev);
			}

			expect(events.length).toBe(1);
			expect(events[0].type).toBe("error");
			const errObj = (events[0] as any).error;
			const errMsg = errObj.errorMessage ?? errObj.content?.[0]?.errorMessage;
			expect(errMsg).toContain("429 exhausted for sk-2");
			expect(isTokenInOnCooldown("sk-1")).toBe(true);
			expect(isTokenInOnCooldown("sk-2")).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("createTokenInStreamSimple falls back to base implementation when no accounts are configured", async () => {
		const dir = mkdtempSync(join(tmpdir(), "tokenin-rot-empty-"));
		const authPath = join(dir, "tokenin-auth.json");

		const requestStream = vi.fn((m, c, options) => {
			const stream = createAssistantMessageEventStream();
			setTimeout(() => {
				stream.push({ type: "text_delta", contentIndex: 0, delta: "passthrough" });
				stream.push({ type: "done", message: fauxAssistantMessage({ content: [{ type: "text", text: "passthrough" }] }) });
				stream.end();
			}, 5);
			return stream;
		});

		try {
			const streamSimple = createTokenInStreamSimple({ authPath, streamSimple: requestStream });
			const stream = streamSimple(model, context, { apiKey: "sk-env" });
			const events: AssistantMessageEvent[] = [];
			for await (const ev of stream) {
				events.push(ev);
			}

			expect(events.some((e) => e.type === "text_delta" && (e as any).delta === "passthrough")).toBe(true);
			expect(requestStream).toHaveBeenCalled();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("tokenInOnboardingExtension registers tokenin provider with streamSimple", () => {
		const registeredProviders = new Map<string, any>();
		const pi = {
			on: vi.fn(),
			exec: vi.fn(),
			registerCommand: vi.fn(),
			registerProvider: vi.fn((name: string, config: any) => {
				registeredProviders.set(name, config);
			}),
		} as unknown as ExtensionAPI;

		tokenInOnboardingExtension(pi);
		expect(registeredProviders.has("tokenin")).toBe(true);
		const cfg = registeredProviders.get("tokenin");
		expect(cfg.api).toBe("openai-completions");
		expect(typeof cfg.streamSimple).toBe("function");
	});
});
