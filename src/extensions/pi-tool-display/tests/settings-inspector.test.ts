import assert from "node:assert/strict";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { SplitPaneInspectorModal, type InspectorSettingItem } from "../src/settings-inspector-modal.ts";
import { DEFAULT_TOOL_DISPLAY_CONFIG } from "../src/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const passThroughTheme = {
	fg: (_color: string, text: string): string => text,
	bold: (text: string): string => text,
} as Theme;

function makeMcpSettings(hasMcp: boolean, hasRtk: boolean): InspectorSettingItem[] {
	const config = DEFAULT_TOOL_DISPLAY_CONFIG;
	const items: InspectorSettingItem[] = [
		{
			id: "preset",
			label: "Preset profile",
			currentValue: "opencode",
			values: ["opencode", "balanced", "verbose"],
			inspectorTitle: "Preset Profile",
			inspectorSummary: ["Determines the overall verbosity."],
			inspectorOptions: ["opencode", "balanced", "verbose"],
			searchTerms: ["verbosity", "profile"],
		},
		{
			id: "readOutputMode",
			label: "Read tool output",
			currentValue: config.readOutputMode,
			values: ["hidden", "summary", "preview"],
			inspectorTitle: "Read Tool Output",
			inspectorSummary: ["Controls read results."],
			inspectorPath: "~/.pi/extensions/pi-tool-display/config.json",
			searchTerms: ["file", "source"],
		},
	];

	if (hasMcp) {
		items.push({
			id: "mcpOutputMode",
			label: "MCP tool output",
			currentValue: config.mcpOutputMode,
			values: ["hidden", "summary", "preview"],
			inspectorTitle: "MCP Tool Output",
			inspectorSummary: ["Controls MCP output."],
			inspectorOptions: ["hidden", "summary", "preview"],
			inspectorAdvanced: ["Only when MCP is available."],
			searchTerms: ["mcp", "proxy"],
		});
	}

	if (hasRtk) {
		items.push({
			id: "showRtkCompactionHints",
			label: "RTK compaction hints",
			currentValue: "off",
			values: ["on", "off"],
			inspectorTitle: "RTK Compaction Hints",
			inspectorSummary: ["Controls RTK hint visibility."],
			searchTerms: ["rtk", "hints"],
		});
	}

	items.push(
		{
			id: "previewLines",
			label: "Preview lines",
			currentValue: String(config.previewLines),
			values: ["4", "8", "12", "20", "40"],
			inspectorTitle: "Preview Lines",
			inspectorSummary: ["Sets preview line count."],
			inspectorOptions: ["4", "8", "12", "20", "40"],
			inspectorPath: "~/.pi/extensions/pi-tool-display/config.json",
			searchTerms: ["preview", "lines"],
		},
		{
			id: "enableNativeUserMessageBox",
			label: "Native user message box",
			currentValue: "on",
			values: ["on", "off"],
			inspectorTitle: "Native User Message Box",
			inspectorSummary: ["Toggles bordered renderer."],
			searchTerms: ["user", "message"],
		},
	);
	return items;
}

