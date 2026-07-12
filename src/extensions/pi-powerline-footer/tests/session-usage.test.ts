import test from "node:test";
import assert from "node:assert/strict";
import { readAsyncSubagentUsage, readSubagentToolResultUsage } from "../session-usage.ts";

test("reads all completed subagent usage from a parent tool result", () => {
  assert.deepEqual(
    readSubagentToolResultUsage({
      role: "toolResult",
      toolName: "subagent",
      details: {
        totalChildUsage: {
          input: 120,
          output: 34,
          cacheRead: 56,
          cacheWrite: 7,
          cost: 0.123,
          turns: 2,
        },
      },
    }),
    { input: 120, output: 34, cacheRead: 56, cacheWrite: 7, cost: 0.123 },
  );
});

test("reads asynchronous completion usage", () => {
  assert.deepEqual(
    readAsyncSubagentUsage({
      id: "async-123",
      sessionId: "parent-session",
      totalChildUsage: { input: 20, output: 8, cacheRead: 13, cacheWrite: 0, cost: 0.02 },
    }),
    {
      runId: "async-123",
      sessionId: "parent-session",
      usage: { input: 20, output: 8, cacheRead: 13, cacheWrite: 0, cost: 0.02 },
    },
  );
});

test("does not treat other tool results or malformed usage as child usage", () => {
  assert.equal(readSubagentToolResultUsage({ role: "toolResult", toolName: "bash", details: {} }), null);
  assert.equal(readSubagentToolResultUsage({
    role: "toolResult",
    toolName: "subagent",
    details: { totalChildUsage: { input: 1, output: 2 } },
  }), null);
});
