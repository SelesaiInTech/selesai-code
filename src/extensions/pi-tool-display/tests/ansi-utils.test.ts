import assert from "node:assert/strict";
import test from "node:test";
import {
	ANSI_SGR_PATTERN,
	STYLE_RESET_PARAMS,
	toSgrParams,
	stripBackgroundSgrParams,
	sanitizeAnsiForThemedOutput,
} from "../src/ansi-utils.ts";

// ─── toSgrParams ───────────────────────────────────────────────────────────

test("toSgrParams returns [0] for empty string input", () => {
	assert.deepEqual(toSgrParams(""), [0]);
});

test("toSgrParams returns [0] for whitespace-only input", () => {
	assert.deepEqual(toSgrParams("   "), [0]);
	assert.deepEqual(toSgrParams("\t"), [0]);
	assert.deepEqual(toSgrParams("\n"), [0]);
});

test("toSgrParams returns [0] for single zero", () => {
	assert.deepEqual(toSgrParams("0"), [0]);
});

test("toSgrParams parses semicolon-separated numeric tokens", () => {
	assert.deepEqual(toSgrParams("1;2;3"), [1, 2, 3]);
	assert.deepEqual(toSgrParams("38;5;196"), [38, 5, 196]);
	assert.deepEqual(toSgrParams("48;2;12;49;200"), [48, 2, 12, 49, 200]);
});

test("toSgrParams filters out non-numeric tokens", () => {
	assert.deepEqual(toSgrParams("1;abc;3"), [1, 3]);
	assert.deepEqual(toSgrParams("hello;world"), []);
});

test("toSgrParams filters out NaN from empty segments", () => {
	// "1;;3".split(";") => ["1", "", "3"] => parseInt => [1, NaN, 3] => filter(isFinite) => [1, 3]
	assert.deepEqual(toSgrParams("1;;3"), [1, 3]);
});

test("toSgrParams handles leading/trailing semicolons", () => {
	// ";1;2" => ["", "1", "2"] => [NaN, 1, 2] => filter => [1, 2]
	assert.deepEqual(toSgrParams(";1;2"), [1, 2]);
	// "1;2;" => ["1", "2", ""] => [1, 2, NaN] => [1, 2]
	assert.deepEqual(toSgrParams("1;2;"), [1, 2]);
	// ";" => ["", ""] => [NaN, NaN] => []
	assert.deepEqual(toSgrParams(";"), []);
});

test("toSgrParams handles negative values", () => {
	assert.deepEqual(toSgrParams("-1;2"), [-1, 2]);
	assert.deepEqual(toSgrParams("1;-2;3"), [1, -2, 3]);
});

test("toSgrParams handles very large numbers", () => {
	assert.deepEqual(toSgrParams("9999999999"), [9999999999]);
	assert.deepEqual(toSgrParams("1;9999999999;3"), [1, 9999999999, 3]);
});

test("toSgrParams returns [] for semicolons without valid numbers", () => {
	// ";abc" => ["", "abc"] => [NaN, NaN] => []
	assert.deepEqual(toSgrParams(";abc"), []);
});

test("toSgrParams handles single param", () => {
	assert.deepEqual(toSgrParams("42"), [42]);
	assert.deepEqual(toSgrParams("0"), [0]);
});

// ─── stripBackgroundSgrParams ──────────────────────────────────────────────

test("stripBackgroundSgrParams strips param 49 (background reset)", () => {
	assert.deepEqual(stripBackgroundSgrParams([49]), []);
});

test("stripBackgroundSgrParams keeps param 49 not confused with rgb component", () => {
	// The function only sees the parsed numeric params, so 49 in an RGB component
	// is already parsed as [48, 2, 12, 49, 200]. stripBackgroundSgrParams
	// should skip the entire 48;2;r;g;b sequence, not treat the color value 49 as reset.
	const result = stripBackgroundSgrParams([48, 2, 12, 49, 200]);
	assert.deepEqual(result, []);
});

test("stripBackgroundSgrParams replaces reset param 0 with style reset params", () => {
	const result = stripBackgroundSgrParams([0]);
	assert.deepEqual(result, [...STYLE_RESET_PARAMS]);
});

test("stripBackgroundSgrParams strips 8-bit background (48;5;N)", () => {
	assert.deepEqual(stripBackgroundSgrParams([48, 5, 196]), []);
	assert.deepEqual(stripBackgroundSgrParams([48, 5, 255]), []);
});

