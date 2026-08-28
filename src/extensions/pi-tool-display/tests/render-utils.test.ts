import assert from "node:assert/strict";
import { homedir } from "node:os";
import test from "node:test";
import {
  buildCollapsedDiffHintText,
  type WidthMeasurementOps,
} from "../src/line-width-safety.ts";
import {
  compactOutputLines,
  countNonEmptyLines,
  extractTextOutput,
  isLikelyQuietCommand,
  pluralize,
  previewLines,
  shortenPath,
  splitLines,
} from "../src/render-utils.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const codePointWidthOps: WidthMeasurementOps = {
  measure: (text: string): number => [...text].length,
  truncate: (text: string, maxWidth: number): string =>
    [...text].slice(0, Math.max(0, maxWidth)).join(""),
};

interface ThemeLike {
  fg(color: string, text: string): string;
}

function formatExpandHint(theme: ThemeLike): string {
  return theme.fg("muted", " • Ctrl+O to expand");
}

// ---------------------------------------------------------------------------
// formatExpandHint  (replicates production logic from tool-overrides.ts)
// ---------------------------------------------------------------------------

test("formatExpandHint: pass-through theme returns plain hint string", () => {
  const theme: ThemeLike = { fg: (_color, text) => text };
  assert.equal(formatExpandHint(theme), " • Ctrl+O to expand");
});

