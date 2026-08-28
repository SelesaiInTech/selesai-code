import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createToolDisplayDebugLogger } from "../src/debug-logger.ts";

async function withTempRoot(run: (root: string) => Promise<void> | void): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "pi-tool-display-debug-"));
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function createLogger(root: string) {
  return createToolDisplayDebugLogger({
    configFile: join(root, "config.json"),
    debugDir: join(root, "debug"),
    debugLogFile: join(root, "debug", "debug.log"),
    createDate: () => new Date("2026-01-01T00:00:00.000Z"),
  });
}

test("disabled debug logger is a no-op and does not create debug artifacts", async () => {
  await withTempRoot(async (root) => {
    writeFileSync(join(root, "config.json"), JSON.stringify({ debug: false }), "utf-8");
    const logger = createLogger(root);

    assert.equal(logger.log("disabled sk-abcdefghijkl", new Error("hidden sk-bcdefghijklm")), undefined);
    await logger.flush();

    assert.equal(existsSync(join(root, "debug")), false);
  });
});

test("enabled debug logger writes on flush and redacts secret values", async () => {
  await withTempRoot(async (root) => {
    writeFileSync(join(root, "config.json"), JSON.stringify({ debug: true }), "utf-8");
    const logger = createLogger(root);

    assert.equal(logger.log("request sk-abcdefghijkl", new Error("failed sk-bcdefghijklm")), undefined);
    await logger.flush();

    const logContent = readFileSync(join(root, "debug", "debug.log"), "utf-8");
    assert.match(logContent, /^2026-01-01T00:00:00\.000Z request \[REDACTED\] Error: failed \[REDACTED\]/);
    assert.doesNotMatch(logContent, /sk-abcdefghijkl|sk-bcdefghijklm/);
  });
});

test("debug logger swallows append failures", async () => {
  await withTempRoot(async (root) => {
    writeFileSync(join(root, "config.json"), JSON.stringify({ debug: true }), "utf-8");
    mkdirSync(join(root, "debug"), { recursive: true });
    mkdirSync(join(root, "debug", "debug.log"));
    const logger = createLogger(root);

    assert.doesNotThrow(() => logger.log("write-fails"));
    await assert.doesNotReject(() => logger.flush());
  });
});
