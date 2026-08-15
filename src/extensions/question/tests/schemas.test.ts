import { describe, expect, it } from "vitest";

import { Value } from "typebox/value";

import { QuestionParamsSchema } from "../schemas.ts";

const valid = {
	questions: [{ type: "select", question: "Pick", options: [{ value: "yes", label: "Yes" }] }],
};

describe("QuestionParamsSchema", () => {
	it("accepts typed batch requests", () => {
		expect(Value.Check(QuestionParamsSchema, valid)).toBe(true);
	});

	it("accepts multiselect, text, ids, labels, context, allowOther, descriptions", () => {
		expect(Value.Check(QuestionParamsSchema, {
			questions: [
				{ type: "multiselect", id: "m", label: "M", question: "Pick many", context: "ctx", options: [{ value: "a", label: "A", description: "d" }], allowOther: true },
				{ type: "text", question: "Explain" },
			],
		})).toBe(true);
	});

	it("rejects legacy and mistyped fields", () => {
		expect(Value.Check(QuestionParamsSchema, { ...valid, timeout: 1000 })).toBe(false);
		expect(Value.Check(QuestionParamsSchema, {
			questions: [{ ...valid.questions[0], allowMultiple: true }],
		})).toBe(false);
		expect(Value.Check(QuestionParamsSchema, {
			questions: [{ ...valid.questions[0], allowComment: true }],
		})).toBe(false);
		expect(Value.Check(QuestionParamsSchema, {
			questions: [{ type: "text", question: "Explain", options: [] }],
		})).toBe(false);
		expect(Value.Check(QuestionParamsSchema, {
			questions: [{ ...valid.questions[0], options: [{ value: "yes", label: "Yes", extra: true }] }],
		})).toBe(false);
	});

	it("rejects empty questions and bad option shapes", () => {
		expect(Value.Check(QuestionParamsSchema, { questions: [] })).toBe(false);
		expect(Value.Check(QuestionParamsSchema, {
			questions: [{ type: "select", question: "Pick", options: [] }],
		})).toBe(false);
		expect(Value.Check(QuestionParamsSchema, {
			questions: [{ type: "select", question: "Pick", options: [{ value: "yes" }] }],
		})).toBe(false);
		expect(Value.Check(QuestionParamsSchema, {
			questions: [{ type: "select", question: "Pick", options: [{ label: "Yes" }] }],
		})).toBe(false);
	});
});
