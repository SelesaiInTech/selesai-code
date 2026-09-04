/**
 * Capability gateway catalog and deterministic router.
 *
 * Pure functions: no host imports, fully unit-testable. The router uses
 * deterministic local scoring (name/alias matches above token overlap) and
 * never calls a model.
 */

import type { ResolvedSkillInfo, ToolInfo } from "@selesai/code";

export interface CatalogEntry {
	name: string;
	kind: "tool" | "skill";
	summary: string;
	aliases: string[];
	category?: string;
	eligible: boolean;
}

/** Built-in tools are never mediated by the gateway. */
export const BUILTIN_TOOL_NAMES = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);

/** First sentence of a description, used as the conservative fallback summary. */
export function firstSentence(text: string): string {
	const trimmed = text.trim();
	const end = trimmed.search(/[.!?](?:\s|$)/);
	return (end === -1 ? trimmed : trimmed.slice(0, end + 1)).trim();
}

/** Compact summary for a tool: explicit discovery metadata wins, then first sentence, then snippet. */
export function toolSummary(tool: ToolInfo): string {
	const explicit = tool.discovery?.summary?.trim();
	if (explicit) return explicit;
	const sentence = firstSentence(tool.description);
	if (sentence) return sentence;
	return tool.promptSnippet?.trim() || tool.name;
}

export function buildToolCatalog(tools: ToolInfo[], gatewayToolNames: Set<string>): CatalogEntry[] {
	return tools
		.filter((tool) => !BUILTIN_TOOL_NAMES.has(tool.name) && !gatewayToolNames.has(tool.name))
		.map((tool) => ({
			name: tool.name,
			kind: "tool" as const,
			summary: toolSummary(tool),
			aliases: tool.discovery?.aliases ?? [],
			category: tool.discovery?.category,
			eligible: true,
		}));
}

export function buildSkillCatalog(skills: ResolvedSkillInfo[]): CatalogEntry[] {
	return skills
		.filter((skill) => !skill.disableModelInvocation)
		.map((skill) => ({
			name: skill.name,
			kind: "skill" as const,
			summary: skill.description,
			aliases: [],
			category: skill.category,
			eligible: true,
		}));
}

export function normalizeQuery(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function tokenize(text: string): string[] {
	return normalizeQuery(text).split(/\s+/).filter(Boolean);
}

/** Words that carry no routing signal. */
const STOPWORDS = new Set([
	"the", "a", "an", "to", "of", "for", "with", "and", "or", "use", "using", "me", "my", "i",
	"please", "help", "can", "you", "do", "does", "is", "are", "on", "in", "at", "by", "from",
	"this", "that", "it", "its", "want", "need", "run", "call", "invoke", "find", "show", "list",
	"get", "load", "activate", "discover", "capability", "tool", "skill", "the", "a",
]);

export interface RouteResult {
	action: "activate" | "recommend" | "hint" | "none";
	entry?: CatalogEntry;
	candidates?: CatalogEntry[];
}

/**
 * Deterministic routing over the compact catalog.
 *
 * - Exact name/alias match scores 3; prefix match scores 2; each content token
 *   shared with the name/alias or summary adds 1.
 * - A unique tool with score >= 3 is auto-activated.
 * - A unique skill with score >= 3 is recommended (never auto-loaded).
 * - Score 2 or a tie at the top produces a catalog-discovery hint.
 * - No signal produces no hint at all.
 */
export function route(query: string, catalog: CatalogEntry[]): RouteResult {
	const q = normalizeQuery(query);
	if (!q) return { action: "none" };
	const contentTokens = tokenize(q).filter((token) => !STOPWORDS.has(token));
	if (contentTokens.length === 0) return { action: "none" };

	const scored = catalog.map((entry) => {
		const names = [entry.name, ...entry.aliases].map(normalizeQuery);
		const nameTokens = new Set(names.flatMap((name) => name.split(/\s+/)));
		const summaryTokens = new Set(tokenize(entry.summary));
		let score = 0;
		for (const name of names) {
			if (name === q) score = Math.max(score, 3);
			else if (name.startsWith(q) || q.startsWith(name)) score = Math.max(score, 2);
		}
		for (const token of contentTokens) {
			if (nameTokens.has(token)) score += 3;
			else if (token.length >= 3 && [...nameTokens].some((nameToken) => nameToken.startsWith(token))) score += 2;
			if (summaryTokens.has(token)) score += 1;
		}
		return { entry, score };
	});

	const best = Math.max(0, ...scored.map((s) => s.score));
	if (best === 0) return { action: "none" };
	const top = scored.filter((s) => s.score === best);
	if (top.length > 1) {
		return { action: "hint", candidates: top.map((s) => s.entry) };
	}
	const winner = top[0]!.entry;
	if (best >= 3) {
		return { action: winner.kind === "tool" ? "activate" : "recommend", entry: winner };
	}
	if (best >= 2) {
		return { action: "hint", candidates: [winner] };
	}
	return { action: "none" };
}
