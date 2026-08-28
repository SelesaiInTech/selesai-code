import assert from "node:assert/strict";
import test from "node:test";
import {
  extractUserMessageMarkdownState,
} from "../src/user-message-box-markdown.ts";
import {
  patchUserMessageRenderPrototype,
  type PatchableUserMessagePrototype,
} from "../src/user-message-box-patch.ts";
import {
  patchNativeUserMessagePrototype,
  shouldBypassUserMessageMarkdownRebuild,
  createUserMessageMarkdownLineRenderer,
} from "../src/user-message-box-renderer.ts";
import {
  addUserMessageVerticalPadding,
  applyUserMessageBackground,
  normalizeUserMessageContentLine,
  normalizeUserMessageContentLines,
  type UserMessageBackgroundTheme,
} from "../src/user-message-box-utils.ts";

// ===========================================================================
// Issue #10: OSC 133 prompt marker stripping
// Each variant: BEL-terminated (\x07) and ST-terminated (\x1b\\)
// ===========================================================================

test("osc133 strips BEL-terminated A marker from content", () => {
  assert.equal(
    normalizeUserMessageContentLine("before\x1b]133;A\x07after"),
    "beforeafter",
  );
});

test("osc133 strips BEL-terminated B marker from content", () => {
  assert.equal(
    normalizeUserMessageContentLine("\x1b]133;B\x07middle"),
    "middle",
  );
});

test("osc133 strips BEL-terminated C marker from content", () => {
  assert.equal(
    normalizeUserMessageContentLine("data\x1b]133;C\x07"),
    "data",
  );
});

test("osc133 strips BEL-terminated D marker from content", () => {
  assert.equal(
    normalizeUserMessageContentLine("\x1b]133;D\x07trailing"),
    "trailing",
  );
});

test("osc133 strips ST-terminated A marker", () => {
  assert.equal(
    normalizeUserMessageContentLine("lead\x1b]133;A\x1b\\tail"),
    "leadtail",
  );
});

test("osc133 strips ST-terminated B marker", () => {
  assert.equal(
    normalizeUserMessageContentLine("\x1b]133;B\x1b\\inner"),
    "inner",
  );
});

test("osc133 strips ST-terminated C marker", () => {
  assert.equal(
    normalizeUserMessageContentLine("\x1b]133;C\x1b\\"),
    "",
  );
});

test("osc133 strips ST-terminated D marker", () => {
  assert.equal(
    normalizeUserMessageContentLine("\x1b]133;D\x1b\\data"),
    "data",
  );
});

test("osc133 strips multiple markers in a single line", () => {
  assert.equal(
    normalizeUserMessageContentLine("\x1b]133;A\x07hello\x1b]133;B\x07 world\x1b]133;C\x07"),
    "hello world",
  );
});

test("osc133 strips marker with optional semicolon-delimited parameters", () => {
  assert.equal(
    normalizeUserMessageContentLine("\x1b]133;A;url=https://example.com\x07text\x1b]133;B\x07"),
    "text",
  );
});

test("osc133 markers are stripped via applyUserMessageBackground path", () => {
  assert.equal(
    applyUserMessageBackground(undefined, "hello\x1b]133;A\x07"),
    "hello",
  );
});

test("osc133-only line is treated as visually empty", () => {
  assert.equal(
    normalizeUserMessageContentLine("\x1b]133;A\x07\x1b]133;B\x07"),
    "",
  );
});

// ===========================================================================
// Nested Box → Markdown structures
// ===========================================================================

test("extract finds deeply nested markdown child at depth 10", () => {
  const theme = { heading: () => "" };
  let child: Record<string, unknown> = {
    text: "deep markdown",
    theme,
  };
  for (let i = 0; i < 10; i++) {
    child = { children: [child] };
  }
  const extracted = extractUserMessageMarkdownState({ children: [child] });
  assert.equal(extracted?.text, "deep markdown");
  assert.equal(extracted?.theme, theme);
});

