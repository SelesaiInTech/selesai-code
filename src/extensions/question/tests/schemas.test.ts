import test from "node:test";
import assert from "node:assert/strict";

import { Value } from "typebox/value";

import { QuestionParamsSchema } from "../schemas.ts";

const valid = {
	questions: [{ type: "select", question: "Pick", options: [{ value: "yes", label: "Yes" }] }],
};

test("QuestionParamsSchema accepts typed batch requests", () => {
	assert.equal(Value.Check(QuestionParamsSchema, valid), true);
});

test("QuestionParamsSchema rejects legacy and mistyped fields", () => {
	assert.equal(Value.Check(QuestionParamsSchema, { ...valid, timeout: 1000 }), false);
	assert.equal(Value.Check(QuestionParamsSchema, {
		questions: [{ ...valid.questions[0], allowMultiple: true }],
	}), false);
	assert.equal(Value.Check(QuestionParamsSchema, {
		questions: [{ ...valid.questions[0], allowComment: true }],
	}), false);
	assert.equal(Value.Check(QuestionParamsSchema, {
		questions: [{ type: "text", question: "Explain", options: [] }],
	}), false);
	assert.equal(Value.Check(QuestionParamsSchema, {
		questions: [{ ...valid.questions[0], options: [{ value: "yes", label: "Yes", extra: true }] }],
	}), false);
});
