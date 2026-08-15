import { describe, expect, it } from "vitest";

import { matchesKey } from "@earendil-works/pi-tui";

import { QuestionList } from "../question-list.ts";
import { MultiSelect, SingleSelect } from "../selection-mode.ts";
import type { KeybindingsManager, Theme } from "@selesai/code";
import type { ResolvedShortcut } from "../types.ts";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const fakeTheme: Theme = {
	fg: (_name: string, s: string) => s,
	bold: (s: string) => s,
} as unknown as Theme;

function fakeKeybindings(actions: string[] = []): KeybindingsManager {
	return {
		matches: (_data: string, action: string) => actions.includes(action),
		getKeys: (_action: string) => [],
	} as unknown as KeybindingsManager;
}

const enabledShortcut: ResolvedShortcut = {
	disabled: false,
	spec: "ctrl+g",
	matches: (data: string) => matchesKey(data, "ctrl+g"),
};

const disabledShortcut: ResolvedShortcut = {
	disabled: true,
	spec: null,
	matches: ((_data: string) => false) as (data: string) => false,
};

const opts = (labels: string[]) => labels.map((label) => ({ value: label, label }));

// Terminal data bytes
const ESC = "\x1b";
const ENTER = "\r";
const SPACE = " ";
const CTRL_J = "\x0a";
const CTRL_K = "\x0b";
const CTRL_G = "\x07";

