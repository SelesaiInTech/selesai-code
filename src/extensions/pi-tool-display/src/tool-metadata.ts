export interface PromptMetadata {
	promptSnippet?: string;
	promptGuidelines?: string[];
}

const MCP_DESCRIPTION_PATTERN = /\bmcp\b/i;
const MCP_ADAPTER_SOURCE_PATTERN = /(?:^|[/\\@_-])(?:pi-)?mcp(?:[/\\@_-]|$)|pi-mcp-adapter|mcp-adapter/i;
const MAX_PROMPT_SNIPPET_LENGTH = 120;

export const MCP_PROXY_PROMPT_SNIPPET = "Discover, inspect, and call MCP tools across configured servers";
export const MCP_PROXY_PROMPT_GUIDELINES = [
	"Use mcp for MCP discovery first: search by capability, describe one exact tool, then call it.",
] as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toRecord(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) {
		return {};
	}

	return value;
}

export function getTextField(value: unknown, field: string): string | undefined {
	const record = toRecord(value);
	const raw = record[field];
	return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
}

function normalizeInlineText(value: string): string {
	return value.trim().replace(/\s+/g, " ");
}

function trimPromptSnippet(value: string): string {
	if (value.length <= MAX_PROMPT_SNIPPET_LENGTH) {
		return value;
	}

	const truncated = value.slice(0, MAX_PROMPT_SNIPPET_LENGTH).trimEnd();
	return `${truncated.replace(/[\s.,;:!?-]+$/u, "")}…`;
}

export function buildPromptSnippetFromDescription(description: string | undefined, fallback: string): string {
	const normalizedDescription = normalizeInlineText(description || "");
	const normalizedFallback = normalizeInlineText(fallback);
	const base = normalizedDescription || normalizedFallback;
	const firstSentence = base.split(/(?<=[.!?])\s+/u, 1)[0] ?? base;
	const withoutSentencePunctuation = firstSentence.replace(/[.!?]+$/u, "").trim();
	return trimPromptSnippet(withoutSentencePunctuation || base);
}

export function extractPromptMetadata(tool: unknown): PromptMetadata {
	const source = toRecord(tool);
	const promptSnippet =
		typeof source.promptSnippet === "string" && source.promptSnippet.trim().length > 0
			? source.promptSnippet
			: undefined;
	const promptGuidelines = Array.isArray(source.promptGuidelines)
		? source.promptGuidelines.filter(
				(guideline): guideline is string =>
					typeof guideline === "string" && guideline.trim().length > 0,
			)
		: undefined;

	return {
		promptSnippet,
		promptGuidelines:
			promptGuidelines && promptGuidelines.length > 0
				? [...promptGuidelines]
				: undefined,
	};
}

function hasMcpSourceInfo(value: unknown): boolean {
	const sourceInfo = toRecord(value);
	for (const [key, raw] of Object.entries(sourceInfo)) {
		if (typeof raw !== "string" || raw.trim().length === 0) {
			continue;
		}

		const normalizedKey = key.toLowerCase();
		const normalizedValue = raw.trim();
		if (["source", "type", "kind", "origin"].includes(normalizedKey) && normalizedValue.toLowerCase() === "mcp") {
			return true;
		}
		if (MCP_ADAPTER_SOURCE_PATTERN.test(normalizedValue)) {
			return true;
		}
	}

	return false;
}

export function isMcpToolCandidate(tool: unknown): boolean {
	if (!tool || typeof tool !== "object") {
		return false;
	}

	const record = tool as Record<string, unknown>;
	const name = typeof record.name === "string" ? record.name : "";
	const description = typeof record.description === "string" ? record.description : "";
	const label = typeof record.label === "string" ? record.label : "";

	if (name === "mcp") {
		return true;
	}
	if (MCP_DESCRIPTION_PATTERN.test(description) || MCP_DESCRIPTION_PATTERN.test(label)) {
		return true;
	}
	if (hasMcpSourceInfo(record.sourceInfo)) {
		return true;
	}
	if (/^mcp[_-]/i.test(name) || /_mcp$/i.test(name)) {
		return true;
	}
	if (name.includes(":")) {
		return true;
	}
	if (/^ctx_/i.test(name)) {
		return true;
	}

	const params = record.parameters;
	if (params && typeof params === "object") {
		const parameterRecord = params as Record<string, unknown>;
		if (
			"mcpServer" in parameterRecord ||
			"serverUrl" in parameterRecord ||
			"server_name" in parameterRecord
		) {
			return true;
		}
	}

	return false;
}
