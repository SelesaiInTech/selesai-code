import type {
	DraftQuestionState,
	PreparedQuestion,
	QuestionAnswer,
	QuestionOption,
	QuestionResponse,
	RawQuestion,
} from "./types.ts";

function clean(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
}

function prepareOptions(value: unknown, questionNumber: number): { options: QuestionOption[] } | { error: string } {
	if (!Array.isArray(value) || value.length === 0) {
		return { error: `Question ${questionNumber}: choice questions require at least one option.` };
	}
	const values = new Set<string>();
	const options: QuestionOption[] = [];
	for (let index = 0; index < value.length; index++) {
		const raw = value[index] as { value?: unknown; label?: unknown; description?: unknown };
		const optionValue = clean(raw?.value);
		const label = clean(raw?.label);
		if (!optionValue || !label) {
			return { error: `Question ${questionNumber}, option ${index + 1}: value and label must be non-empty strings.` };
		}
		if (values.has(optionValue)) {
			return { error: `Question ${questionNumber}: option values must be unique; duplicate value: ${optionValue}` };
		}
		values.add(optionValue);
		options.push({ value: optionValue, label, description: clean(raw.description) });
	}
	return { options };
}

export function prepareQuestions(value: unknown): { questions: PreparedQuestion[] } | { error: string } {
	if (!Array.isArray(value) || value.length === 0) return { error: "questions must contain at least one question." };

	const ids = new Set<string>();
	const questions: PreparedQuestion[] = [];
	for (let index = 0; index < value.length; index++) {
		const raw = value[index] as RawQuestion;
		const number = index + 1;
		const question = clean(raw?.question);
		if (!question) return { error: `Question ${number} must include a non-empty question.` };

		const id = clean(raw.id) ?? `q${number}`;
		if (ids.has(id)) return { error: `Question ids must be unique; duplicate id: ${id}` };
		ids.add(id);

		const common = {
			id,
			label: clean(raw.label) ?? `Q${number}`,
			question,
			context: clean(raw.context),
			allowComment: raw.allowComment ?? false,
		};

		if (raw.type === "text") {
			questions.push({ ...common, type: "text", options: [], allowOther: false });
			continue;
		}
		if (raw.type !== "select" && raw.type !== "multiselect") {
			return { error: `Question ${number}: type must be select, multiselect, or text.` };
		}
		const preparedOptions = prepareOptions(raw.options, number);
		if ("error" in preparedOptions) return preparedOptions;
		questions.push({
			...common,
			type: raw.type,
			options: preparedOptions.options,
			allowOther: raw.allowOther ?? false,
		});
	}
	return { questions };
}

export function saveDraftQuestion(
	states: Map<string, DraftQuestionState>,
	comments: Map<string, string>,
	id: string,
	response: QuestionResponse | null,
	markBlankSkipped: boolean,
): void {
	if (response) {
		states.set(id, { status: "answered", response });
		return;
	}
	comments.delete(id);
	if (markBlankSkipped) states.set(id, { status: "skipped" });
	else states.delete(id);
}

export function buildQuestionAnswers(
	questions: PreparedQuestion[],
	states: ReadonlyMap<string, DraftQuestionState>,
	comments: ReadonlyMap<string, string>,
): QuestionAnswer[] {
	return questions.map((question) => {
		const state = states.get(question.id);
		if (!state) return { id: question.id, status: "unanswered" };
		if (state.status !== "answered" || !state.response) return { id: question.id, status: "skipped" };
		const comment = question.allowComment ? clean(comments.get(question.id)) : undefined;
		return comment
			? { id: question.id, status: "answered", response: state.response, comment }
			: { id: question.id, status: "answered", response: state.response };
	});
}
