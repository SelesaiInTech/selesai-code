import { describe, expect, it } from "vitest";

import {
	createSelectionResponse,
	createTextResponse,
	formatQuestionResponse,
	formatResponseSummary,
	formatOptionsForMessage,
	oneLine,
	previewText,
	trimText,
} from "../helpers.ts";
import type { PreparedQuestion } from "../types.ts";

describe("question helpers", () => {
	it("trimText trims and returns undefined for blank", () => {
		expect(trimText("  ")).toBeUndefined();
		expect(trimText(undefined)).toBeUndefined();
		expect(trimText(null)).toBeUndefined();
		expect(trimText("  hello  ")).toBe("hello");
	});

	it("createTextResponse trims edges and rejects blank text", () => {
		expect(createTextResponse("  ")).toBeNull();
		expect(createTextResponse(undefined)).toBeNull();
		expect(createTextResponse("  hello\nworld  ")).toEqual({ kind: "text", text: "hello\nworld" });
	});

	it("createSelectionResponse supports values plus Other and rejects empty", () => {
		expect(createSelectionResponse([], "  ")).toBeNull();
		expect(createSelectionResponse([], undefined)).toBeNull();
		expect(createSelectionResponse([" a ", "b"], " other ")).toEqual({
			kind: "selection",
			values: ["a", "b"],
			otherText: "other",
		});
		expect(createSelectionResponse(["a"], undefined)).toEqual({ kind: "selection", values: ["a"] });
	});

	it("formatResponseSummary returns machine values", () => {
		expect(formatResponseSummary({ kind: "selection", values: ["a", "b"], otherText: "c" })).toBe("a, b, c");
		expect(formatResponseSummary({ kind: "selection", values: ["a"] })).toBe("a");
		expect(formatResponseSummary({ kind: "text", text: "hello" })).toBe("hello");
	});

	it("formatQuestionResponse maps stable values to labels", () => {
		const question: PreparedQuestion = {
			id: "q1",
			label: "Q1",
			question: "Pick",
			type: "multiselect",
			options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }],
			allowOther: true,
		};
		expect(formatQuestionResponse(question, { kind: "selection", values: ["b"], otherText: "Gamma" })).toBe("Beta, Other: Gamma");
		expect(formatQuestionResponse(question, { kind: "selection", values: ["unknown"] })).toBe("unknown");
		expect(formatQuestionResponse(question, { kind: "text", text: "plain" })).toBe("plain");
	});

	it("formatOptionsForMessage numbers options with descriptions", () => {
		expect(formatOptionsForMessage([
			{ value: "a", label: "Alpha" },
			{ value: "b", label: "Beta", description: "the beta" },
		])).toBe("1. Alpha\n2. Beta — the beta");
	});

	it("previewText bounds multiline summaries", () => {
		expect(previewText("one\ntwo\nthree", 160, 2)).toBe("one\ntwo…");
		expect(previewText("a".repeat(200), 10, 2)).toBe(`${"a".repeat(9)}…`);
		expect(previewText("short", 160, 2)).toBe("short");
		expect(previewText("", 160, 2)).toBe("");
	});

	it("oneLine collapses whitespace and truncates", () => {
		expect(oneLine("  hello   world  ")).toBe("hello world");
		expect(oneLine("a".repeat(20), 10)).toBe(`${"a".repeat(9)}…`);
		expect(oneLine(undefined)).toBe("");
		expect(oneLine(42)).toBe("42");
	});

	it("previewText handles single-line and exact-boundary text", () => {
		expect(previewText("one line", 160, 2)).toBe("one line");
		expect(previewText("a".repeat(10), 10, 2)).toBe("a".repeat(10));
		expect(previewText("a".repeat(11), 10, 2)).toBe(`${"a".repeat(9)}…`);
	});

	it("previewText handles nullish values", () => {
		expect(previewText(null)).toBe("");
		expect(previewText(undefined)).toBe("");
		expect(previewText(null, 10, 1)).toBe("");
		expect(previewText(undefined, 10, 1)).toBe("");
	});
});
