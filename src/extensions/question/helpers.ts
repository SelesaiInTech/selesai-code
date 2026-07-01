// Pure helper functions for the question extension.

import type { MarkdownTheme } from "@earendil-works/pi-coding-agent";

import type { QuestionOption, QuestionResponse, RawOption } from "./types.ts";

export function getOptionsFormatError(options: RawOption[] | undefined): string | null {
	for (const option of options ?? []) {
		if (typeof option !== "string") continue;
		const text = option.trim();
		if (!text.startsWith("[") && !text.startsWith("{")) continue;
		try {
			const parsed = JSON.parse(text);
			const jsonOption = (value: unknown) => !!value && typeof value === "object" && typeof (value as { label?: unknown }).label === "string";
			if (jsonOption(parsed) || (Array.isArray(parsed) && parsed.some(jsonOption))) {
				return 'Invalid question.options: pass an array of strings or {label, description} objects, not a JSON-encoded string. Example: {"options":[{"label":"Yes","description":"..."}]}, not {"options":["[{\\"label\\":\\"Yes\\"}]"]}.';
			}
		} catch {}
	}
	return null;
}

export function normalizeOptions(options: RawOption[] | undefined): QuestionOption[] {
	return (options ?? [])
		.map((option) =>
			typeof option === "string"
				? { label: option }
				: { label: option.label, description: option.description },
		)
		.filter((option) => option.label.trim().length > 0);
}

export function oneLine(value: unknown, max = 100): string {
	const text = String(value ?? "").replace(/\s+/g, " ").trim();
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// ponytail: lazy import avoids hard dependency on pi-coding-agent at module load
// time (it may not be resolvable in dev/test environments). The function is
// only called at runtime when the TUI is active.
let _getMarkdownTheme: (() => MarkdownTheme) | null | undefined;
export function safeMarkdownTheme(): MarkdownTheme | undefined {
	try {
		if (_getMarkdownTheme === undefined) {
			// Dynamic require avoids breaking module load when package is absent.
			_getMarkdownTheme = (globalThis as any).require
				? (globalThis as any).require("@earendil-works/pi-coding-agent").getMarkdownTheme
				: null;
		}
		if (!_getMarkdownTheme) return undefined;
		const md = _getMarkdownTheme();
		if (!md) return undefined;
		md.bold("");
		return md;
	} catch {
		return undefined;
	}
}

export function createFreeformResponse(text: string | null | undefined): QuestionResponse | null {
	const trimmed = text?.trim();
	return trimmed ? { kind: "freeform", text: trimmed } : null;
}

export function createSelectionResponse(selections: string[], comment?: string | null): QuestionResponse | null {
	const norm = selections.map((s) => s.trim()).filter(Boolean);
	if (norm.length === 0) return null;
	const c = comment?.trim();
	return c ? { kind: "selection", selections: norm, comment: c } : { kind: "selection", selections: norm };
}

export function formatResponseSummary(response: QuestionResponse): string {
	if (response.kind === "freeform") return response.text;
	const selections = response.selections.join(", ");
	return response.comment ? `${selections} — ${response.comment}` : selections;
}

export function formatOptionsForMessage(options: QuestionOption[]): string {
	return options
		.map((option, index) => {
			const desc = option.description ? ` — ${option.description}` : "";
			return `${index + 1}. ${option.label}${desc}`;
		})
		.join("\n");
}

export function buildCommentPrompt(prompt: string, selections: string[]): string {
	const label = selections.length === 1 ? "Selected option" : "Selected options";
	const lines = selections.map((selection) => `- ${selection}`).join("\n");
	return `${prompt}\n\n${label}:\n${lines}`;
}

export function parseDialogSelections(input: string): string[] {
	return input
		.split(",")
		.map((selection) => selection.trim())
		.filter(Boolean);
}

export function isCancelled(value: unknown): value is null | undefined {
	return value === null || value === undefined;
}