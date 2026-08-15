/** Native Selesai extension inspired by ai-tools-all/grep_app_mcp (ISC). */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
	type ExtensionAPI,
	withFileMutationQueue,
} from "@selesai/code";
import { Text } from "@earendil-works/pi-tui";
import { load } from "cheerio";
import { Type } from "typebox";

const API_URL = "https://grep.app/api/search";
const RAW_GITHUB_URL = "https://raw.githubusercontent.com";

interface GrepAppHit {
	repo: string;
	branch: string;
	path: string;
	content: { snippet: string };
	total_matches?: string;
}

interface GrepAppResponse {
	hits: { total: number; hits: GrepAppHit[] };
}

interface SearchParams {
	query: string;
	page?: number;
	caseSensitive?: boolean;
	useRegex?: boolean;
	wholeWords?: boolean;
	repo?: string;
	path?: string;
	language?: string;
}

export function buildSearchUrl(params: SearchParams): URL {
	const url = new URL(API_URL);
	url.searchParams.set("q", params.query);
	url.searchParams.set("page", String(params.page ?? 1));
	if (params.caseSensitive) url.searchParams.set("case", "true");
	if (params.useRegex) url.searchParams.set("regexp", "true");
	if (params.wholeWords) url.searchParams.set("words", "true");
	if (params.repo) url.searchParams.set("f.repo.pattern", params.repo);
	if (params.path) url.searchParams.set("f.path.pattern", params.path);
	if (params.language) url.searchParams.set("f.lang", params.language);
	return url;
}

function snippetLines(snippet: string): Array<{ line: string; text: string }> {
	const $ = load(snippet);
	return $("tr")
		.toArray()
		.map((row) => ({
			line: $(row).attr("data-line") ?? "?",
			text: $(row).find("pre").text().replace(/\s+$/, ""),
		}));
}

function encodePath(value: string): string {
	return value
		.split("/")
		.filter(Boolean)
		.map(encodeURIComponent)
		.join("/");
}

export function formatSearchResponse(response: GrepAppResponse, page: number): string {
	if (response.hits.hits.length === 0) return "No matches found.";

	const results = response.hits.hits.map((hit, index) => {
		const lines = snippetLines(hit.content.snippet);
		const firstLine = lines.find((line) => line.line !== "?")?.line;
		const url = `https://github.com/${hit.repo}/blob/${encodePath(hit.branch)}/${encodePath(hit.path)}${firstLine ? `#L${firstLine}` : ""}`;
		const body = lines.map(({ line, text }) => `  L${line}: ${text}`).join("\n");
		return `${index + 1}. ${hit.repo}:${hit.path} (${hit.branch})\n${body}\n  ${url}`;
	});

	return `grep.app: ${response.hits.total} total matches; page ${page}\n\n${results.join("\n\n")}`;
}

async function fetchWithBrowser(url: URL | string, signal: AbortSignal | undefined): Promise<string> {
	const { chromium } = await import("playwright");
	const browser = await chromium.launch({ headless: true });
	const abort = () => void browser.close();
	signal?.addEventListener("abort", abort, { once: true });
	try {
		const page = await browser.newPage();
		await page.goto(String(url), { waitUntil: "networkidle", timeout: 30_000 });
		await page.waitForFunction(() => document.body.innerText.trimStart().startsWith("{"), undefined, { timeout: 15_000 });
		return await page.locator("body").innerText();
	} catch (error) {
		if (signal?.aborted) {
			// signal.reason is always set after abort() in Node, so the ?? fallback
			// is unreachable.
			/* v8 ignore next 1 */
			throw signal.reason ?? new Error("Cancelled");
		}
		throw error;
	} finally {
		signal?.removeEventListener("abort", abort);
		await browser.close();
	}
}

async function fetchText(url: URL | string, signal: AbortSignal | undefined, browserFallback = false): Promise<string> {
	const response = await fetch(url, {
		signal,
		headers: { Accept: "application/json, text/plain;q=0.9", "User-Agent": "selesai-grep-app-extension" },
	});
	if (browserFallback && response.status === 429 && response.headers.get("x-vercel-mitigated") === "challenge") {
		return fetchWithBrowser(url, signal);
	}
	if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
	return response.text();
}