test("extract returns first markdown child via DFS (not last)", () => {
  const themeA = { heading: () => "a" };
  const themeB = { heading: () => "b" };
  const extracted = extractUserMessageMarkdownState({
    children: [
      { text: "first", theme: themeA },
      { text: "second", theme: themeB },
    ],
  });
  assert.equal(extracted?.text, "first");
  assert.equal(extracted?.theme, themeA);
});

test("extract returns undefined when no markdown child exists", () => {
  const extracted = extractUserMessageMarkdownState({
    children: [{ lines: 3 }, { other: "data" }],
  });
  assert.equal(extracted, undefined);
});

test("extract returns undefined when child has theme but no text string", () => {
  const extracted = extractUserMessageMarkdownState({
    children: [{ theme: { heading: () => "" } }],
  });
  assert.equal(extracted, undefined);
});

test("extract returns markdown when top-level value itself is markdown-like", () => {
  const theme = { heading: () => "" };
  const extracted = extractUserMessageMarkdownState({
    text: "self markdown",
    theme,
  } as never);
  assert.equal(extracted?.text, "self markdown");
  assert.equal(extracted?.theme, theme);
});

// ===========================================================================
// Malformed children on extractUserMessageMarkdownState
// ===========================================================================

test("extract handles null children gracefully", () => {
  assert.equal(extractUserMessageMarkdownState({ children: null }), undefined);
});

test("extract handles undefined children (missing property) gracefully", () => {
  assert.equal(extractUserMessageMarkdownState({}), undefined);
});

test("extract handles children as a plain string (non-array)", () => {
  assert.equal(
    extractUserMessageMarkdownState({ children: "not-an-array" as never }),
    undefined,
  );
});

test("extract handles children as a number", () => {
  assert.equal(
    extractUserMessageMarkdownState({ children: 42 as never }),
    undefined,
  );
});

test("extract handles array children containing only non-object items", () => {
  assert.equal(
    extractUserMessageMarkdownState({ children: [null, 42, "str", undefined, true] }),
    undefined,
  );
});

test("extract handles null top-level value", () => {
  assert.equal(extractUserMessageMarkdownState(null as never), undefined);
});

test("extract handles undefined top-level value", () => {
  assert.equal(extractUserMessageMarkdownState(undefined as never), undefined);
});

test("extract handles circular reference (stack overflow expected)", () => {
  const circular: Record<string, unknown> = { children: [] };
  circular.children = [circular];
  // findMarkdownChild recurses without cycle detection, so this throws.
  // In production the caller wraps extract in try/catch.
  assert.throws(() => {
    extractUserMessageMarkdownState(circular);
  });
});

// ===========================================================================
// defaultTextStyle bgColor sanitization
// ===========================================================================

test("extract strips bgColor but keeps other defaultTextStyle props", () => {
  const extracted = extractUserMessageMarkdownState({
    children: [{
      text: "styled",
      theme: {},
      defaultTextStyle: { color: "red", bgColor: () => "", bold: true },
    }],
  });
  assert.equal(extracted?.defaultTextStyle?.color, "red");
  assert.equal(extracted?.defaultTextStyle?.bold, true);
  assert.equal("bgColor" in (extracted?.defaultTextStyle ?? {}), false);
});

test("extract returns undefined defaultTextStyle when all props were bgColor-only", () => {
  const extracted = extractUserMessageMarkdownState({
    children: [{
      text: "text",
      theme: {},
      defaultTextStyle: { bgColor: () => "" },
    }],
  });
  assert.equal(extracted?.defaultTextStyle, undefined);
});

test("extract returns undefined defaultTextStyle when value is not a record", () => {
  const extracted = extractUserMessageMarkdownState({
    children: [{
      text: "raw",
      theme: {},
      defaultTextStyle: "string" as never,
    }],
  });
  assert.equal(extracted?.defaultTextStyle, undefined);
});

// ===========================================================================
// applyUserMessageBackground with various theme objects
// ===========================================================================

