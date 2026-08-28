import assert from "node:assert/strict";
import test from "node:test";
import {
  patchNativeUserMessagePrototype,
  type PatchableUserMessagePrototype,
  type UserMessageTheme,
} from "../src/user-message-box-renderer.ts";

function createCountingTheme(label: string): UserMessageTheme & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fg(color: string, text: string): string {
      calls.push(`${label}:fg:${color}:${text}`);
      return `[${label}:${color}]${text}`;
    },
    bold(text: string): string {
      calls.push(`${label}:bold:${text}`);
      return `[${label}:bold]${text}`;
    },
  };
}

function markdownUserMessageInstance(text: string, theme: object = {}): { children: unknown[] } {
  return {
    children: [
      {
        text,
        theme,
      },
    ],
  };
}

function renderLineCount(lines: string[], needle: string): number {
  return lines.filter((line) => line.includes(needle)).length;
}

// RED coverage for the reported long-session slowdown: these tests describe the
// expected production fix but intentionally do not implement it here.

test("native user message border render reuses final boxed output for identical rerenders", () => {
  let originalRenderCount = 0;
  const theme = createCountingTheme("stable");
  const prototype: PatchableUserMessagePrototype = {
    render(width: number) {
      originalRenderCount++;
      return [`stable body at ${width}`];
    },
  };
  const instance = {};

  patchNativeUserMessagePrototype(prototype, () => theme, () => true);

  const first = prototype.render.call(instance, 42);
  const themeCallsAfterFirstRender = theme.calls.length;
  const second = prototype.render.call(instance, 42);

  assert.equal(originalRenderCount, 1, "identical rerender should not call the original body renderer again");
  assert.equal(theme.calls.length, themeCallsAfterFirstRender, "identical rerender should not recolor/rebuild border lines");
  assert.equal(second, first, "identical rerender should return the cached final bordered string[]");
});

test("native user message final output cache invalidates by width and theme without rebuilding unchanged body", () => {
  let originalRenderCount = 0;
  let activeTheme = createCountingTheme("a");
  const prototype: PatchableUserMessagePrototype = {
    render(width: number) {
      originalRenderCount++;
      return [`body rendered for ${width}`];
    },
  };
  const instance = {};

  patchNativeUserMessagePrototype(prototype, () => activeTheme, () => true);

  const width40ThemeA = prototype.render.call(instance, 40);
  const width40ThemeAAgain = prototype.render.call(instance, 40);
  const width50ThemeA = prototype.render.call(instance, 50);
  activeTheme = createCountingTheme("b");
  const width50ThemeB = prototype.render.call(instance, 50);

  assert.equal(width40ThemeAAgain, width40ThemeA, "same width/theme should hit final output cache");
  assert.notEqual(width50ThemeA, width40ThemeA, "different width must invalidate final output cache");
  assert.notDeepEqual(width50ThemeB, width50ThemeA, "different theme must invalidate final output cache");
  assert.equal(originalRenderCount, 2, "body renderer should run only once per distinct content width");
});

test("native user message final output cache does not return stale output after message state changes", () => {
  const markdownTheme = {};
  const instance = markdownUserMessageInstance("first message", markdownTheme);
  const prototype: PatchableUserMessagePrototype = {
    render() {
      throw new Error("markdown child should provide body lines without falling back to original render");
    },
  };

  patchNativeUserMessagePrototype(prototype, () => undefined, () => true);

  const first = prototype.render.call(instance, 48);
  instance.children = [{ text: "second message", theme: markdownTheme }];
  const second = prototype.render.call(instance, 48);

  assert.notEqual(second, first, "changed markdown state should invalidate the final output cache reference");
  assert.ok(first.some((line) => line.includes("first message")), "first render should include the original message");
  assert.ok(second.some((line) => line.includes("second message")), "second render should include the changed message");
  assert.equal(second.some((line) => line.includes("first message")), false, "changed message should not reuse stale boxed output");
});

test("native user message final output cache invalidates when the enabled state changes", () => {
  let enabled = true;
  const originalLines = ["disabled native fallback"];
  const prototype: PatchableUserMessagePrototype = {
    render() {
      return originalLines;
    },
  };
  const instance = {};

  patchNativeUserMessagePrototype(prototype, () => undefined, () => enabled);

  const enabledRender = prototype.render.call(instance, 52);
  const enabledRenderAgain = prototype.render.call(instance, 52);
  enabled = false;
  const disabledRender = prototype.render.call(instance, 52);

  assert.equal(enabledRenderAgain, enabledRender, "same width/theme/enabled state should hit final output cache");
  assert.equal(disabledRender, originalLines, "disabled native rendering must bypass any previously cached boxed output");
  assert.notEqual(disabledRender, enabledRender, "enabled-state change should invalidate final output cache");
});

test("native user message skips custom boxing for markdown text over the character threshold", () => {
  let originalRenderCount = 0;
  const theme = createCountingTheme("huge-text");
  const originalLines = ["huge body fallback"];
  const instance = markdownUserMessageInstance("x".repeat(100_001));
  const prototype: PatchableUserMessagePrototype = {
    render(width: number) {
      originalRenderCount++;
      assert.equal(width, 80, "oversized messages should bypass native boxing before content-width shrinking");
      return originalLines;
    },
  };

  patchNativeUserMessagePrototype(prototype, () => theme, () => true);

  const rendered = prototype.render.call(instance, 80);

  assert.equal(originalRenderCount, 1);
  assert.equal(rendered, originalLines, "oversized markdown text should return the original render output without custom boxing");
  assert.equal(renderLineCount(rendered, "│"), 0, "oversized markdown text should avoid per-line custom box work");
  assert.equal(theme.calls.length, 0, "oversized markdown text should not spend time coloring native border lines");
});

test("native user message skips custom boxing for markdown text over the line-count threshold", () => {
  let originalRenderCount = 0;
  const theme = createCountingTheme("huge-lines");
  const originalLines = ["line-count fallback"];
  const instance = markdownUserMessageInstance(`${"line\n".repeat(2000)}tail`);
  const prototype: PatchableUserMessagePrototype = {
    render(width: number) {
      originalRenderCount++;
      assert.equal(width, 72, "line-heavy messages should bypass native boxing before content-width shrinking");
      return originalLines;
    },
  };

  patchNativeUserMessagePrototype(prototype, () => theme, () => true);

  const rendered = prototype.render.call(instance, 72);

  assert.equal(originalRenderCount, 1);
  assert.equal(rendered, originalLines, "line-heavy markdown should return the original render output without custom boxing");
  assert.equal(renderLineCount(rendered, "│"), 0, "line-heavy markdown should avoid per-line custom box work");
  assert.equal(theme.calls.length, 0, "line-heavy markdown should not spend time coloring native border lines");
});
