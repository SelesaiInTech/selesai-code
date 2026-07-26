// Typebox schemas for the question tool parameters.

import { Type } from "typebox";

const OptionSchema = Type.Union([
	Type.String({ description: "Option label" }),
	Type.Object({
		label: Type.String({ description: "Option label shown to the user" }),
		description: Type.Optional(Type.String({ description: "Optional help text shown under the option" })),
	}),
]);

const QuestionFields = {
	question: Type.String({ description: "Question to ask the user before continuing" }),
	title: Type.Optional(Type.String({ description: "Short title for the question UI (deprecated alias for context summary)" })),
	context: Type.Optional(Type.String({ description: "Relevant context summary shown before the question" })),
	options: Type.Optional(
		Type.Array(OptionSchema, {
			description: "Optional multiple-choice options. Each option may be a string or { label, description }.",
		}),
	),
	allowMultiple: Type.Optional(Type.Boolean({ description: "Allow selecting multiple options. Default: false" })),
	allowFreeform: Type.Optional(
		Type.Boolean({
			description: "Allow a custom freeform answer. Defaults to true when no options are provided, false when options exist.",
		}),
	),
	allowComment: Type.Optional(Type.Boolean({ description: "Collect an optional comment after selecting one or more options. Default: false" })),
	commentToggleKey: Type.Optional(
		Type.String({
			description:
				"Shortcut for toggling the optional comment/extra-context row when allowComment is true, e.g. 'ctrl+g'. Pass 'off' to disable. Default: PI_QUESTION_COMMENT_TOGGLE_KEY env var if set, otherwise 'ctrl+g'.",
		}),
	),
};

const SingleQuestionParamsSchema = Type.Object({
	...QuestionFields,
	timeout: Type.Optional(Type.Number({ description: "Auto-dismiss after N milliseconds. Returns null (cancelled) when expired." })),
});

const BatchQuestionSchema = Type.Object({
	id: Type.Optional(Type.String({ description: "Unique answer id. Defaults to q1, q2, and so on." })),
	label: Type.Optional(Type.String({ description: "Short page label. Defaults to Q1, Q2, and so on." })),
	...QuestionFields,
});

const BatchQuestionParamsSchema = Type.Object({
	questions: Type.Array(BatchQuestionSchema, {
		minItems: 1,
		description:
			"Questions to answer in one paged form. User can move between pages with Tab/Shift+Tab or Left/Right, then press Enter on the final review page to submit all answers.",
	}),
	timeout: Type.Optional(Type.Number({ description: "Auto-dismiss the whole batch after N milliseconds." })),
});

export const QuestionParamsSchema = Type.Union([SingleQuestionParamsSchema, BatchQuestionParamsSchema]);
