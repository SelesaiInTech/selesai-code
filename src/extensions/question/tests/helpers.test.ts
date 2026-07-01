import test from "node:test";
import assert from "node:assert/strict";

import {
	normalizeOptions,
	createFreeformResponse,
	createSelectionResponse,
	formatResponseSummary,
	formatOptionsForMessage,
	parseDialogSelections,
	isCancelled,
	oneLine,
} from "../helpers.ts";

test("normalizeOptions: string array", () => {
	assert.deepEqual(normalizeOptions(["a", "b"]), [
		{ label: "a" },
		{ label: "b" },
	]);
});

test("normalizeOptions: object array", () => {
	assert.deepEqual(
		normalizeOptions([{ label: "a", description: "desc" }]),
		[{ label: "a", description: "desc" }],
	);
});

test("normalizeOptions: mixed string and object", () => {
	assert.deepEqual(normalizeOptions(["a", { label: "b", description: "d" }]), [
		{ label: "a" },
		{ label: "b", description: "d" },
	]);
});

test("normalizeOptions: empty/undefined", () => {
	assert.deepEqual(normalizeOptions(undefined), []);
	assert.deepEqual(normalizeOptions([]), []);
});

test("normalizeOptions: whitespace-only labels filtered", () => {
	assert.deepEqual(normalizeOptions(["  ", "a", ""]), [{ label: "a" }]);
});

test("createFreeformResponse: null/undefined/empty → null", () => {
	assert.equal(createFreeformResponse(null), null);
	assert.equal(createFreeformResponse(undefined), null);
	assert.equal(createFreeformResponse(""), null);
	assert.equal(createFreeformResponse("   "), null);
});

test("createFreeformResponse: non-empty → { kind: freeform }", () => {
	assert.deepEqual(createFreeformResponse("hello"), { kind: "freeform", text: "hello" });
	assert.deepEqual(createFreeformResponse("  trim  "), { kind: "freeform", text: "trim" });
});

test("createSelectionResponse: empty → null", () => {
	assert.equal(createSelectionResponse([]), null);
	assert.equal(createSelectionResponse(["", "  "]), null);
});

test("createSelectionResponse: single", () => {
	assert.deepEqual(createSelectionResponse(["a"]), { kind: "selection", selections: ["a"] });
});

test("createSelectionResponse: multiple with trim", () => {
	assert.deepEqual(createSelectionResponse(["  a  ", "b"]), { kind: "selection", selections: ["a", "b"] });
});

test("createSelectionResponse: with comment", () => {
	assert.deepEqual(createSelectionResponse(["a"], "note"), {
		kind: "selection",
		selections: ["a"],
		comment: "note",
	});
});

test("createSelectionResponse: comment whitespace trimmed", () => {
	assert.deepEqual(createSelectionResponse(["a"], "  note  "), {
		kind: "selection",
		selections: ["a"],
		comment: "note",
	});
});

test("createSelectionResponse: empty comment → no comment field", () => {
	assert.deepEqual(createSelectionResponse(["a"], "   "), { kind: "selection", selections: ["a"] });
});

test("formatResponseSummary: freeform → text", () => {
	assert.equal(formatResponseSummary({ kind: "freeform", text: "hello" }), "hello");
});

test("formatResponseSummary: selection without comment", () => {
	assert.equal(formatResponseSummary({ kind: "selection", selections: ["a", "b"] }), "a, b");
});

test("formatResponseSummary: selection with comment", () => {
	assert.equal(
		formatResponseSummary({ kind: "selection", selections: ["a", "b"], comment: "note" }),
		"a, b — note",
	);
});

test("formatOptionsForMessage: 0 options → empty string", () => {
	assert.equal(formatOptionsForMessage([]), "");
});

test("formatOptionsForMessage: 1 option", () => {
	assert.equal(formatOptionsForMessage([{ label: "a" }]), "1. a");
});

test("formatOptionsForMessage: with description", () => {
	assert.equal(formatOptionsForMessage([{ label: "a", description: "desc" }]), "1. a — desc");
});

test("formatOptionsForMessage: multiple", () => {
	assert.equal(
		formatOptionsForMessage([{ label: "a" }, { label: "b", description: "d" }]),
		"1. a\n2. b — d",
	);
});

test("parseDialogSelections: basic CSV", () => {
	assert.deepEqual(parseDialogSelections("a,b,c"), ["a", "b", "c"]);
});

test("parseDialogSelections: whitespace trimmed", () => {
	assert.deepEqual(parseDialogSelections(" a , b "), ["a", "b"]);
});

test("parseDialogSelections: empty → []", () => {
	assert.deepEqual(parseDialogSelections(""), []);
});

test("parseDialogSelections: empty entries filtered", () => {
	assert.deepEqual(parseDialogSelections("a,,b"), ["a", "b"]);
});

test("isCancelled: null/undefined → true", () => {
	assert.equal(isCancelled(null), true);
	assert.equal(isCancelled(undefined), true);
});

test("isCancelled: falsy non-null → false", () => {
	assert.equal(isCancelled(""), false);
	assert.equal(isCancelled(0), false);
	assert.equal(isCancelled(false), false);
});

test("oneLine: undefined → empty string", () => {
	assert.equal(oneLine(undefined), "");
	assert.equal(oneLine(null), "");
});

test("oneLine: short → unchanged", () => {
	assert.equal(oneLine("hello"), "hello");
});

test("oneLine: long → truncated with …", () => {
	const long = "a".repeat(120);
	const result = oneLine(long, 10);
	assert.equal(result.length, 10);
	assert.equal(result.endsWith("…"), true);
});

test("oneLine: whitespace collapsed", () => {
	assert.equal(oneLine("  hello   world  "), "hello world");
});