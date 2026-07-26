import { getOptionsFormatError, normalizeOptions } from "./helpers.ts";
import { resolveShortcuts } from "./shortcuts.ts";
import type { BatchedQuestion, RawBatchQuestion } from "./types.ts";

export function prepareBatchQuestions(value: unknown): { questions: BatchedQuestion[] } | { error: string } {
	if (!Array.isArray(value) || value.length === 0) return { error: "questions must contain at least one question." };

	const ids = new Set<string>();
	const questions: BatchedQuestion[] = [];
	for (let index = 0; index < value.length; index++) {
		const raw = value[index] as RawBatchQuestion;
		const question = raw?.question?.trim();
		if (!question) return { error: `Question ${index + 1} must include a non-empty question.` };

		const optionsError = getOptionsFormatError(raw.options);
		if (optionsError) return { error: `Question ${index + 1}: ${optionsError}` };
		const options = normalizeOptions(raw.options);
		const allowFreeform = raw.allowFreeform ?? options.length === 0;
		if (options.length === 0 && !allowFreeform) {
			return { error: `Question ${index + 1}: options are empty and allowFreeform is false.` };
		}

		const id = raw.id?.trim() || `q${index + 1}`;
		if (ids.has(id)) return { error: `Question ids must be unique; duplicate id: ${id}` };
		ids.add(id);
		questions.push({
			id,
			label: raw.label?.trim() || `Q${index + 1}`,
			question,
			context: raw.context?.trim() || raw.title?.trim() || undefined,
			options,
			allowMultiple: raw.allowMultiple ?? false,
			allowFreeform,
			allowComment: raw.allowComment ?? false,
			shortcuts: resolveShortcuts(raw.commentToggleKey, process.env.PI_QUESTION_COMMENT_TOGGLE_KEY),
		});
	}
	return { questions };
}
