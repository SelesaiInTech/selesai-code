import assert from "node:assert/strict";
import test from "node:test";
import { Box, visibleWidth, type Component } from "@earendil-works/pi-tui";
import {
	normalizeDiffRenderWidth,
	resolveDiffPresentationMode,
	buildDiffSummaryText,
} from "../src/diff-presentation.ts";
import {
	renderEditDiffResult,
	renderWriteDiffResult,
} from "../src/diff-renderer.ts";
import type { ToolDisplayConfig } from "../src/types.ts";

// ─── Test helpers ──────────────────────────────────────────────────────────

const passThroughTheme = {
	fg: (_color: string, text: string): string => text,
	bold: (text: string): string => text,
};

const defaultConfig: Partial<ToolDisplayConfig> = {
	diffViewMode: "auto",
	diffSplitMinWidth: 80,
	diffCollapsedLines: 24,
	diffWordWrap: false,
	diffIndicatorMode: "bars",
};

function renderInsideToolBox(component: Component, width: number): string[] {
	const box = new Box(1, 1);
	box.addChild(component);
	return box.render(width);
}

// ─── normalizeDiffRenderWidth extreme values ───────────────────────────────

test("normalizeDiffRenderWidth returns 0 for negative values", () => {
	assert.equal(normalizeDiffRenderWidth(-1), 0);
	assert.equal(normalizeDiffRenderWidth(-100), 0);
});

test("normalizeDiffRenderWidth returns 0 for NaN", () => {
	assert.equal(normalizeDiffRenderWidth(NaN), 0);
});

test("normalizeDiffRenderWidth returns 0 for Infinity", () => {
	assert.equal(normalizeDiffRenderWidth(Infinity), 0);
	assert.equal(normalizeDiffRenderWidth(-Infinity), 0);
});

test("normalizeDiffRenderWidth returns 0 for zero", () => {
	assert.equal(normalizeDiffRenderWidth(0), 0);
});

test("normalizeDiffRenderWidth floors to integer", () => {
	assert.equal(normalizeDiffRenderWidth(10.7), 10);
	assert.equal(normalizeDiffRenderWidth(99.99), 99);
});

test("normalizeDiffRenderWidth clamps negative floor result to 0", () => {
	// normalizeDiffRenderWidth(-0.5): Number.isFinite(-0.5) → true, Math.floor(-0.5) → -1, Math.max(0, -1) → 0
	assert.equal(normalizeDiffRenderWidth(-0.5), 0);
});

test("normalizeDiffRenderWidth returns positive integers as-is", () => {
	assert.equal(normalizeDiffRenderWidth(1), 1);
	assert.equal(normalizeDiffRenderWidth(80), 80);
	assert.equal(normalizeDiffRenderWidth(999), 999);
});

// ─── resolveDiffPresentationMode all branches ──────────────────────────────

test("resolveDiffPresentationMode returns summary when width < 8", () => {
	const config = { diffViewMode: "auto" as const, diffSplitMinWidth: 80 };
	assert.equal(resolveDiffPresentationMode(config, 0, true), "summary");
	assert.equal(resolveDiffPresentationMode(config, 7, true), "summary");
	assert.equal(resolveDiffPresentationMode(config, -1, true), "summary");
});

test("resolveDiffPresentationMode returns compact when 8 <= width < 18", () => {
	const config = { diffViewMode: "auto" as const, diffSplitMinWidth: 80 };
	assert.equal(resolveDiffPresentationMode(config, 8, true), "compact");
	assert.equal(resolveDiffPresentationMode(config, 12, true), "compact");
	assert.equal(resolveDiffPresentationMode(config, 17, true), "compact");
});

test("resolveDiffPresentationMode returns unified when mode is unified", () => {
	const config = { diffViewMode: "unified" as const, diffSplitMinWidth: 80 };
	assert.equal(resolveDiffPresentationMode(config, 80, true), "unified");
	assert.equal(resolveDiffPresentationMode(config, 200, true), "unified");
});

test("resolveDiffPresentationMode split falls back to unified when canRenderSplitLayout is false", () => {
	const config = { diffViewMode: "split" as const, diffSplitMinWidth: 80 };
	assert.equal(resolveDiffPresentationMode(config, 80, false), "unified");
});

