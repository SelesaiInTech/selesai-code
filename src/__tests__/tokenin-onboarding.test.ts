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
	getActiveTokenInAccountId,
	getStoredTokenInApiKey,
	getTokenInApiKey,
	getTokenInAuthPath,
	isPlaceholderToken,
	PLACEHOLDER_API_KEY,
	readModelsJson,
	readTokenInAuth,
	removeTokenInApiKey,
	saveTokenInAccount,
	validateTokenInToken,
	writeTokenInAuth,
} from "../extensions/tokenin-onboarding.ts";

// Import the handler factory for session_start behavior tests.
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
		expect(all).toHaveLength(3);
		expect(all.map((i: any) => i.value).sort()).toEqual(["add", "remove", "switch"]);
		expect(cmd.getArgumentCompletions("sw")).toHaveLength(1);
		expect(cmd.getArgumentCompletions("sw")[0].value).toBe("switch");
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
});