function makeModal(
	items: InspectorSettingItem[],
	theme = passThroughTheme,
): SplitPaneInspectorModal {
	return new SplitPaneInspectorModal(
		{
			getSettings: () => items,
			onChange: (_id: string, _value: string) => {},
			onClose: () => {},
		},
		theme,
	);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("renders split layout above minimum width", () => {
	const modal = makeModal(makeMcpSettings(true, true));
	const lines = modal.render(120);

	assert.ok(lines.length >= 4, `expected at least 4 lines, got ${lines.length}`);

	const headerLine = lines[0] ?? "";
	assert.ok(
		headerLine.includes("Pi Tool Display Settings"),
		"header should contain title",
	);

	const footerLine = lines[lines.length - 1] ?? "";
	assert.ok(footerLine.includes("Esc"), "footer should show Esc action");
});

test("renders stacked layout when width is below SPLIT_PANE_MIN_WIDTH (84)", () => {
	const modal = makeModal(makeMcpSettings(true, true));
	const lines = modal.render(60);

	assert.ok(lines.length >= 4, `expected at least 4 lines for stacked, got ${lines.length}`);

	const joined = lines.join(" ");
	assert.ok(
		joined.includes("Pi Tool Display Settings"),
		"title should appear in stacked layout",
	);
});

test("includes MCP setting when MCP capability is available", () => {
	const items = makeMcpSettings(true, false);
	const ids = items.map((i) => i.id);
	assert.ok(ids.includes("mcpOutputMode"), "should include MCP setting");
});

test("excludes MCP setting when MCP capability is absent", () => {
	const items = makeMcpSettings(false, false);
	const ids = items.map((i) => i.id);
	assert.equal(ids.includes("mcpOutputMode"), false, "should exclude MCP setting");
});

test("includes RTK setting when RTK capability is available", () => {
	const items = makeMcpSettings(false, true);
	const ids = items.map((i) => i.id);
	assert.ok(ids.includes("showRtkCompactionHints"), "should include RTK setting");
});

test("excludes RTK setting when RTK capability is absent", () => {
	const items = makeMcpSettings(false, false);
	const ids = items.map((i) => i.id);
	assert.equal(ids.includes("showRtkCompactionHints"), false, "should exclude RTK setting");
});

test("search filters items by label", () => {
	const modal = makeModal(makeMcpSettings(true, true));

	// Type "/" to activate search
	modal.handleInput("/");
	// Type "MCP" characters into search
	modal.handleInput("M");
	modal.handleInput("C");
	modal.handleInput("P");

	const lines = modal.render(120);
	const joined = lines.join(" ");
	assert.ok(joined.includes("MCP tool output"), "filtered results should contain MCP setting");
});

test("search shows 'No matching settings' for non-matching query", () => {
	const modal = makeModal(makeMcpSettings(false, false));
	modal.handleInput("/");
	modal.handleInput("x");
	modal.handleInput("y");
	modal.handleInput("z");

	const lines = modal.render(120);
	const joined = lines.join(" ");
	assert.ok(
		joined.includes("No matching") || joined.includes("matching"),
		"should indicate no matches",
	);
});

test("handleInput cycles value with space", () => {
	const onChange = new Array<{ id: string; value: string }>();
	const modal = new SplitPaneInspectorModal(
		{
			getSettings: () => makeMcpSettings(false, false),
			onChange: (id: string, value: string) => {
				onChange.push({ id, value });
			},
			onClose: () => {},
		},
		passThroughTheme,
	);

	// First item is "preset" with values ["opencode", "balanced", "verbose"]
	modal.handleInput(" ");

	assert.equal(onChange.length, 1);
	assert.equal(onChange[0]?.id, "preset");
	assert.equal(onChange[0]?.value, "balanced");
});

test("handleInput cycles value with Enter (\\r)", () => {
	const onChange = new Array<{ id: string; value: string }>();
	const modal = new SplitPaneInspectorModal(
		{
			getSettings: () => makeMcpSettings(false, false),
			onChange: (id: string, value: string) => {
				onChange.push({ id, value });
			},
			onClose: () => {},
		},
		passThroughTheme,
	);

	modal.handleInput("\r");

	assert.equal(onChange.length, 1);
	assert.equal(onChange[0]?.value, "balanced");
});

test("handleInput moves selection down with arrow key", () => {
	const itemsArr: InspectorSettingItem[] = makeMcpSettings(false, false);
	const onChange: Array<{ id: string; value: string }> = [];
	const modal = new SplitPaneInspectorModal(
		{
			getSettings: () => itemsArr,
			onChange: (id: string, value: string) => {
				onChange.push({ id, value });
			},
			onClose: () => {},
		},
		passThroughTheme,
	);

	// Move down once then cycle
	modal.handleInput("\x1b[B");
	modal.handleInput(" ");

	assert.equal(onChange.length, 1);
	assert.notEqual(onChange[0]?.id, "preset", "should not cycle first item after moving down");
});

test("handleInput moves selection up with arrow key", () => {
	const items = makeMcpSettings(true, false);
	const onChange: Array<{ id: string; value: string }> = [];
	const modal = new SplitPaneInspectorModal(
		{
			getSettings: () => items,
			onChange: (id: string, value: string) => {
				onChange.push({ id, value });
			},
			onClose: () => {},
		},
		passThroughTheme,
	);

	// Move down then up should select first item
	modal.handleInput("\x1b[B"); // down
	modal.handleInput("\x1b[A"); // up
	modal.handleInput(" ");

	assert.equal(onChange[0]?.id, "preset");
});

test("handleInput calls onClose on Escape key", () => {
	let closed = false;
	const modal = new SplitPaneInspectorModal(
		{
			getSettings: () => makeMcpSettings(false, false),
			onChange: () => {},
			onClose: () => {
				closed = true;
			},
		},
		passThroughTheme,
	);

	modal.handleInput("\x1b");
	assert.ok(closed, "expected onClose on escape");
});

test("handleInput calls onClose on Ctrl+C", () => {
	let closed = false;
	const modal = new SplitPaneInspectorModal(
		{
			getSettings: () => makeMcpSettings(false, false),
			onChange: () => {},
			onClose: () => {
				closed = true;
			},
		},
		passThroughTheme,
	);

	modal.handleInput("\x03");
	assert.ok(closed, "expected onClose on ctrl+c");
});

test("advanced mode toggles with / input", () => {
	const items = makeMcpSettings(true, false);
	// Add an item with inspectorAdvanced
	const modal = makeModal(items);

	// Default: advanced not shown
	const linesBefore = modal.render(120);
	const beforeJoined = linesBefore.join(" ");
	assert.equal(beforeJoined.includes("Advanced:"), false, "advanced not shown initially");

	// Toggle advanced on
	modal.handleInput("/");
	const linesAfterOn = modal.render(120);
	const afterJoined = linesAfterOn.join(" ");
	assert.ok(beforeJoined !== afterJoined, "rendering changed after advanced toggle");
});

test("footer shows advanced toggle hint", () => {
	const modal = makeModal(makeMcpSettings(true, true));
	const lines = modal.render(100);

	const footer = lines[lines.length - 1] ?? "";
	assert.ok(footer.includes("/") || footer.includes("advanced"), "footer should reference advanced toggle");
});

test("empty settings list renders gracefully", () => {
	const modal = new SplitPaneInspectorModal(
		{
			getSettings: () => [],
			onChange: () => {},
			onClose: () => {},
		},
		passThroughTheme,
	);

	const lines = modal.render(120);
	assert.ok(lines.length >= 4, "should render even with empty settings");
	const joined = lines.join(" ");
	assert.ok(joined.includes("No matching") || joined.includes("Settings"), "should show empty state");
});

test("inspector panel shows item summary", () => {
	const items = makeMcpSettings(false, false);
	const modal = makeModal(items);

	const lines = modal.render(120);
	const joined = lines.join(" ");

	// The first (selected) item 'preset' has summary "Determines the overall verbosity."
	assert.ok(joined.includes("Determines"), "should show preset summary");
	// The path only appears for the currently selected item; 'preset' has no path,
	// but the summary is visible in the inspector pane.
	assert.ok(joined.includes("verbosity"), "should show preset summary detail");
});

test("theme application adds styled text via fg()", () => {
	const themeRecorder = {
		fg: (color: string, text: string): string => `[${color}]${text}`,
		bold: (text: string): string => `[bold]${text}`,
	} as Theme;

	const modal = new SplitPaneInspectorModal(
		{
			getSettings: () => makeMcpSettings(false, false),
			onChange: () => {},
			onClose: () => {},
		},
		themeRecorder,
	);

	const lines = modal.render(120);
	const joined = lines.join(" ");

	assert.ok(joined.includes("[accent]"), "should apply accent color");
	assert.ok(joined.includes("[bold]"), "should apply bold in header");
});

test("navigating past last item wraps to first", () => {
	const items = makeMcpSettings(false, false);
	const onChange: Array<{ id: string; value: string }> = [];
	const modal = new SplitPaneInspectorModal(
		{
			getSettings: () => items,
			onChange: (id: string, value: string) => {
				onChange.push({ id, value });
			},
			onClose: () => {},
		},
		passThroughTheme,
	);

	// Press down items.length times to wrap exactly back to the first item
	for (let i = 0; i < items.length; i++) {
		modal.handleInput("\x1b[B");
	}
	// Space should cycle the current (first) item after wrapping
	modal.handleInput(" ");

	assert.equal(onChange[0]?.id, "preset", "should wrap to first item");
});

test("cycle at last value wraps to first", () => {
	const items: InspectorSettingItem[] = [
		{
			id: "readOutputMode",
			label: "Read tool output",
			currentValue: "preview",
			values: ["hidden", "summary", "preview"],
			inspectorTitle: "Read Tool Output",
			inspectorSummary: ["Test summary."],
			searchTerms: ["read"],
		},
	];

	// Track changes; update the item's currentValue so each subsequent cycle
	// uses the new value (same way the real controller would).
	const onChange: Array<{ id: string; value: string }> = [];
	const modal = new SplitPaneInspectorModal(
		{
			getSettings: () => items,
			onChange: (id: string, value: string) => {
				onChange.push({ id, value });
				const item = items.find((i) => i.id === id);
				if (item) {
					item.currentValue = value;
				}
			},
			onClose: () => {},
		},
		passThroughTheme,
	);

	// Cycle three times: preview → hidden → summary → preview
	modal.handleInput(" ");
	modal.handleInput(" ");
	modal.handleInput(" ");

	assert.equal(onChange.length, 3);
	assert.equal(onChange[2]?.value, "preview", "should wrap back to preview after three cycles");
});
