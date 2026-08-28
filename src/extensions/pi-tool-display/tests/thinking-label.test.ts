import assert from "node:assert/strict";
import test from "node:test";
import { registerThinkingLabeling } from "../src/thinking-label.ts";

type CapturedHandler = (event: unknown, ctx?: unknown) => Promise<void> | void;

function captureThinkingHandlers(): Map<string, CapturedHandler> {
  const handlers = new Map<string, CapturedHandler>();
  registerThinkingLabeling({
    on(eventName: string, handler: CapturedHandler): void {
      handlers.set(eventName, handler);
    },
  } as never);
  return handlers;
}

test("thinking label formatting prefixes supported provider thinking blocks for display", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    message: {
      role: "assistant",
      api: "anthropic-messages",
      content: [{ type: "thinking", thinking: "checking options" }],
    },
  };

  await handlers.get("message_update")?.(event, {
    ui: { theme: { fg: (color: string, text: string) => `[${color}]${text}` } },
  });

  assert.deepEqual(event.message.content, [
    { type: "thinking", thinking: "[accent]Thinking: [thinkingText]checking options" },
  ]);
});

test("thinking label formatting leaves unsupported explicit OpenAI APIs unchanged", async () => {
  const handlers = captureThinkingHandlers();
  const thinkingBlock = { type: "thinking", thinking: "raw reasoning" };
  const event = {
    message: {
      role: "assistant",
      api: "openai-chat",
      content: [thinkingBlock],
    },
  };

  await handlers.get("message_end")?.(event, {});

  assert.equal(event.message.content[0], thinkingBlock);
});

test("thinking context sanitization removes presentation labels before model context", async () => {
  const handlers = captureThinkingHandlers();
  const event = {
    messages: [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "\u001b[31mThinking: \u001b[0mThinking: final answer path" },
        ],
      },
      { role: "user", content: "keep me" },
    ],
  };

  await handlers.get("context")?.(event, {});

  assert.deepEqual(event.messages[0]?.content, [
    { type: "thinking", thinking: "final answer path" },
  ]);
  assert.deepEqual(event.messages[1], { role: "user", content: "keep me" });
});