test("stripBackgroundSgrParams strips RGB background (48;2;r;g;b)", () => {
	assert.deepEqual(stripBackgroundSgrParams([48, 2, 10, 20, 30]), []);
	assert.deepEqual(stripBackgroundSgrParams([48, 2, 255, 128, 0]), []);
});

test("stripBackgroundSgrParams keeps foreground 8-bit color (38;5;N)", () => {
	assert.deepEqual(stripBackgroundSgrParams([38, 5, 196]), [38, 5, 196]);
});

test("stripBackgroundSgrParams keeps foreground RGB color (38;2;r;g;b)", () => {
	assert.deepEqual(stripBackgroundSgrParams([38, 2, 12, 49, 200]), [38, 2, 12, 49, 200]);
});

test("stripBackgroundSgrParams strips direct background codes 40-47", () => {
	for (let code = 40; code <= 47; code++) {
		assert.deepEqual(stripBackgroundSgrParams([code]), [], `param ${code} should be stripped`);
	}
});

test("stripBackgroundSgrParams strips bright background codes 100-107", () => {
	for (let code = 100; code <= 107; code++) {
		assert.deepEqual(stripBackgroundSgrParams([code]), [], `param ${code} should be stripped`);
	}
});

test("stripBackgroundSgrParams keeps non-background params", () => {
	assert.deepEqual(stripBackgroundSgrParams([1]), [1]); // bold
	assert.deepEqual(stripBackgroundSgrParams([3]), [3]); // italic
	assert.deepEqual(stripBackgroundSgrParams([4]), [4]); // underline
	assert.deepEqual(stripBackgroundSgrParams([7]), [7]); // inverse
	assert.deepEqual(stripBackgroundSgrParams([9]), [9]); // strikethrough
});

test("stripBackgroundSgrParams handles incomplete 48;5 sequence (missing color value)", () => {
	// Only 48 and 5 present, no color value → skips index+2 (48 and 5)
	assert.deepEqual(stripBackgroundSgrParams([48, 5]), []);
});

test("stripBackgroundSgrParams handles incomplete 48;2 sequence (missing color components)", () => {
	// Only 48 and 2 and partial RGB → skips index+4 (48,2,r,g,b)
	assert.deepEqual(stripBackgroundSgrParams([48, 2, 100]), []);
	assert.deepEqual(stripBackgroundSgrParams([48, 2, 100, 200]), []);
});

test("stripBackgroundSgrParams handles mixed params preserving non-background and stripping background", () => {
	const result = stripBackgroundSgrParams([1, 49, 3, 40, 4, 48, 5, 196, 7]);
	// 1 kept, 49 stripped, 3 kept, 40 stripped, 4 kept, 48;5;196 stripped, 7 kept
	assert.deepEqual(result, [1, 3, 4, 7]);
});

test("stripBackgroundSgrParams handles full reset zero before background params", () => {
	// [0, 49] → param 0 replaced with style reset params, param 49 stripped
	const result = stripBackgroundSgrParams([0, 49]);
	assert.deepEqual(result, [...STYLE_RESET_PARAMS]);
});

// ─── sanitizeAnsiForThemedOutput ───────────────────────────────────────────

test("sanitizeAnsiForThemedOutput returns empty string unchanged", () => {
	assert.equal(sanitizeAnsiForThemedOutput(""), "");
});

test("sanitizeAnsiForThemedOutput returns string with no ANSI codes unchanged", () => {
	const text = "hello world";
	assert.equal(sanitizeAnsiForThemedOutput(text), text);
});

test("sanitizeAnsiForThemedOutput strips background reset from SGR sequence", () => {
	const input = "\x1b[1;49;32mhello";
	const result = sanitizeAnsiForThemedOutput(input);
	// 1 (bold) kept, 49 (bg reset) stripped, 32 (fg green) kept
	assert.equal(result, "\x1b[1;32mhello");
});

test("sanitizeAnsiForThemedOutput keeps foreground RGB with 49 component value", () => {
	// \x1b[38;2;12;49;200m → RGB fg with 49 as GREEN component, should be kept
	const input = "\x1b[38;2;12;49;200mhello";
	const result = sanitizeAnsiForThemedOutput(input);
	// stripBackgroundSgrParams keeps the whole RGB foreground sequence
	assert.equal(result, input);
});

