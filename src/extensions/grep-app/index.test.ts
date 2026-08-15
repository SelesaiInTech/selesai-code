import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSearchUrl, formatSearchResponse } from "./index.ts";

// Mock fetch and playwright so the tool execute paths run offline.
const fetchMock = vi.fn();

const chromiumMock = {
	launch: vi.fn(),
};
vi.mock("playwright", () => ({ chromium: chromiumMock }));

import grepAppExtension from "./index.ts";

function makePi() {
	const tools = new Map<string, any>();
	const pi = {
		registerTool: (tool: any) => tools.set(tool.name, tool),
	};
	grepAppExtension(pi as any);
	return { pi, tools };
}

const theme = {
	fg: (_name: string, value: string) => value,
	bold: (value: string) => value,
};

const okResponse = (body: string, status = 200, headers: Record<string, string> = {}) =>
	new Response(body, { status, headers });

describe("grep-app extension", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", fetchMock);
		fetchMock.mockReset();
		chromiumMock.launch.mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("maps search filters to grep.app parameters", () => {
		const url = buildSearchUrl({
			query: "useEffect cleanup",
			page: 2,
			caseSensitive: true,
			useRegex: true,
			wholeWords: true,
			repo: "facebook/react",
			path: "packages/",
			language: "TypeScript",
		});

		expect(Object.fromEntries(url.searchParams)).toEqual({
			q: "useEffect cleanup",
			page: "2",
			case: "true",
			regexp: "true",
			words: "true",
			"f.repo.pattern": "facebook/react",
			"f.path.pattern": "packages/",
			"f.lang": "TypeScript",
		});
	});

	it("buildSearchUrl defaults page to 1 and omits optional filters", () => {
		const url = buildSearchUrl({ query: "foo" });
		expect(url.searchParams.get("page")).toBe("1");
		expect(url.searchParams.has("case")).toBe(false);
		expect(url.searchParams.has("regexp")).toBe(false);
		expect(url.searchParams.has("words")).toBe(false);
		expect(url.searchParams.has("f.repo.pattern")).toBe(false);
		expect(url.searchParams.has("f.path.pattern")).toBe(false);
		expect(url.searchParams.has("f.lang")).toBe(false);
	});

	it("turns grep.app HTML snippets into readable numbered source", () => {
		const output = formatSearchResponse(
			{
				hits: {
					total: 42,
					hits: [
						{
							repo: "owner/repo",
							branch: "main",
							path: "src/a file.ts",
							content: {
								snippet: '<table><tr data-line="7"><td><pre>const x = &lt;mark&gt;;</pre></td></tr></table>',
							},
						},
					],
				},
			},
			3,
		);

		expect(output).toContain("42 total matches; page 3");
		expect(output).toContain("L7: const x = <mark>;");
		expect(output).toContain("https://github.com/owner/repo/blob/main/src/a%20file.ts#L7");
	});

	it("formatSearchResponse returns no-matches text for empty hits", () => {
		expect(formatSearchResponse({ hits: { total: 0, hits: [] } }, 1)).toBe("No matches found.");
	});

	it("formatSearchResponse omits the line anchor when no data-line is present", () => {
		const output = formatSearchResponse(
			{
				hits: {
					total: 1,
					hits: [
						{
							repo: "owner/repo",
							branch: "main",
							path: "src/file.ts",
							content: { snippet: "<table><tr><td><pre>code</pre></td></tr></table>" },
						},
					],
				},
			},
			1,
		);
		expect(output).toContain("L?: code");
		expect(output).toContain("https://github.com/owner/repo/blob/main/src/file.ts");
		expect(output).not.toContain("#L");
	});

	it("registers both tools", () => {
		const { tools } = makePi();
		expect(tools.has("grep_app_search")).toBe(true);
		expect(tools.has("grep_app_fetch")).toBe(true);
	});

	it("grep_app_search executes and formats results", async () => {
		const { tools } = makePi();
		fetchMock.mockResolvedValueOnce(
			okResponse(JSON.stringify({
				hits: {
					total: 5,
					hits: [
						{
							repo: "owner/repo",
							branch: "main",
							path: "src/a.ts",
							content: { snippet: '<table><tr data-line="3"><td><pre>const x = 1;</pre></td></tr></table>' },
						},
					],
				},
			})),
		);

		const result = await tools.get("grep_app_search").execute("call1", { query: "const x" }, undefined);
		expect(result.content[0].text).toContain("grep.app: 5 total matches; page 1");
		expect(result.content[0].text).toContain("L3: const x = 1;");
		expect(result.details).toMatchObject({ total: 5, page: 1, resultCount: 1 });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(String(url)).toContain("q=const+x");
		expect(init.headers["User-Agent"]).toBe("selesai-grep-app-extension");
	});

	it("grep_app_search rejects useRegex + wholeWords", async () => {
		const { tools } = makePi();
		await expect(tools.get("grep_app_search").execute("call1", { query: "x", useRegex: true, wholeWords: true }, undefined))
			.rejects.toThrow("useRegex and wholeWords cannot both be true.");
	});

	it("grep_app_search throws on invalid JSON and unexpected shapes", async () => {
		const { tools } = makePi();
		fetchMock.mockResolvedValueOnce(okResponse("not json"));
		await expect(tools.get("grep_app_search").execute("call1", { query: "x" }, undefined))
			.rejects.toThrow("grep.app returned invalid JSON.");

		fetchMock.mockResolvedValueOnce(okResponse(JSON.stringify({ hits: {} })));
		await expect(tools.get("grep_app_search").execute("call1", { query: "x" }, undefined))
			.rejects.toThrow("grep.app returned an unexpected response.");
	});

	it("grep_app_search throws on non-OK responses", async () => {
		const { tools } = makePi();
		fetchMock.mockResolvedValueOnce(okResponse("oops", 500));
		await expect(tools.get("grep_app_search").execute("call1", { query: "x" }, undefined))
			.rejects.toThrow("500");
	});

	it("grep_app_search falls back to the browser on a 429 challenge", async () => {
		const { tools } = makePi();
		fetchMock.mockResolvedValueOnce(
			okResponse("challenge", 429, { "x-vercel-mitigated": "challenge" }),
		);
		const page = {
			goto: vi.fn(async () => {}),
			waitForFunction: vi.fn(async () => {}),
			locator: vi.fn(() => ({ innerText: vi.fn(async () => '{"hits":{"total":1,"hits":[]}}') })),
		};
		const browser = { newPage: vi.fn(async () => page), close: vi.fn(async () => {}) };
		chromiumMock.launch.mockResolvedValue(browser);

		const result = await tools.get("grep_app_search").execute("call1", { query: "x" }, undefined);
		expect(result.content[0].text).toBe("No matches found.");
		expect(chromiumMock.launch).toHaveBeenCalledWith({ headless: true });
		expect(browser.close).toHaveBeenCalled();
	});

	it("grep_app_search aborts the browser fetch when the signal fires", async () => {
		const { tools } = makePi();
		fetchMock.mockResolvedValueOnce(
			okResponse("challenge", 429, { "x-vercel-mitigated": "challenge" }),
		);
		const controller = new AbortController();
		const page = {
			goto: vi.fn(async () => {}),
			waitForFunction: vi.fn(() => new Promise((_resolve, reject) => {
				controller.signal.addEventListener("abort", () => reject(controller.signal.reason));
			})),
			locator: vi.fn(() => ({ innerText: vi.fn(async () => "{}") })),
		};
		const browser = { newPage: vi.fn(async () => page), close: vi.fn(async () => {}) };
		chromiumMock.launch.mockResolvedValue(browser);

		const promise = tools.get("grep_app_search").execute("call1", { query: "x" }, controller.signal);
		// Let the browser launch and page.goto run, then abort while waitForFunction hangs.
		await vi.waitFor(() => expect(page.goto).toHaveBeenCalled());
		controller.abort(new Error("cancelled"));
		await expect(promise).rejects.toThrow("cancelled");
	});

	it("grep_app_search rethrows non-abort browser errors", async () => {
		const { tools } = makePi();
		fetchMock.mockResolvedValueOnce(
			okResponse("challenge", 429, { "x-vercel-mitigated": "challenge" }),
		);
		const page = {
			goto: vi.fn(async () => {}),
			waitForFunction: vi.fn(() => Promise.reject(new Error("browser timeout"))),
			locator: vi.fn(() => ({ innerText: vi.fn(async () => "{}") })),
		};
		const browser = { newPage: vi.fn(async () => page), close: vi.fn(async () => {}) };
		chromiumMock.launch.mockResolvedValue(browser);

		await expect(tools.get("grep_app_search").execute("call1", { query: "x" }, undefined))
			.rejects.toThrow("browser timeout");
	});

	it("grep_app_search aborts with a default Cancelled error when no reason is given", async () => {
		const { tools } = makePi();
		fetchMock.mockResolvedValueOnce(
			okResponse("challenge", 429, { "x-vercel-mitigated": "challenge" }),
		);
		const controller = new AbortController();
		const page = {
			goto: vi.fn(async () => {}),
			waitForFunction: vi.fn(() => new Promise((_resolve, reject) => {
				controller.signal.addEventListener("abort", () => reject(controller.signal.reason));
			})),
			locator: vi.fn(() => ({ innerText: vi.fn(async () => "{}") })),
		};
		const browser = { newPage: vi.fn(async () => page), close: vi.fn(async () => {}) };
		chromiumMock.launch.mockResolvedValue(browser);

		const promise = tools.get("grep_app_search").execute("call1", { query: "x" }, controller.signal);
		await vi.waitFor(() => expect(page.goto).toHaveBeenCalled());
		controller.abort(); // no reason → signal.reason is a DOMException in Node
		await expect(promise).rejects.toThrow();
	});

	it("grep_app_search waitForFunction predicate checks the page body prefix", async () => {
		const { tools } = makePi();
		fetchMock.mockResolvedValueOnce(
			okResponse("challenge", 429, { "x-vercel-mitigated": "challenge" }),
		);
		let predicate: (() => boolean) | null = null;
		const page = {
			goto: vi.fn(async () => {}),
			waitForFunction: vi.fn((fn: () => boolean) => {
				predicate = fn;
				return Promise.resolve();
			}),
			locator: vi.fn(() => ({ innerText: vi.fn(async () => '{"hits":{"total":0,"hits":[]}}') })),
		};
		const browser = { newPage: vi.fn(async () => page), close: vi.fn(async () => {}) };
		chromiumMock.launch.mockResolvedValue(browser);

		const result = await tools.get("grep_app_search").execute("call1", { query: "x" }, undefined);
		expect(result.content[0].text).toBe("No matches found.");

		// The predicate reads document.body.innerText.
		const originalDocument = (globalThis as any).document;
		(globalThis as any).document = { body: { innerText: "{\"hits\":1}" } };
		try {
			expect(predicate!()).toBe(true);
			(globalThis as any).document = { body: { innerText: "not json" } };
			expect(predicate!()).toBe(false);
		} finally {
			(globalThis as any).document = originalDocument;
		}
	});

	it("grep_app_search truncates long output and reports the full path", async () => {
		const { tools } = makePi();
		// A snippet with 100 table rows produces 100 output lines per hit;
		// 30 hits × 100 lines exceeds the 2000-line truncation limit.
		const rows = Array.from({ length: 100 }, (_, i) => `<tr data-line="${i + 1}"><td><pre>line ${i}</pre></td></tr>`).join("");
		const snippet = `<table>${rows}</table>`;
		const hits = Array.from({ length: 30 }, (_, i) => ({
			repo: "owner/repo",
			branch: "main",
			path: `src/file${i}.ts`,
			content: { snippet },
		}));
		fetchMock.mockResolvedValueOnce(okResponse(JSON.stringify({ hits: { total: 30, hits } })));

		const result = await tools.get("grep_app_search").execute("call1", { query: "x" }, undefined);
		expect(result.content[0].text).toContain("[Output truncated to");
		expect(result.details.fullOutputPath).toBeTruthy();
	});

	it("grep_app_fetch fetches a file with line ranges", async () => {
		const { tools } = makePi();
		fetchMock.mockResolvedValueOnce(okResponse("line1\nline2\nline3\nline4"));

		const result = await tools.get("grep_app_fetch").execute("call2", {
			repo: "owner/repo",
			path: "src/a.ts",
			ref: "v1.0",
			startLine: 2,
			endLine: 3,
		}, undefined);
		expect(result.content[0].text).toBe("2: line2\n3: line3");
		expect(result.details).toMatchObject({ repo: "owner/repo", path: "src/a.ts", ref: "v1.0", startLine: 2, endLine: 3, totalLines: 4 });
		const [url] = fetchMock.mock.calls[0];
		expect(String(url)).toBe("https://raw.githubusercontent.com/owner/repo/v1.0/src/a.ts");
	});

	it("grep_app_fetch defaults ref and endLine", async () => {
		const { tools } = makePi();
		fetchMock.mockResolvedValueOnce(okResponse("a\nb\nc"));

		const result = await tools.get("grep_app_fetch").execute("call2", { repo: "owner/repo", path: "src/a.ts" }, undefined);
		expect(result.content[0].text).toBe("1: a\n2: b\n3: c");
		expect(result.details.ref).toBe("HEAD");
		expect(result.details.endLine).toBe(3);
		const [url] = fetchMock.mock.calls[0];
		expect(String(url)).toBe("https://raw.githubusercontent.com/owner/repo/HEAD/src/a.ts");
	});

	it("grep_app_fetch rejects endLine before startLine", async () => {
		const { tools } = makePi();
		await expect(tools.get("grep_app_fetch").execute("call2", {
			repo: "owner/repo",
			path: "src/a.ts",
			startLine: 5,
			endLine: 2,
		}, undefined)).rejects.toThrow("endLine must be greater than or equal to startLine.");
	});

	it("grep_app_fetch returns empty-file text for empty ranges", async () => {
		const { tools } = makePi();
		fetchMock.mockResolvedValueOnce(okResponse("a\nb\nc"));
		// startLine beyond the file length produces an empty selection.
		const result = await tools.get("grep_app_fetch").execute("call2", { repo: "owner/repo", path: "src/a.ts", startLine: 5 }, undefined);
		expect(result.content[0].text).toBe("(empty file or range)");
	});

	it("grep_app_fetch truncates long output", async () => {
		const { tools } = makePi();
		const lines = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join("\n");
		fetchMock.mockResolvedValueOnce(okResponse(lines));
		const result = await tools.get("grep_app_fetch").execute("call2", { repo: "owner/repo", path: "src/a.ts" }, undefined);
		expect(result.content[0].text).toContain("[Output truncated to");
		expect(result.details.fullOutputPath).toBeTruthy();
	});

	it("renderResult renders success and error states", () => {
		const { tools } = makePi();
		const search = tools.get("grep_app_search");
		const success = search.renderResult(
			{ content: [], details: { total: 10, page: 2, resultCount: 3 } },
			{},
			theme,
			{ isError: false },
		);
		expect(success.render(80).join("\n")).toContain("✓ grep.app: 3 results · page 2 · 10 total matches");

		const error = search.renderResult({ content: [] }, {}, theme, { isError: true });
		expect(error.render(80).join("\n")).toContain("✗ grep.app search failed");

		const noDetails = search.renderResult({ content: [] }, {}, theme, { isError: false });
		expect(noDetails.render(80).join("\n")).toContain("0 results");

		const fetchTool = tools.get("grep_app_fetch");
		const fetchSuccess = fetchTool.renderResult(
			{ content: [], details: { repo: "o/r", path: "src/a.ts", startLine: 1, endLine: 5 } },
			{},
			theme,
			{ isError: false },
		);
		expect(fetchSuccess.render(80).join("\n")).toContain("✓ GitHub: o/r/src/a.ts · lines 1-5");

		const fetchError = fetchTool.renderResult({ content: [] }, {}, theme, { isError: true });
		expect(fetchError.render(80).join("\n")).toContain("✗ GitHub file fetch failed");

		const fetchNoDetails = fetchTool.renderResult({ content: [] }, {}, theme, { isError: false });
		expect(fetchNoDetails.render(80).join("\n")).toContain("✓ GitHub: ?/? · lines 1-?");
	});
});
