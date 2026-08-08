import { describe, expect, it, vi, afterEach } from "vitest";
import {
	applyGrepaiDefaults,
	buildGrepaiToolCommand,
	formatGrepaiSearchResult,
	formatGrepaiTraceResult,
	GREPAI_EMBEDDING_DIMENSIONS,
	GREPAI_EMBEDDING_ENDPOINT,
	GREPAI_EMBEDDING_MODEL,
	GREPAI_PROVIDER,
} from "./index.ts";

describe("grepai embedding defaults", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("uses the default local embedding endpoint when no env overrides are set", () => {
		vi.stubEnv("GREPAI_EMBEDDING_ENDPOINT", undefined);
		vi.stubEnv("GREPAI_EMBEDDING_MODEL", undefined);
		// Constants are read at module load; re-import with a query to re-evaluate.
		return import("./index.ts?defaults=1").then((m) => {
			expect(m.GREPAI_EMBEDDING_ENDPOINT).toBe("http://127.0.0.1:8787/v1");
			expect(m.GREPAI_EMBEDDING_MODEL).toBe("nomic-embed-text-v1.5");
		});
	});

	it("honors GREPAI_EMBEDDING_ENDPOINT/GREPAI_EMBEDDING_MODEL overrides", () => {
		vi.stubEnv("GREPAI_EMBEDDING_ENDPOINT", "http://127.0.0.1:8787/v1");
		vi.stubEnv("GREPAI_EMBEDDING_MODEL", "nomic-embed-text-v1.5");
		return import("./index.ts?overrides=1").then((m) => {
			expect(m.GREPAI_EMBEDDING_ENDPOINT).toBe("http://127.0.0.1:8787/v1");
			expect(m.GREPAI_EMBEDDING_MODEL).toBe("nomic-embed-text-v1.5");
		});
	});

	it("fills missing embedder fields when rewriting a grepai config", () => {
		vi.stubEnv("GREPAI_EMBEDDING_ENDPOINT", "http://127.0.0.1:8787/v1");
		vi.stubEnv("GREPAI_EMBEDDING_MODEL", "nomic-embed-text-v1.5");
		return import("./index.ts?apply=1").then((m) => {
			const config = m.applyGrepaiDefaults({ version: 1, store: { backend: "gob" } });
			expect(config.embedder).toMatchObject({
				provider: GREPAI_PROVIDER,
				model: "nomic-embed-text-v1.5",
				endpoint: "http://127.0.0.1:8787/v1",
				api_key: "local",
				dimensions: GREPAI_EMBEDDING_DIMENSIONS,
			});
		});
	});

	it("keeps an existing embedder.api_key (e.g. local) instead of replacing the config", () => {
		return import("./index.ts?keep=1").then((m) => {
			const config = m.applyGrepaiDefaults({
				version: 1,
				store: { backend: "gob" },
				embedder: {
					provider: "openai",
					model: "nomic-embed-text-v1.5",
					endpoint: "http://127.0.0.1:8787/v1",
					api_key: "local",
					parallelism: 4,
					dimensions: 768,
				},
			});
			expect(config.embedder).toMatchObject({ api_key: "local", model: "nomic-embed-text-v1.5", endpoint: "http://127.0.0.1:8787/v1" });
		});
	});

	describe("grepai tool command builder", () => {
		it("builds a search command with defaults", () => {
			expect(buildGrepaiToolCommand("search", "session config")).toEqual(["search", "session config", "--limit", "10", "--json"]);
		});

		it("builds a search command with limit and path", () => {
			expect(buildGrepaiToolCommand("search", "auth", 5, "src/core")).toEqual(["search", "auth", "--limit", "5", "--json", "--path", "src/core"]);
		});

		it("builds trace commands", () => {
			expect(buildGrepaiToolCommand("callers", "Login")).toEqual(["trace", "callers", "Login", "--json"]);
			expect(buildGrepaiToolCommand("callees", "HandleRequest")).toEqual(["trace", "callees", "HandleRequest", "--json"]);
		});
	});

	describe("grepai result formatting", () => {
		it("formats search hits compactly", () => {
			const json = JSON.stringify([
				{ file_path: "src/a.ts", start_line: 3, end_line: 5, score: 0.712345, content: "File: src/a.ts\n\nconst x = 1;\r\n" },
			]);
			expect(formatGrepaiSearchResult(json)).toContain("1. src/a.ts:3-5 (score 0.712)");
			expect(formatGrepaiSearchResult(json)).toContain("const x = 1;");
		});

		it("explains empty search results", () => {
			expect(formatGrepaiSearchResult("[]")).toBe("No matching code found. Try rephrasing the query with different terms.");
		});

		it("passes through non-JSON output", () => {
			expect(formatGrepaiSearchResult("  some log line  ")).toBe("some log line");
		});

		it("formats trace results", () => {
			const json = JSON.stringify({
				query: "foo",
				symbol: { name: "foo", signature: "function foo(x: string)" },
				callers: [{ call_site: { file: "src/b.ts", line: 42, context: "foo('hi')" } }],
			});
			const text = formatGrepaiTraceResult(json, "callers");
			expect(text).toContain("callers of foo · function foo(x: string)");
			expect(text).toContain("1. src/b.ts:42");
		});

		it("reports missing callers", () => {
			expect(formatGrepaiTraceResult(JSON.stringify({ query: "bar", symbol: { name: "bar" }, callers: [] }), "callers")).toContain("No callers found");
		});
	});
});
