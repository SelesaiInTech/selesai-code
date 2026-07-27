// Pure helper functions for the question extension.

import type { PreparedQuestion, QuestionOption, QuestionResponse } from "./types.ts";

export function trimText(value: string | null | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed || undefined;
}

export function oneLine(value: unknown, max = 100): string {
	const text = String(value ?? "").replace(/\s+/g, " ").trim();
	return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

export function previewText(value: unknown, max = 160, maxLines = 2): string {
	const lines = String(value ?? "").trim().split(/\r?\n/);
	const limited = lines.slice(0, maxLines).join("\n");
	const wasCut = lines.length > maxLines || limited.length > max;
	const text = limited.length > max ? limited.slice(0, Math.max(0, max - 1)) : limited;
	return wasCut ? `${text}…` : text;
}

export function createTextResponse(text: string | null | undefined): QuestionResponse | null {
	const normalized = trimText(text);
	return normalized ? { kind: "text", text: normalized } : null;
}

export function createSelectionResponse(values: string[], otherText?: string | null): QuestionResponse | null {
	const normalizedValues = values.map((value) => value.trim()).filter(Boolean);
	const normalizedOther = trimText(otherText);
	if (normalizedValues.length === 0 && !normalizedOther) return null;
	return normalizedOther
		? { kind: "selection", values: normalizedValues, otherText: normalizedOther }
		: { kind: "selection", values: normalizedValues };
}

export function formatResponseSummary(response: QuestionResponse): string {
	if (response.kind === "text") return response.text;
	return [...response.values, ...(response.otherText ? [response.otherText] : [])].join(", ");
}

export function formatQuestionResponse(question: PreparedQuestion, response: QuestionResponse): string {
	if (response.kind === "text") return response.text;
	const labels = response.values.map(
		(value) => question.options.find((option) => option.value === value)?.label ?? value,
	);
	if (response.otherText) labels.push(`Other: ${response.otherText}`);
	return labels.join(", ");
}

export function formatOptionsForMessage(options: QuestionOption[]): string {
	return options
		.map((option, index) => {
			const description = option.description ? ` — ${option.description}` : "";
			return `${index + 1}. ${option.label}${description}`;
		})
		.join("\n");
}
