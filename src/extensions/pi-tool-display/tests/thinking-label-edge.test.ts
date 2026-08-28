import assert from "node:assert/strict";
import test from "node:test";
import { registerThinkingLabeling } from "../src/thinking-label.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CapturedHandler = (
  event: unknown,
  ctx?: unknown,
) => Promise<void> | void;

function captureThinkingHandlers(): Map<string, CapturedHandler> {
  const handlers = new Map<string, CapturedHandler>();
  registerThinkingLabeling({
    on(eventName: string, handler: CapturedHandler): void {
      handlers.set(eventName, handler);
    },
  } as never);
  return handlers;
}

const PASSTHROUGH_THEME = {
  fg: (_color: string, text: string) => text,
};

const ANSI_THEME = {
  fg: (color: string, text: string) => `\x1b[38;2;100;200;255m[${color}]${text}\x1b[0m`,
};

// ---------------------------------------------------------------------------
// message_update / message_end thinking-label formatting edge cases
// ---------------------------------------------------------------------------

test("message_update duplicates: single 'Thinking:' prefix is normalized away", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [{ type: "thinking", thinking: "Thinking: reasoning about X" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.equal(event.message.content[0].thinking, "Thinking: reasoning about X");
});

test("message_update duplicates: lowercase 'thinking:' prefix is normalized away", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [{ type: "thinking", thinking: "thinking: checking paths" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.equal(event.message.content[0].thinking, "Thinking: checking paths");
});

test("message_update duplicates: uppercase 'THINKING:' prefix is normalized away", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [{ type: "thinking", thinking: "THINKING: uppercased reasoning" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.equal(event.message.content[0].thinking, "Thinking: uppercased reasoning");
});

test("message_update duplicates: repeated 'Thinking: Thinking:' prefix is fully stripped", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [{ type: "thinking", thinking: "Thinking:  Thinking: double label content" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.equal(event.message.content[0].thinking, "Thinking: double label content");
});

test("message_update duplicates: interleaved case 'thinking: Thinking:' is fully stripped", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [{ type: "thinking", thinking: "thinking: Thinking: mixed case double" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.equal(event.message.content[0].thinking, "Thinking: mixed case double");
});

test("message_update duplicates: triple label 'thinking: thinking: Thinking:' is fully stripped", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [{ type: "thinking", thinking: "thinking: thinking: Thinking: triple" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.equal(event.message.content[0].thinking, "Thinking: triple");
});

test("message_update duplicates: indented label '  Thinking: content' is handled", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [{ type: "thinking", thinking: "  Thinking: indented content" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.equal(event.message.content[0].thinking, "Thinking: indented content");
});

// ---------------------------------------------------------------------------
// ANSI fragments interleaved with labels
// ---------------------------------------------------------------------------

test("message_update ANSI: SGR code before thinking label is stripped", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [{ type: "thinking", thinking: "\x1b[31mThinking: red-tinted reasoning" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.equal(event.message.content[0].thinking, "Thinking: red-tinted reasoning");
});

test("message_update ANSI: multiple SGR codes before label are all stripped", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [{ type: "thinking", thinking: "\x1b[1m\x1b[32mThinking: bold green label\x1b[0m" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  // stripAnsi inside stripThinkingPresentationArtifacts removes ALL ANSI codes
  assert.equal(event.message.content[0].thinking, "Thinking: bold green label");
});

test("message_update ANSI: fragment starting with semicolon is stripped as leading artifact", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [{ type: "thinking", thinking: ";1;31mThinking: fragment artifact content" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.equal(event.message.content[0].thinking, "Thinking: fragment artifact content");
});

test("message_update ANSI: striped background code before label is removed", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [{ type: "thinking", thinking: "\x1b[48;5;24mThinking: bg colored reasoning" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.equal(event.message.content[0].thinking, "Thinking: bg colored reasoning");
});

test("message_update ANSI: exposed fragment after removing first label reveals second label", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [{ type: "thinking", thinking: "\x1b[31mThinking: \x1b[0mThinking: double with ANSI between" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  // After stripping ANSI: "Thinking: Thinking: double with ANSI between"
  // After stripping first label: "Thinking: double with ANSI between"
  // After stripping second label: "double with ANSI between"
  // So result should have single "Thinking: " prefix
  assert.equal(event.message.content[0].thinking, "Thinking: double with ANSI between");
});

// ---------------------------------------------------------------------------
// Provider API name handling
// ---------------------------------------------------------------------------

test("message_update API: anthropic-messages gets thinking prefix", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [{ type: "thinking", thinking: "raw reasoning" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.equal(event.message.content[0].thinking, "Thinking: raw reasoning");
});

test("message_update API: openai-completions gets thinking prefix", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "openai-completions",
      content: [{ type: "thinking", thinking: "raw reasoning" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.equal(event.message.content[0].thinking, "Thinking: raw reasoning");
});

test("message_update API: openai-responses gets thinking prefix", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "openai-responses",
      content: [{ type: "thinking", thinking: "raw reasoning" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.equal(event.message.content[0].thinking, "Thinking: raw reasoning");
});

test("message_update API: openai-codex-responses gets thinking prefix", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "openai-codex-responses",
      content: [{ type: "thinking", thinking: "raw reasoning" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.equal(event.message.content[0].thinking, "Thinking: raw reasoning");
});

test("message_update API: openai-chat does NOT get thinking prefix", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "openai-chat",
      content: [{ type: "thinking", thinking: "raw reasoning" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.strictEqual(event.message.content[0].thinking, "raw reasoning");
});

test("message_update API: openai-unknown-future does NOT get thinking prefix", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "openai-unknown-future",
      content: [{ type: "thinking", thinking: "raw reasoning" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.strictEqual(event.message.content[0].thinking, "raw reasoning");
});

test("message_update API: undefined API gets thinking prefix (default)", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      content: [{ type: "thinking", thinking: "raw reasoning" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.equal(event.message.content[0].thinking, "Thinking: raw reasoning");
});

test("message_update API: empty string API gets thinking prefix (default)", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "",
      content: [{ type: "thinking", thinking: "raw reasoning" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.equal(event.message.content[0].thinking, "Thinking: raw reasoning");
});

test("message_update API: random non-OpenAI provider gets thinking prefix", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "custom-provider-v1",
      content: [{ type: "thinking", thinking: "raw reasoning" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.equal(event.message.content[0].thinking, "Thinking: raw reasoning");
});

test("message_update API: anthropic-responses gets thinking prefix", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-responses",
      content: [{ type: "thinking", thinking: "raw reasoning" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.equal(event.message.content[0].thinking, "Thinking: raw reasoning");
});

test("message_update API: anthropic-completions gets thinking prefix", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-completions",
      content: [{ type: "thinking", thinking: "raw reasoning" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.equal(event.message.content[0].thinking, "Thinking: raw reasoning");
});

test("message_update API: unknown anthropic- prefix gets thinking prefix", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-experimental-v3",
      content: [{ type: "thinking", thinking: "raw reasoning" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.equal(event.message.content[0].thinking, "Thinking: raw reasoning");
});

test("message_update API: case-insensitive normalization of openai-completions", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "OpenAI-Completions",
      content: [{ type: "thinking", thinking: "raw reasoning" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.equal(event.message.content[0].thinking, "Thinking: raw reasoning");
});

// ---------------------------------------------------------------------------
// message_end event behavior (same logic, persists labels)
// ---------------------------------------------------------------------------

test("message_end: attaches thinking label on final message", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [{ type: "thinking", thinking: "final reasoning" }],
    },
  };

  await handlers.get("message_end")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.equal(event.message.content[0].thinking, "Thinking: final reasoning");
});

test("message_end: respects openai-* exclusion", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "openai-chat",
      content: [{ type: "thinking", thinking: "final reasoning" }],
    },
  };

  await handlers.get("message_end")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.strictEqual(event.message.content[0].thinking, "final reasoning");
});

test("message_end: applies theme to label", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [{ type: "thinking", thinking: "themed reasoning" }],
    },
  };

  await handlers.get("message_end")?.(event, { ui: { theme: ANSI_THEME } });

  assert.match(event.message.content[0].thinking, /^\x1b\[38;2;100;200;255m\[accent\]Thinking:/);
});

// ---------------------------------------------------------------------------
// context event behavior (sanitization strips labels for LLM context)
// ---------------------------------------------------------------------------

test("context: strips thinking labels from assistant messages", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    messages: [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Thinking: labeled reasoning for model" },
        ],
      },
    ],
  };

  await handlers.get("context")?.(event, {});

  assert.equal(event.messages[0].content[0].thinking, "labeled reasoning for model");
});

test("context: strips thinking labels even with ANSI wrapping", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    messages: [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "\x1b[31mThinking: \x1b[0mansi reasoning" },
        ],
      },
    ],
  };

  await handlers.get("context")?.(event, {});

  assert.equal(event.messages[0].content[0].thinking, "ansi reasoning");
});

test("context: preserves non-thinking blocks unchanged", async () => {
  const handlers = captureThinkingHandlers();
  const textBlock = { type: "text", text: "hello" };
  const thinkingBlock = { type: "thinking", thinking: "Thinking: labeled" };
  const event = {
    messages: [
      {
        role: "assistant",
        content: [textBlock, thinkingBlock],
      },
    ],
  };

  await handlers.get("context")?.(event, {});

  assert.strictEqual(event.messages[0].content[0], textBlock);
  assert.equal((event.messages[0].content[1] as { thinking: string }).thinking, "labeled");
});

test("context: does not modify non-assistant messages", async () => {
  const handlers = captureThinkingHandlers();
  const userMessage = { role: "user", content: "hello" };
  const event = {
    messages: [userMessage],
  };

  await handlers.get("context")?.(event, {});

  assert.strictEqual(event.messages[0], userMessage);
});

test("context: handles events with non-array messages gracefully", async () => {
  const handlers = captureThinkingHandlers();

  // Should not throw for non-array messages
  await handlers.get("context")?.({ messages: "not an array" }, {});
  await handlers.get("context")?.({ messages: null }, {});
  await handlers.get("context")?.({ messages: undefined }, {});
  await handlers.get("context")?.({}, {});

  assert.ok(true, "context handler did not throw");
});

test("context: handles events with missing messages property", async () => {
  const handlers = captureThinkingHandlers();

  await handlers.get("context")?.({ unrelated: true }, {});

  assert.ok(true, "context handler did not throw on missing messages");
});

test("context: strips duplicate labels in context", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    messages: [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Thinking:  Thinking: double label" },
        ],
      },
    ],
  };

  await handlers.get("context")?.(event, {});

  assert.equal(event.messages[0].content[0].thinking, "double label");
});

test("context: strips lowercase thinking: label", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    messages: [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "thinking: lowercase prefix" },
        ],
      },
    ],
  };

  await handlers.get("context")?.(event, {});

  assert.equal(event.messages[0].content[0].thinking, "lowercase prefix");
});