test("formatExpandHint: ANSI-wrapping theme wraps with color codes", () => {
  const theme: ThemeLike = {
    fg: (color, text) => `\x1b[38;2;200;200;200m[${color}]${text}\x1b[0m`,
  };
  const result = formatExpandHint(theme);
  assert.match(result, /^\x1b\[38;2;200;200;200m\[muted\]/);
  assert.match(result, /Ctrl\+O to expand/);
  assert.match(result, /\x1b\[0m$/);
});

test("formatExpandHint: theme returning empty string", () => {
  const theme: ThemeLike = { fg: () => "" };
  assert.equal(formatExpandHint(theme), "");
});

test("formatExpandHint: theme returning custom prefix", () => {
  const theme: ThemeLike = { fg: (_color, text) => `[[${text}]]` };
  assert.equal(formatExpandHint(theme), "[[ • Ctrl+O to expand]]");
});

// ---------------------------------------------------------------------------
// shortenPath
// ---------------------------------------------------------------------------

test("shortenPath: undefined returns empty string", () => {
  assert.equal(shortenPath(undefined), "");
});

test("shortenPath: empty string returns empty string", () => {
  assert.equal(shortenPath(""), "");
});

test("shortenPath: absolute path within homedir is shortened with tilde", () => {
  const home = homedir();
  const result = shortenPath(`${home}/projects/my-app`);
  assert.equal(result, "~/projects/my-app");
});

test("shortenPath: absolute path outside homedir is unchanged", () => {
  const result = shortenPath("/opt/app/config.json");
  assert.equal(result, "/opt/app/config.json");
});

test("shortenPath: relative path is unchanged", () => {
  assert.equal(shortenPath("src/utils/helper.ts"), "src/utils/helper.ts");
  assert.equal(shortenPath("./local/file.txt"), "./local/file.txt");
  assert.equal(shortenPath("../sibling/file.ts"), "../sibling/file.ts");
});

test("shortenPath: deeply nested path within homedir is shortened", () => {
  const home = homedir();
  const result = shortenPath(`${home}/a/b/c/d/e/f/g/file.ts`);
  assert.equal(result, "~/a/b/c/d/e/f/g/file.ts");
});

test("shortenPath: Windows-style C:\\ path is unchanged", () => {
  const result = shortenPath("C:\\Users\\Name\\Projects\\app");
  // Should not match homedir (unless running on Windows with matching homedir)
  // On Windows homedir is typically C:\Users\<username>
  // This test ensures the path is not incorrectly shortened
  const home = homedir();
  if (home.startsWith("C:\\Users\\")) {
    // If path IS within homedir, it should be shortened
    const result2 = shortenPath(`${home}\\Projects\\app`);
    assert.match(result2, /^~/);
  } else {
    // Otherwise path outside homedir stays unchanged
    assert.equal(result, "C:\\Users\\Name\\Projects\\app");
  }
});

test("shortenPath: UNC path is unchanged", () => {
  const result = shortenPath("\\\\server\\share\\path\\file.txt");
  // UNC paths don't start with homedir, so they pass through
  assert.equal(result, "\\\\server\\share\\path\\file.txt");
});

test("shortenPath: homedir itself returns tilde", () => {
  const home = homedir();
  const result = shortenPath(home);
  assert.equal(result, "~");
});

test("shortenPath: path exactly matching homedir with trailing slash returns tilde", () => {
  const home = homedir();
  const result = shortenPath(`${home}/`);
  assert.equal(result, "~/");
});

// ---------------------------------------------------------------------------
// extractTextOutput
// ---------------------------------------------------------------------------

test("extractTextOutput: input with null content returns empty string", () => {
  assert.equal(extractTextOutput({ content: null } as never), "");
});

test("extractTextOutput: missing content field returns empty string", () => {
  assert.equal(extractTextOutput({}), "");
});

test("extractTextOutput: empty content array returns empty string", () => {
  assert.equal(extractTextOutput({ content: [] }), "");
});

test("extractTextOutput: single text block returns its text", () => {
  const result = extractTextOutput({
    content: [{ type: "text", text: "hello world" }],
  });
  assert.equal(result, "hello world");
});

test("extractTextOutput: multiple text blocks joined by newline", () => {
  const result = extractTextOutput({
    content: [
      { type: "text", text: "line1" },
      { type: "text", text: "line2" },
    ],
  });
  assert.equal(result, "line1\nline2");
});

test("extractTextOutput: non-text type blocks are filtered out", () => {
  const result = extractTextOutput({
    content: [
      { type: "tool_result", text: "skip me" },
      { type: "text", text: "keep me" },
    ],
  });
  assert.equal(result, "keep me");
});

test("extractTextOutput: text block missing text field returns empty", () => {
  const result = extractTextOutput({
    content: [{ type: "text" }],
  });
  assert.equal(result, "");
});

test("extractTextOutput: text block with non-string text field is filtered", () => {
  const result = extractTextOutput({
    content: [{ type: "text", text: 123 } as never],
  });
  assert.equal(result, "");
});

test("extractTextOutput: null and undefined items in array are filtered", () => {
  const result = extractTextOutput({
    content: [
      null,
      undefined,
      { type: "text", text: "surviving" },
    ] as never,
  });
  assert.equal(result, "surviving");
});

test("extractTextOutput: nested content object (non-array) returns empty", () => {
  const result = extractTextOutput({
    content: { type: "text", text: "nested" },
  } as never);
  assert.equal(result, "");
});

test("extractTextOutput: content as string returns empty", () => {
  const result = extractTextOutput({
    content: "raw string",
  } as never);
  assert.equal(result, "");
});

test("extractTextOutput: content with mixed valid/invalid blocks", () => {
  const result = extractTextOutput({
    content: [
      { type: "image", source: "..." },
      { type: "text", text: "valid text" },
      { type: "text" },
      { type: "text", text: "" },
    ],
  });
  assert.equal(result, "valid text\n");
});

// ---------------------------------------------------------------------------
// splitLines
// ---------------------------------------------------------------------------

test("splitLines: empty string returns empty array", () => {
  assert.deepEqual(splitLines(""), []);
});

test("splitLines: LF line endings", () => {
  assert.deepEqual(splitLines("line1\nline2\nline3"), [
    "line1",
    "line2",
    "line3",
  ]);
});

test("splitLines: CRLF line endings are normalized", () => {
  assert.deepEqual(splitLines("line1\r\nline2\r\nline3"), [
    "line1",
    "line2",
    "line3",
  ]);
});

test("splitLines: CR-only line endings are removed (not treated as line separator)", () => {
  // splitLines only removes \r; it does NOT split on CR.
  assert.deepEqual(splitLines("line1\rline2\rline3"), ["line1line2line3"]);
});

test("splitLines: mixed line endings — CR removed, \n splits; lone CR concatenates", () => {
  // "a\r\nb\nc\rd" → remove \r → "a\nb\ncd" → split \n → ["a", "b", "cd"]
  assert.deepEqual(splitLines("a\r\nb\nc\rd"), ["a", "b", "cd"]);
});

test("splitLines: trailing newline produces trailing empty string", () => {
  assert.deepEqual(splitLines("line1\nline2\n"), ["line1", "line2", ""]);
});

test("splitLines: no newline returns single-element array", () => {
  assert.deepEqual(splitLines("single line"), ["single line"]);
});

test("splitLines: empty lines in middle are preserved", () => {
  assert.deepEqual(splitLines("a\n\n\nb"), ["a", "", "", "b"]);
});

test("splitLines: tabs are expanded to 4 spaces", () => {
  assert.deepEqual(splitLines("a\tb\nc\td"), ["a    b", "c    d"]);
});

test("splitLines: only newlines returns array of empty strings (split semantics)", () => {
  assert.deepEqual(splitLines("\n\n"), ["", "", ""]);
});

// ---------------------------------------------------------------------------
// compactOutputLines
// ---------------------------------------------------------------------------

test("compactOutputLines: expanded mode trims trailing empty lines", () => {
  const result = compactOutputLines(["a", "b", "", "c", "", ""], {
    expanded: true,
  });
  assert.deepEqual(result, ["a", "b", "", "c"]);
});

test("compactOutputLines: expanded mode preserves all non-trailing content", () => {
  const result = compactOutputLines(["a", "", "b"], { expanded: true });
  assert.deepEqual(result, ["a", "", "b"]);
});

test("compactOutputLines: collapsed mode defaults to max 1 consecutive empty line", () => {
  const result = compactOutputLines(["a", "", "", "b", "", "", "", "c"], {
    expanded: false,
  });
  assert.deepEqual(result, ["a", "", "b", "", "c"]);
});

test("compactOutputLines: collapsed mode with maxCollapsedConsecutiveEmptyLines = 0 removes all empty lines", () => {
  const result = compactOutputLines(["a", "", "", "b", "", "c"], {
    expanded: false,
    maxCollapsedConsecutiveEmptyLines: 0,
  });
  assert.deepEqual(result, ["a", "b", "c"]);
});

test("compactOutputLines: collapsed mode with maxCollapsedConsecutiveEmptyLines = 2 allows up to 2 consecutive empties", () => {
  const result = compactOutputLines(["a", "", "", "", "b", "", "c"], {
    expanded: false,
    maxCollapsedConsecutiveEmptyLines: 2,
  });
  assert.deepEqual(result, ["a", "", "", "b", "", "c"]);
});

test("compactOutputLines: all trailing empty lines are trimmed before collapse", () => {
  const result = compactOutputLines(["a", "", "b", "", ""], {
    expanded: false,
  });
  assert.deepEqual(result, ["a", "", "b"]);
});

test("compactOutputLines: all empty lines collapses to empty array", () => {
  const result = compactOutputLines(["", "", ""], { expanded: false });
  assert.deepEqual(result, []);
});

test("compactOutputLines: empty input returns empty array", () => {
  const result = compactOutputLines([], { expanded: false });
  assert.deepEqual(result, []);
});

test("compactOutputLines: single line stays unchanged", () => {
  const result = compactOutputLines(["hello"], { expanded: true });
  assert.deepEqual(result, ["hello"]);
});

// ---------------------------------------------------------------------------
// isLikelyQuietCommand
// ---------------------------------------------------------------------------

test("isLikelyQuietCommand: undefined returns false", () => {
  assert.equal(isLikelyQuietCommand(undefined), false);
});

test("isLikelyQuietCommand: empty string returns false", () => {
  assert.equal(isLikelyQuietCommand(""), false);
});

test("isLikelyQuietCommand: 'cd /tmp' is quiet", () => {
  assert.equal(isLikelyQuietCommand("cd /tmp"), true);
});

test("isLikelyQuietCommand: 'git add file.txt' is quiet", () => {
  assert.equal(isLikelyQuietCommand("git add file.txt"), true);
});

test("isLikelyQuietCommand: 'git checkout main' is quiet", () => {
  assert.equal(isLikelyQuietCommand("git checkout main"), true);
});

test("isLikelyQuietCommand: 'npm install' is quiet", () => {
  assert.equal(isLikelyQuietCommand("npm install"), true);
});

test("isLikelyQuietCommand: 'npm install express' is quiet", () => {
  assert.equal(isLikelyQuietCommand("npm install express"), true);
});

test("isLikelyQuietCommand: 'pip install pytest' is quiet", () => {
  assert.equal(isLikelyQuietCommand("pip install pytest"), true);
});

test("isLikelyQuietCommand: 'echo hello' is NOT quiet (not in list)", () => {
  assert.equal(isLikelyQuietCommand("echo hello"), false);
});

test("isLikelyQuietCommand: 'cat file.txt' is NOT quiet (not in list)", () => {
  assert.equal(isLikelyQuietCommand("cat file.txt"), false);
});

test("isLikelyQuietCommand: 'rm -rf node_modules' is quiet", () => {
  assert.equal(isLikelyQuietCommand("rm -rf node_modules"), true);
});

test("isLikelyQuietCommand: 'mkdir -p dist' is quiet", () => {
  assert.equal(isLikelyQuietCommand("mkdir -p dist"), true);
});

test("isLikelyQuietCommand: 'mv old new' is quiet", () => {
  assert.equal(isLikelyQuietCommand("mv old new"), true);
});

test("isLikelyQuietCommand: 'cp src dest' is quiet", () => {
  assert.equal(isLikelyQuietCommand("cp src dest"), true);
});

test("isLikelyQuietCommand: 'touch index.ts' is quiet", () => {
  assert.equal(isLikelyQuietCommand("touch index.ts"), true);
});

test("isLikelyQuietCommand: whitespace-padded quiet command is detected", () => {
  assert.equal(isLikelyQuietCommand("  cd /tmp  "), true);
});

test("isLikelyQuietCommand: 'npx jest' is NOT quiet", () => {
  assert.equal(isLikelyQuietCommand("npx jest"), false);
});

test("isLikelyQuietCommand: compound command matches first segment", () => {
  assert.equal(isLikelyQuietCommand("cd /tmp && npm test"), true);
});

test("isLikelyQuietCommand: 'git commit' is NOT quiet (only specific git subcommands)", () => {
  assert.equal(isLikelyQuietCommand("git commit -m 'fix'"), false);
});

test("isLikelyQuietCommand: 'chmod 755 script.sh' is quiet", () => {
  assert.equal(isLikelyQuietCommand("chmod 755 script.sh"), true);
});

test("isLikelyQuietCommand: 'chown user:group file' is quiet", () => {
  assert.equal(isLikelyQuietCommand("chown user:group file"), true);
});

test("isLikelyQuietCommand: 'pnpm install' is quiet", () => {
  assert.equal(isLikelyQuietCommand("pnpm install"), true);
});

test("isLikelyQuietCommand: 'yarn install' is quiet", () => {
  assert.equal(isLikelyQuietCommand("yarn install"), true);
});

test("isLikelyQuietCommand: 'bun install' is quiet", () => {
  assert.equal(isLikelyQuietCommand("bun install"), true);
});

test("isLikelyQuietCommand: 'pip install' alone is quiet", () => {
  assert.equal(isLikelyQuietCommand("pip install"), true);
});

test("isLikelyQuietCommand: 'Set-Location C:\\' is quiet", () => {
  assert.equal(isLikelyQuietCommand("Set-Location C:\\"), true);
});

test("isLikelyQuietCommand: 'New-Item file.txt' is quiet", () => {
  assert.equal(isLikelyQuietCommand("New-Item file.txt"), true);
});

test("isLikelyQuietCommand: 'Remove-Item file' is quiet", () => {
  assert.equal(isLikelyQuietCommand("Remove-Item file.txt"), true);
});

test("isLikelyQuietCommand: 'git reset HEAD~1' is quiet", () => {
  assert.equal(isLikelyQuietCommand("git reset HEAD~1"), true);
});

test("isLikelyQuietCommand: 'git clean -fd' is quiet", () => {
  assert.equal(isLikelyQuietCommand("git clean -fd"), true);
});

test("isLikelyQuietCommand: 'git switch feature-branch' is quiet", () => {
  assert.equal(isLikelyQuietCommand("git switch feature-branch"), true);
});

test("isLikelyQuietCommand: 'git restore .' is quiet", () => {
  assert.equal(isLikelyQuietCommand("git restore ."), true);
});

test("isLikelyQuietCommand: 'poetry install' is quiet", () => {
  assert.equal(isLikelyQuietCommand("poetry install"), true);
});

test("isLikelyQuietCommand: 'cargo fetch' is quiet", () => {
  assert.equal(isLikelyQuietCommand("cargo fetch"), true);
});

test("isLikelyQuietCommand: 'go mod tidy' is quiet", () => {
  assert.equal(isLikelyQuietCommand("go mod tidy"), true);
});

test("isLikelyQuietCommand: 'Copy-Item src dest' is quiet", () => {
  assert.equal(isLikelyQuietCommand("Copy-Item src dest"), true);
});

test("isLikelyQuietCommand: 'Move-Item old new' is quiet", () => {
  assert.equal(isLikelyQuietCommand("Move-Item old new"), true);
});

// ---------------------------------------------------------------------------
// countNonEmptyLines
// ---------------------------------------------------------------------------

test("countNonEmptyLines: empty array returns 0", () => {
  assert.equal(countNonEmptyLines([]), 0);
});

test("countNonEmptyLines: all whitespace lines return 0", () => {
  assert.equal(countNonEmptyLines(["", "  ", "\t", " \t "]), 0);
});

test("countNonEmptyLines: mixed empty and non-empty", () => {
  assert.equal(countNonEmptyLines(["a", "", "b", "  ", "c"]), 3);
});

test("countNonEmptyLines: all non-empty returns count", () => {
  assert.equal(countNonEmptyLines(["a", "b", "c"]), 3);
});

test("countNonEmptyLines: single non-empty line", () => {
  assert.equal(countNonEmptyLines(["  hello  "]), 1);
});

test("countNonEmptyLines: single whitespace-only line returns 0", () => {
  assert.equal(countNonEmptyLines(["   "]), 0);
});

// ---------------------------------------------------------------------------
// pluralize
// ---------------------------------------------------------------------------

test("pluralize: 0 count returns plural", () => {
  assert.equal(pluralize(0, "line"), "lines");
});

test("pluralize: 1 count returns singular", () => {
  assert.equal(pluralize(1, "line"), "line");
});

test("pluralize: 2 count returns plural", () => {
  assert.equal(pluralize(2, "line"), "lines");
});

test("pluralize: explicit plural form for 0", () => {
  assert.equal(pluralize(0, "hunk", "hunks"), "hunks");
});

test("pluralize: explicit plural form for 1", () => {
  assert.equal(pluralize(1, "hunk", "hunks"), "hunk");
});

test("pluralize: explicit plural form for many", () => {
  assert.equal(pluralize(5, "hunk", "hunks"), "hunks");
});

test("pluralize: negative count uses plural", () => {
  assert.equal(pluralize(-1, "line"), "lines");
});

test("pluralize: large count uses plural", () => {
  assert.equal(pluralize(1000, "file"), "files");
});

test("pluralize: custom plurals for diff contexts", () => {
  assert.equal(pluralize(1, "diff", "diffs"), "diff");
  assert.equal(pluralize(2, "diff", "diffs"), "diffs");
});

// ---------------------------------------------------------------------------
// previewLines
// ---------------------------------------------------------------------------

test("previewLines: maxLines 0 returns empty shown, all remaining", () => {
  const result = previewLines(["a", "b", "c"], 0);
  assert.deepEqual(result, { shown: [], remaining: 3 });
});

test("previewLines: maxLines 1 returns first line, remaining", () => {
  const result = previewLines(["a", "b", "c"], 1);
  assert.deepEqual(result, { shown: ["a"], remaining: 2 });
});

test("previewLines: maxLines larger than array returns all, 0 remaining", () => {
  const result = previewLines(["a", "b"], 10);
  assert.deepEqual(result, { shown: ["a", "b"], remaining: 0 });
});

test("previewLines: empty array returns empty shown, 0 remaining", () => {
  const result = previewLines([], 5);
  assert.deepEqual(result, { shown: [], remaining: 0 });
});

test("previewLines: negative maxLines treated as 0", () => {
  const result = previewLines(["a", "b"], -5);
  assert.deepEqual(result, { shown: [], remaining: 2 });
});

test("previewLines: maxLines exactly equals array length", () => {
  const result = previewLines(["a", "b", "c"], 3);
  assert.deepEqual(result, { shown: ["a", "b", "c"], remaining: 0 });
});

test("previewLines: single element with maxLines 0 returns empty", () => {
  const result = previewLines(["only"], 0);
  assert.deepEqual(result, { shown: [], remaining: 1 });
});

test("previewLines: Infinity-like large value is clamped to array", () => {
  const result = previewLines(["x"], Number.POSITIVE_INFINITY);
  assert.deepEqual(result, { shown: ["x"], remaining: 0 });
});

// ---------------------------------------------------------------------------
// buildCollapsedDiffHintText
// ---------------------------------------------------------------------------

test("buildCollapsedDiffHintText: wide width shows full hint with lines and hunks", () => {
  const hint = buildCollapsedDiffHintText(
    { remainingLines: 42, hiddenHunks: 3 },
    80,
    codePointWidthOps,
  );
  assert.equal(
    hint,
    "… (42 more diff lines • 3 more hunks • Ctrl+O to expand)",
  );
});

test("buildCollapsedDiffHintText: remaining lines only, no hunks", () => {
  const hint = buildCollapsedDiffHintText(
    { remainingLines: 10, hiddenHunks: 0 },
    80,
    codePointWidthOps,
  );
  assert.equal(hint, "… (10 more diff lines • Ctrl+O to expand)");
});

test("buildCollapsedDiffHintText: zero remaining lines and zero hunks", () => {
  const hint = buildCollapsedDiffHintText(
    { remainingLines: 0, hiddenHunks: 0 },
    80,
    codePointWidthOps,
  );
  // "0 more diff lines" passed to pluralize → "0 more diff lines"
  assert.equal(hint, "… (0 more diff lines • Ctrl+O to expand)");
});

test("buildCollapsedDiffHintText: narrow width forces shorter variants", () => {
  const hint = buildCollapsedDiffHintText(
    { remainingLines: 3970, hiddenHunks: 1 },
    40,
    codePointWidthOps,
  );
  assert.ok(codePointWidthOps.measure(hint) <= 40);
  assert.match(hint, /3970/);
  // With ~40 chars, it should drop the Ctrl+O hint
  assert.doesNotMatch(hint, /Ctrl\+O/);
});

test("buildCollapsedDiffHintText: very narrow width forces compact format", () => {
  const hint = buildCollapsedDiffHintText(
    { remainingLines: 3970, hiddenHunks: 1 },
    20,
    codePointWidthOps,
  );
  assert.ok(codePointWidthOps.measure(hint) <= 20);
  // At 20 chars, it likely shows the compact "+N • +Mh" format
  assert.match(hint, /\+/);
});

test("buildCollapsedDiffHintText: extremely narrow width returns just '…'", () => {
  const hint = buildCollapsedDiffHintText(
    { remainingLines: 100, hiddenHunks: 5 },
    1,
    codePointWidthOps,
  );
  // The ellipsis "…" is 1 code point wide
  assert.ok(codePointWidthOps.measure(hint) <= 1);
  assert.equal(hint, "…");
});

test("buildCollapsedDiffHintText: zero width returns empty string", () => {
  const hint = buildCollapsedDiffHintText(
    { remainingLines: 100, hiddenHunks: 2 },
    0,
    codePointWidthOps,
  );
  assert.equal(hint, "");
});

test("buildCollapsedDiffHintText: many hunks at narrow width", () => {
  const hint = buildCollapsedDiffHintText(
    { remainingLines: 12, hiddenHunks: 2 },
    35,
    codePointWidthOps,
  );
  assert.ok(codePointWidthOps.measure(hint) <= 35);
  // Should mention both lines and hunks in some form
  assert.match(hint, /12/);
  assert.match(hint, /2/);
});

test("buildCollapsedDiffHintText: negative values are handled gracefully", () => {
  // buildCollapsedDiffHintText doesn't clamp negative values internally,
  // but pluralize handles negative counts (returns plural)
  const hint = buildCollapsedDiffHintText(
    { remainingLines: -1, hiddenHunks: -2 },
    80,
    codePointWidthOps,
  );
  // Should not throw and produce some string
  assert.ok(typeof hint === "string");
  assert.ok(hint.length > 0);
});
