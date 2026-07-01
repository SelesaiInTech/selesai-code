import test from "node:test";
import assert from "node:assert/strict";

import { normalizeShortcutSpec, isValidShortcutSpec, resolveShortcut } from "../shortcuts.ts";
import { DISABLED_SHORTCUT } from "../constants.ts";

test("normalizeShortcutSpec: undefined → undefined", () => {
	assert.equal(normalizeShortcutSpec(undefined), undefined);
});

test("normalizeShortcutSpec: null → null", () => {
	assert.equal(normalizeShortcutSpec(null), null);
});

test("normalizeShortcutSpec: disable values → null", () => {
	assert.equal(normalizeShortcutSpec("off"), null);
	assert.equal(normalizeShortcutSpec("none"), null);
	assert.equal(normalizeShortcutSpec("disabled"), null);
	assert.equal(normalizeShortcutSpec(""), null);
	assert.equal(normalizeShortcutSpec("  off  "), null);
});

test("normalizeShortcutSpec: normalizes case and trims", () => {
	assert.equal(normalizeShortcutSpec("Alt+O"), "alt+o");
	assert.equal(normalizeShortcutSpec("  Ctrl+G  "), "ctrl+g");
});

test("isValidShortcutSpec: empty → false", () => {
	assert.equal(isValidShortcutSpec(""), false);
	assert.equal(isValidShortcutSpec(" "), false);
});

test("isValidShortcutSpec: valid specs", () => {
	assert.equal(isValidShortcutSpec("alt+o"), true);
	assert.equal(isValidShortcutSpec("ctrl+g"), true);
	assert.equal(isValidShortcutSpec("shift+f1"), true);
});

test("isValidShortcutSpec: leading/trailing + → false", () => {
	assert.equal(isValidShortcutSpec("+o"), false);
	assert.equal(isValidShortcutSpec("o+"), false);
});

test("isValidShortcutSpec: double + → false", () => {
	assert.equal(isValidShortcutSpec("alt++o"), false);
});

test("resolveShortcut: uses param when valid", () => {
	const result = resolveShortcut("alt+o", undefined, "alt+o");
	assert.equal(result.disabled, false);
	assert.equal(result.spec, "alt+o");
});

test("resolveShortcut: param undefined, uses env", () => {
	const result = resolveShortcut(undefined, "ctrl+x", "alt+o");
	assert.equal(result.disabled, false);
	assert.equal(result.spec, "ctrl+x");
});

test("resolveShortcut: param null → disabled", () => {
	const result = resolveShortcut(null, "ctrl+x", "alt+o");
	assert.equal(result, DISABLED_SHORTCUT);
});

test("resolveShortcut: param undefined, env undefined, uses default", () => {
	const result = resolveShortcut(undefined, undefined, "alt+o");
	assert.equal(result.disabled, false);
	assert.equal(result.spec, "alt+o");
});

test("resolveShortcut: param 'off' → disabled", () => {
	const result = resolveShortcut("off", "ctrl+x", "alt+o");
	assert.equal(result, DISABLED_SHORTCUT);
});

test("resolveShortcut: invalid param falls through to env", () => {
	const result = resolveShortcut("invalid++", "ctrl+x", "alt+o");
	assert.equal(result.disabled, false);
	assert.equal(result.spec, "ctrl+x");
});

test("resolveShortcut: all invalid → disabled", () => {
	const result = resolveShortcut("invalid++", "also++", "default++");
	assert.equal(result, DISABLED_SHORTCUT);
});