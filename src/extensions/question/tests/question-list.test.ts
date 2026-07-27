import test from "node:test";
import assert from "node:assert/strict";

import { Key, matchesKey } from "@earendil-works/pi-tui";

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
const UP_ARROW = "\x1b[A";
const DOWN_ARROW = "\x1b[B";
const BACKSPACE = "\x7f";

// ---------------------------------------------------------------------------
// Single-select tests
// ---------------------------------------------------------------------------

test("SingleSelect: navigate down wraps at end", () => {
	const list = new QuestionList(opts(["a", "b", "c"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
	list.handleInput(CTRL_J); // ctrl+j = vim down
	assert.equal((list as any).selectedIndex, 1);
	list.handleInput(CTRL_J);
	assert.equal((list as any).selectedIndex, 2);
	list.handleInput(CTRL_J);
	assert.equal((list as any).selectedIndex, 0); // wraps
});

test("SingleSelect: navigate up wraps at 0", () => {
	const list = new QuestionList(opts(["a", "b", "c"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
	list.handleInput(CTRL_K); // ctrl+k = vim up
	assert.equal((list as any).selectedIndex, 2); // wraps to last
});

test("SingleSelect: confirm on option → onSubmit with [label]", () => {
	const list = new QuestionList(opts(["a", "b"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(["tui.select.confirm"]), disabledShortcut);
	let submitted: [string[], boolean] | null = null;
	list.onSubmit = (selections, commentEnabled) => (submitted = [selections, commentEnabled]);
	list.handleInput(ENTER);
	assert.deepEqual(submitted, [["a"], false]);
});

test("SingleSelect: confirm on freeform row → onEnterFreeform", () => {
	const list = new QuestionList(opts(["a"]), SingleSelect, true, false, fakeTheme, fakeKeybindings(["tui.select.confirm"]), disabledShortcut);
	let called = false;
	list.onEnterFreeform = () => (called = true);
	// Navigate to freeform row (index 1, since 1 option + 0 comment = freeform at index 1)
	list.handleInput(CTRL_J);
	list.handleInput(ENTER);
	assert.equal(called, true);
});

test("SingleSelect: no options with freeform → opens custom response", () => {
	const list = new QuestionList([], SingleSelect, true, false, fakeTheme, fakeKeybindings(["tui.select.confirm"]), disabledShortcut);
	let called = false;
	list.onEnterFreeform = () => (called = true);
	list.handleInput(ENTER);
	assert.equal(called, true);
});

test("SingleSelect: confirm on comment-toggle → toggles comment, no submit", () => {
	const list = new QuestionList(opts(["a"]), SingleSelect, false, true, fakeTheme, fakeKeybindings(["tui.select.confirm"]), disabledShortcut);
	let submitted = false;
	list.onSubmit = () => (submitted = true);
	// Navigate to comment-toggle row (index 1)
	list.handleInput(CTRL_J);
	list.handleInput(ENTER);
	assert.equal(list.isCommentEnabled(), true);
	assert.equal(submitted, false);
});

test("SingleSelect: number key selects (no toggle)", () => {
	const list = new QuestionList(opts(["a", "b", "c"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
	list.handleInput("3");
	assert.equal((list as any).selectedIndex, 2);
	// No toggle in single-select
	assert.equal((list as any).checked.size, 0);
});

test("SingleSelect: escape with search query → clears search", () => {
	const list = new QuestionList(opts(["a", "b"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
	list.handleInput("a"); // type into search
	assert.equal((list as any).searchQuery, "a");
	list.handleInput(ESC);
	assert.equal((list as any).searchQuery, "");
});

test("SingleSelect: escape without search → not handled by list (cancel is via keybinding)", () => {
	const list = new QuestionList(opts(["a"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(["tui.select.cancel"]), disabledShortcut);
	let cancelled = false;
	list.onCancel = () => (cancelled = true);
	// In single-select, escape without search query is not handled by the list at all.
	// The keybinding check for cancel comes AFTER the escape-clears-search check.
	// Since searchQuery is empty, escape falls through to cancel keybinding check.
	// With fakeKeybindings matching "tui.select.cancel", it WILL cancel.
	list.handleInput(ESC);
	assert.equal(cancelled, true);
});

// ---------------------------------------------------------------------------
// Multi-select tests
// ---------------------------------------------------------------------------

test("MultiSelect: space on option → toggles checked", () => {
	const list = new QuestionList(opts(["a", "b"]), MultiSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
	list.handleInput(SPACE);
	assert.equal((list as any).checked.has(0), true);
	list.handleInput(SPACE);
	assert.equal((list as any).checked.has(0), false);
});

test("MultiSelect: number key toggles + selects", () => {
	const list = new QuestionList(opts(["a", "b", "c"]), MultiSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
	list.handleInput("2");
	assert.equal((list as any).checked.has(1), true);
	assert.equal((list as any).selectedIndex, 1);
});

test("MultiSelect: confirm with checked items → onSubmit with sorted labels", () => {
	const list = new QuestionList(opts(["a", "b", "c"]), MultiSelect, false, false, fakeTheme, fakeKeybindings(["tui.select.confirm"]), disabledShortcut);
	let submitted: [string[], boolean] | null = null;
	list.onSubmit = (selections, commentEnabled) => (submitted = [selections, commentEnabled]);
	// Check items 2 and 1 (out of order)
	list.handleInput("2");
	list.handleInput("1");
	list.handleInput(ENTER);
	assert.deepEqual(submitted, [["a", "b"], false]); // sorted by index
});

test("QuestionList: restores saved multi-select choices and comment state", () => {
	const list = new QuestionList(opts(["a", "b", "c"]), MultiSelect, false, true, fakeTheme, fakeKeybindings(), disabledShortcut);
	list.restoreSelection(["a", "c"], "reason");
	assert.deepEqual([...((list as any).checked)], [0, 2]);
	assert.equal((list as any).selectedIndex, 0);
	assert.equal(list.isCommentEnabled(), true);
});

test("QuestionList: restores saved single-select cursor", () => {
	const list = new QuestionList(opts(["a", "b", "c"]), SingleSelect, false, false, fakeTheme, fakeKeybindings(), disabledShortcut);
	list.restoreSelection(["b"]);
	assert.equal((list as any).selectedIndex, 1);
});

test("MultiSelect: confirm with nothing checked → empty selection", () => {
	const list = new QuestionList(opts(["a", "b"]), MultiSelect, false, false, fakeTheme, fakeKeybindings(["tui.select.confirm"]), disabledShortcut);
	let submitted: [string[], boolean] | null = null;
	list.onSubmit = (selections, commentEnabled) => (submitted = [selections, commentEnabled]);
	list.handleInput(ENTER);
	assert.deepEqual(submitted, [[], false]);
});

test("MultiSelect: confirm with no options → onCancel", () => {
	const list = new QuestionList([], MultiSelect, false, false, fakeTheme, fakeKeybindings(["tui.select.confirm"]), disabledShortcut);
	let cancelled = false;
	list.onCancel = () => (cancelled = true);
	list.handleInput(ENTER);
	assert.equal(cancelled, true);
});

test("MultiSelect: confirm on comment-toggle → toggles comment", () => {
	const list = new QuestionList(opts(["a"]), MultiSelect, false, true, fakeTheme, fakeKeybindings(["tui.select.confirm"]), disabledShortcut);
	let submitted = false;
	list.onSubmit = () => (submitted = true);
	// Navigate to comment-toggle (index 1)
	list.handleInput(CTRL_J);
	list.handleInput(ENTER);
	assert.equal(list.isCommentEnabled(), true);
	assert.equal(submitted, false);
});

test("MultiSelect: confirm on freeform → onEnterFreeform", () => {
	const list = new QuestionList(opts(["a"]), MultiSelect, true, false, fakeTheme, fakeKeybindings(["tui.select.confirm"]), disabledShortcut);
	let called = false;
	list.onEnterFreeform = () => (called = true);
	// Navigate to freeform row (index 1)
	list.handleInput(CTRL_J);
	list.handleInput(ENTER);
	assert.equal(called, true);
});

// ---------------------------------------------------------------------------
// Comment toggle tests (both modes)
// ---------------------------------------------------------------------------

test("Comment toggle via shortcut: toggles commentEnabled", () => {
	const list = new QuestionList(opts(["a"]), SingleSelect, false, true, fakeTheme, fakeKeybindings(), enabledShortcut);
	assert.equal(list.isCommentEnabled(), false);
	list.handleInput(CTRL_K); // ctrl+k = our comment toggle key... wait, spec is "ctrl+g"
	// Actually the shortcut spec is "ctrl+g", so we need to send ctrl+g data
	const CTRL_G = "\x07";
	list.handleInput(CTRL_G);
	assert.equal(list.isCommentEnabled(), true);
	list.handleInput(CTRL_G);
	assert.equal(list.isCommentEnabled(), false);
});

test("Comment toggle disabled: does nothing", () => {
	const list = new QuestionList(opts(["a"]), SingleSelect, false, true, fakeTheme, fakeKeybindings(), disabledShortcut);
	const CTRL_G = "\x07";
	list.handleInput(CTRL_G);
	assert.equal(list.isCommentEnabled(), false);
});

// ---------------------------------------------------------------------------
// onSubmit includes commentEnabled flag
// ---------------------------------------------------------------------------

test("onSubmit passes commentEnabled=true when comment is enabled", () => {
	const list = new QuestionList(opts(["a", "b"]), SingleSelect, false, true, fakeTheme, fakeKeybindings(["tui.select.confirm"]), enabledShortcut);
	let submitted: [string[], boolean] | null = null;
	list.onSubmit = (selections, commentEnabled) => (submitted = [selections, commentEnabled]);
	const CTRL_G = "\x07";
	list.handleInput(CTRL_G); // enable comment
	list.handleInput(ENTER); // confirm
	assert.deepEqual(submitted, [["a"], true]);
});