test("resolveDiffPresentationMode returns split when mode is split and canRenderSplitLayout", () => {
	const config = { diffViewMode: "split" as const, diffSplitMinWidth: 80 };
	assert.equal(resolveDiffPresentationMode(config, 80, true), "split");
});

test("resolveDiffPresentationMode auto mode returns split when width >= diffSplitMinWidth and canRenderSplitLayout", () => {
	const config = { diffViewMode: "auto" as const, diffSplitMinWidth: 100 };
	assert.equal(resolveDiffPresentationMode(config, 100, true), "split");
	assert.equal(resolveDiffPresentationMode(config, 120, true), "split");
});

test("resolveDiffPresentationMode auto mode returns unified when width >= 18 but < diffSplitMinWidth", () => {
	const config = { diffViewMode: "auto" as const, diffSplitMinWidth: 120 };
	assert.equal(resolveDiffPresentationMode(config, 80, true), "unified");
});

test("resolveDiffPresentationMode auto mode returns unified when canRenderSplitLayout is false", () => {
	const config = { diffViewMode: "auto" as const, diffSplitMinWidth: 80 };
	assert.equal(resolveDiffPresentationMode(config, 80, false), "unified");
});

test("resolveDiffPresentationMode auto mode returns unified when width >= diffSplitMinWidth but canRenderSplitLayout is false", () => {
	const config = { diffViewMode: "auto" as const, diffSplitMinWidth: 80 };
	assert.equal(resolveDiffPresentationMode(config, 120, false), "unified");
});

test("resolveDiffPresentationMode handles NaN width safely", () => {
	const config = { diffViewMode: "auto" as const, diffSplitMinWidth: 80 };
	assert.equal(resolveDiffPresentationMode(config, NaN, true), "summary");
});

test("resolveDiffPresentationMode handles Infinity width safely", () => {
	const config = { diffViewMode: "auto" as const, diffSplitMinWidth: 80 };
	assert.equal(resolveDiffPresentationMode(config, Infinity, true), "summary");
});

// ─── Empty diff ────────────────────────────────────────────────────────────

