import assert from "node:assert/strict";
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

test("resolveSessionActive: returns last persisted boolean, defaults to true", () => {
  assert.equal(resolveSessionActive([]), true);
  assert.equal(resolveSessionActive([{ type: "custom", customType: "caveman-mode", data: { active: false } }]), false);
  assert.equal(resolveSessionActive([{ type: "custom", customType: "caveman-mode", data: { active: true } }]), true);
  assert.equal(resolveSessionActive([
    { type: "custom", customType: "caveman-mode", data: { active: false } },
    { type: "custom", customType: "caveman-mode", data: { active: true } },
  ]), true);
  assert.equal(resolveSessionActive([{ type: "custom", customType: "other", data: {} }]), true);
  assert.equal(resolveSessionActive(null), true);
});

test("isDeactivationCommand: only the whole message, case-insensitive, trailing punct ok", () => {
  assert.equal(isDeactivationCommand("stop caveman"), true);
  assert.equal(isDeactivationCommand("STOP CAVEMAN!"), true);
  assert.equal(isDeactivationCommand("normal mode"), true);
  assert.equal(isDeactivationCommand("Normal Mode."), true);
  assert.equal(isDeactivationCommand("add a normal mode toggle"), false);
  assert.equal(isDeactivationCommand("how do I stop caveman re-rendering"), false);
});

test("getCavemanInstructions returns the compact runtime prompt", () => {
  const instructions = getCavemanInstructions();

  assert.equal(instructions,
    "CAVEMAN MODE ACTIVE. Terse, technically complete: omit articles, filler, pleasantries, and hedging; fragments, short terms, standard abbreviations, and -> are OK. Preserve technical terms, code blocks, and quoted errors exactly. Use clear normal prose for security warnings, irreversible confirmations, risky multi-step instructions, or requested/repeated clarification; then resume terse mode.");
  assert.ok(!instructions.includes("Persistence"));
  assert.ok(!instructions.includes("stop caveman"));
  assert.ok(!instructions.includes("normal mode"));
  assert.ok(instructions.length < 400);
});