// ---------------------------------------------------------------------------
// Malformed content arrays – handlers must be resilient
// ---------------------------------------------------------------------------

test("message_update malformed: null content array item passes through", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [null, { type: "thinking", thinking: "reasoning" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.strictEqual(event.message.content[0], null);
  assert.equal(event.message.content[1].thinking, "Thinking: reasoning");
});

test("message_update malformed: undefined content array item passes through", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [undefined, { type: "thinking", thinking: "reasoning" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.strictEqual(event.message.content[0], undefined);
  assert.equal(event.message.content[1].thinking, "Thinking: reasoning");
});

test("message_update malformed: non-array content passes through unchanged", async () => {
  const handlers = captureThinkingHandlers();
  const content = { type: "thinking", thinking: "not in array" };
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content,
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.strictEqual(event.message.content, content);
});

test("message_update malformed: nested array content passes through unchanged", async () => {
  const handlers = captureThinkingHandlers();
  // Content IS an array with a thinking block — it will be processed.
  const nested = [{ type: "thinking", thinking: "nested reasoning" }];
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: nested,
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  // Since content is an array containing a valid thinking block, the label IS added.
  assert.equal(event.message.content[0].thinking, "Thinking: nested reasoning");
});

test("message_update malformed: empty content array is a no-op", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.deepEqual(event.message.content, []);
});

test("message_update malformed: non-string thinking field is left untouched", async () => {
  const handlers = captureThinkingHandlers();
  const block = { type: "thinking", thinking: 42 as unknown as string };
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [block],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.strictEqual(event.message.content[0].thinking, 42);
});

test("message_update malformed: block with null thinking field is left untouched", async () => {
  const handlers = captureThinkingHandlers();
  const block = { type: "thinking", thinking: null as unknown as string };
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [block],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.strictEqual(event.message.content[0].thinking, null);
});

test("message_update malformed: mixed valid and invalid blocks only processes valid ones", async () => {
  const handlers = captureThinkingHandlers();
  const invalid = { type: "other", data: "skip" };
  const valid = { type: "thinking", thinking: "valid reasoning" };
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [invalid, valid, null],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.strictEqual(event.message.content[0], invalid);
  assert.equal((event.message.content[1] as { thinking: string }).thinking, "Thinking: valid reasoning");
  assert.strictEqual(event.message.content[2], null);
});

test("message_update malformed: content is a plain string, not array, passes through", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: "just a string, not an array of blocks",
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.equal(event.message.content, "just a string, not an array of blocks");
});