test("sanitizeAnsiForThemedOutput keeps foreground 8-bit colors", () => {
	const input = "\x1b[38;5;82mhello";
	const result = sanitizeAnsiForThemedOutput(input);
	assert.equal(result, input);
});

test("sanitizeAnsiForThemedOutput strips background 8-bit colors", () => {
	const input = "\x1b[48;5;196mhello";
	const result = sanitizeAnsiForThemedOutput(input);
	assert.equal(result, "hello");
});

test("sanitizeAnsiForThemedOutput strips RGB background colors while keeping foreground", () => {
	const input = "\x1b[1;38;2;10;20;30;48;2;100;200;50mhello";
	const result = sanitizeAnsiForThemedOutput(input);
	// Should keep 1 (bold) and RGB foreground 38;2;10;20;30
	assert.equal(result, "\x1b[1;38;2;10;20;30mhello");
});

test("sanitizeAnsiForThemedOutput preserves OSC sequences (not matched by SGR pattern)", () => {
	const input = "\x1b]0;my title\x07hello";
	const result = sanitizeAnsiForThemedOutput(input);
	assert.equal(result, input);
});

test("sanitizeAnsiForThemedOutput preserves CSI cursor sequences", () => {
	const input = "\x1b[A\x1b[5Chello";
	const result = sanitizeAnsiForThemedOutput(input);
	// \x1b[A and \x1b[5C are not SGR (don't end with 'm'), pass through
	assert.equal(result, input);
});

test("sanitizeAnsiForThemedOutput preserves bell characters", () => {
	const input = "hello\x07world";
	const result = sanitizeAnsiForThemedOutput(input);
	assert.equal(result, input);
});

test("sanitizeAnsiForThemedOutput handles string with only non-SGR escape sequences", () => {
	const input = "\x1b[2J\x1b[Hclear";
	const result = sanitizeAnsiForThemedOutput(input);
	// Not SGR (don't end with m), pass through
	assert.equal(result, input);
});

test("sanitizeAnsiForThemedOutput strips empty SGR sequences", () => {
	// \x1b[m → toSgrParams("") → [0] → stripBackgroundSgrParams([0]) → STYLE_RESET_PARAMS → still non-empty
	// So it doesn't strip reset entirely, it replaces with style reset params
	const input = "\x1b[mhello";
	const result = sanitizeAnsiForThemedOutput(input);
	assert.equal(result, "\x1b[39;22;23;24;25;27;28;29;59mhello");
});

test("sanitizeAnsiForThemedOutput strips SGR that becomes empty after background removal", () => {
	// \x1b[49m → toSgrParams("49") → [49] → stripBackgroundSgrParams([49]) → [] → returns ""
	const input = "\x1b[49mhello";
	const result = sanitizeAnsiForThemedOutput(input);
	assert.equal(result, "hello");
});

test("sanitizeAnsiForThemedOutput handles multiple SGR sequences in one string", () => {
	const input = "\x1b[1m\x1b[49mbold\x1b[49m\x1b[22m";
	const result = sanitizeAnsiForThemedOutput(input);
	// [1] → [1] kept; [49] → [] stripped; [49] → [] stripped; [22] → [22] kept
	assert.equal(result, "\x1b[1mbold\x1b[22m");
});

test("sanitizeAnsiForThemedOutput handles text without any escape sequences", () => {
	assert.equal(sanitizeAnsiForThemedOutput("plain text"), "plain text");
});

test("sanitizeAnsiForThemedOutput handles non-SGR CSI sequences mixed with SGR", () => {
	const input = "\x1b[1m\x1b[49m\x1b[5Cmixed";
	const result = sanitizeAnsiForThemedOutput(input);
	// \x1b[5C is not SGR (doesn't end with m), passes through
	assert.equal(result, "\x1b[1m\x1b[5Cmixed");
});

test("sanitizeAnsiForThemedOutput handles multiple semicolons producing empty params", () => {
	// \x1b[1;;32m → toSgrParams("1;;32") → [1, 32] (NaN filtered) → stripBackgroundSgrParams → [1, 32]
	const input = "\x1b[1;;32mhello";
	const result = sanitizeAnsiForThemedOutput(input);
	assert.equal(result, "\x1b[1;32mhello");
});

// ─── sequenceResetsBackground behavior exported through sanitizeAnsiForThemedOutput ──
// These tests exercise the behavior of sequenceResetsBackground (private in diff-renderer)
// by verifying that sanitizeAnsiForThemedOutput does NOT incorrectly strip RGB foreground
// sequences containing the value 49 as a component.

