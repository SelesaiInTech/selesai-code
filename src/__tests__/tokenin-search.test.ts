import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBackendSet } from "../extensions/pi-web-agent/src/backends/factory.ts";
import { DEFAULT_BACKEND_CONFIG } from "../extensions/pi-web-agent/src/backends/config.ts";
import { hasActiveTokenInAccount } from "../extensions/pi-web-agent/src/backends/settings-reader.ts";
import {
	createTokenInSearchTool,
	readActiveTokenInAccount,
	TOKENIN_DEFAULT_BASE_URL,
	TOKENIN_SEARCH_TOOL_NAME,
} from "../extensions/pi-web-agent/src/search/tokenin.ts";

const tmpDirs: string[] = [];

function makeAuthFile(accounts: unknown[], activeId: string | null): string {
	const dir = mkdtempSync(join(tmpdir(), "tokenin-search-"));
	tmpDirs.push(dir);
	const path = join(dir, "tokenin-auth.json");
	writeFileSync(path, JSON.stringify({ accounts, activeId }), "utf-8");
	return path;
}

afterEach(() => {
	for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("readActiveTokenInAccount", () => {
	it("returns the active account from tokenin-auth.json", () => {
		const path = makeAuthFile(
			[
				{ id: "sk-a", label: "A", apiKey: "sk-a" },
				{ id: "sk-b", label: "B", apiKey: "sk-b", baseUrl: "https://custom.example/v1" },
			],
			"sk-b",
		);
		const account = readActiveTokenInAccount(path);
		expect(account?.id).toBe("sk-b");
		expect(account?.baseUrl).toBe("https://custom.example/v1");
	});

	it("returns undefined when no account is active", () => {
		const path = makeAuthFile([{ id: "sk-a", label: "A", apiKey: "sk-a" }], null);
		expect(readActiveTokenInAccount(path)).toBeUndefined();
	});

	it("returns undefined when the file is missing or corrupt", () => {
		expect(readActiveTokenInAccount(join(tmpdir(), "does-not-exist.json"))).toBeUndefined();
		const dir = mkdtempSync(join(tmpdir(), "tokenin-search-"));
		tmpDirs.push(dir);
		const path = join(dir, "tokenin-auth.json");
		writeFileSync(path, "not json", "utf-8");
		expect(readActiveTokenInAccount(path)).toBeUndefined();
	});
});

describe("hasActiveTokenInAccount", () => {
	it("is true when an active account exists", () => {
		const path = makeAuthFile([{ id: "sk-a", label: "A", apiKey: "sk-a" }], "sk-a");
		expect(hasActiveTokenInAccount(path)).toBe(true);
	});

	it("is false when no active account exists", () => {
		const path = makeAuthFile([{ id: "sk-a", label: "A", apiKey: "sk-a" }], null);
		expect(hasActiveTokenInAccount(path)).toBe(false);
	});

	it("is false when the file is missing", () => {
		expect(hasActiveTokenInAccount(join(tmpdir(), "does-not-exist.json"))).toBe(false);
	});
});

describe("createTokenInSearchTool", () => {
	it("calls the LiteLLM search endpoint with the active account key and maps results", async () => {
		const calls: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
		const search = createTokenInSearchTool({
			readAccount: () => ({ id: "sk-a", label: "A", apiKey: "sk-a" }),
			fetchImpl: (async (url: string, init: RequestInit) => {
				calls.push({
					url,
					headers: init.headers as Record<string, string>,
					body: JSON.parse(String(init.body)),
				});
				return new Response(
					JSON.stringify({
						object: "search",
						results: [
							{ title: "One", url: "https://example.com/1", snippet: "first" },
							{ title: "Two", url: "https://example.com/2", snippet: "second" },
						],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}) as typeof fetch,
		});

		const result = await search({ query: "hello world" });

		expect(result.status).toBe("ok");
		expect(result.results).toEqual([
			{ title: "One", url: "https://example.com/1", snippet: "first" },
			{ title: "Two", url: "https://example.com/2", snippet: "second" },
		]);
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe(`${TOKENIN_DEFAULT_BASE_URL}/v1/search/${TOKENIN_SEARCH_TOOL_NAME}`);
		expect(calls[0].headers.Authorization).toBe("Bearer sk-a");
		expect(calls[0].body).toEqual({ query: "hello world", max_results: 10 });
	});

	it("uses the account baseUrl when set", async () => {
		let calledUrl = "";
		const search = createTokenInSearchTool({
			readAccount: () => ({ id: "sk-a", label: "A", apiKey: "sk-a", baseUrl: "https://custom.example/v1/" }),
			fetchImpl: (async (url: string) => {
				calledUrl = url;
				return new Response(JSON.stringify({ results: [{ title: "T", url: "https://e.com", snippet: "s" }] }), {
					status: 200,
				});
			}) as typeof fetch,
		});

		await search({ query: "q" });
		expect(calledUrl).toBe("https://custom.example/v1/v1/search/firecrawl");
	});

	it("errors with a helpful message when no account is configured", async () => {
		const search = createTokenInSearchTool({ readAccount: () => undefined });
		const result = await search({ query: "q" });
		expect(result.status).toBe("error");
		expect(result.error?.code).toBe("BACKEND_CONFIG_INVALID");
		expect(result.error?.message).toContain("/tokenin add");
	});

	it("errors on non-2xx responses", async () => {
		const search = createTokenInSearchTool({
			readAccount: () => ({ id: "sk-a", label: "A", apiKey: "sk-a" }),
			fetchImpl: (async () => new Response("nope", { status: 401 })) as typeof fetch,
		});
		const result = await search({ query: "q" });
		expect(result.status).toBe("error");
		expect(result.error?.code).toBe("FETCH_FAILED");
		expect(result.error?.message).toContain("401");
	});

	it("errors on empty query", async () => {
		const search = createTokenInSearchTool({ readAccount: () => ({ id: "sk-a", label: "A", apiKey: "sk-a" }) });
		const result = await search({ query: "   " });
		expect(result.status).toBe("error");
		expect(result.error?.code).toBe("INVALID_QUERY");
	});
});

describe("default backend wiring", () => {
	it("defaults to the tokenin provider with duckduckgo fallback", () => {
		expect(DEFAULT_BACKEND_CONFIG.search.provider).toBe("tokenin");
		expect(DEFAULT_BACKEND_CONFIG.search.fallback).toBe("duckduckgo");
	});

	it("falls back to duckduckgo when the tokenin provider errors (no account)", async () => {
		const backends = createBackendSet(
			{
				search: { provider: "tokenin", fallback: "duckduckgo" },
				fetch: { provider: "http" },
				headless: { provider: "local-browser" },
			},
			{
				createDuckDuckGoSearch: () =>
					(async () => ({
						status: "ok",
						results: [{ title: "DDG", url: "https://ddg.example", snippet: "s" }],
						metadata: { backend: "duckduckgo", cacheHit: false },
					})) as never,
			},
		);
		const result = await backends.search({ query: "hello" });
		expect(result.status).toBe("ok");
		expect(result.metadata.fallbackFrom).toBe("tokenin");
		expect(result.metadata.backend).toBe("duckduckgo");
	});
});