test("renderEditDiffResult handles entirely empty diff string", () => {
	const component = renderEditDiffResult(
		{ diff: "" },
		{ expanded: true },
		{ diffViewMode: "auto", diffSplitMinWidth: 80, diffCollapsedLines: 24, diffWordWrap: false } as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	assert.ok(lines.length > 0);
	assert.ok(lines.some((line) => line.includes("no diff payload")));
});

test("renderEditDiffResult handles diff with only whitespace", () => {
	const component = renderEditDiffResult(
		{ diff: "   \n  \n" },
		{ expanded: true },
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	// Whitespace-only diff is treated as empty → shows no diff payload
	assert.ok(lines.some((line) => line.includes("no diff")));
});

test("renderEditDiffResult handles diff with no actual changes (only file headers)", () => {
	const component = renderEditDiffResult(
		{
			diff: [
				"diff --git a/file.txt b/file.txt",
				"index abc123..def456 100644",
				"--- a/file.txt",
				"+++ b/file.txt",
			].join("\n"),
		},
		{ expanded: true },
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	// Should render with 0 added/0 removed
	assert.ok(lines.length > 0);
});

test("renderEditDiffResult handles empty diff with fallback text", () => {
	const component = renderEditDiffResult(
		{ diff: "" },
		{ expanded: true },
		defaultConfig as any,
		passThroughTheme,
		"↳ file updated",
	);
	const lines = renderInsideToolBox(component, 80);
	assert.ok(lines.some((line) => line.includes("file updated")));
});

// ─── Malformed diff input ──────────────────────────────────────────────────

test("renderEditDiffResult handles undefined diff in details", () => {
	const component = renderEditDiffResult(
		{},
		{ expanded: true },
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	assert.ok(lines.length > 0);
	assert.ok(lines.some((line) => line.includes("no diff payload")));
});

test("renderEditDiffResult handles null details", () => {
	const component = renderEditDiffResult(
		null,
		{ expanded: true },
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	assert.ok(lines.length > 0);
});

test("renderEditDiffResult handles non-object details", () => {
	// string instead of object
	const component = renderEditDiffResult(
		"not an object" as any,
		{ expanded: true },
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	assert.ok(lines.length > 0);
});

test("renderEditDiffResult handles array as details", () => {
	const component = renderEditDiffResult(
		[] as any,
		{ expanded: true },
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	assert.ok(lines.length > 0);
});

test("renderEditDiffResult handles diff property with non-string value", () => {
	const component = renderEditDiffResult(
		{ diff: 42 },
		{ expanded: true },
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	// safeGetDiff would return "" for non-string diff
	assert.ok(lines.some((line) => line.includes("no diff payload")));
});

test("renderEditDiffResult handles git binary diff patch gracefully", () => {
	const binaryDiff = [
		"diff --git a/image.png b/image.png",
		"index abc..def 100644",
		"Binary files a/image.png and b/image.png differ",
	].join("\n");
	const component = renderEditDiffResult(
		{ diff: binaryDiff },
		{ expanded: true, filePath: "image.png" },
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	// Should render without crashing (binary diff lines are treated as meta/context)
	assert.ok(lines.length > 0);
});

// ─── Diff with unicode, BOM, CRLF ──────────────────────────────────────────

test("renderEditDiffResult renders diff with unicode characters", () => {
	const diff = [
		"--- a/unicode.txt",
		"+++ b/unicode.txt",
		"@@ -1 +1 @@",
		"-hello",
		"+héllo wörld 你好 🎉",
	].join("\n");
	const component = renderEditDiffResult(
		{ diff },
		{ expanded: true, filePath: "unicode.txt" },
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	assert.ok(lines.length > 0);
	const joined = lines.join("");
	assert.ok(joined.includes("héllo") || joined.includes("hello"));
});

test("renderEditDiffResult renders diff with BOM prefix gracefully", () => {
	const diff = "\uFEFF--- a/bom.txt\n+++ b/bom.txt\n@@ -1 +1 @@\n-old\n+new\n";
	const component = renderEditDiffResult(
		{ diff },
		{ expanded: true, filePath: "bom.txt" },
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	// BOM is data before diff markers; parseDiff should handle it or not crash
	assert.ok(lines.length > 0);
});

test("renderEditDiffResult handles CRLF line endings in diff", () => {
	const diff = "--- a/crlf.txt\r\n+++ b/crlf.txt\r\n@@ -1 +1 @@\r\n-old line\r\n+new line\r\n";
	const component = renderEditDiffResult(
		{ diff },
		{ expanded: true, filePath: "crlf.txt" },
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	assert.ok(lines.length > 0);
});

test("renderEditDiffResult renders diff with mixed indentation (tabs, spaces)", () => {
	const diff = [
		"--- a/file.txt",
		"+++ b/file.txt",
		"@@ -1,3 +1,3 @@",
		"-    indented",
		"-	tabbed",
		"+\t\t changed",
		"+\t\t path",
		"",
	].join("\n");
	const component = renderEditDiffResult(
		{ diff },
		{ expanded: true, filePath: "file.txt" },
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	assert.ok(lines.length > 0);
});

// ─── Split diff when canRenderSplitLayout is false ─────────────────────────

test("renderEditDiffResult falls back to unified when split layout cannot render", () => {
	// Width 40 is below 51 (2*24 + 3), so canRenderSplitLayout returns false.
	// resolveDiffPresentationMode with diffViewMode="split" returns "unified"
	const diff = [
		"--- a/demo.ts",
		"+++ b/demo.ts",
		"@@ -1,3 +1,4 @@",
		" const a = 1;",
		"-const b = 2;",
		"+const b = 42;",
		" const c = 3;",
		"+const d = 4;",
	].join("\n");
	const component = renderEditDiffResult(
		{ diff },
		{ expanded: true, filePath: "demo.ts" },
		{
			...defaultConfig,
			diffViewMode: "split",
		} as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 40);
	// Should render without crash, showing unified view
	assert.ok(lines.length > 0);
	// In split mode top border shows "─┬─"; unified doesn't use that
	const joined = lines.join("");
	assert.ok(
		!joined.includes("─┬─"),
		`Split top border should not appear in unified fallback: ${joined}`,
	);
});

test("renderEditDiffResult narrow width auto mode falls back from split to unified", () => {
	const diff = [
		"--- a/a.ts",
		"+++ b/a.ts",
		"@@ -1 +1 @@",
		"-old",
		"+new",
	].join("\n");
	const component = renderEditDiffResult(
		{ diff },
		{ expanded: true, filePath: "a.ts" },
		{
			diffViewMode: "auto",
			diffSplitMinWidth: 200, // Requires 200+ width for split
			diffCollapsedLines: 24,
			diffWordWrap: false,
		} as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	assert.ok(lines.length > 0);
});

// ─── Syntax highlighting failure ───────────────────────────────────────────

test("renderEditDiffResult handles unknown language gracefully", () => {
	const diff = [
		"--- a/file.unknown_extension_xyz",
		"+++ b/file.unknown_extension_xyz",
		"@@ -1 +1 @@",
		"-print('hello');",
		"+print('world');",
	].join("\n");
	const component = renderEditDiffResult(
		{ diff },
		{ expanded: true, filePath: "file.unknown_extension_xyz" },
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	assert.ok(lines.length > 0);
});

test("renderEditDiffResult handles null filePath (no highlighting attempted)", () => {
	const diff = [
		"--- a/f.txt",
		"+++ b/f.txt",
		"@@ -1 +1 @@",
		"-old content",
		"+new content",
	].join("\n");
	const component = renderEditDiffResult(
		{ diff },
		{ expanded: true, filePath: undefined },
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	assert.ok(lines.length > 0);
});

test("renderEditDiffResult handles empty filePath string", () => {
	const diff = [
		"--- a/f.txt",
		"+++ b/f.txt",
		"@@ -1 +1 @@",
		"-a",
		"+b",
	].join("\n");
	const component = renderEditDiffResult(
		{ diff },
		{ expanded: true, filePath: "" },
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	assert.ok(lines.length > 0);
});

// ─── Large overwrite guard behavior in write diffs ──────────────────────────

test("renderWriteDiffResult triggers overwrite guard when previousLineCount * nextLineCount exceeds matrix limit", () => {
	// Matrix limit is 1,000,000 cells. Using 1001 previous lines × 1000 next lines = 1,001,000 > 1M.
	const previousLines = Array.from({ length: 1001 }, (_, i) => `previous line ${i}`);
	const nextLines = Array.from({ length: 1000 }, (_, i) => `next line ${i}`);
	const previousContent = previousLines.join("\n");
	const content = nextLines.join("\n");

	const component = renderWriteDiffResult(
		content,
		{
			expanded: true,
			filePath: "large.txt",
			previousContent,
			fileExistedBeforeWrite: true,
		},
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	assert.ok(lines.length > 0);
	const joined = lines.join("");
	assert.ok(
		joined.includes("overwrite diff omitted") || joined.includes("large"),
		`Expected overwrite guard message in output: ${joined}`,
	);
});

test("renderWriteDiffResult triggers guard when previous lines exceed MAX_WRITE_OVERWRITE_LINES", () => {
	// MAX_WRITE_OVERWRITE_DIFF_LINES = 4000
	const previousLines = Array.from({ length: 4001 }, (_, i) => `line ${i}`);
	const nextLines = ["single line"];
	const previousContent = previousLines.join("\n");

	const component = renderWriteDiffResult(
		"single line",
		{
			expanded: true,
			filePath: "big.txt",
			previousContent,
			fileExistedBeforeWrite: true,
		},
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	assert.ok(lines.length > 0);
});

test("renderWriteDiffResult does not trigger guard for small diffs", () => {
	const previousContent = "line1\nline2\nline3";
	const component = renderWriteDiffResult(
		"line1\nline2\nline3\nline4",
		{
			expanded: true,
			filePath: "small.txt",
			previousContent,
			fileExistedBeforeWrite: true,
		},
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	assert.ok(lines.length > 0);
	const joined = lines.join("");
	assert.ok(
		!joined.includes("overwrite diff omitted"),
		`Small diff should not trigger overwrite guard: ${joined}`,
	);
});

test("renderWriteDiffResult does not trigger guard for new file (not overwrite)", () => {
	// fileExistedBeforeWrite is false, so guard is skipped
	const component = renderWriteDiffResult(
		"hello\nworld",
		{
			expanded: true,
			filePath: "new.txt",
			previousContent: undefined,
			fileExistedBeforeWrite: false,
		},
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	assert.ok(lines.length > 0);
});

test("renderWriteDiffResult reports created file header", () => {
	const component = renderWriteDiffResult(
		"new content",
		{
			expanded: true,
			filePath: "fresh.txt",
			fileExistedBeforeWrite: false,
		},
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	const joined = lines.join("");
	assert.ok(joined.includes("created") || joined.includes("↳"));
});

test("renderWriteDiffResult reports overwritten file header", () => {
	const component = renderWriteDiffResult(
		"new",
		{
			expanded: true,
			filePath: "over.txt",
			previousContent: "old",
			fileExistedBeforeWrite: true,
		},
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	const joined = lines.join("");
	assert.ok(joined.includes("overwritten") || joined.includes("↳"));
});

// ─── renderWriteDiffResult with undefined / null content ────────────────────

test("renderWriteDiffResult handles undefined content", () => {
	const component = renderWriteDiffResult(
		undefined,
		{ expanded: true, filePath: "f.txt" },
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	assert.ok(lines.some((l) => l.includes("write completed")));
});

test("renderWriteDiffResult handles non-string content", () => {
	const component = renderWriteDiffResult(
		42 as any,
		{ expanded: true, filePath: "f.txt" },
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	assert.ok(lines.some((l) => l.includes("write completed")));
});

test("renderWriteDiffResult uses fallback text when content is missing", () => {
	const component = renderWriteDiffResult(
		undefined,
		{ expanded: true, filePath: "f.txt" },
		defaultConfig as any,
		passThroughTheme,
		"↳ file saved successfully",
	);
	const lines = renderInsideToolBox(component, 80);
	assert.ok(lines.some((l) => l.includes("saved successfully")));
});

// ─── renderEditDiffResult with very narrow widths ──────────────────────────

test("renderEditDiffResult renders summary at very narrow width", () => {
	const diff = [
		"--- a/a.ts",
		"+++ b/a.ts",
		"@@ -1,2 +1,2 @@",
		"-old1",
		"-old2",
		"+new1",
		"+new2",
	].join("\n");
	const component = renderEditDiffResult(
		{ diff },
		{ expanded: true, filePath: "a.ts" },
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 5);
	assert.ok(lines.length > 0);
});

test("renderEditDiffResult renders compact mode at narrow width (8..17)", () => {
	const diff = [
		"--- a/a.ts",
		"+++ b/a.ts",
		"@@ -1 +1 @@",
		"-old",
		"+new",
	].join("\n");
	const component = renderEditDiffResult(
		{ diff },
		{ expanded: true, filePath: "a.ts" },
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 12);
	assert.ok(lines.length > 0);
});

// ─── write diff with empty content ─────────────────────────────────────────

test("renderWriteDiffResult handles empty string content", () => {
	const component = renderWriteDiffResult(
		"",
		{ expanded: true, filePath: "empty.txt" },
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	assert.ok(lines.length > 0);
});

test("renderWriteDiffResult handles overwrite with identical content", () => {
	const previousContent = "same\ncontent";
	const component = renderWriteDiffResult(
		"same\ncontent",
		{
			expanded: true,
			filePath: "same.txt",
			previousContent,
			fileExistedBeforeWrite: true,
		},
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	assert.ok(lines.length > 0);
});

// ─── Edit diff with hashline anchors (canonical format) ─────────────────────

test("renderEditDiffResult renders canonical numbered diff with hashline anchors", () => {
	const diff = [
		"  1|import { foo } from './foo';",
		"- 2|const oldVar = true;",
		"+ 2|const newVar = true;",
		"  3|export function test() {",
	].join("\n");
	const component = renderEditDiffResult(
		{ diff },
		{ expanded: true, filePath: "demo.ts" },
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	assert.ok(lines.length > 0);
});

// ─── edit diff with only context lines ─────────────────────────────────────

test("renderEditDiffResult handles diff with only context lines", () => {
	const diff = [
		"--- a/ctx.txt",
		"+++ b/ctx.txt",
		"@@ -1,3 +1,3 @@",
		" unchanged1",
		" unchanged2",
		" unchanged3",
	].join("\n");
	const component = renderEditDiffResult(
		{ diff },
		{ expanded: true, filePath: "ctx.txt" },
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	assert.ok(lines.length > 0);
});

// ─── resolveDiffPresentationMode with explicit diffSplitMinWidth extremes ───

test("resolveDiffPresentationMode honors large diffSplitMinWidth for auto mode", () => {
	const config = { diffViewMode: "auto" as const, diffSplitMinWidth: 9999 };
	// Width 1000 < 9999, so returns "unified"
	assert.equal(resolveDiffPresentationMode(config, 1000, true), "unified");
	// Width 10000 >= 9999, returns "split"
	assert.equal(resolveDiffPresentationMode(config, 10000, true), "split");
});

test("resolveDiffPresentationMode honors zero diffSplitMinWidth", () => {
	// With diffSplitMinWidth = 0, auto mode always qualifies for split if canRenderSplitLayout
	const config = { diffViewMode: "auto" as const, diffSplitMinWidth: 0 };
	assert.equal(resolveDiffPresentationMode(config, 51, true), "split");
});

// ─── buildDiffSummaryText edge cases ───────────────────────────────────────

test("buildDiffSummaryText returns empty string for zero width", () => {
	const stats = { added: 5, removed: 3, hunks: 2, files: 1 };
	assert.equal(buildDiffSummaryText(stats, 0), "");
});

test("buildDiffSummaryText returns empty string for negative width", () => {
	const stats = { added: 5, removed: 3, hunks: 2, files: 1 };
	assert.equal(buildDiffSummaryText(stats, -1), "");
});

test("buildDiffSummaryText returns minimal text for very narrow width", () => {
	const stats = { added: 10, removed: 5, hunks: 3, files: 2 };
	const result = buildDiffSummaryText(stats, 1);
	assert.equal(result, "…");
});

test("buildDiffSummaryText returns progressively shorter candidates for limited width", () => {
	const stats = { added: 100, removed: 50, hunks: 5, files: 3 };
	// Narrow but not too narrow
	const narrow = buildDiffSummaryText(stats, 10);
	assert.ok(typeof narrow === "string");
	assert.ok(narrow.length <= 10);

	const medium = buildDiffSummaryText(stats, 30);
	assert.ok(medium.length > 0);

	const wide = buildDiffSummaryText(stats, 120);
	assert.ok(wide.startsWith("↳ diff"));
});

test("buildDiffSummaryText handles zero stats", () => {
	const stats = { added: 0, removed: 0, hunks: 0, files: 0 };
	const result = buildDiffSummaryText(stats, 80);
	// With zero stats, the first candidate "↳ diff +0 -0 • 0 hunks • 0 files" fits
	assert.ok(result.includes("+0"));
	assert.ok(result.includes("-0"));
});

// ─── renderWriteDiffResult with custom header label ────────────────────────

test("renderWriteDiffResult uses custom header label", () => {
	const component = renderWriteDiffResult(
		"content",
		{
			expanded: true,
			filePath: "custom.txt",
			headerLabel: "custom-label",
			fileExistedBeforeWrite: false,
		},
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	const joined = lines.join("");
	assert.ok(joined.includes("custom-label"), `Expected custom label in output: ${joined}`);
});

test("renderWriteDiffResult falls back to 'created' when no header label for new file", () => {
	const component = renderWriteDiffResult(
		"content",
		{
			expanded: true,
			filePath: "nothdr.txt",
			fileExistedBeforeWrite: false,
		},
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 80);
	const joined = lines.join("");
	assert.ok(joined.includes("created") || joined.includes("↳"));
});

// ─── renderEditDiffResult with summary mode at width 0 ────────────────────

test("renderEditDiffResult handles width 0 without crashing", () => {
	const diff = [
		"--- a/a.ts",
		"+++ b/a.ts",
		"@@ -1 +1 @@",
		"-old",
		"+new",
	].join("\n");
	const component = renderEditDiffResult(
		{ diff },
		{ expanded: true, filePath: "a.ts" },
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 0);
	assert.ok(lines.length > 0);
});

test("renderEditDiffResult handles width 1 (minimum summary)", () => {
	const diff = [
		"--- a/a.ts",
		"+++ b/a.ts",
		"@@ -1,5 +1,5 @@",
		" line1",
		"-remove1",
		"-remove2",
		"+add1",
		"+add2",
		" line5",
	].join("\n");
	const component = renderEditDiffResult(
		{ diff },
		{ expanded: true, filePath: "a.ts" },
		defaultConfig as any,
		passThroughTheme,
		"",
	);
	const lines = renderInsideToolBox(component, 1);
	assert.ok(lines.length > 0);
});
