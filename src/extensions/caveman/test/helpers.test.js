import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  getCavemanInstructions,
  isDeactivationCommand,
  parseCavemanCommand,
  resolveSessionActive,
} from "../index.js";

test("parseCavemanCommand: bare toggles", () => {
  assert.deepEqual(parseCavemanCommand(""), { type: "toggle" });
  assert.deepEqual(parseCavemanCommand("   "), { type: "toggle" });
});

test("parseCavemanCommand: on/off/status", () => {
  assert.deepEqual(parseCavemanCommand("on"), { type: "set", active: true });
  assert.deepEqual(parseCavemanCommand("ENABLE"), { type: "set", active: true });
  assert.deepEqual(parseCavemanCommand("off"), { type: "set", active: false });
  assert.deepEqual(parseCavemanCommand("disable"), { type: "set", active: false });
  assert.deepEqual(parseCavemanCommand("status"), { type: "status" });
});

test("parseCavemanCommand: unknown arg is invalid", () => {
  assert.deepEqual(parseCavemanCommand("banana"), { type: "invalid", reason: "unknown-subcommand", arg: "banana" });
});

test("resolveSessionActive: latest persisted entry wins", () => {
  const entries = [
    { type: "custom", customType: "caveman-mode", data: { active: false } },
    { type: "custom", customType: "caveman-mode", data: { active: true } },
  ];
  assert.equal(resolveSessionActive(entries, true), true);
});

test("resolveSessionActive: non-array entries fall back", () => {
  assert.equal(resolveSessionActive(null, true), true);
  assert.equal(resolveSessionActive(undefined, false), false);
  assert.equal(resolveSessionActive({}, true), true);
  assert.equal(resolveSessionActive("nope"), true); // DEFAULT fallback
});

test("isDeactivationCommand: only the whole message, case-insensitive, trailing punct ok", () => {
  assert.equal(isDeactivationCommand("stop caveman"), true);
  assert.equal(isDeactivationCommand("STOP CAVEMAN!"), true);
  assert.equal(isDeactivationCommand("normal mode"), true);
  assert.equal(isDeactivationCommand("Normal Mode."), true);
  assert.equal(isDeactivationCommand("add a normal mode toggle"), false);
  assert.equal(isDeactivationCommand("how do I stop caveman re-rendering"), false);
});

test("getCavemanInstructions reads SKILL.md and strips frontmatter", () => {
  const instructions = getCavemanInstructions();
  assert.ok(instructions.startsWith("CAVEMAN MODE ACTIVE"));
  assert.ok(!instructions.includes("name: caveman")); // frontmatter gone
  assert.ok(instructions.includes("Respond terse like smart caveman"));
});

test("getCavemanInstructions matches src/skills/caveman/SKILL.md body", () => {
  const skillPath = fileURLToPath(new URL("../../../skills/caveman/SKILL.md", import.meta.url));
  const raw = readFileSync(skillPath, "utf8");
  const body = raw.replace(/^---[\s\S]*?---\s*/, "");

  assert.ok(getCavemanInstructions().endsWith(body));
});