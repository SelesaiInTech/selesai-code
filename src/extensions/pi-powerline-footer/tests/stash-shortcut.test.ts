import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchesStashShortcutInput } from "../shortcuts.ts";

const source = readFileSync(new URL("../index.ts", import.meta.url), "utf-8");

test("stash shortcut matches Alt+S encodings without consuming literal sharp-S by default", () => {
  assert.equal(matchesStashShortcutInput("ß"), false);
  assert.equal(matchesStashShortcutInput("ß", { includePrintableSharpS: true }), true);

  for (const data of [
    "\x1bs",
    "\x1bS",
    "\x1b[115;3u",
    "\x1b[83;3u",
    "\x1b[27;3;115~",
    "\x1b[27;3;83~",
  ]) {
    assert.equal(matchesStashShortcutInput(data), true, data);
  }

  assert.equal(matchesStashShortcutInput("s"), false);
  assert.equal(matchesStashShortcutInput("\x1b[115;5u"), false);
});

test("stash shortcut stays in terminal/editor fallback routing", () => {
  assert.doesNotMatch(source, /pi\.registerShortcut\("alt\+s"/);
  assert.match(source, /matchesStashShortcutInput\(data, \{ includePrintableSharpS: config\.stashSharpSShortcut \}\)/);
  assert.match(source, /ctx\.ui\.onTerminalInput\(\(data: string\) =>/);
  assert.match(source, /if \(isStashShortcutInput\(data\)\)/);
  assert.match(source, /function stashOrRestoreEditorText\(ctx: any\): void/);
  assert.match(source, /function isPromptHistoryShortcutInput\(data: string\): boolean/);
  assert.match(source, /matchesConfiguredShortcut\(data, resolvedShortcuts\.stashHistory\)/);
  assert.doesNotMatch(source, /data === "\\x1b\\b"/);
  assert.doesNotMatch(source, /data === "\\x1b\\x7f"/);
});
