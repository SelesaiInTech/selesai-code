// Typebox schemas for the question tool parameters.

import { Type } from "typebox";

const OptionSchema = Type.Union([
	Type.String({ description: "Option label" }),
	Type.Object({
		label: Type.String({ description: "Option label shown to the user" }),
		description: Type.Optional(Type.String({ description: "Optional help text shown under the option" })),
	}),
]);

export const QuestionParamsSchema = Type.Object({
	question: Type.String({ description: "Question to ask the user before continuing" }),
	title: Type.Optional(Type.String({ description: "Short title for the question UI (deprecated alias of context summary)" })),
	context: Type.Optional(
		Type.String({ description: "Relevant context summary shown before the question" }),
	),
	options: Type.Optional(
		Type.Array(OptionSchema, {
			description: "Optional multiple-choice options. Each option may be a string or { label, description }.",
		}),
	),
	allowMultiple: Type.Optional(
		Type.Boolean({ description: "Allow selecting multiple options. Default: false" }),
	),
	allowFreeform: Type.Optional(
		Type.Boolean({
			description: "Allow a custom freeform answer. Defaults to true when no options are provided, false when options exist.",
		}),
	),
	allowComment: Type.Optional(
		Type.Boolean({ description: "Collect an optional comment after selecting one or more options. Default: false" }),
	),
	commentToggleKey: Type.Optional(
		Type.String({
			description:
				"Shortcut for toggling the optional comment/extra-context row when allowComment is true, e.g. 'ctrl+g'. Pass 'off' to disable. Default: PI_QUESTION_COMMENT_TOGGLE_KEY env var if set, otherwise 'ctrl+g'.",
		}),
	),
	timeout: Type.Optional(
		Type.Number({ description: "Auto-dismiss after N milliseconds. Returns null (cancelled) when expired." }),
	),
});