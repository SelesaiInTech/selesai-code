import test from "node:test";
import assert from "node:assert/strict";

import { wrapPlain, buildItemBlocks, flattenBlocks, renderSingleSelectRows } from "../row-layout.ts";
import type { ItemBlock, QuestionOption } from "../types.ts";

const opts = (labels: string[]): QuestionOption[] => labels.map((label) => ({ label }));

test("wrapPlain: empty → ['']", () => {
	assert.deepEqual(wrapPlain("", 20), [""]);
	assert.deepEqual(wrapPlain("   ", 20), [""]);
});

test("wrapPlain: single word fits", () => {
	assert.deepEqual(wrapPlain("hello", 20), ["hello"]);
});

test("wrapPlain: word longer than width → chunked", () => {
	assert.deepEqual(wrapPlain("abcdefgh", 3), ["abc", "def", "gh"]);
});

test("wrapPlain: multiple words wrapping", () => {
	assert.deepEqual(wrapPlain("hello world foo", 7), ["hello", "world", "foo"]);
	assert.deepEqual(wrapPlain("hello world foo", 11), ["hello world", "foo"]);
});

test("wrapPlain: width=1 → char-by-char", () => {
	assert.deepEqual(wrapPlain("abc", 1), ["a", "b", "c"]);
});

test("buildItemBlocks: 3 options, selected=0 → arrow on block 0", () => {
	const blocks = buildItemBlocks(opts(["a", "b", "c"]), 80, false, false, false, 0);
	assert.equal(blocks.length, 3);
	assert.equal(blocks[0]!.itemIndex, 0);
	assert.ok(blocks[0]!.lines[0]!.startsWith("→"));
	assert.ok(blocks[0]!.lines[0]!.includes("1. a"));
	assert.ok(blocks[1]!.lines[0]!.startsWith(" "));
});

test("buildItemBlocks: selected=1 → arrow pointer on block 1", () => {
	const blocks = buildItemBlocks(opts(["a", "b", "c"]), 80, false, false, false, 1);
	assert.ok(blocks[1]!.lines[0]!.startsWith("→"));
	assert.ok(blocks[0]!.lines[0]!.startsWith(" "));
});

test("buildItemBlocks: with description → description lines included", () => {
	const blocks = buildItemBlocks(
		[{ label: "a", description: "some desc" }],
		80,
		false,
		false,
		false,
		0,
	);
	assert.ok(blocks[0]!.lines.length > 1);
	assert.ok(blocks[0]!.lines.some((l) => l.includes("some desc")));
});

test("buildItemBlocks: hideDescriptions=true → no description lines", () => {
	const blocks = buildItemBlocks(
		[{ label: "a", description: "some desc" }],
		80,
		false,
		false,
		false,
		0,
		true,
	);
	// Only the title line, no description
	assert.equal(blocks[0]!.lines.length, 1);
});

test("buildItemBlocks: allowFreeform → freeform block appended", () => {
	const blocks = buildItemBlocks(opts(["a"]), 80, true, false, false, 0);
	assert.equal(blocks.length, 2);
	assert.ok(blocks[1]!.lines[0]!.includes("Type custom answer"));
});

test("buildItemBlocks: allowComment → comment-toggle block appended", () => {
	const blocks = buildItemBlocks(opts(["a"]), 80, false, true, false, 0);
	assert.equal(blocks.length, 2);
	assert.ok(blocks[1]!.lines[0]!.includes("[ ]"));
	assert.ok(blocks[1]!.lines[0]!.includes("Add extra context"));
});

test("buildItemBlocks: allowComment + commentEnabled → [✓]", () => {
	const blocks = buildItemBlocks(opts(["a"]), 80, false, true, true, 0);
	assert.ok(blocks[1]!.lines[0]!.includes("[✓]"));
});

test("flattenBlocks: correct selected flags", () => {
	const blocks: ItemBlock[] = [
		{ itemIndex: 0, lines: ["a", "b"] },
		{ itemIndex: 1, lines: ["c"] },
	];
	const rows = flattenBlocks(blocks, 1);
	assert.equal(rows.length, 3);
	assert.equal(rows[0]!.selected, false);
	assert.equal(rows[1]!.selected, false);
	assert.equal(rows[2]!.selected, true);
});

test("renderSingleSelectRows: few rows, all visible", () => {
	const rows = renderSingleSelectRows({
		options: opts(["a", "b"]),
		selectedIndex: 0,
		width: 80,
		allowFreeform: false,
	});
	assert.equal(rows.length, 2);
});

test("renderSingleSelectRows: maxRows truncation with indicator", () => {
	const rows = renderSingleSelectRows({
		options: opts(["a", "b", "c", "c", "e", "f", "g", "h"]),
		selectedIndex: 0,
		width: 80,
		allowFreeform: false,
		maxRows: 3,
	});
	assert.ok(rows.length <= 3);
	// Last row should be the indicator
	assert.ok(rows[rows.length - 1]!.line.includes("("));
});

test("renderSingleSelectRows: selected block larger than available → only selected + indicator", () => {
	const rows = renderSingleSelectRows({
		options: [{ label: "a".repeat(100) }],
		selectedIndex: 0,
		width: 10,
		allowFreeform: false,
		maxRows: 3,
	});
	assert.ok(rows.length <= 3);
	assert.ok(rows.every((r) => r.selected || r.line.includes("(")));
});