import { describe, expect, it } from "vitest";
import type { ResolvedSkillInfo, ToolInfo } from "@selesai/code";
import {
	buildSkillCatalog,
	buildToolCatalog,
	firstSentence,
	route,
	toolSummary,
	type CatalogEntry,
} from "./catalog.ts";

const tool = (overrides: Partial<ToolInfo>): ToolInfo =>
	({
		name: "grep_app_search",
		description: "Search public GitHub code through grep.app. Returns one page.",
		parameters: {} as never,
		sourceInfo: { path: "/ext/index.ts", source: "local", scope: "user", origin: "top-level" },
		...overrides,
	}) as ToolInfo;

const skill = (overrides: Partial<ResolvedSkillInfo>): ResolvedSkillInfo => ({
	name: "research",
	description: "Investigate a question against high-trust primary sources.",
	filePath: "/skills/research/SKILL.md",
	scope: "user",
	disableModelInvocation: false,
	...overrides,
});

describe("catalog metadata", () => {
	it("uses explicit discovery summary over the description first sentence", () => {
		const t = tool({ discovery: { summary: "Search public GitHub code" } });
		expect(toolSummary(t)).toBe("Search public GitHub code");
	});

	it("falls back to the first sentence of the description", () => {
		expect(toolSummary(tool({}))).toBe("Search public GitHub code through grep.app.");
	});

	it("firstSentence handles short text without punctuation", () => {
		expect(firstSentence("no punctuation here")).toBe("no punctuation here");
	});

	it("builds a tool catalog excluding built-ins and gateway tools", () => {
		const tools = [
			tool({ name: "read" }),
			tool({ name: "capability_catalog" }),
			tool({ name: "grep_app_search", discovery: { aliases: ["github-search"], category: "web" } }),
		];
		const entries = buildToolCatalog(tools, new Set(["capability_catalog"]));
		expect(entries.map((e) => e.name)).toEqual(["grep_app_search"]);
		expect(entries[0]!.aliases).toEqual(["github-search"]);
		expect(entries[0]!.category).toBe("web");
		expect(entries[0]!.kind).toBe("tool");
	});

	it("builds a skill catalog excluding disable-model-invocation skills", () => {
		const entries = buildSkillCatalog([
			skill({ name: "research" }),
			skill({ name: "secret", disableModelInvocation: true }),
		]);
		expect(entries.map((e) => e.name)).toEqual(["research"]);
		expect(entries[0]!.kind).toBe("skill");
	});
});

describe("deterministic routing", () => {
	const catalog: CatalogEntry[] = [
		{ name: "grep_app_search", kind: "tool", summary: "Search public GitHub code", aliases: ["github-search"], category: "web" },
		{ name: "grep_app_fetch", kind: "tool", summary: "Fetch a public GitHub file", aliases: [], category: "web" },
		{ name: "research", kind: "skill", summary: "Investigate a question against primary sources", aliases: [], category: "research" },
	];

	it("auto-activates a unique high-confidence tool match", () => {
		const result = route("search github code with grep_app_search", catalog);
		expect(result.action).toBe("activate");
		expect(result.entry?.name).toBe("grep_app_search");
	});

	it("matches by alias", () => {
		const result = route("use github-search", catalog);
		expect(result.action).toBe("activate");
		expect(result.entry?.name).toBe("grep_app_search");
	});

	it("recommends a unique high-confidence skill without auto-loading", () => {
		const result = route("do research on this topic", catalog);
		expect(result.action).toBe("recommend");
		expect(result.entry?.name).toBe("research");
	});

	it("returns a hint for ambiguous matches", () => {
		const result = route("grep app", catalog);
		expect(result.action).toBe("hint");
		expect(result.candidates?.length).toBeGreaterThan(1);
	});

	it("returns none for unrelated prompts", () => {
		expect(route("refactor the auth module", catalog).action).toBe("none");
		expect(route("", catalog).action).toBe("none");
		expect(route("   ", catalog).action).toBe("none");
	});

	it("is deterministic for the same input", () => {
		const a = route("search github code", catalog);
		const b = route("search github code", catalog);
		expect(a).toEqual(b);
	});
});