test("applyBg on empty theme object returns sanitized text unchanged", () => {
  const result = applyUserMessageBackground({}, "\x1b[31mred\x1b[0m");
  // \x1b[0m → \x1b[39;22;23;24;25;27;28;29m (reset sans bg params)
  assert.ok(result.includes("\x1b[31mred"));
  assert.doesNotMatch(result, /\x1b\[0m/);
});

test("applyBg with empty string returns empty string", () => {
  assert.equal(applyUserMessageBackground({ getBgAnsi: () => "\x1b[48;5;24m" }, ""), "");
  assert.equal(applyUserMessageBackground(undefined, ""), "");
});

test("applyBg ignores getBgAnsi when it is not a function and falls to bg", () => {
  const result = applyUserMessageBackground(
    {
      getBgAnsi: "not-a-fn" as never,
      bg: (_color, text) => `wrapped(${text})`,
    },
    "hello",
  );
  assert.equal(result, "wrapped(hello)");
});

test("applyBg falls back to bg when getBgAnsi throws", () => {
  const result = applyUserMessageBackground(
    {
      getBgAnsi: () => { throw new Error("oops"); },
      bg: (_color, text) => `fallback(${text})`,
    },
    "hello",
  );
  assert.equal(result, "fallback(hello)");
});

test("applyBg returns sanitized text when both getBgAnsi and bg throw", () => {
  const result = applyUserMessageBackground(
    {
      getBgAnsi: () => { throw new Error("e1"); },
      bg: (_color, _text) => { throw new Error("e2"); },
    },
    "\x1b[32mtext",
  );
  assert.equal(result, "\x1b[32mtext");
});

test("applyBg returns sanitized text when theme has neither method", () => {
  const result = applyUserMessageBackground(
    { unrelated: true } as never,
    "\x1b[33myellow\x1b[0m",
  );
  assert.ok(result.includes("\x1b[33myellow"));
});

test("applyBg passes userMessageBg constant to getBgAnsi", () => {
  let capturedColor = "";
  applyUserMessageBackground(
    {
      getBgAnsi: (color) => {
        capturedColor = color;
        return "\x1b[48;5;24m";
      },
    },
    "test",
  );
  assert.equal(capturedColor, "userMessageBg");
});

test("applyBg passes userMessageBg constant to bg fallback", () => {
  let capturedColor = "";
  const result = applyUserMessageBackground(
    {
      bg: (color, text) => {
        capturedColor = color;
        return `[${color}]${text}`;
      },
    },
    "text",
  );
  assert.equal(capturedColor, "userMessageBg");
  assert.equal(result, "[userMessageBg]text");
});

// ===========================================================================
// Background double-application prevention (Issue #8 / #3)
// ===========================================================================

test("applyBg strips internal SGR 49 and appends exactly one reset at end", () => {
  const rendered = applyUserMessageBackground(
    { getBgAnsi: () => "\x1b[48;5;24m" },
    "\x1b[31mhello\x1b[49m",
  );
  const fortyNineMatches = rendered.match(/\x1b\[49m/g);
  assert.equal(fortyNineMatches?.length ?? 0, 1);
  assert.ok(rendered.endsWith("\x1b[49m"));
});

test("applyBg strips multiple SGR 49 occurrences, appends single reset", () => {
  const rendered = applyUserMessageBackground(
    { getBgAnsi: () => "\x1b[48;5;24m" },
    "\x1b[49mstart\x1b[49m middle\x1b[49m",
  );
  const fortyNineMatches = rendered.match(/\x1b\[49m/g);
  assert.equal(fortyNineMatches?.length ?? 0, 1);
  assert.ok(rendered.endsWith("\x1b[49m"));
});

test("applyBg strips existing background SGR before applying new bg via getBgAnsi", () => {
  const rendered = applyUserMessageBackground(
    { getBgAnsi: () => "\x1b[48;5;24m" },
    "\x1b[48;5;160mtext\x1b[49m",
  );
  // Original bg (48;5;160) stripped
  assert.doesNotMatch(rendered, /\x1b\[48;5;160m/);
  // New bg applied exactly once
  const bg24Matches = rendered.match(/\x1b\[48;5;24m/g);
  assert.equal(bg24Matches?.length ?? 0, 1);
  // Reset appended exactly once
  const fortyNineMatches = rendered.match(/\x1b\[49m/g);
  assert.equal(fortyNineMatches?.length ?? 0, 1);
  assert.ok(rendered.endsWith("\x1b[49m"));
});

test("applyBg via bg function does not double-wrap", () => {
  const rendered = applyUserMessageBackground(
    { bg: (_color, text) => `[bg]${text}[/bg]` },
    "\x1b[48;5;24mhello",
  );
  assert.ok(rendered.startsWith("[bg]"));
  assert.ok(rendered.includes("hello"));
  // The SGR 48;5;24 is stripped by sanitizeAnsiForThemedOutput
  assert.doesNotMatch(rendered, /\x1b\[48;5;24m/);
});

// ===========================================================================
// normalizeUserMessageContentLines edge cases
// ===========================================================================

test("normalizeLines empty array returns empty array", () => {
  assert.deepEqual(normalizeUserMessageContentLines([]), []);
});

test("normalizeLines trims leading and trailing whitespace-only lines", () => {
  assert.deepEqual(
    normalizeUserMessageContentLines(["   ", "content", "\t"]),
    ["content"],
  );
});

test("normalizeLines preserves interior empty lines", () => {
  assert.deepEqual(
    normalizeUserMessageContentLines(["start", "", "end"]),
    ["start", "", "end"],
  );
});

test("normalizeLines trims only edge lines, not interior whitespace", () => {
  assert.deepEqual(
    normalizeUserMessageContentLines(["", "  indented  ", "middle", ""]),
    ["  indented  ", "middle"],
  );
});

test("normalizeLines treats leading OSC133-only lines as visually empty and trims them", () => {
  assert.deepEqual(
    normalizeUserMessageContentLines([
      "\x1b]133;A\x07\x1b]133;B\x07   ",
      "actual",
      "\x1b]133;C\x07\u001b[0m",
    ]),
    ["actual"],
  );
});

test("normalizeLines handles array with all visually empty lines", () => {
  assert.deepEqual(
    normalizeUserMessageContentLines(["", "   ", "\x1b[0m"]),
    [],
  );
});

test("normalizeLines preserves lines with trailing spaces that are not edge lines", () => {
  // Trailing spaces on interior lines are preserved
  const result = normalizeUserMessageContentLines(["hello   ", "world"]);
  assert.equal(result[0], "hello   ");
  assert.equal(result[1], "world");
});

// ===========================================================================
// normalizeUserMessageContentLine edge cases
// ===========================================================================

test("normalizeLine preserves tab characters", () => {
  assert.equal(normalizeUserMessageContentLine("\thello\tworld"), "\thello\tworld");
});

test("normalizeLine preserves non-SGR control characters", () => {
  assert.equal(normalizeUserMessageContentLine("a\x00b\x01c"), "a\x00b\x01c");
});

test("normalizeLine handles very long line without truncation", () => {
  const longLine = "x".repeat(10000);
  assert.equal(normalizeUserMessageContentLine(longLine), longLine);
});

test("normalizeLine handles very long line with ANSI sequences", () => {
  const result = normalizeUserMessageContentLine(
    "\x1b[31m" + "x".repeat(5000) + "\x1b[0m" + "y".repeat(5000),
  );
  // Content survives; SGR 0 is converted to reset params sans bg
  assert.ok(result.includes("x".repeat(5000)));
  assert.ok(result.includes("y".repeat(5000)));
});

test("normalizeLine returns empty for line with only SGR control sequences", () => {
  assert.equal(normalizeUserMessageContentLine("\x1b[0m\x1b[31m\x1b[0m"), "");
});

test("normalizeLine returns empty for empty string", () => {
  assert.equal(normalizeUserMessageContentLine(""), "");
});

test("normalizeLine returns empty for whitespace-only string", () => {
  assert.equal(normalizeUserMessageContentLine("   \t  "), "");
});

test("normalizeLine preserves hyperlinks (OSC 8) while stripping OSC 133", () => {
  const hyperlink = "\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\";
  const result = normalizeUserMessageContentLine(hyperlink);
  // OSC 8 hyperlinks should be preserved, not stripped
  assert.equal(result, hyperlink);
});

// ===========================================================================
// addUserMessageVerticalPadding edge cases
// ===========================================================================

test("addPadding on empty array returns two empty padding lines", () => {
  assert.deepEqual(addUserMessageVerticalPadding([]), ["", ""]);
});

test("addPadding on single line adds one blank line before and after", () => {
  assert.deepEqual(addUserMessageVerticalPadding(["only"]), ["", "only", ""]);
});

test("addPadding on already-padded input adds another layer of padding", () => {
  assert.deepEqual(
    addUserMessageVerticalPadding(["", "content", ""]),
    ["", "", "content", "", ""],
  );
});

test("addPadding on multi-line input pads all sides equally", () => {
  const result = addUserMessageVerticalPadding(["a", "b", "c"]);
  assert.equal(result.length, 5);
  assert.equal(result[0], "");
  assert.equal(result[result.length - 1], "");
  assert.deepEqual(result.slice(1, -1), ["a", "b", "c"]);
});

// ===========================================================================
// patchUserMessageRenderPrototype version handling
// ===========================================================================

test("patchRenderPrototype skips when prototype.render is not a function", () => {
  const prototype: PatchableUserMessagePrototype = {
    render: undefined as never,
  };
  patchUserMessageRenderPrototype(prototype, 7, (orig) => orig);
  assert.equal(prototype.render, undefined);
});

test("patchRenderPrototype skips when already patched with same version", () => {
  let buildCallCount = 0;
  const originalRender = (width: number) => [`orig:${width}`];
  const prototype: PatchableUserMessagePrototype = {
    render: originalRender,
    __piUserMessageOriginalRender: originalRender,
    __piUserMessageNativePatched: true,
    __piUserMessagePatchVersion: 7,
  };
  patchUserMessageRenderPrototype(prototype, 7, (_orig) => {
    buildCallCount++;
    return (width) => [`patched:${width}`];
  });
  assert.equal(buildCallCount, 0);
  assert.equal(prototype.render, originalRender);
});

test("patchRenderPrototype reapplies when version is different (upgrade)", () => {
  const originalRender = (width: number) => [`orig:${width}`];
  const prototype: PatchableUserMessagePrototype = {
    render: (width: number) => [`stale:${width}`],
    __piUserMessageOriginalRender: originalRender,
    __piUserMessageNativePatched: true,
    __piUserMessagePatchVersion: 1,
  };
  patchUserMessageRenderPrototype(prototype, 7, (baseRender) => {
    return function (this: unknown, width: number) {
      return [`v7:${baseRender.call(this, width)}`];
    };
  });
  assert.deepEqual(prototype.render(42), ["v7:orig:42"]);
  assert.equal(prototype.__piUserMessagePatchVersion, 7);
});

test("patchRenderPrototype saves original render when __piUserMessageOriginalRender is absent", () => {
  const originalRender = (width: number) => [`orig:${width}`];
  const prototype: PatchableUserMessagePrototype = {
    render: originalRender,
  };
  patchUserMessageRenderPrototype(prototype, 7, (baseRender) => {
    return function (this: unknown, width: number) {
      return [`patched:${baseRender.call(this, width)}`];
    };
  });
  assert.equal(prototype.__piUserMessageOriginalRender, originalRender);
  assert.notEqual(prototype.render, originalRender);
  assert.deepEqual(prototype.render(10), ["patched:orig:10"]);
});

test("patchRenderPrototype saves original and patches when same version but original undefined", () => {
  const originalRender = (width: number) => [`r:${width}`];
  const prototype: PatchableUserMessagePrototype = {
    render: originalRender,
    __piUserMessageOriginalRender: undefined,
    __piUserMessageNativePatched: true,
    __piUserMessagePatchVersion: 5,
  };
  // Guard requires all three: patched + same version + original IS function.
  // Since original is undefined, the function saves it and applies patch.
  patchUserMessageRenderPrototype(prototype, 5, (baseRender) => {
    return function (this: unknown, width: number) {
      return [`patched:${baseRender.call(this, width)}`];
    };
  });
  assert.equal(prototype.__piUserMessageOriginalRender, originalRender);
  assert.deepEqual(prototype.render(10), ["patched:r:10"]);
  assert.equal(prototype.__piUserMessagePatchVersion, 5);
});

test("patchRenderPrototype saves original and patches when version differs and original undefined", () => {
  const originalRender = (width: number) => [`r:${width}`];
  const prototype: PatchableUserMessagePrototype = {
    render: originalRender,
    __piUserMessageOriginalRender: undefined,
    __piUserMessageNativePatched: true,
    __piUserMessagePatchVersion: 5,
  };
  // Version differs (5 !== 7) so guard doesn't skip.
  // Original is undefined, so the function saves it and applies patch.
  patchUserMessageRenderPrototype(prototype, 7, (baseRender) => {
    return function (this: unknown, width: number) {
      return [`v7:${baseRender.call(this, width)}`];
    };
  });
  assert.equal(prototype.__piUserMessageOriginalRender, originalRender);
  assert.deepEqual(prototype.render(10), ["v7:r:10"]);
  assert.equal(prototype.__piUserMessagePatchVersion, 7);
});

// ===========================================================================
// patchNativeUserMessagePrototype: width threshold and enable guard
// ===========================================================================

test("nativeRender width < 8 bypasses native rendering", () => {
  let capturedWidth: number | undefined;
  const prototype: PatchableUserMessagePrototype = {
    render: (width: number) => {
      capturedWidth = width;
      return [`orig:${width}`];
    },
  };
  patchNativeUserMessagePrototype(prototype, () => undefined, () => true);
  assert.deepEqual(prototype.render(7), ["orig:7"]);
  assert.equal(capturedWidth, 7);
});

test("nativeRender width exactly 8 triggers native rendering", () => {
  const prototype: PatchableUserMessagePrototype = {
    render: () => ["content"],
  };
  patchNativeUserMessagePrototype(prototype, () => undefined, () => true);
  const rendered = prototype.render(8);
  assert.ok(rendered.some((line) => line.includes("╭")), "should have top border");
  assert.ok(rendered.some((line) => line.includes("╰")), "should have bottom border");
});

test("nativeRender width 0 bypasses native rendering", () => {
  let capturedWidth: number | undefined;
  const prototype: PatchableUserMessagePrototype = {
    render: (width: number) => {
      capturedWidth = width;
      return [`orig:${width}`];
    },
  };
  patchNativeUserMessagePrototype(prototype, () => undefined, () => true);
  assert.deepEqual(prototype.render(0), ["orig:0"]);
  assert.equal(capturedWidth, 0);
});

test("nativeRender negative width bypasses native rendering", () => {
  let capturedWidth: number | undefined;
  const prototype: PatchableUserMessagePrototype = {
    render: (width: number) => {
      capturedWidth = width;
      return [`orig:${width}`];
    },
  };
  patchNativeUserMessagePrototype(prototype, () => undefined, () => true);
  assert.deepEqual(prototype.render(-5), ["orig:0"]);
  assert.equal(capturedWidth, 0);
});

test("nativeRender fractional width floors before threshold check", () => {
  let capturedWidth: number | undefined;
  const prototype: PatchableUserMessagePrototype = {
    render: (width: number) => {
      capturedWidth = width;
      return [`orig:${width}`];
    },
  };
  patchNativeUserMessagePrototype(prototype, () => undefined, () => true);
  // 7.5 floors to 7 → < 8 → bypass
  assert.deepEqual(prototype.render(7.5), ["orig:7"]);
  assert.equal(capturedWidth, 7);
});

test("nativeRender isEnabled false bypasses native rendering regardless of width", () => {
  let capturedWidth: number | undefined;
  const prototype: PatchableUserMessagePrototype = {
    render: (width: number) => {
      capturedWidth = width;
      return [`orig:${width}`];
    },
  };
  patchNativeUserMessagePrototype(prototype, () => undefined, () => false);
  assert.deepEqual(prototype.render(100), ["orig:100"]);
  assert.equal(capturedWidth, 100);
});

test("nativeRender produces top margin spacer and border when enabled and width >= 8", () => {
  const prototype: PatchableUserMessagePrototype = {
    render: () => ["user message body"],
  };
  patchNativeUserMessagePrototype(prototype, () => undefined, () => true);
  const rendered = prototype.render(40);
  assert.equal(rendered[0], "", "first line is top margin spacer");
  assert.ok(rendered[1]?.includes("╭"), "second line has top border");
  assert.ok(rendered.some((l) => l.includes("│")), "has content border lines");
  assert.ok(rendered.some((l) => l.includes("╰")), "has bottom border");
});

test("nativeRender prototype without render function does not crash", () => {
  const prototype: Partial<PatchableUserMessagePrototype> = {};
  patchNativeUserMessagePrototype(
    prototype as PatchableUserMessagePrototype,
    () => undefined,
    () => true,
  );
  assert.equal((prototype as PatchableUserMessagePrototype).render, undefined);
});

test("nativeRender invokes original for empty body content", () => {
  let calledWith = -1;
  const prototype: PatchableUserMessagePrototype = {
    render: (w) => {
      calledWith = w;
      return [];
    },
  };
  patchNativeUserMessagePrototype(prototype, () => undefined, () => true);
  prototype.render(8);
  // original called with content-width = max(1, 8-2-1*2) = max(1, 4) = 4
  assert.equal(calledWith, 4);
});

// ===========================================================================
// shouldBypassUserMessageMarkdownRebuild edge cases
// ===========================================================================

test("bypass guard allows short text within limits", () => {
  assert.equal(
    shouldBypassUserMessageMarkdownRebuild({ text: "short", theme: {} }),
    false,
  );
});

test("bypass guard triggers on text over 100000 chars", () => {
  assert.equal(
    shouldBypassUserMessageMarkdownRebuild({
      text: "x".repeat(100001),
      theme: {},
    }),
    true,
  );
});

test("bypass guard triggers when line count exceeds 2000", () => {
  assert.equal(
    shouldBypassUserMessageMarkdownRebuild({
      text: `${"line\n".repeat(2000)}tail`,
      theme: {},
    }),
    true,
  );
});

test("bypass guard does NOT bypass exactly 2000 lines (threshold is > 2000)", () => {
  // 1999 newlines = 2000 lines; guard checks > 2000, so 2000 should NOT bypass
  assert.equal(
    shouldBypassUserMessageMarkdownRebuild({
      text: "a\n".repeat(1999) + "a",
      theme: {},
    }),
    false,
  );
});

// ===========================================================================
// createUserMessageMarkdownLineRenderer cache behavior
// ===========================================================================

test("markdown line renderer cache hits on identical state and width", () => {
  let rendererCreationCount = 0;
  let renderCallCount = 0;
  const renderMarkdown = createUserMessageMarkdownLineRenderer((state) => {
    rendererCreationCount++;
    return {
      render(width: number) {
        renderCallCount++;
        return [`${state.text}:${width}`];
      },
    };
  });

  const instance = {};
  const theme = { heading: () => "" };
  const state = { text: "cached", theme, defaultTextStyle: { bold: true } };

  assert.deepEqual(renderMarkdown(instance, state, 24), ["cached:24"]);
  assert.deepEqual(renderMarkdown(instance, state, 24), ["cached:24"]);
  assert.equal(rendererCreationCount, 1);
  assert.equal(renderCallCount, 1);
});

test("markdown line renderer re-renders on width change with same renderer", () => {
  let rendererCreationCount = 0;
  let renderCallCount = 0;
  const renderMarkdown = createUserMessageMarkdownLineRenderer((state) => {
    rendererCreationCount++;
    return {
      render(width: number) {
        renderCallCount++;
        return [`${state.text}:${width}`];
      },
    };
  });

  const instance = {};
  const theme = { heading: () => "" };
  const state = { text: "width-test", theme };

  assert.deepEqual(renderMarkdown(instance, state, 10), ["width-test:10"]);
  assert.deepEqual(renderMarkdown(instance, state, 20), ["width-test:20"]);
  assert.equal(rendererCreationCount, 1);
  assert.equal(renderCallCount, 2);
});

test("markdown line renderer creates new renderer on state change", () => {
  let rendererCreationCount = 0;
  const renderMarkdown = createUserMessageMarkdownLineRenderer((state) => {
    rendererCreationCount++;
    return {
      render(_width: number) {
        return [`${state.text}`];
      },
    };
  });

  const instance = {};
  const theme = { heading: () => "" };

  assert.deepEqual(renderMarkdown(instance, { text: "a", theme }, 10), ["a"]);
  assert.deepEqual(renderMarkdown(instance, { text: "b", theme }, 10), ["b"]);
  assert.equal(rendererCreationCount, 2);
});

test("markdown line renderer uses separate cache per instance (WeakMap)", () => {
  let rendererCreationCount = 0;
  const renderMarkdown = createUserMessageMarkdownLineRenderer((state) => {
    rendererCreationCount++;
    return {
      render(_width: number) {
        return [`${state.text}`];
      },
    };
  });

  const instanceA = {};
  const instanceB = {};
  const theme = { heading: () => "" };
  const state = { text: "shared", theme };

  assert.deepEqual(renderMarkdown(instanceA, state, 10), ["shared"]);
  assert.deepEqual(renderMarkdown(instanceB, state, 10), ["shared"]);
  // Each instance gets its own cache entry, so two renderers created
  assert.equal(rendererCreationCount, 2);
});

// ===========================================================================
// End-to-end: patchNativeUserMessagePrototype with real theme
// ===========================================================================

test("nativeRender applies theme coloring via fg and bold", () => {
  const prototype: PatchableUserMessagePrototype = {
    render: () => ["hello world"],
  };
  const theme = {
    fg: (_color: string, text: string) => `[${_color}]${text}`,
    bold: (text: string) => `*${text}*`,
  };
  patchNativeUserMessagePrototype(prototype, () => theme, () => true);

  const rendered = prototype.render(30);
  // Title should be bold + accent-colored
  const titleLine = rendered.find((l) => l.includes("user")) ?? "";
  assert.ok(titleLine.includes("* user *") || titleLine.includes("[accent]"));
  // Border should be border-colored
  const topBorder = rendered.find((l) => l.includes("╭")) ?? "";
  assert.ok(topBorder.includes("[border]"));
});

test("nativeRender builds correct box structure with all required line types", () => {
  const prototype: PatchableUserMessagePrototype = {
    render: () => ["line one", "line two"],
  };
  patchNativeUserMessagePrototype(prototype, () => undefined, () => true);

  const rendered = prototype.render(30);
  // Structure: [spacer, top-border, padding, content-line, padding, content-line, padding, bottom-border]
  // With vertical padding of 1, each content line gets padding on both sides:
  // But actually, addUserMessageVerticalPadding adds 1 padding before and after ALL content:
  // So: spacer(blank), top-border, blank, content1, content2, blank, bottom-border
  // = 7 lines total
  assert.ok(rendered.length >= 5);
  assert.equal(rendered.filter((l) => l.includes("│")).length, 4); // 2 content + 2 padding
  assert.equal(rendered.filter((l) => l.includes("╭") || l.includes("╰")).length, 2);
});
