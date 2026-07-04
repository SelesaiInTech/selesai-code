import type { AssistantMessage } from "@earendil-works/pi-ai/compat";

type AssistantContent = AssistantMessage["content"];
type AssistantContentPart = AssistantContent[number];

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

function splitTextByThinkingTags(text: string): Array<{ type: "text"; text: string } | { type: "thinking"; thinking: string }> {
	const parts: Array<{ type: "text"; text: string } | { type: "thinking"; thinking: string }> = [];
	let index = 0;
	let inThinking = false;

	while (index < text.length) {
		const nextOpen = text.indexOf(THINK_OPEN, index);
		const nextClose = text.indexOf(THINK_CLOSE, index);

		if (!inThinking) {
			if (nextOpen === -1) {
				parts.push({ type: "text", text: text.slice(index) });
				break;
			}
			if (nextOpen > index) parts.push({ type: "text", text: text.slice(index, nextOpen) });
			index = nextOpen + THINK_OPEN.length;
			inThinking = true;
			continue;
		}

		if (nextClose === -1) {
			parts.push({ type: "thinking", thinking: text.slice(index) });
			break;
		}
		parts.push({ type: "thinking", thinking: text.slice(index, nextClose) });
		index = nextClose + THINK_CLOSE.length;
		inThinking = false;
	}

	return parts.filter((part) => part.type === "text" ? part.text.length > 0 : part.thinking.length > 0);
}

function shouldNormalizeText(text: string): boolean {
	if (!text.includes(THINK_OPEN)) return false;
	return text.trimStart().startsWith(THINK_OPEN) || text.includes(THINK_CLOSE);
}

export function normalizeThinkingTagContent(content: AssistantContent): AssistantContent {
	let changed = false;
	const normalized: AssistantContentPart[] = [];

	for (const part of content) {
		if (part.type !== "text" || !shouldNormalizeText(part.text)) {
			normalized.push(part);
			continue;
		}

		changed = true;
		for (const split of splitTextByThinkingTags(part.text)) {
			normalized.push(split as AssistantContentPart);
		}
	}

	return changed ? normalized : content;
}

export function normalizeAssistantThinkingTags(message: AssistantMessage): AssistantMessage {
	const content = normalizeThinkingTagContent(message.content);
	return content === message.content ? message : { ...message, content };
}

export function stripThinkingTagsFromText(text: string): string {
	if (!shouldNormalizeText(text)) return text;
	return splitTextByThinkingTags(text)
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("");
}
