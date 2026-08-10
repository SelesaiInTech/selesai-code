import test from "node:test";
import assert from "node:assert/strict";

import { isSupportedSuperShortcut, matchesConfiguredShortcut, shortcutConflictKey } from "../shortcuts.ts";
import { resolveShortcutConfig } from "../index.ts";

test("surviving editor shortcuts resolve alongside chat jumps", () => {
  const resolved = resolveShortcutConfig({});
  assert.equal(resolved.stashHistory, "ctrl+alt+h");
  assert.equal(resolved.copyEditor, "ctrl+alt+c");
  assert.equal(resolved.cutEditor, "ctrl+alt+x");
  assert.equal(resolved.ideaCapture, null);
  assert.equal(resolved.editorStart, "super+shift+up");
  assert.equal(resolved.editorEnd, "super+shift+down");
  assert.equal(resolved.jumpPreviousUserMessage, "ctrl+shift+u");
  assert.equal(resolved.jumpChatBottom, "ctrl+shift+g");
  assert.equal(resolved.scrollChatUp, "super+up");
  assert.equal(resolved.scrollChatDown, "super+down");
});

test("super shortcut matching and conflict normalization remain supported", () => {
  assert.equal(matchesConfiguredShortcut("\x1b[1;9A", "super+up"), true);
  assert.equal(matchesConfiguredShortcut("c", "super+c"), false);
  assert.equal(isSupportedSuperShortcut("super+up"), true);
  assert.equal(isSupportedSuperShortcut("super+z"), false);
  assert.equal(shortcutConflictKey("super+home"), "super+up");
});

test("idea capture shortcut remains configurable", () => {
  const resolved = resolveShortcutConfig({
    powerlineShortcuts: {
      ideaCapture: "ctrl+alt+i",
    },
  });

  assert.equal(resolved.ideaCapture, "ctrl+alt+i");
});

test("editor boundary shortcuts remain configurable", () => {
  const resolved = resolveShortcutConfig({
    powerlineShortcuts: {
      editorStart: "ctrl+shift+y",
      editorEnd: "ctrl+shift+x",
    },
  });

  assert.equal(resolved.editorStart, "ctrl+shift+y");
  assert.equal(resolved.editorEnd, "ctrl+shift+x");
});
