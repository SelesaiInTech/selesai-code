import assert from "node:assert/strict";
import test from "node:test";
import {
  clearWriteExecutionMeta,
  getWriteExecutionMeta,
  recordWriteExecutionMeta,
  WRITE_EXECUTION_META_LIMIT,
  type WriteExecutionMeta,
} from "../src/tool-overrides.ts";

test("write execution metadata moves pending entries into render state", () => {
  const pending = new Map<string, WriteExecutionMeta>();
  const meta: WriteExecutionMeta = {
    fileExistedBeforeWrite: true,
    previousContent: "before\n",
  };

  recordWriteExecutionMeta(pending, "write-1", meta);

  const state: Record<string, unknown> = {};
  const first = getWriteExecutionMeta(
    { toolCallId: "write-1", state },
    pending,
  );
  const second = getWriteExecutionMeta({ state }, pending);

  assert.deepEqual(first, meta);
  assert.equal(pending.size, 0);
  assert.deepEqual(second, meta);
});

test("write execution metadata keeps stale pending entries bounded", () => {
  const pending = new Map<string, WriteExecutionMeta>();
  const totalWrites = WRITE_EXECUTION_META_LIMIT + 7;

  for (let index = 0; index < totalWrites; index += 1) {
    recordWriteExecutionMeta(pending, `write-${index}`, {
      fileExistedBeforeWrite: true,
      previousContent: `before-${index}`,
    });
  }

  const evictedCount = totalWrites - WRITE_EXECUTION_META_LIMIT;

  assert.equal(pending.size, WRITE_EXECUTION_META_LIMIT);
  assert.equal(pending.has(`write-${evictedCount - 1}`), false);
  assert.equal(pending.has(`write-${evictedCount}`), true);
  assert.deepEqual(pending.get(`write-${totalWrites - 1}`), {
    fileExistedBeforeWrite: true,
    previousContent: `before-${totalWrites - 1}`,
  });
});

test("write execution metadata cleanup clears stale pending entries", () => {
  const pending = new Map<string, WriteExecutionMeta>();

  recordWriteExecutionMeta(pending, "write-1", {
    fileExistedBeforeWrite: false,
  });
  recordWriteExecutionMeta(pending, "write-2", {
    fileExistedBeforeWrite: true,
    previousContent: "before\n",
  });

  clearWriteExecutionMeta(pending);

  assert.equal(pending.size, 0);
});
