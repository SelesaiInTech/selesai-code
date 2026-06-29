import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getTokenInApiKey,
	isPlaceholderToken,
	PLACEHOLDER_API_KEY,
	readModelsJson,
	setTokenInApiKey,
	validateTokenInToken,
} from "../extensions/tokenin-onboarding.ts";

// Import the handler factory for session_start behavior tests.
import tokenInOnboardingExtension from "../extensions/tokenin-onboarding.ts";
import type { ExtensionAPI, ExtensionContext, SessionStartEvent } from "../core/extensions/types.ts";

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

	it("setTokenInApiKey sets apiKey and preserves other providers", () => {
		const models = {
			providers: {
				other: { apiKey: "other-key", baseUrl: "https://other.example" },
				tokenin: { apiKey: PLACEHOLDER_API_KEY, baseUrl: "https://token.in" },
			},
		};
		const updated = setTokenInApiKey(models, "sk-user");
		const providers = updated.providers as Record<string, any>;
		expect(providers.tokenin.apiKey).toBe("sk-user");
		expect(providers.tokenin.baseUrl).toBe("https://token.in");
		expect(providers.other.apiKey).toBe("other-key");
	});

	it("setTokenInApiKey creates providers and tokenin objects if missing", () => {
		const updated = setTokenInApiKey({}, "sk-new");
		expect(updated).toEqual({ providers: { tokenin: { apiKey: "sk-new" } } });
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

describe("tokenin-onboarding extension", () => {
	let dir: string;
	let modelsPath: string;
	let markerPath: string;
	let fakeCtx: ExtensionContext;
	let confirmValue = false;
	let inputValue: string | undefined = undefined;
	const notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "tokenin-ext-"));
		modelsPath = join(dir, "models.json");
		markerPath = join(dir, ".tokenInOnboardingComplete");
		confirmValue = false;
		inputValue = undefined;
		notifications.length = 0;

		fakeCtx = {
			hasUI: true,
			ui: {
				confirm: vi.fn(async () => confirmValue),
				input: vi.fn(async () => inputValue),
				notify: vi.fn((message, type) => {
					notifications.push({ message, type });
				}),
			} as unknown as ExtensionContext["ui"],
			modelRegistry: {
				refresh: vi.fn(),
			} as unknown as ExtensionContext["modelRegistry"],
		} as unknown as ExtensionContext;
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	function makeApi(execResult?: { code: number; stdout: string; stderr: string }): {
		pi: ExtensionAPI;
		handlers: Record<string, unknown>;
	} {
		const handlers: Record<string, unknown> = {};
		const pi = {
			on: vi.fn((event: string, h: unknown) => {
				handlers[event] = h;
			}),
			exec: vi.fn(async () => execResult ?? { code: 0, stdout: "", stderr: "" }),
		} as unknown as ExtensionAPI;
		return { pi, handlers };
	}

	async function trigger(): Promise<void> {
		const { pi, handlers } = makeApi();
		tokenInOnboardingExtension(pi);
		const handler = handlers["session_start"] as ((event: SessionStartEvent, ctx: ExtensionContext) => Promise<void>) | undefined;
		expect(handler).toBeDefined();
		await handler!({ type: "session_start", reason: "startup" } as SessionStartEvent, fakeCtx);
	}

	it("does nothing when apiKey is already configured", async () => {
		writeFileSync(modelsPath, JSON.stringify({ providers: { tokenin: { apiKey: "sk-configured" } } }), "utf-8");
		process.env.SELESAI_CODING_AGENT_DIR = dir;
		await trigger();
		expect(existsSync(markerPath)).toBe(true);
		expect(fakeCtx.ui.confirm).not.toHaveBeenCalled();
		delete process.env.SELESAI_CODING_AGENT_DIR;
	});

	it("skips prompt when user declines and writes marker", async () => {
		writeFileSync(modelsPath, JSON.stringify({ providers: { tokenin: { apiKey: PLACEHOLDER_API_KEY } } }), "utf-8");
		process.env.SELESAI_CODING_AGENT_DIR = dir;
		confirmValue = false;
		await trigger();
		expect(fakeCtx.ui.confirm).toHaveBeenCalled();
		expect(existsSync(markerPath)).toBe(true);
		expect(JSON.parse(readFileSync(modelsPath, "utf-8")).providers.tokenin.apiKey).toBe(PLACEHOLDER_API_KEY);
		delete process.env.SELESAI_CODING_AGENT_DIR;
	});

	it("writes token and refreshes registry when user accepts and pastes valid token", async () => {
		writeFileSync(modelsPath, JSON.stringify({ providers: { tokenin: { apiKey: PLACEHOLDER_API_KEY } } }), "utf-8");
		process.env.SELESAI_CODING_AGENT_DIR = dir;
		confirmValue = true;
		inputValue = "  sk-live-token  ";
		await trigger();
		expect(fakeCtx.ui.confirm).toHaveBeenCalled();
		expect(fakeCtx.ui.input).toHaveBeenCalled();
		expect(existsSync(markerPath)).toBe(true);
		const saved = JSON.parse(readFileSync(modelsPath, "utf-8"));
		expect(saved.providers.tokenin.apiKey).toBe("sk-live-token");
		expect(fakeCtx.modelRegistry.refresh).toHaveBeenCalled();
		delete process.env.SELESAI_CODING_AGENT_DIR;
	});

	it("does not mark complete when pasted token is invalid", async () => {
		writeFileSync(modelsPath, JSON.stringify({ providers: { tokenin: { apiKey: PLACEHOLDER_API_KEY } } }), "utf-8");
		process.env.SELESAI_CODING_AGENT_DIR = dir;
		confirmValue = true;
		inputValue = "not-starting-with-sk";
		await trigger();
		expect(existsSync(markerPath)).toBe(false);
		expect(JSON.parse(readFileSync(modelsPath, "utf-8")).providers.tokenin.apiKey).toBe(PLACEHOLDER_API_KEY);
		delete process.env.SELESAI_CODING_AGENT_DIR;
	});
});
