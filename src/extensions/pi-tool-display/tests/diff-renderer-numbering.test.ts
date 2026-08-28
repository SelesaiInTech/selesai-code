import assert from "node:assert/strict";
import test from "node:test";
import { Box, type Component } from "@earendil-works/pi-tui";
import { renderEditDiffResult } from "../src/diff-renderer.ts";

const theme = {
	fg: (_color: string, text: string): string => text,
	bold: (text: string): string => text,
};

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function renderInsideToolBox(component: Component, width: number): string[] {
	const box = new Box(1, 1);
	box.addChild(component);
	return box.render(width).map(stripAnsi);
}

function extractDisplayedLineNumber(line: string): string | null {
	const match = line.match(/^\s*(?:▌\s+)?(\S*)\s+│/);
	if (!match) {
		return null;
	}
	return match[1] ?? "";
}

function splitRenderedRow(line: string, width: number): { left: string; right: string } {
	const separatorWidth = 3;
	const leftWidth = Math.floor((width - separatorWidth) / 2);
	return {
		left: line.slice(0, leftWidth),
		right: line.slice(leftWidth + separatorWidth),
	};
}

function extractSplitDiffRows(lines: string[], width: number): Array<{ left: string; right: string }> {
	return lines
		.map((line) => splitRenderedRow(line, width))
		.filter(({ left, right }) => extractDisplayedLineNumber(left) !== null || extractDisplayedLineNumber(right) !== null);
}

test("split diff derives sequential new-side line numbers for canonical numbered diffs", () => {
	const width = 120;
	const component = renderEditDiffResult(
		{
			diff: [
				"  6|export default function toolDisplay() {",
				"- 7|  const oldA = true;",
				"- 8|  const oldB = true;",
				"  9|  setup();",
				"-10|  const legacy = getLegacyMode();",
				"+10|  if (ready) {",
				" 11|  run();",
				"+11|    start();",
				" 12|  cleanup();",
				"+12|  }",
				" 13|  finalize();",
				"+14|  return true;",
				" 14|}",
			].join("\n"),
		},
		{ expanded: true, filePath: "demo.ts" },
		{
			diffViewMode: "split",
			diffSplitMinWidth: 80,
			diffCollapsedLines: 24,
			diffWordWrap: false,
		} as any,
		theme,
		"",
	);

	const lines = renderInsideToolBox(component, width);
	const diffRows = extractSplitDiffRows(lines, width);
	const rightNumbers = diffRows
		.map(({ right }) => extractDisplayedLineNumber(right))
		.filter((value): value is string => value !== null && /^\d+$/.test(value));

	assert.deepStrictEqual(
		rightNumbers,
		["6", "7", "8", "9", "10", "11", "12", "13", "14", "15"],
		`Expected the new pane to preserve a strictly sequential numbering model.\n${lines.join("\n")}`,
	);
});

const hashlineDiff = [
	" 1#ZP:alpha",
	"-2#  :beta",
	"+2#A1:bravo",
	" 3#BC:gamma",
].join("\n");

function renderHashlineDiff(expanded: boolean): string {
	const width = 100;
	const component = renderEditDiffResult(
		{ diff: hashlineDiff },
		{ expanded, filePath: "demo.txt" },
		{
			diffViewMode: "unified",
			diffSplitMinWidth: 80,
			diffCollapsedLines: 24,
			diffWordWrap: false,
		} as any,
		theme,
		"",
	);

	return renderInsideToolBox(component, width).join("\n");
}

test("collapsed edit diff renderer hides hashline anchors while preserving visible line numbers", () => {
	const rendered = renderHashlineDiff(false);

	assert.doesNotMatch(
		rendered,
		/\b\d+#(?:ZP|A1|BC|\s{2}):/,
		`Expected hashline anchor metadata to be hidden from collapsed edit diff display.\n${rendered}`,
	);
	assert.match(rendered, /\b1\s+│ alpha\b/);
	assert.match(rendered, /\b2\s+│ bravo\b/);
	assert.match(rendered, /\b3\s+│ gamma\b/);
});

test("expanded edit diff renderer shows compact hashline labels in the line-number gutter", () => {
	const rendered = renderHashlineDiff(true);

	assert.match(rendered, /(?:^|\n) 1#ZP│ alpha\b/);
	assert.match(rendered, /(?:^|\n) 2# {2}│ beta\b/);
	assert.match(rendered, /(?:^|\n) 2#A1│ bravo\b/);
	assert.match(rendered, /(?:^|\n) 3#BC│ gamma\b/);
	assert.doesNotMatch(rendered, /(?:^|\n) {2,}1#ZP│/);
	assert.doesNotMatch(rendered, /│\s+\d+#(?:ZP|A1|BC|\s{2}):/);
});
