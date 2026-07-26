import test from "node:test";
import assert from "node:assert/strict";

import { prepareBatchQuestions } from "../batch.ts";

test("prepareBatchQuestions: normalizes defaults and generated ids", () => {
	const result = prepareBatchQuestions([
		{ question: "Pick a color", options: ["Red", "Blue"] },
		{ id: "notes", label: "Notes", question: "Anything else?" },
	]);
	assert.ok("questions" in result);
	if (!("questions" in result)) return;
	assert.deepEqual(
		result.questions.map(({ id, label, question, options, allowFreeform }) => ({ id, label, question, options, allowFreeform })),
		[
			{ id: "q1", label: "Q1", question: "Pick a color", options: [{ label: "Red" }, { label: "Blue" }], allowFreeform: false },
			{ id: "notes", label: "Notes", question: "Anything else?", options: [], allowFreeform: true },
		],
	);
});

test("prepareBatchQuestions: rejects empty batches, duplicate ids, and impossible questions", () => {
	assert.deepEqual(prepareBatchQuestions([]), { error: "questions must contain at least one question." });
	assert.match((prepareBatchQuestions([{ id: "same", question: "One" }, { id: "same", question: "Two" }]) as { error: string }).error, /duplicate id/);
	assert.match((prepareBatchQuestions([{ question: "Choose", allowFreeform: false }]) as { error: string }).error, /options are empty/);
});
