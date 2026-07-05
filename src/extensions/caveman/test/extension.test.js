import assert from "node:assert/strict";
import test from "node:test";

import cavemanExtension from "../index.js";

function createPiHarness() {
  const events = new Map();
  const commands = new Map();
  const appendedEntries = [];
  const sentUserMessages = [];

  const pi = {
    on(eventName, handler) { events.set(eventName, handler); },
    registerCommand(name, options) { commands.set(name, options); },
    appendEntry(customType, data) { appendedEntries.push({ customType, data }); },
    sendUserMessage(text, options) { sentUserMessages.push({ text, options }); },
  };

  cavemanExtension(pi);
  return { events, commands, appendedEntries, sentUserMessages };
}

function createCommandContext(overrides = {}) {
  return {
    isIdle: () => true,
    sessionManager: { getEntries: () => [] },
    ui: { notify() {} },
    ...overrides,
  };
}

test("extension registers the /caveman command", () => {
  const { commands } = createPiHarness();
  assert.deepEqual([...commands.keys()], ["caveman"]);
});

test("/caveman on/off appends a caveman-mode entry", async () => {
  const { commands, events, appendedEntries } = createPiHarness();
  const ctx = createCommandContext();

  await events.get("session_start")({ reason: "startup" }, ctx);
  await commands.get("caveman").handler("off", ctx);

  assert.deepEqual(appendedEntries.at(-1), { customType: "caveman-mode", data: { active: false } });

  await commands.get("caveman").handler("on", ctx);
  assert.deepEqual(appendedEntries.at(-1), { customType: "caveman-mode", data: { active: true } });
});

test("bare /caveman toggles off then back on", async () => {
  const { commands, events, appendedEntries } = createPiHarness();
  const ctx = createCommandContext();

  await events.get("session_start")({ reason: "startup" }, ctx); // starts on
  await commands.get("caveman").handler("", ctx);
  assert.equal(appendedEntries.at(-1).data.active, false);
  await commands.get("caveman").handler("", ctx);
  assert.equal(appendedEntries.at(-1).data.active, true);
});

test("before_agent_start injects instructions while active", async () => {
  const { events } = createPiHarness();
  const ctx = createCommandContext();

  await events.get("session_start")({ reason: "startup" }, ctx);
  const result = await events.get("before_agent_start")({ systemPrompt: "BASE" }, ctx);

  assert.ok(result.systemPrompt.startsWith("BASE"));
  assert.ok(result.systemPrompt.includes("CAVEMAN MODE ACTIVE"));
});

test("disabled caveman skips instruction injection", async () => {
  const { commands, events } = createPiHarness();
  const ctx = createCommandContext();

  await events.get("session_start")({ reason: "startup" }, ctx);
  await commands.get("caveman").handler("off", ctx);
  const result = await events.get("before_agent_start")({ systemPrompt: "BASE" }, ctx);

  assert.equal(result, undefined);
});

test("session_start restores latest persisted active flag", async () => {
  const { events } = createPiHarness();
  const ctx = createCommandContext({
    sessionManager: {
      getEntries: () => [
        { type: "custom", customType: "caveman-mode", data: { active: false } },
      ],
    },
  });

  await events.get("session_start")({ reason: "resume" }, ctx);
  const result = await events.get("before_agent_start")({ systemPrompt: "BASE" }, ctx);

  assert.equal(result, undefined); // persisted false -> no injection
});

test("'stop caveman' as a whole message deactivates mid-session", async () => {
  const { events } = createPiHarness();
  const ctx = createCommandContext();

  await events.get("session_start")({ reason: "startup" }, ctx);
  await events.get("input")({ text: "stop caveman", source: "interactive" }, ctx);

  const result = await events.get("before_agent_start")({ systemPrompt: "BASE" }, ctx);
  assert.equal(result, undefined);
});

test("a request merely mentioning 'stop caveman' stays active", async () => {
  const { events } = createPiHarness();
  const ctx = createCommandContext();

  await events.get("session_start")({ reason: "startup" }, ctx);
  await events.get("input")({ text: "how do I stop caveman re-rendering?", source: "interactive" }, ctx);

  const result = await events.get("before_agent_start")({ systemPrompt: "BASE" }, ctx);
  assert.ok(result.systemPrompt.includes("CAVEMAN MODE ACTIVE"));
});

test("status bar renders ON and flips active on agent_start", async () => {
  const { events } = createPiHarness();
  const statusWrites = [];
  const ctx = createCommandContext({
    sessionManager: { getEntries: () => [] },
    ui: { notify() {}, setStatus: (key, text) => statusWrites.push({ key, text }), theme: { fg: (_c, t) => t } },
  });

  await events.get("session_start")({ reason: "startup" }, ctx);
  await events.get("agent_start")({}, ctx);

  assert.equal(statusWrites.at(-2).key, "caveman");
  assert.match(statusWrites.at(-2).text, /○.*ON/);
  assert.match(statusWrites.at(-1).text, /●.*ON/);
});

test("status bar clears when disabled", async () => {
  const { events, commands } = createPiHarness();
  const statusWrites = [];
  const ctx = createCommandContext({
    ui: { notify() {}, setStatus: (key, text) => statusWrites.push({ key, text }), theme: { fg: (_c, t) => t } },
  });

  await events.get("session_start")({ reason: "startup" }, ctx);
  await commands.get("caveman").handler("off", ctx);

  assert.deepEqual(statusWrites.at(-1), { key: "caveman", text: "" });
});

test("status bar stays silent when ui lacks a theme", async () => {
  const { events } = createPiHarness();
  const calls = [];
  const ctx = createCommandContext({
    sessionManager: { getEntries: () => [] },
    ui: { notify() {}, setStatus: (_key, text) => calls.push(text) }, // no theme
  });

  await events.get("session_start")({ reason: "startup" }, ctx);
  await events.get("agent_start")({}, ctx);

  assert.deepEqual(calls, []);
});

test("invalid subcommand notifies warning and does not append", async () => {
  const { commands, appendedEntries } = createPiHarness();
  let notified = null;
  const ctx = createCommandContext({ ui: { notify: (_m, kind) => { notified = kind; } } });

  await commands.get("caveman").handler("banana", ctx);

  assert.equal(notified, "warning");
  assert.equal(appendedEntries.length, 0);
});

test("status subcommand reports without changing state", async () => {
  const { commands, events, appendedEntries } = createPiHarness();
  let reported = null;
  const ctx = createCommandContext({ ui: { notify: (m) => { reported = m; } } });

  await events.get("session_start")({ reason: "startup" }, ctx); // starts on
  await commands.get("caveman").handler("status", ctx);

  assert.match(reported, /ON/);
  assert.equal(appendedEntries.length, 0);
});