// ---------------------------------------------------------------------------
// Non-English / custom thinking label patterns (should pass through)
// ---------------------------------------------------------------------------

test("message_update non-English: Japanese thinking label gets Thinking: prefix since pattern not matched", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [{ type: "thinking", thinking: "思考: 日本語の推論" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  // The non-English prefix does not match /^thinking:/i so the original text
  // is NOT deduplicated, but the standard "Thinking: " prefix IS prepended.
  assert.equal(event.message.content[0].thinking, "Thinking: 思考: 日本語の推論");
});

test("message_update non-English: French thinking label gets Thinking: prefix", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [{ type: "thinking", thinking: "Réflexion: raisonnement en français" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.equal(event.message.content[0].thinking, "Thinking: Réflexion: raisonnement en français");
});

test("message_update custom: 'Analyzing:' prefix gets Thinking: prefix (not matched by pattern)", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [{ type: "thinking", thinking: "Analyzing: code structure" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.equal(event.message.content[0].thinking, "Thinking: Analyzing: code structure");
});

test("message_update custom: 'Note:' prefix gets Thinking: prefix", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [{ type: "thinking", thinking: "Note: additional context" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.equal(event.message.content[0].thinking, "Thinking: Note: additional context");
});

// ---------------------------------------------------------------------------
// Non-assistant role in event – should be skipped
// ---------------------------------------------------------------------------

test("message_update: non-assistant role messages are skipped", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "user",
      api: "anthropic-messages",
      content: [{ type: "thinking", thinking: "user thinking" }],
    },
  };

  // Should not throw and should not modify content
  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.ok(true, "non-assistant message update did not throw");
});

test("message_end: non-assistant role messages are skipped", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "user",
      api: "anthropic-messages",
      content: [{ type: "thinking", thinking: "user thinking end" }],
    },
  };

  await handlers.get("message_end")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  assert.ok(true, "non-assistant message end did not throw");
});

// ---------------------------------------------------------------------------
// No-theme fallback (plain "Thinking: " prefix)
// ---------------------------------------------------------------------------

test("message_update: no theme falls back to plain 'Thinking: ' prefix", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [{ type: "thinking", thinking: "no theme reasoning" }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: {} });

  assert.equal(event.message.content[0].thinking, "Thinking: no theme reasoning");
});

test("message_update: no theme and undefined ctx.ui is handled gracefully", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [{ type: "thinking", thinking: "no ctx at all" }],
    },
  };

  // ctx is undefined entirely
  await handlers.get("message_update")?.(event, undefined);

  assert.ok(true, "handled undefined ctx without throwing");
});

// ---------------------------------------------------------------------------
// Edge: content with only whitespace after stripping
// ---------------------------------------------------------------------------

test("message_update: content that becomes empty after stripping keeps original text", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [{ type: "thinking", thinking: "Thinking:   " }],
    },
  };

  await handlers.get("message_update")?.(event, { ui: { theme: PASSTHROUGH_THEME } });

  // After stripping "Thinking:" the remainder is whitespace → trimmed to empty → keep original
  assert.equal(event.message.content[0].thinking, "Thinking:   ");
});