test("sanitizeAnsiForThemedOutput preserves RGB foreground with 49 in green component (issue #8/#3 regression guard)", () => {
	// \x1b[38;2;12;49;200m → toSgrParams → [38, 2, 12, 49, 200]
	// stripBackgroundSgrParams([38, 2, 12, 49, 200]):
	//   index=0: param=38, not 0, not 49, not 40-47, not 100-107, not 48 → push 38
	//   index=1: param=2 → push 2
	//   index=2: param=12 → push 12
	//   index=3: param=49 → push 49 (only stripped when param === 49 directly, not inside RGB)
	//   index=4: param=200 → push 200
	// Result: [38, 2, 12, 49, 200] → preserved
	const input = "\x1b[38;2;12;49;200mtest";
	const result = sanitizeAnsiForThemedOutput(input);
	assert.equal(result, input);
});

test("sanitizeAnsiForThemedOutput preserves 8-bit foreground even when color value is 49", () => {
	// \x1b[38;5;49m → color 49 is a valid 8-bit color (not background reset)
	const input = "\x1b[38;5;49mtest";
	const result = sanitizeAnsiForThemedOutput(input);
	assert.equal(result, input);
});

test("sanitizeAnsiForThemedOutput correctly strips actual background reset (49) in mixed seq", () => {
	// \x1b[1;49;32m → [1, 49, 32] → 1 kept, 49 stripped, 32 kept → \x1b[1;32m
	const input = "\x1b[1;49;32mtest";
	const result = sanitizeAnsiForThemedOutput(input);
	assert.equal(result, "\x1b[1;32mtest");
});

// ─── ANSI_SGR_PATTERN edge cases ───────────────────────────────────────────

test("ANSI_SGR_PATTERN matches standard SGR sequences", () => {
	const matches = "\x1b[31m\x1b[1;32m\x1b[0m".match(ANSI_SGR_PATTERN);
	assert.deepEqual(matches, ["\x1b[31m", "\x1b[1;32m", "\x1b[0m"]);
});

test("ANSI_SGR_PATTERN does not match CSI sequences not ending in m", () => {
	const matches = "\x1b[A\x1b[5C\x1b[2J".match(ANSI_SGR_PATTERN);
	assert.equal(matches, null);
});

test("ANSI_SGR_PATTERN does not match OSC sequences", () => {
	const matches = "\x1b]0;title\x07".match(ANSI_SGR_PATTERN);
	assert.equal(matches, null);
});

// ─── colon-form SGR (if supported) ──────────────────────────────────────────
// Current implementation uses semicolons only. Colon-form params like
// \x1b[38:2:12:49:200m are NOT currently handled by toSgrParams which splits on ";"
// Test that they behave as undefined/non-matching.

test("toSgrParams partial-parse on colon-form (colon-form SGR not supported)", () => {
	// "38:2:12:49:200" → split(";") → ["38:2:12:49:200"]
	// parseInt("38:2:12:49:200", 10) → 38 (parseInt stops at the first non-digit)
	const result = toSgrParams("38:2:12:49:200");
	assert.deepEqual(result, [38]);
});

test("sanitizeAnsiForThemedOutput handles colon-form SGR sequence as non-SGR passthrough", () => {
	// \x1b[38:2:12:49:200m is an SGR sequence but uses colons.
	// The regex \x1b\[([0-9;]*)m will match "38:2:12:49:200" because colons are not [0-9;]
	// Wait: [0-9;] matches digits and semicolons only, NOT colons.
	// So \x1b[38:2:12:49:200m would NOT match ANSI_SGR_PATTERN since ":" is not in [0-9;].
	// Therefore the entire sequence passes through unchanged.
	const input = "\x1b[38:2:12:49:200mhello";
	const result = sanitizeAnsiForThemedOutput(input);
	assert.equal(result, input);
});

// ─── edge case: non-string at runtime ──────────────────────────────────────

test("sanitizeAnsiForThemedOutput handles null/undefined gracefully at runtime", () => {
	assert.equal(sanitizeAnsiForThemedOutput(null as unknown as string), null);
	assert.equal(sanitizeAnsiForThemedOutput(undefined as unknown as string), undefined);
});

test("sanitizeAnsiForThemedOutput throws for non-string input at runtime", () => {
	assert.throws(() => sanitizeAnsiForThemedOutput(42 as unknown as string), /includes/);
});
