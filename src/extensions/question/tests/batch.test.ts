import { describe, expect, it } from "vitest";

import { buildQuestionAnswers, prepareQuestions, saveDraftQuestion } from "../batch.ts";
import type { DraftQuestionState } from "../types.ts";

describe("question batch helpers", () => {
	it("prepareQuestions: normalizes typed questions and generated ids", () => {
		const result = prepareQuestions([
			{ type: "select", question: "Pick a color", options: [{ value: "red", label: "Red" }, { value: "blue", label: "Blue" }] },
			{ type: "text", id: "notes", label: "Notes", question: "Anything else?" },
		]);
		expect("questions" in result).toBe(true);
		if (!("questions" in result)) return;
		expect(result.questions).toEqual([
			{
				id: "q1",
				label: "Q1",
				question: "Pick a color",
				context: undefined,
				type: "select",
				options: [
					{ value: "red", label: "Red", description: undefined },
					{ value: "blue", label: "Blue", description: undefined },
				],
				allowOther: true,
			},
			{
				id: "notes",
				label: "Notes",
				question: "Anything else?",
				context: undefined,
				type: "text",
				options: [],
				allowOther: false,
			},
		]);
	});

	it("prepareQuestions: rejects empty batches, generated-id collisions, and duplicate option values", () => {
		expect(prepareQuestions([])).toEqual({ error: "questions must contain at least one question." });
		expect((prepareQuestions([
			{ type: "text", id: "q2", question: "One" },
			{ type: "text", question: "Two" },
		]) as { error: string }).error).toMatch(/duplicate id: q2/);
		expect((prepareQuestions([{
			type: "select",
			question: "Choose",
			options: [{ value: "same", label: "A" }, { value: "same", label: "B" }],
		}]) as { error: string }).error).toMatch(/duplicate value: same/);
	});

	it("prepareQuestions: rejects missing question, bad type, empty options, and bad option fields", () => {
		expect((prepareQuestions([{ type: "text" }]) as { error: string }).error).toMatch(/non-empty question/);
		expect((prepareQuestions([{ type: "radio", question: "X", options: [{ value: "a", label: "A" }] }]) as { error: string }).error).toMatch(/type must be select, multiselect, or text/);
		expect((prepareQuestions([{ type: "select", question: "X", options: [] }]) as { error: string }).error).toMatch(/at least one option/);
		expect((prepareQuestions([{ type: "select", question: "X", options: [{ value: "", label: "A" }] }]) as { error: string }).error).toMatch(/value and label must be non-empty/);
		expect((prepareQuestions([{ type: "select", question: "X", options: [{ value: "a", label: "" }] }]) as { error: string }).error).toMatch(/value and label must be non-empty/);
	});

	it("prepareQuestions: trims id/label/context and defaults allowOther", () => {
		const result = prepareQuestions([
			{ type: "multiselect", id: "  m1  ", label: "  Multi  ", question: "  Pick many  ", context: "  ctx  ", options: [{ value: "a", label: "A", description: "  desc  " }] },
		]);
		expect("questions" in result).toBe(true);
		if (!("questions" in result)) return;
		expect(result.questions[0]).toEqual({
			id: "m1",
			label: "Multi",
			question: "Pick many",
			context: "ctx",
			type: "multiselect",
			options: [{ value: "a", label: "A", description: "desc" }],
			allowOther: true,
		});
	});

	it("saveDraftQuestion: clearing an answer while navigating back leaves it unanswered", () => {
		const states = new Map<string, DraftQuestionState>([["q1", { status: "answered", response: { kind: "text", text: "old" } }]]);
		saveDraftQuestion(states, "q1", null, false);
		expect(states.has("q1")).toBe(false);
	});

	it("saveDraftQuestion: blank answer with markBlankSkipped marks skipped", () => {
		const states = new Map<string, DraftQuestionState>();
		saveDraftQuestion(states, "q1", null, true);
		expect(states.get("q1")).toEqual({ status: "skipped" });
	});

	it("saveDraftQuestion: response marks answered", () => {
		const states = new Map<string, DraftQuestionState>();
		saveDraftQuestion(states, "q1", { kind: "text", text: "answer" }, true);
		expect(states.get("q1")).toEqual({ status: "answered", response: { kind: "text", text: "answer" } });
	});

	it("buildQuestionAnswers: preserves answered, skipped, and unvisited states", () => {
		const prepared = prepareQuestions([
			{ type: "text", id: "a", question: "A" },
			{ type: "text", id: "b", question: "B" },
			{ type: "text", id: "c", question: "C" },
		]);
		expect("questions" in prepared).toBe(true);
		if (!("questions" in prepared)) return;
		const states = new Map<string, DraftQuestionState>([
			["a", { status: "answered", response: { kind: "text", text: "answer" } }],
			["b", { status: "skipped" }],
		]);
		expect(buildQuestionAnswers(prepared.questions, states)).toEqual([
			{ id: "a", status: "answered", response: { kind: "text", text: "answer" } },
			{ id: "b", status: "skipped" },
			{ id: "c", status: "unanswered" },
		]);
	});
});