async function truncateOutput(output: string): Promise<{ text: string; fullOutputPath?: string }> {
	const truncated = truncateHead(output, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
	if (!truncated.truncated) return { text: output };

	const directory = await mkdtemp(join(tmpdir(), "selesai-grep-app-"));
	const fullOutputPath = join(directory, "output.txt");
	await withFileMutationQueue(fullOutputPath, () => writeFile(fullOutputPath, output, "utf8"));
	return {
		text: `${truncated.content}\n\n[Output truncated to ${truncated.outputLines} lines / ${formatSize(truncated.outputBytes)}. Full output: ${fullOutputPath}]`,
		fullOutputPath,
	};
}

export default function grepAppExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "grep_app_search",
		label: "grep.app Search",
		description: "Search public GitHub code through grep.app. Returns one page (up to 10 files); use page to continue.",
		promptSnippet: "Search public GitHub code through grep.app",
		promptGuidelines: ["Use grep_app_search to find real public-code implementations and usage examples across GitHub."],
		parameters: Type.Object({
			query: Type.String({ minLength: 1, description: "Code or pattern to search for." }),
			page: Type.Optional(Type.Integer({ minimum: 1, description: "Result page; defaults to 1." })),
			caseSensitive: Type.Optional(Type.Boolean({ description: "Match case." })),
			useRegex: Type.Optional(Type.Boolean({ description: "Treat query as a regular expression." })),
			wholeWords: Type.Optional(Type.Boolean({ description: "Match whole words. Cannot be combined with useRegex." })),
			repo: Type.Optional(Type.String({ description: "Repository filter, for example facebook/react." })),
			path: Type.Optional(Type.String({ description: "File path filter, for example src/components/." })),
			language: Type.Optional(Type.String({ description: "Language filter, for example TypeScript." })),
		}),
		async execute(_toolCallId, params, signal) {
			if (params.useRegex && params.wholeWords) throw new Error("useRegex and wholeWords cannot both be true.");

			const page = params.page ?? 1;
			const raw = await fetchText(buildSearchUrl(params), signal, true);
			let response: GrepAppResponse;
			try {
				response = JSON.parse(raw) as GrepAppResponse;
			} catch {
				throw new Error("grep.app returned invalid JSON.");
			}
			if (!response.hits || !Array.isArray(response.hits.hits)) throw new Error("grep.app returned an unexpected response.");

			const output = await truncateOutput(formatSearchResponse(response, page));
			return {
				content: [{ type: "text", text: output.text }],
				details: { total: response.hits.total, page, resultCount: response.hits.hits.length, fullOutputPath: output.fullOutputPath },
			};
		},
		renderResult(result, _options, theme, context) {
			if (context.isError) return new Text(theme.fg("error", "✗ grep.app search failed"), 0, 0);
			const details = result.details as { total?: number; page?: number; resultCount?: number } | undefined;
			return new Text(theme.fg("success", `✓ grep.app: ${details?.resultCount ?? 0} results · page ${details?.page ?? 1} · ${details?.total ?? 0} total matches`), 0, 0);
		},
	});

	pi.registerTool({
		name: "grep_app_fetch",
		label: "GitHub File",
		description: "Fetch a public GitHub file found via grep.app. Supports line ranges; output is truncated to 50KB or 2000 lines.",
		promptSnippet: "Fetch a public GitHub file found via grep.app",
		promptGuidelines: ["Use grep_app_fetch after grep_app_search when the full source context is needed."],
		parameters: Type.Object({
			repo: Type.String({ pattern: "^[^/\\s]+/[^/\\s]+$", description: "owner/repository." }),
			path: Type.String({ minLength: 1, description: "Path inside the repository." }),
			ref: Type.Optional(Type.String({ minLength: 1, description: "Branch, tag, or commit; defaults to HEAD." })),
			startLine: Type.Optional(Type.Integer({ minimum: 1, description: "First line; defaults to 1." })),
			endLine: Type.Optional(Type.Integer({ minimum: 1, description: "Last line; defaults to end of file." })),
		}),
		async execute(_toolCallId, params, signal) {
			const startLine = params.startLine ?? 1;
			if (params.endLine !== undefined && params.endLine < startLine) throw new Error("endLine must be greater than or equal to startLine.");

			const rawUrl = `${RAW_GITHUB_URL}/${encodePath(params.repo)}/${encodePath(params.ref ?? "HEAD")}/${encodePath(params.path)}`;
			const source = await fetchText(rawUrl, signal);
			const allLines = source.split("\n");
			const endLine = Math.min(params.endLine ?? allLines.length, allLines.length);
			const selected = allLines.slice(startLine - 1, endLine).map((line, index) => `${startLine + index}: ${line}`).join("\n");
			const output = await truncateOutput(selected);

			return {
				content: [{ type: "text", text: output.text || "(empty file or range)" }],
				details: { repo: params.repo, path: params.path, ref: params.ref ?? "HEAD", startLine, endLine, totalLines: allLines.length, fullOutputPath: output.fullOutputPath },
			};
		},
		renderResult(result, _options, theme, context) {
			if (context.isError) return new Text(theme.fg("error", "✗ GitHub file fetch failed"), 0, 0);
			const details = result.details as { repo?: string; path?: string; startLine?: number; endLine?: number } | undefined;
			return new Text(theme.fg("success", `✓ GitHub: ${details?.repo ?? "?"}/${details?.path ?? "?"} · lines ${details?.startLine ?? 1}-${details?.endLine ?? "?"}`), 0, 0);
		},
	});
}