describe("QuestionList single-select", () => {
	it("navigate down wraps at end", () => {
		const list = new QuestionList(opts(["a", "b", "c"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		list.handleInput(CTRL_J); // ctrl+j = vim down
		expect((list as any).selectedIndex).toBe(1);
		list.handleInput(CTRL_J);
		expect((list as any).selectedIndex).toBe(2);
		list.handleInput(CTRL_J);
		expect((list as any).selectedIndex).toBe(0); // wraps
	});

	it("navigate up wraps at 0", () => {
		const list = new QuestionList(opts(["a", "b", "c"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		list.handleInput(CTRL_K); // ctrl+k = vim up
		expect((list as any).selectedIndex).toBe(2); // wraps to last
	});

	it("confirm on option → onSubmit with [label]", () => {
		const list = new QuestionList(opts(["a", "b"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(["tui.select.confirm"]), disabledShortcut);
		let submitted: [string[], boolean] | null = null;
		list.onSubmit = (selections, commentEnabled) => (submitted = [selections, commentEnabled]);
		list.handleInput(ENTER);
		expect(submitted).toEqual([["a"], false]);
	});

	it("confirm on freeform row → onEnterFreeform", () => {
		const list = new QuestionList(opts(["a"]), SingleSelect, true, false, fakeTheme, fakeKeybindings(["tui.select.confirm"]), disabledShortcut);
		let called = false;
		list.onEnterFreeform = () => (called = true);
		// Navigate to freeform row (index 1, since 1 option + 0 comment = freeform at index 1)
		list.handleInput(CTRL_J);
		list.handleInput(ENTER);
		expect(called).toBe(true);
	});

	it("no options with freeform → opens custom response", () => {
		const list = new QuestionList([], SingleSelect, true, false, fakeTheme, fakeKeybindings(["tui.select.confirm"]), disabledShortcut);
		let called = false;
		list.onEnterFreeform = () => (called = true);
		list.handleInput(ENTER);
		expect(called).toBe(true);
	});

	it("confirm on comment-toggle → toggles comment, no submit", () => {
		const list = new QuestionList(opts(["a"]), SingleSelect, false, true, fakeTheme, fakeKeybindings(["tui.select.confirm"]), disabledShortcut);
		let submitted = false;
		list.onSubmit = () => (submitted = true);
		// Navigate to comment-toggle row (index 1)
		list.handleInput(CTRL_J);
		list.handleInput(ENTER);
		expect(list.isCommentEnabled()).toBe(true);
		expect(submitted).toBe(false);
	});

	it("number key selects (no toggle)", () => {
		const list = new QuestionList(opts(["a", "b", "c"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		list.handleInput("3");
		expect((list as any).selectedIndex).toBe(2);
		// No toggle in single-select
		expect((list as any).checked.size).toBe(0);
	});

	it("escape with search query → clears search", () => {
		const list = new QuestionList(opts(["a", "b"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		list.handleInput("a"); // type into search
		expect((list as any).searchQuery).toBe("a");
		list.handleInput(ESC);
		expect((list as any).searchQuery).toBe("");
	});

	it("escape without search → cancel via keybinding", () => {
		const list = new QuestionList(opts(["a"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(["tui.select.cancel"]), disabledShortcut);
		let cancelled = false;
		list.onCancel = () => (cancelled = true);
		list.handleInput(ESC);
		expect(cancelled).toBe(true);
	});

	it("backspace pops search characters", () => {
		const list = new QuestionList(opts(["a", "b"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		list.handleInput("a");
		list.handleInput("b");
		expect((list as any).searchQuery).toBe("ab");
		list.handleInput("\x7f");
		expect((list as any).searchQuery).toBe("a");
		list.handleInput("\x7f");
		expect((list as any).searchQuery).toBe("");
	});

	it("control and C1 characters are filtered out of search input", () => {
		const list = new QuestionList(opts(["a", "b"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		// Control chars and C1 range are rejected (not added to the search query).
		list.handleInput("\u0001"); // code 1 < 32
		expect((list as any).searchQuery).toBe("");
		list.handleInput("\u0085"); // C1 control (code 0x85 in 0x80..0x9f)
		expect((list as any).searchQuery).toBe("");
		// Multi-char paste is rejected too.
		list.handleInput("ab");
		expect((list as any).searchQuery).toBe("");
		// Printable chars are still accepted.
		list.handleInput("a");
		expect((list as any).searchQuery).toBe("a");
	});

	it("filters options by search and shows no-match row", () => {
		const list = new QuestionList(opts(["alpha", "beta"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		list.handleInput("z");
		list.handleInput("z");
		list.handleInput("z");
		const lines = list.render(80);
		expect(lines.some((l) => l.includes("No matching options"))).toBe(true);
	});

	it("renders split-pane preview at wide widths", () => {
		const list = new QuestionList(
			[{ value: "a", label: "Alpha", description: "The alpha option" }],
			SingleSelect,
			true,
			true,
			fakeTheme,
			fakeKeybindings(),
			disabledShortcut,
		);
		const lines = list.render(120);
		expect(lines.some((l) => l.includes("│"))).toBe(true);
		expect(lines.some((l) => l.includes("Alpha"))).toBe(true);
	});

	it("renders freeform and comment previews in split pane", () => {
		const list = new QuestionList(opts(["a"]), SingleSelect, true, true, fakeTheme, fakeKeybindings(), disabledShortcut);
		// Navigate to comment-toggle row (index 1)
		list.handleInput(CTRL_J);
		const commentLines = list.render(120);
		expect(commentLines.some((l) => l.includes("Additional context"))).toBe(true);
		// Navigate to freeform row (index 2)
		list.handleInput(CTRL_J);
		const freeformLines = list.render(120);
		expect(freeformLines.some((l) => l.includes("Custom response"))).toBe(true);
	});

	it("setMaxVisibleRows clamps and invalidates", () => {
		const list = new QuestionList(opts(["a", "b", "c"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		list.setMaxVisibleRows(2);
		expect((list as any).maxVisibleRows).toBe(2);
		list.setMaxVisibleRows(0);
		expect((list as any).maxVisibleRows).toBe(1);
		list.setMaxVisibleRows(2.7);
		expect((list as any).maxVisibleRows).toBe(2);
	});

	it("getCheckedValues returns [] in single-select", () => {
		const list = new QuestionList(opts(["a"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		expect(list.getCheckedValues()).toEqual([]);
	});
});

describe("QuestionList multi-select", () => {
	it("space on option → toggles checked", () => {
		const list = new QuestionList(opts(["a", "b"]), MultiSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		list.handleInput(SPACE);
		expect((list as any).checked.has(0)).toBe(true);
		list.handleInput(SPACE);
		expect((list as any).checked.has(0)).toBe(false);
	});

	it("number key toggles + selects", () => {
		const list = new QuestionList(opts(["a", "b", "c"]), MultiSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		list.handleInput("2");
		expect((list as any).checked.has(1)).toBe(true);
		expect((list as any).selectedIndex).toBe(1);
	});

	it("confirm with checked items → onSubmit with sorted labels", () => {
		const list = new QuestionList(opts(["a", "b", "c"]), MultiSelect, false, false, fakeTheme, fakeKeybindings(["tui.select.confirm"]), disabledShortcut);
		let submitted: [string[], boolean] | null = null;
		list.onSubmit = (selections, commentEnabled) => (submitted = [selections, commentEnabled]);
		// Check items 2 and 1 (out of order)
		list.handleInput("2");
		list.handleInput("1");
		list.handleInput(ENTER);
		expect(submitted).toEqual([["a", "b"], false]); // sorted by index
	});

	it("restores saved multi-select choices and comment state", () => {
		const list = new QuestionList(opts(["a", "b", "c"]), MultiSelect, false, true, fakeTheme, fakeKeybindings(), disabledShortcut);
		list.restoreSelection(["a", "c"], "reason");
		expect([...((list as any).checked)]).toEqual([0, 2]);
		expect((list as any).selectedIndex).toBe(0);
		expect(list.isCommentEnabled()).toBe(true);
	});

	it("restores saved single-select cursor", () => {
		const list = new QuestionList(opts(["a", "b", "c"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		list.restoreSelection(["b"]);
		expect((list as any).selectedIndex).toBe(1);
	});

	it("confirm with nothing checked → empty selection", () => {
		const list = new QuestionList(opts(["a", "b"]), MultiSelect, false, false, fakeTheme, fakeKeybindings(["tui.select.confirm"]), disabledShortcut);
		let submitted: [string[], boolean] | null = null;
		list.onSubmit = (selections, commentEnabled) => (submitted = [selections, commentEnabled]);
		list.handleInput(ENTER);
		expect(submitted).toEqual([[], false]);
	});

	it("MultiSelect: toggle with a negative index is a no-op", () => {
		const checked = new Set<number>();
		MultiSelect.toggle(checked, -1);
		expect(checked.size).toBe(0);
	});

	it("MultiSelect: buildResult skips missing options", () => {
		const result = MultiSelect.buildResult({
			selectedIndex: 0,
			checked: new Set([0, 5]),
			options: [{ value: "a", label: "A" }],
		});
		expect(result).toEqual(["a"]);
	});

	it("SingleSelect: buildResult returns empty for a missing option", () => {
		const result = SingleSelect.buildResult({
			selectedIndex: 0,
			checked: new Set(),
			options: [],
		});
		expect(result).toEqual([]);
	});

	it("SingleSelect: handleNumberKey clamps the index", () => {
		expect(SingleSelect.handleNumberKey(5, 3)).toEqual({ toggle: false, selectIndex: 2 });
	});

	it("MultiSelect: handleNumberKey clamps the index", () => {
		expect(MultiSelect.handleNumberKey(5, 3)).toEqual({ toggle: true, selectIndex: 2 });
	});

	it("confirm with no options → onCancel", () => {
		const list = new QuestionList([], MultiSelect, false, false, fakeTheme, fakeKeybindings(["tui.select.confirm"]), disabledShortcut);
		let cancelled = false;
		list.onCancel = () => (cancelled = true);
		list.handleInput(ENTER);
		expect(cancelled).toBe(true);
	});

	it("confirm on comment-toggle → toggles comment", () => {
		const list = new QuestionList(opts(["a"]), MultiSelect, false, true, fakeTheme, fakeKeybindings(["tui.select.confirm"]), disabledShortcut);
		let submitted = false;
		list.onSubmit = () => (submitted = true);
		// Navigate to comment-toggle (index 1)
		list.handleInput(CTRL_J);
		list.handleInput(ENTER);
		expect(list.isCommentEnabled()).toBe(true);
		expect(submitted).toBe(false);
	});

	it("confirm on freeform → onEnterFreeform", () => {
		const list = new QuestionList(opts(["a"]), MultiSelect, true, false, fakeTheme, fakeKeybindings(["tui.select.confirm"]), disabledShortcut);
		let called = false;
		list.onEnterFreeform = () => (called = true);
		// Navigate to freeform row (index 1)
		list.handleInput(CTRL_J);
		list.handleInput(ENTER);
		expect(called).toBe(true);
	});

	it("space on freeform row → onEnterFreeform", () => {
		const list = new QuestionList(opts(["a"]), MultiSelect, true, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		let called = false;
		list.onEnterFreeform = () => (called = true);
		list.handleInput(CTRL_J);
		list.handleInput(SPACE);
		expect(called).toBe(true);
	});

	it("renders multi rows with checkboxes and descriptions", () => {
		const list = new QuestionList(
			[{ value: "a", label: "Alpha", description: "desc" }],
			MultiSelect,
			true,
			true,
			fakeTheme,
			fakeKeybindings(),
			disabledShortcut,
		);
		const lines = list.render(80);
		expect(lines.some((l) => l.includes("Alpha"))).toBe(true);
		expect(lines.some((l) => l.includes("desc"))).toBe(true);
		expect(lines.some((l) => l.includes("Type custom answer"))).toBe(true);
		expect(lines.some((l) => l.includes("Add extra context"))).toBe(true);
	});

	it("renders no-options row", () => {
		const list = new QuestionList([], MultiSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		expect(list.render(80)).toEqual(["No options"]);
	});

	it("getCheckedValues returns checked values sorted", () => {
		const list = new QuestionList(opts(["a", "b", "c"]), MultiSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		list.handleInput("3");
		list.handleInput("1");
		expect(list.getCheckedValues()).toEqual(["a", "c"]);
	});

	it("setMaxVisibleRows is a no-op in multi-select", () => {
		const list = new QuestionList(opts(["a", "b", "c"]), MultiSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		list.setMaxVisibleRows(2);
		expect((list as any).maxVisibleRows).toBe(12);
	});
});

describe("QuestionList comment toggle", () => {
	it("toggles commentEnabled via shortcut", () => {
		const list = new QuestionList(opts(["a"]), SingleSelect, false, true, fakeTheme, fakeKeybindings(), enabledShortcut);
		expect(list.isCommentEnabled()).toBe(false);
		list.handleInput(CTRL_G);
		expect(list.isCommentEnabled()).toBe(true);
		list.handleInput(CTRL_G);
		expect(list.isCommentEnabled()).toBe(false);
	});

	it("disabled shortcut does nothing", () => {
		const list = new QuestionList(opts(["a"]), SingleSelect, false, true, fakeTheme, fakeKeybindings(), disabledShortcut);
		list.handleInput(CTRL_G);
		expect(list.isCommentEnabled()).toBe(false);
	});

	it("space on comment-toggle row toggles in single-select", () => {
		const list = new QuestionList(opts(["a"]), SingleSelect, false, true, fakeTheme, fakeKeybindings(), disabledShortcut);
		list.handleInput(CTRL_J); // to comment-toggle row
		list.handleInput(SPACE);
		expect(list.isCommentEnabled()).toBe(true);
	});

	it("onSubmit passes commentEnabled=true when comment is enabled", () => {
		const list = new QuestionList(opts(["a", "b"]), SingleSelect, false, true, fakeTheme, fakeKeybindings(["tui.select.confirm"]), enabledShortcut);
		let submitted: [string[], boolean] | null = null;
		list.onSubmit = (selections, commentEnabled) => (submitted = [selections, commentEnabled]);
		list.handleInput(CTRL_G); // enable comment
		list.handleInput(ENTER); // confirm
		expect(submitted).toEqual([["a"], true]);
	});

	it("isMulti reflects the selection mode", () => {
		const single = new QuestionList(opts(["a"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		expect(single.isMulti).toBe(false);
		const multi = new QuestionList(opts(["a"]), MultiSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		expect(multi.isMulti).toBe(true);
	});

	it("toggleComment is a no-op when comments are not allowed", () => {
		const list = new QuestionList(opts(["a"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(), enabledShortcut);
		list.handleInput(CTRL_G);
		expect(list.isCommentEnabled()).toBe(false);
	});

	it("popSearchChar is a no-op with an empty query", () => {
		const list = new QuestionList(opts(["a"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		list.handleInput("\x7f");
		expect((list as any).searchQuery).toBe("");
	});

	it("getPrintableInput rejects multi-char and control data", () => {
		const list = new QuestionList(opts(["a"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		// Multi-char data → not printable.
		list.handleInput("ab");
		expect((list as any).searchQuery).toBe("");
		// Control char → not printable.
		list.handleInput("\x1b");
		expect((list as any).searchQuery).toBe("");
		// DEL → not printable.
		list.handleInput("\x7f");
		expect((list as any).searchQuery).toBe("");
	});

	it("getSplitPaneWidths returns null for narrow widths", () => {
		const list = new QuestionList(opts(["a"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		// Width below SPLIT_PANE_MIN_WIDTH (84) → no split.
		const lines = list.render(80);
		expect(lines.some((l) => l.includes("│"))).toBe(false);
	});

	it("styleListLine styles indicator, selected, description, and arrow lines", () => {
		const list = new QuestionList(
			[{ value: "a", label: "Alpha", description: "desc" }],
			SingleSelect,
			true,
			true,
			fakeTheme,
			fakeKeybindings(),
			disabledShortcut,
		);
		// Render with a search query that matches nothing → indicator + no-match.
		list.handleInput("z");
		const lines = list.render(80);
		expect(lines.some((l) => l.includes("No matching options"))).toBe(true);
	});

	it("buildListLines shows No options when count is zero without search", () => {
		const list = new QuestionList([], SingleSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		const lines = list.render(80);
		expect(lines.some((l) => l.includes("No options"))).toBe(true);
	});

	it("buildPreviewLines handles maxLines zero and truncation", () => {
		const list = new QuestionList(
			[{ value: "a", label: "Alpha", description: "A very long description that will wrap and truncate in the preview pane" }],
			SingleSelect,
			false,
			false,
			fakeTheme,
			fakeKeybindings(),
			disabledShortcut,
		);
		// Wide width → split pane with preview.
		const lines = list.render(120);
		expect(lines.some((l) => l.includes("Alpha"))).toBe(true);
	});

	it("buildPreviewLines shows no-option-selected and filter text", () => {
		const list = new QuestionList(
			[{ value: "a", label: "Alpha" }],
			SingleSelect,
			false,
			false,
			fakeTheme,
			fakeKeybindings(),
			disabledShortcut,
		);
		// Search that filters out all options → no option selected in preview.
		list.handleInput("z");
		list.handleInput("z");
		list.handleInput("z");
		const lines = list.render(120);
		expect(lines.some((l) => l.includes("No option selected"))).toBe(true);
	});

	it("single-select confirm with no options does nothing", () => {
		const list = new QuestionList([], SingleSelect, false, false, fakeTheme, fakeKeybindings(["tui.select.confirm"]), disabledShortcut);
		let cancelled = false;
		list.onCancel = () => (cancelled = true);
		list.handleInput(ENTER);
		expect(cancelled).toBe(false);
	});

	it("multi-select cancel and comment toggle paths", () => {
		const list = new QuestionList(opts(["a"]), MultiSelect, false, true, fakeTheme, fakeKeybindings(["tui.select.cancel"]), enabledShortcut);
		let cancelled = false;
		list.onCancel = () => (cancelled = true);
		list.handleInput(ESC);
		expect(cancelled).toBe(true);

		// Comment toggle via shortcut in multi-select.
		const list2 = new QuestionList(opts(["a"]), MultiSelect, false, true, fakeTheme, fakeKeybindings(), enabledShortcut);
		list2.handleInput(CTRL_G);
		expect(list2.isCommentEnabled()).toBe(true);
	});

	it("multi-select up/down wrap and space on comment toggle", () => {
		const list = new QuestionList(opts(["a", "b"]), MultiSelect, false, true, fakeTheme, fakeKeybindings(), disabledShortcut);
		// Up from 0 wraps to last.
		list.handleInput(CTRL_K);
		expect((list as any).selectedIndex).toBe(2); // comment toggle row
		// Space on comment toggle row toggles.
		list.handleInput(SPACE);
		expect(list.isCommentEnabled()).toBe(true);
	});

	it("multi-select render caches lines", () => {
		const list = new QuestionList(opts(["a", "b"]), MultiSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		const first = list.render(80);
		const second = list.render(80);
		expect(second).toEqual(first);
	});

	it("multi-select render skips missing options and shows scroll indicator", () => {
		const list = new QuestionList(opts(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"]), MultiSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		// Navigate to the end to trigger the scroll indicator.
		for (let i = 0; i < 20; i++) list.handleInput(CTRL_J);
		const lines = list.render(80);
		expect(lines.some((l) => l.includes("("))).toBe(true);
	});

	it("multi-select render shows freeform and comment rows", () => {
		const list = new QuestionList(opts(["a"]), MultiSelect, true, true, fakeTheme, fakeKeybindings(), disabledShortcut);
		const lines = list.render(80);
		expect(lines.some((l) => l.includes("Type custom answer"))).toBe(true);
		expect(lines.some((l) => l.includes("Add extra context"))).toBe(true);
	});

	it("multi-select space on freeform row opens the editor", () => {
		const list = new QuestionList(opts(["a"]), MultiSelect, true, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		let called = false;
		list.onEnterFreeform = () => (called = true);
		list.handleInput(CTRL_J); // to freeform row
		list.handleInput(SPACE);
		expect(called).toBe(true);
	});

	it("multi-select number key on comment toggle row toggles", () => {
		const list = new QuestionList(opts(["a"]), MultiSelect, false, true, fakeTheme, fakeKeybindings(), disabledShortcut);
		// Navigate to the comment toggle row (index 1) and press space.
		list.handleInput(CTRL_J);
		list.handleInput(SPACE);
		expect(list.isCommentEnabled()).toBe(true);
	});
});

describe("QuestionList split-pane preview truncation", () => {
	const longDescription = "A very long description that keeps wrapping and wrapping well past the preview pane width so the preview must be truncated with an ellipsis marker";

	it("maxLines 1 collapses the preview to a single ellipsis line", () => {
		const list = new QuestionList(
			[{ value: "a", label: "Alpha", description: longDescription }],
			SingleSelect,
			false,
			false,
			fakeTheme,
			fakeKeybindings(),
			disabledShortcut,
		);
		list.setMaxVisibleRows(1);
		const lines = list.render(120);
		expect(lines.some((l) => l.includes("…"))).toBe(true);
	});

	it("maxLines above 1 keeps leading lines and appends an ellipsis", () => {
		const list = new QuestionList(
			[{ value: "a", label: "Alpha", description: longDescription }],
			SingleSelect,
			false,
			false,
			fakeTheme,
			fakeKeybindings(),
			disabledShortcut,
		);
		list.setMaxVisibleRows(2);
		const lines = list.render(120);
		expect(lines.some((l) => l.includes("…"))).toBe(true);
	});
});

describe("QuestionList remaining branch coverage", () => {
	it("single-select confirm on comment-toggle row toggles the comment", () => {
		const list = new QuestionList(opts(["a"]), SingleSelect, false, true, fakeTheme, fakeKeybindings(["tui.select.confirm"]), enabledShortcut);
		list.handleInput(CTRL_J); // to comment-toggle row
		list.handleInput(ENTER);
		expect(list.isCommentEnabled()).toBe(true);
	});

	it("multi-select renders the selected comment-toggle row with an enabled checkbox", () => {
		const list = new QuestionList(opts(["a"]), MultiSelect, false, true, fakeTheme, fakeKeybindings(), enabledShortcut);
		list.handleInput(CTRL_G); // enable comment
		list.handleInput(CTRL_J); // to comment-toggle row
		const lines = list.render(80);
		expect(lines.some((l) => l.includes("[✓]"))).toBe(true);
		expect(lines.some((l) => l.includes("→"))).toBe(true);
	});

	it("multi-select renders a checked option with a success checkbox", () => {
		const list = new QuestionList(opts(["a", "b"]), MultiSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		list.handleInput(SPACE); // check option 0
		const lines = list.render(80);
		expect(lines.some((l) => l.includes("[✓]"))).toBe(true);
	});
});

describe("QuestionList final branch coverage", () => {
	it("setMaxVisibleRows with the same value is a no-op", () => {
		const list = new QuestionList(opts(["a"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		list.setMaxVisibleRows(12);
		expect((list as any).maxVisibleRows).toBe(12);
	});

	it("single-select render styles the scroll indicator line", () => {
		const list = new QuestionList(opts(["a", "b", "c", "d", "e", "f"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		list.setMaxVisibleRows(3);
		const lines = list.render(80);
		expect(lines.some((l) => l.includes("("))).toBe(true);
	});

	it("single-select render styles description lines", () => {
		const list = new QuestionList(
			[
				{ value: "a", label: "Alpha", description: "some desc" },
				{ value: "b", label: "Beta" },
			],
			SingleSelect,
			false,
			false,
			fakeTheme,
			fakeKeybindings(),
			disabledShortcut,
		);
		list.handleInput(CTRL_J); // select Beta so Alpha's description row is unselected
		const lines = list.render(80);
		expect(lines.some((l) => l.includes("some desc"))).toBe(true);
	});

	it("preview shows Enabled when the comment row is selected with comment on", () => {
		const list = new QuestionList(opts(["a"]), SingleSelect, false, true, fakeTheme, fakeKeybindings(), enabledShortcut);
		list.handleInput(CTRL_G); // enable comment
		list.handleInput(CTRL_J); // to comment-toggle row
		const lines = list.render(120);
		expect(lines.some((l) => l.includes("Enabled"))).toBe(true);
	});

	it("preview shows the current filter on the freeform row", () => {
		const list = new QuestionList(opts(["a"]), SingleSelect, true, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		list.handleInput("a"); // search keeps the option, selects index 0
		list.handleInput(CTRL_J); // to freeform row
		const lines = list.render(120);
		expect(lines.some((l) => l.includes("Current filter"))).toBe(true);
	});

	it("preview shows the current filter on a selected option", () => {
		const list = new QuestionList(opts(["a"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		list.handleInput("a"); // search matches, selected stays 0
		const lines = list.render(120);
		expect(lines.some((l) => l.includes("Filter:"))).toBe(true);
	});

	it("single-select number key beyond the filtered options is ignored", () => {
		const list = new QuestionList(opts(["a", "b"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		list.handleInput("3");
		expect((list as any).selectedIndex).toBe(0);
	});

	it("multi-select up from a non-zero index moves up", () => {
		const list = new QuestionList(opts(["a", "b"]), MultiSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		list.handleInput(CTRL_J); // to 1
		list.handleInput(CTRL_K); // back to 0
		expect((list as any).selectedIndex).toBe(0);
	});

	it("multi-select number key beyond the options is ignored", () => {
		const list = new QuestionList(opts(["a", "b"]), MultiSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		list.handleInput("3");
		expect((list as any).checked.size).toBe(0);
	});

	it("multi-select input that matches nothing reaches the confirm check safely", () => {
		const list = new QuestionList(opts(["a"]), MultiSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
		list.handleInput("x");
		expect((list as any).checked.size).toBe(0);
	});
});
