import test from "node:test";
import assert from "node:assert/strict";

import {
	createSelectionResponse,
	createTextResponse,
	formatQuestionResponse,
	formatResponseSummary,
	oneLine,
	previewText,
} from "../helpers.ts";
import type { PreparedQuestion } from "../types.ts";

test("createTextResponse trims edges and rejects blank text", () => {
	assert.equal(createTextResponse("  "), null);
	assert.deepEqual(createTextResponse("  hello\nworld  "), { kind: "text", text: "hello\nworld" });
});

test("createSelectionResponse supports values plus Other and rejects empty", () => {
	assert.equal(createSelectionResponse([], "  "), null);
	assert.deepEqual(createSelectionResponse([" a ", "b"], " other "), {
		kind: "selection",
		values: ["a", "b"],
		otherText: "other",
	});
});

test("formatResponseSummary returns machine values", () => {
	assert.equal(formatResponseSummary({ kind: "selection", values: ["a", "b"], otherText: "c" }), "a, b, c");
	assert.equal(formatResponseSummary({ kind: "text", text: "hello" }), "hello");
});

test("formatQuestionResponse maps stable values to labels", () => {
	const question: PreparedQuestion = {
		id: "q1",
		label: "Q1",
		question: "Pick",
		type: "multiselect",
		options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }],
		allowOther: true,
	};
	assert.equal(formatQuestionResponse(question, { kind: "selection", values: ["b"], otherText: "Gamma" }), "Beta, Other: Gamma");
});

test("previewText bounds multiline summaries", () => {
	assert.equal(previewText("one\ntwo\nthree", 160, 2), "one\ntwo…");
	assert.equal(previewText("a".repeat(200), 10, 2), `${"a".repeat(9)}…`);
});

test("oneLine collapses whitespace and truncates", () => {
	assert.equal(oneLine("  hello   world  "), "hello world");
	assert.equal(oneLine("a".repeat(20), 10), `${"a".repeat(9)}…`);
});
