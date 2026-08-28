import assert from "node:assert/strict";
import test from "node:test";
import {
  detectToolDisplayPreset,
  getToolDisplayPresetConfig,
  parseToolDisplayPreset,
} from "../src/presets.ts";

test("preset parsing is case-insensitive and rejects unknown names", () => {
  assert.equal(parseToolDisplayPreset(" BALANCED "), "balanced");
  assert.equal(parseToolDisplayPreset("Verbose"), "verbose");
  assert.equal(parseToolDisplayPreset(""), undefined);
  assert.equal(parseToolDisplayPreset("custom"), undefined);
});

test("preset detection matches cloned preset configs and detects custom changes", () => {
  const balanced = getToolDisplayPresetConfig("balanced");
  const anotherBalanced = getToolDisplayPresetConfig("balanced");

  assert.notEqual(balanced.registerToolOverrides, anotherBalanced.registerToolOverrides);
  assert.equal(detectToolDisplayPreset(balanced), "balanced");
  assert.equal(
    detectToolDisplayPreset({ ...balanced, previewLines: balanced.previewLines + 1 }),
    "custom",
  );
});
