// Typebox schemas for the question tool parameters.

import { Type, type TUnsafe } from "typebox";

const OptionSchema = Type.Union([
	Type.String({ description: "Option label" }),
	Type.Object({
		label: Type.String({ description: "Option label shown to the user" }),
		description: Type.Optional(Type.String({ description: "Optional help text shown under the option" })),
	}),
]);

/** Flat { type: "string", enum: [...] } instead of anyOf — Google function-calling rejects unions. */
export function StringEnum<const T extends readonly string[]>(
	values: T,
	options?: { description?: string; default?: T[number] },
): TUnsafe<T[number]> {
	return Type.Unsafe<T[number]>({
		type: "string",
		enum: [...values],
		...(options?.description ? { description: options.description } : {}),
		...(options?.default !== undefined ? { default: options.default } : {}),
	});
}

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
	displayMode: Type.Optional(
		StringEnum(["overlay", "inline"] as const, {
			description:
				"UI rendering mode. 'overlay' shows a centered modal, 'inline' renders in-place. Default: PI_QUESTION_DISPLAY_MODE env var if set, otherwise 'overlay'.",
		}),
	),
	overlayToggleKey: Type.Optional(
		Type.String({
			description:
				"Shortcut for hiding/showing the overlay popup (overlay mode only), e.g. 'alt+o'. Pass 'off' to disable. Default: PI_QUESTION_OVERLAY_TOGGLE_KEY env var if set, otherwise 'alt+o'.",
		}),
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