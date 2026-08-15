import { describe, expect, it } from "vitest";

import { normalizeShortcutSpec, isValidShortcutSpec, resolveShortcut, resolveShortcuts, buildShortcut } from "../shortcuts.ts";
import { DISABLED_SHORTCUT, DEFAULT_COMMENT_TOGGLE_KEY } from "../constants.ts";

describe("shortcut resolution", () => {
	it("normalizeShortcutSpec: undefined → undefined", () => {
		expect(normalizeShortcutSpec(undefined)).toBeUndefined();
	});

	it("normalizeShortcutSpec: null → null", () => {
		expect(normalizeShortcutSpec(null)).toBeNull();
	});

	it("normalizeShortcutSpec: disable values → null", () => {
		expect(normalizeShortcutSpec("off")).toBeNull();
		expect(normalizeShortcutSpec("none")).toBeNull();
		expect(normalizeShortcutSpec("disabled")).toBeNull();
		expect(normalizeShortcutSpec("")).toBeNull();
		expect(normalizeShortcutSpec("  off  ")).toBeNull();
	});

	it("normalizeShortcutSpec: normalizes case and trims", () => {
		expect(normalizeShortcutSpec("Alt+O")).toBe("alt+o");
		expect(normalizeShortcutSpec("  Ctrl+G  ")).toBe("ctrl+g");
	});

	it("isValidShortcutSpec: empty → false", () => {
		expect(isValidShortcutSpec("")).toBe(false);
		expect(isValidShortcutSpec(" ")).toBe(false);
	});

	it("isValidShortcutSpec: valid specs", () => {
		expect(isValidShortcutSpec("alt+o")).toBe(true);
		expect(isValidShortcutSpec("ctrl+g")).toBe(true);
		expect(isValidShortcutSpec("shift+f1")).toBe(true);
	});

	it("isValidShortcutSpec: leading/trailing + → false", () => {
		expect(isValidShortcutSpec("+o")).toBe(false);
		expect(isValidShortcutSpec("o+")).toBe(false);
	});

	it("isValidShortcutSpec: double + → false", () => {
		expect(isValidShortcutSpec("alt++o")).toBe(false);
	});

	it("isValidShortcutSpec: illegal characters → false", () => {
		expect(isValidShortcutSpec("alt o")).toBe(false);
		expect(isValidShortcutSpec("alt\n")).toBe(false);
	});

	it("buildShortcut returns a matching shortcut", () => {
		const shortcut = buildShortcut("ctrl+g");
		expect(shortcut.disabled).toBe(false);
		expect(shortcut.spec).toBe("ctrl+g");
		expect(shortcut.matches("\x07")).toBe(true);
		expect(shortcut.matches("x")).toBe(false);
	});

	it("resolveShortcut: uses param when valid", () => {
		const result = resolveShortcut("alt+o", undefined, "alt+o");
		expect(result.disabled).toBe(false);
		expect(result.spec).toBe("alt+o");
	});

	it("resolveShortcut: param undefined, uses env", () => {
		const result = resolveShortcut(undefined, "ctrl+x", "alt+o");
		expect(result.disabled).toBe(false);
		expect(result.spec).toBe("ctrl+x");
	});

	it("resolveShortcut: param null → disabled", () => {
		expect(resolveShortcut(null, "ctrl+x", "alt+o")).toBe(DISABLED_SHORTCUT);
	});

	it("resolveShortcut: param undefined, env undefined, uses default", () => {
		const result = resolveShortcut(undefined, undefined, "alt+o");
		expect(result.disabled).toBe(false);
		expect(result.spec).toBe("alt+o");
	});

	it("resolveShortcut: param 'off' → disabled", () => {
		expect(resolveShortcut("off", "ctrl+x", "alt+o")).toBe(DISABLED_SHORTCUT);
	});

	it("resolveShortcut: invalid param falls through to env", () => {
		const result = resolveShortcut("invalid++", "ctrl+x", "alt+o");
		expect(result.disabled).toBe(false);
		expect(result.spec).toBe("ctrl+x");
	});

	it("resolveShortcut: all invalid → disabled", () => {
		expect(resolveShortcut("invalid++", "also++", "default++")).toBe(DISABLED_SHORTCUT);
	});

	it("resolveShortcuts builds the commentToggle map with the default key", () => {
		const shortcuts = resolveShortcuts(undefined, undefined);
		expect(shortcuts.commentToggle.disabled).toBe(false);
		expect(shortcuts.commentToggle.spec).toBe(DEFAULT_COMMENT_TOGGLE_KEY);
	});

	it("DISABLED_SHORTCUT matches nothing", () => {
		expect(DISABLED_SHORTCUT.matches("anything")).toBe(false);
		expect(DISABLED_SHORTCUT.disabled).toBe(true);
	});
});
