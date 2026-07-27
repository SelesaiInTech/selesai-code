import test from "node:test";
import assert from "node:assert/strict";

import { buildQuestionAnswers, prepareQuestions, saveDraftQuestion } from "../batch.ts";
import type { DraftQuestionState } from "../types.ts";

test("prepareQuestions: normalizes typed questions and generated ids", () => {
	const result = prepareQuestions([
		{ type: "select", question: "Pick a color", options: [{ value: "red", label: "Red" }, { value: "blue", label: "Blue" }] },
		{ type: "text", id: "notes", label: "Notes", question: "Anything else?", allowComment: true },
	]);
	assert.ok("questions" in result);
	if (!("questions" in result)) return;
	assert.deepEqual(result.questions, [
		{
			id: "q1",
			label: "Q1",
			question: "Pick a color",
			context: undefined,
			allowComment: false,
			type: "select",
			options: [
				{ value: "red", label: "Red", description: undefined },
				{ value: "blue", label: "Blue", description: undefined },
			],
			allowOther: false,
		},
		{
			id: "notes",
			label: "Notes",
			question: "Anything else?",
			context: undefined,
			allowComment: true,
			type: "text",
			options: [],
			allowOther: false,
		},
	]);
});

test("prepareQuestions: rejects empty batches, generated-id collisions, and duplicate option values", () => {
	assert.deepEqual(prepareQuestions([]), { error: "questions must contain at least one question." });
	assert.match((prepareQuestions([
		{ type: "text", id: "q2", question: "One" },
		{ type: "text", question: "Two" },
	]) as { error: string }).error, /duplicate id: q2/);
	assert.match((prepareQuestions([{
		type: "select",
		question: "Choose",
		options: [{ value: "same", label: "A" }, { value: "same", label: "B" }],
	}]) as { error: string }).error, /duplicate value: same/);
});

test("saveDraftQuestion: clearing an answer while navigating back leaves it unanswered", () => {
	const states = new Map<string, DraftQuestionState>([["q1", { status: "answered", response: { kind: "text", text: "old" } }]]);
	const comments = new Map([["q1", "old comment"]]);
	saveDraftQuestion(states, comments, "q1", null, false);
	assert.equal(states.has("q1"), false);
	assert.equal(comments.has("q1"), false);
});

test("buildQuestionAnswers: preserves answered, skipped, and unvisited states", () => {
	const prepared = prepareQuestions([
		{ type: "text", id: "a", question: "A", allowComment: true },
		{ type: "text", id: "b", question: "B", allowComment: true },
		{ type: "text", id: "c", question: "C" },
	]);
	assert.ok("questions" in prepared);
	if (!("questions" in prepared)) return;
	const states = new Map<string, DraftQuestionState>([
		["a", { status: "answered", response: { kind: "text", text: "answer" } }],
		["b", { status: "skipped" }],
	]);
	assert.deepEqual(buildQuestionAnswers(prepared.questions, states, new Map([["a", " note "]])), [
		{ id: "a", status: "answered", response: { kind: "text", text: "answer" }, comment: "note" },
		{ id: "b", status: "skipped" },
		{ id: "c", status: "unanswered" },
	]);
});
