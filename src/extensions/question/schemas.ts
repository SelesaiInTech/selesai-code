// Strict, batch-first TypeBox schema for the question tool.

import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const OptionSchema = Type.Object({
	value: Type.String({ description: "Stable machine value returned when selected" }),
	label: Type.String({ description: "Human-readable option label" }),
	description: Type.Optional(Type.String({ description: "Optional help text shown under the option" })),
}, { additionalProperties: false });

const QuestionBase = {
	id: Type.Optional(Type.String({ description: "Unique answer id. Missing ids become q1, q2, and so on." })),
	label: Type.Optional(Type.String({ description: "Short page label. Defaults to Q1, Q2, and so on." })),
	question: Type.String({ description: "Question shown to the user" }),
	context: Type.Optional(Type.String({ description: "Optional plain-text context shown before the question" })),
	allowComment: Type.Optional(Type.Boolean({ description: "Allow an optional multiline comment on the review page" })),
};

const SelectQuestionSchema = Type.Object({
	...QuestionBase,
	type: StringEnum(["select"] as const),
	options: Type.Array(OptionSchema, { minItems: 1, description: "Available choices" }),
	allowOther: Type.Optional(Type.Boolean({ description: "Allow a custom Other text answer" })),
}, { additionalProperties: false });

const MultiSelectQuestionSchema = Type.Object({
	...QuestionBase,
	type: StringEnum(["multiselect"] as const),
	options: Type.Array(OptionSchema, { minItems: 1, description: "Available choices" }),
	allowOther: Type.Optional(Type.Boolean({ description: "Allow custom Other text alongside selected values" })),
}, { additionalProperties: false });

const TextQuestionSchema = Type.Object({
	...QuestionBase,
	type: StringEnum(["text"] as const),
}, { additionalProperties: false });

export const QuestionParamsSchema = Type.Object({
	questions: Type.Array(Type.Union([SelectQuestionSchema, MultiSelectQuestionSchema, TextQuestionSchema]), {
		minItems: 1,
		description: "One or more typed questions shown as a paged wizard followed by atomic review and submission.",
	}),
}, { additionalProperties: false });
