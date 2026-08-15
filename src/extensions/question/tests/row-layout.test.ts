import { describe, expect, it } from "vitest";

import { wrapPlain, buildItemBlocks, flattenBlocks, renderSingleSelectRows } from "../row-layout.ts";
import type { ItemBlock, QuestionOption } from "../types.ts";

const opts = (labels: string[]): QuestionOption[] => labels.map((label) => ({ value: label, label }));

describe("row-layout", () => {
	it("wrapPlain: empty → ['']", () => {
		expect(wrapPlain("", 20)).toEqual([""]);
		expect(wrapPlain("   ", 20)).toEqual([""]);
	});

	it("wrapPlain: single word fits", () => {
		expect(wrapPlain("hello", 20)).toEqual(["hello"]);
	});

	it("wrapPlain: word longer than width → chunked", () => {
		expect(wrapPlain("abcdefgh", 3)).toEqual(["abc", "def", "gh"]);
	});

	it("wrapPlain: multiple words wrapping", () => {
		expect(wrapPlain("hello world foo", 7)).toEqual(["hello", "world", "foo"]);
		expect(wrapPlain("hello world foo", 11)).toEqual(["hello world", "foo"]);
	});

	it("wrapPlain: width=1 → char-by-char", () => {
		expect(wrapPlain("abc", 1)).toEqual(["a", "b", "c"]);
	});

	it("wrapPlain: long word mid-sentence chunks and continues", () => {
		expect(wrapPlain("a verylongwordhere b", 5)).toEqual(["a", "veryl", "ongwo", "rdher", "e b"]);
	});

	it("buildItemBlocks: 3 options, selected=0 → arrow on block 0", () => {
		const blocks = buildItemBlocks(opts(["a", "b", "c"]), 80, false, false, false, 0);
		expect(blocks).toHaveLength(3);
		expect(blocks[0]!.itemIndex).toBe(0);
		expect(blocks[0]!.lines[0]!.startsWith("→")).toBe(true);
		expect(blocks[0]!.lines[0]!).toContain("1. a");
		expect(blocks[1]!.lines[0]!.startsWith(" ")).toBe(true);
	});

	it("buildItemBlocks: selected=1 → arrow pointer on block 1", () => {
		const blocks = buildItemBlocks(opts(["a", "b", "c"]), 80, false, false, false, 1);
		expect(blocks[1]!.lines[0]!.startsWith("→")).toBe(true);
		expect(blocks[0]!.lines[0]!.startsWith(" ")).toBe(true);
	});

	it("buildItemBlocks: with description → description lines included", () => {
		const blocks = buildItemBlocks(
			[{ value: "a", label: "a", description: "some desc" }],
			80,
			false,
			false,
			false,
			0,
		);
		expect(blocks[0]!.lines.length).toBeGreaterThan(1);
		expect(blocks[0]!.lines.some((l) => l.includes("some desc"))).toBe(true);
	});

	it("buildItemBlocks: hideDescriptions=true → no description lines", () => {
		const blocks = buildItemBlocks(
			[{ value: "a", label: "a", description: "some desc" }],
			80,
			false,
			false,
			false,
			0,
			true,
		);
		// Only the title line, no description
		expect(blocks[0]!.lines).toHaveLength(1);
	});

	it("buildItemBlocks: allowFreeform → freeform block appended", () => {
		const blocks = buildItemBlocks(opts(["a"]), 80, true, false, false, 0);
		expect(blocks).toHaveLength(2);
		expect(blocks[1]!.lines[0]!).toContain("Type custom answer");
	});

	it("buildItemBlocks: allowComment → comment-toggle block appended", () => {
		const blocks = buildItemBlocks(opts(["a"]), 80, false, true, false, 0);
		expect(blocks).toHaveLength(2);
		expect(blocks[1]!.lines[0]!).toContain("[ ]");
		expect(blocks[1]!.lines[0]!).toContain("Add extra context");
	});

	it("buildItemBlocks: allowComment + commentEnabled → [✓]", () => {
		const blocks = buildItemBlocks(opts(["a"]), 80, false, true, true, 0);
		expect(blocks[1]!.lines[0]!).toContain("[✓]");
	});

	it("buildItemBlocks: narrow width wraps labels", () => {
		const blocks = buildItemBlocks(opts(["a very long label"]), 12, false, false, false, 0);
		expect(blocks[0]!.lines.length).toBeGreaterThan(1);
	});

	it("flattenBlocks: correct selected flags", () => {
		const blocks: ItemBlock[] = [
			{ itemIndex: 0, lines: ["a", "b"] },
			{ itemIndex: 1, lines: ["c"] },
		];
		const rows = flattenBlocks(blocks, 1);
		expect(rows).toHaveLength(3);
		expect(rows[0]!.selected).toBe(false);
		expect(rows[1]!.selected).toBe(false);
		expect(rows[2]!.selected).toBe(true);
	});

	it("renderSingleSelectRows: few rows, all visible", () => {
		const rows = renderSingleSelectRows({
			options: opts(["a", "b"]),
			selectedIndex: 0,
			width: 80,
			allowFreeform: false,
		});
		expect(rows).toHaveLength(2);
	});

	it("renderSingleSelectRows: maxRows truncation with indicator", () => {
		const rows = renderSingleSelectRows({
			options: opts(["a", "b", "c", "c", "e", "f", "g", "h"]),
			selectedIndex: 0,
			width: 80,
			allowFreeform: false,
			maxRows: 3,
		});
		expect(rows.length).toBeLessThanOrEqual(3);
		// Last row should be the indicator
		expect(rows[rows.length - 1]!.line).toContain("(");
	});

	it("renderSingleSelectRows: selected block larger than available → only selected + indicator", () => {
		const rows = renderSingleSelectRows({
			options: [{ value: "a", label: "a".repeat(100) }],
			selectedIndex: 0,
			width: 10,
			allowFreeform: false,
			maxRows: 3,
		});
		expect(rows.length).toBeLessThanOrEqual(3);
		expect(rows.every((r) => r.selected || r.line.includes("("))).toBe(true);
	});

	it("renderSingleSelectRows: maxRows=1 shows only the selected line", () => {
		const rows = renderSingleSelectRows({
			options: opts(["a", "b"]),
			selectedIndex: 0,
			width: 80,
			allowFreeform: false,
			maxRows: 1,
		});
		expect(rows.length).toBeLessThanOrEqual(1);
	});

	it("renderSingleSelectRows: empty options with freeform still renders", () => {
		const rows = renderSingleSelectRows({
			options: [],
			selectedIndex: 0,
			width: 80,
			allowFreeform: true,
			maxRows: 5,
		});
		expect(rows.length).toBeGreaterThan(0);
	});

	it("renderSingleSelectRows: empty options without freeform returns empty", () => {
		const rows = renderSingleSelectRows({
			options: [],
			selectedIndex: 0,
			width: 80,
			allowFreeform: false,
			maxRows: 5,
		});
		expect(rows).toEqual([]);
	});

	it("renderSingleSelectRows: previous block fits when next does not", () => {
		// Selected block is small; the next block is too large but the previous fits.
		const rows = renderSingleSelectRows({
			options: [
				{ value: "a", label: "A" },
				{ value: "b", label: "B" },
				{ value: "c", label: "C".repeat(100) },
			],
			selectedIndex: 1,
			width: 10,
			allowFreeform: false,
			maxRows: 3,
		});
		expect(rows.length).toBeLessThanOrEqual(3);
		expect(rows.some((r) => r.line.includes("A"))).toBe(true);
	});

	it("buildItemBlocks: wrapped freeform label uses continuation prefix", () => {
		const blocks = buildItemBlocks(opts(["a"]), 12, true, false, false, 1);
		expect(blocks[1]!.lines.length).toBeGreaterThan(1);
		expect(blocks[1]!.lines[1]!.startsWith("    ")).toBe(true);
	});

	it("renderSingleSelectRows: out-of-range selectedIndex falls back to the first block", () => {
		const rows = renderSingleSelectRows({
			options: opts(["a", "b"]),
			selectedIndex: 7,
			width: 40,
			allowFreeform: false,
			maxRows: 1,
		});
		expect(rows.length).toBeGreaterThan(0);
		expect(rows[0]!.selected).toBe(true);
		expect(rows[0]!.line).toContain("a");
	});
});
