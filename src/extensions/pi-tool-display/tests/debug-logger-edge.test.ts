import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  createToolDisplayDebugLogger,
  type ToolDisplayDebugLoggerOptions,
} from "../src/debug-logger.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function withTempRoot(
  run: (root: string) => Promise<void> | void,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "pi-tool-display-debug-edge-"));
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function loggerOpts(
  root: string,
  overrides: Partial<ToolDisplayDebugLoggerOptions> = {},
): ToolDisplayDebugLoggerOptions {
  return {
    configFile: join(root, "config.json"),
    debugDir: join(root, "debug"),
    debugLogFile: join(root, "debug", "debug.log"),
    createDate: () => new Date("2026-01-01T00:00:00.000Z"),
    now: () => 1000000,
    ...overrides,
  };
}

function writeConfig(root: string, debug: boolean): void {
  writeFileSync(join(root, "config.json"), JSON.stringify({ debug }), "utf-8");
}

function readLog(root: string): string {
  const logFile = join(root, "debug", "debug.log");
  assert.ok(existsSync(logFile), "debug.log should exist");
  return readFileSync(logFile, "utf-8");
}

// ---------------------------------------------------------------------------
// Concurrent Write Queue Behavior
// ---------------------------------------------------------------------------

test("concurrent writes are queued and flushed in order", async () => {
  await withTempRoot(async (root) => {
    writeConfig(root, true);
    const logger = createToolDisplayDebugLogger(loggerOpts(root));

    logger.log("first");
    logger.log("second");
    logger.log("third");

    await logger.flush();

    const content = readLog(root);
    const lines = content.trim().split("\n");
    assert.equal(lines.length, 3, "all three lines written");
    assert.match(lines[0]!, /first/);
    assert.match(lines[1]!, /second/);
    assert.match(lines[2]!, /third/);
  });
});

test("concurrent writes with simulated failures still complete", async () => {
  await withTempRoot(async (root) => {
    writeConfig(root, true);
    let appendCallCount = 0;
    const failingAppend = async (
      _path: string,
      _content: string,
      _enc: string,
    ): Promise<void> => {
      appendCallCount++;
      if (appendCallCount === 2) {
        throw new Error("simulated append failure");
      }
    };

    const logger = createToolDisplayDebugLogger(
      loggerOpts(root, {
        fileSystem: {
          existsSync,
          mkdirSync,
          readFileSync,
          statSync: ((p: string) => {
            try {
              return statSync(p);
            } catch {
              throw new Error("ENOENT");
            }
          }) as unknown as typeof statSync,
          appendFile: failingAppend as unknown as typeof appendFile,
        },
      }),
    );

    logger.log("first ok");
    logger.log("second fails");
    logger.log("third ok");

    await logger.flush();
    assert.ok(true, "flush completed despite append failures");
  });
});

test("flush waits for all queued writes", async () => {
  await withTempRoot(async (root) => {
    writeConfig(root, true);

    const order: string[] = [];
    const trackingAppend = async (
      _path: string,
      content: string,
      _enc: string,
    ): Promise<void> => {
      if (content.includes("slow")) {
        await new Promise((r) => setTimeout(r, 20));
      }
      order.push(content.trim());
    };

    const logger = createToolDisplayDebugLogger(
      loggerOpts(root, {
        fileSystem: {
          existsSync,
          mkdirSync,
          readFileSync,
          statSync: ((p: string) => {
            try {
              return statSync(p);
            } catch {
              throw new Error("ENOENT");
            }
          }) as unknown as typeof statSync,
          appendFile: trackingAppend as unknown as typeof appendFile,
        },
      }),
    );

    logger.log("fast");
    logger.log("slow");
    logger.log("fast2");

    await logger.flush();

    assert.ok(order.some((l) => l.includes("fast")), "fast logged");
    assert.ok(order.some((l) => l.includes("slow")), "slow logged");
    assert.ok(order.some((l) => l.includes("fast2")), "fast2 logged");
  });
});

// ---------------------------------------------------------------------------
// Redaction Patterns
// ---------------------------------------------------------------------------

test("redaction masks API-key-style tokens in messages", async () => {
  await withTempRoot(async (root) => {
    writeConfig(root, true);
    const logger = createToolDisplayDebugLogger(loggerOpts(root));

    // The SECRET_VALUE_PATTERN matches sk-[A-Za-z0-9_-]{12,}
    // We need exactly the pattern threshold to trigger redaction.
    logger.log("key sk-abcdefghijklmnop");
    await logger.flush();

    const content = readLog(root);
    assert.doesNotMatch(content, /sk-abcdefghijklmnop/);
    assert.match(content, /\[REDACTED\]/);
  });
});

test("redaction masks JWT-style token patterns in messages", async () => {
  await withTempRoot(async (root) => {
    writeConfig(root, true);
    const logger = createToolDisplayDebugLogger(loggerOpts(root));

    // Pattern matches groups of 24+ . 6+ . 12+ alphanum chars
    logger.log("jwt TOKEN_STR=aabbccddeeffgghhiijjkkll.aabbcc.1234567890ab");
    await logger.flush();

    const content = readLog(root);
    assert.doesNotMatch(
      content,
      /aabbccddeeffgghhiijjkkll\.aabbcc\.1234567890ab/,
    );
    assert.match(content, /\[REDACTED\]/);
  });
});

test("redaction does not match non-secret IDs that lack secret patterns", async () => {
  await withTempRoot(async (root) => {
    writeConfig(root, true);
    const logger = createToolDisplayDebugLogger(loggerOpts(root));

    // Short sk- pattern (< 12 chars after prefix) should NOT be redacted
    // Hex commit hashes without sk- prefix should NOT be redacted
    // Session IDs should NOT be redacted
    logger.log("session: abc-123 def-456");
    logger.log("hash: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0");
    logger.log("short-key: sk-short");
    await logger.flush();

    const content = readLog(root);
    assert.match(content, /abc-123 def-456/);
    assert.match(content, /a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0/);
    assert.match(content, /short-key: sk-short/);
  });
});

test("redaction handles tokens with hyphens and underscores in body", async () => {
  await withTempRoot(async (root) => {
    writeConfig(root, true);
    const logger = createToolDisplayDebugLogger(loggerOpts(root));

    // JWT body with hyphen/underscore should still match [A-Za-z0-9_-]
    logger.log("token: aabbccddeeffgghhiijjkkll.abc-def_ghi.1234567890ab");
    await logger.flush();

    const content = readLog(root);
    assert.doesNotMatch(content, /abc-def_ghi\.1234567890ab/);
    assert.match(content, /\[REDACTED\]/);
  });
});

// ---------------------------------------------------------------------------
// Config File Fingerprint Caching
// ---------------------------------------------------------------------------

test("fingerprint cache avoids re-reading config within TTL", async () => {
  await withTempRoot(async (root) => {
    let readCount = 0;
    const trackingReadFileSync = (path: string, enc: string): string => {
      readCount++;
      return readFileSync(path, enc as BufferEncoding);
    };

    writeConfig(root, true);

    const logger = createToolDisplayDebugLogger(
      loggerOpts(root, {
        now: () => 1000000,
        fileSystem: {
          existsSync,
          mkdirSync,
          readFileSync: trackingReadFileSync as unknown as typeof readFileSync,
          statSync: ((p: string) => {
            try {
              return statSync(p);
            } catch {
              throw new Error("ENOENT");
            }
          }) as unknown as typeof statSync,
          appendFile: async () => {},
        },
      }),
    );

    logger.log("first");
    const readsAfterFirst = readCount;
    assert.equal(readsAfterFirst >= 1, true, "config read at least once on first log");

    logger.log("second");
    assert.equal(readCount, readsAfterFirst, "no additional read within TTL");
  });
});

test("fingerprint cache re-reads config for a newly created logger after file change", async () => {
  await withTempRoot(async (root) => {
    // Use a real-time logger to verify config change detection
    writeConfig(root, false);

    const logger = createToolDisplayDebugLogger(
      loggerOpts(root, { cacheTtlMs: 30, now: () => Date.now() }),
    );

    logger.log("first-msg");
    await logger.flush();

    // No log file should exist while debug is disabled
    assert.equal(
      existsSync(join(root, "debug", "debug.log")),
      false,
      "no log while disabled",
    );

    // Enable debug and wait for TTL to pass
    writeFileSync(
      join(root, "config.json"),
      JSON.stringify({ debug: true }),
      "utf-8",
    );
    await new Promise((r) => setTimeout(r, 100));

    logger.log("after-enable");
    await logger.flush();

    assert.ok(
      existsSync(join(root, "debug", "debug.log")),
      "log created after enabling",
    );
    const content = readLog(root);
    assert.match(content, /after-enable/, "after-enable message appears");
    assert.doesNotMatch(content, /first-msg/, "first message not logged when disabled");
  });
});

// ---------------------------------------------------------------------------
// Debug Directory Creation Timing
// ---------------------------------------------------------------------------

test("debug directory is created only on first enabled write", async () => {
  await withTempRoot(async (root) => {
    writeConfig(root, true);

    const logger = createToolDisplayDebugLogger(
      loggerOpts(root, { now: () => 1000000 }),
    );

    assert.equal(
      existsSync(join(root, "debug")),
      false,
      "dir not yet created before first write",
    );
    logger.log("first enabled write");
    await logger.flush();

    assert.ok(existsSync(join(root, "debug")), "debug dir created on write");
    assert.ok(existsSync(join(root, "debug", "debug.log")), "debug.log created");
  });
});

test("disabled logger does not create debug directory", async () => {
  await withTempRoot(async (root) => {
    writeConfig(root, false);

    const logger = createToolDisplayDebugLogger(
      loggerOpts(root, { now: () => 1000000 }),
    );

    logger.log("disabled message");
    await logger.flush();

    assert.equal(
      existsSync(join(root, "debug")),
      false,
      "no debug dir when disabled",
    );
  });
});

// ---------------------------------------------------------------------------
// Swallowed Logging Errors
// ---------------------------------------------------------------------------

test("logger swallows errors when config file is unreadable", async () => {
  await withTempRoot(async (root) => {
    writeFileSync(join(root, "config.json"), "not-valid-json", "utf-8");

    const logger = createToolDisplayDebugLogger(
      loggerOpts(root, { now: () => 1000000 }),
    );

    assert.doesNotThrow(() => logger.log("after bad config"));
    await assert.doesNotReject(() => logger.flush());
  });
});

test("logger swallows errors when config file is missing", async () => {
  await withTempRoot(async (root) => {
    const logger = createToolDisplayDebugLogger(
      loggerOpts(root, { now: () => 1000000 }),
    );

    assert.doesNotThrow(() => logger.log("no config file"));
    await assert.doesNotReject(() => logger.flush());
  });
});

test("logger swallows directory creation errors", async () => {
  await withTempRoot(async (root) => {
    writeConfig(root, true);

    // Block the debug directory with a regular file
    writeFileSync(join(root, "debug"), "blocking file", "utf-8");

    const logger = createToolDisplayDebugLogger(
      loggerOpts(root, { now: () => 1000000 }),
    );

    assert.doesNotThrow(() => logger.log("after blocked mkdir"));
    await assert.doesNotReject(() => logger.flush());
  });
});

test("logger swallows individual append failures without crashing", async () => {
  await withTempRoot(async (root) => {
    writeConfig(root, true);

    let failNext = false;
    const flakyAppend = async (
      _path: string,
      _content: string,
      _enc: string,
    ): Promise<void> => {
      if (failNext) {
        failNext = false;
        throw new Error("flaky error");
      }
    };

    const logger = createToolDisplayDebugLogger(
      loggerOpts(root, {
        now: () => 1000000,
        fileSystem: {
          existsSync,
          mkdirSync,
          readFileSync,
          statSync: ((p: string) => {
            try {
              return statSync(p);
            } catch {
              throw new Error("ENOENT");
            }
          }) as unknown as typeof statSync,
          appendFile: flakyAppend as unknown as typeof appendFile,
        },
      }),
    );

    failNext = true;
    logger.log("this will fail");
    await logger.flush();

    logger.log("this should succeed");
    await logger.flush();

    assert.ok(true, "logging errors swallowed without crashing logger");
  });
});

// ---------------------------------------------------------------------------
// Log File Append Behavior
// ---------------------------------------------------------------------------

test("multiple writes append to the same log file", async () => {
  await withTempRoot(async (root) => {
    writeConfig(root, true);
    const logger = createToolDisplayDebugLogger(
      loggerOpts(root, { now: () => 1000000 }),
    );

    logger.log("entry-a");
    logger.log("entry-b");
    logger.log("entry-c");
    await logger.flush();

    const content = readLog(root);
    const lines = content.trim().split("\n");
    assert.equal(lines.length, 3, "three entries appended");
    assert.match(lines[0]!, /entry-a/);
    assert.match(lines[1]!, /entry-b/);
    assert.match(lines[2]!, /entry-c/);
  });
});

test("log lines include ISO timestamp prefix", async () => {
  await withTempRoot(async (root) => {
    writeConfig(root, true);
    const logger = createToolDisplayDebugLogger(loggerOpts(root));

    logger.log("timed entry");
    await logger.flush();

    const content = readLog(root);
    assert.match(
      content,
      /^2026-01-01T00:00:00\.000Z /,
      "line starts with ISO timestamp",
    );
  });
});

test("log lines include error details after the message", async () => {
  await withTempRoot(async (root) => {
    writeConfig(root, true);
    const logger = createToolDisplayDebugLogger(loggerOpts(root));

    logger.log("operation", new Error("something broke"));
    await logger.flush();

    const content = readLog(root);
    assert.match(content, /operation/);
    assert.match(content, /Error: something broke/);
  });
});

// ---------------------------------------------------------------------------
// Config Change After Logger Creation
// ---------------------------------------------------------------------------

test("logger picks up config from disabled to enabled after cache expiry", async () => {
  await withTempRoot(async (root) => {
    writeConfig(root, false);

    const ttlMs = 40;
    const logger = createToolDisplayDebugLogger(
      loggerOpts(root, {
        cacheTtlMs: ttlMs,
        now: () => Date.now(),
      }),
    );

    logger.log("disabled-message");
    await logger.flush();
    assert.equal(
      existsSync(join(root, "debug")),
      false,
      "no debug dir while disabled",
    );

    // Switch to enabled
    writeFileSync(join(root, "config.json"), JSON.stringify({ debug: true }), "utf-8");

    // Wait for cache TTL and file system settle
    await new Promise((r) => setTimeout(r, ttlMs * 2 + 50));

    logger.log("enabled-message");
    await logger.flush();

    assert.ok(
      existsSync(join(root, "debug", "debug.log")),
      "log file created after enabling",
    );
    const content = readLog(root);
    assert.match(content, /enabled-message/, "enabled message appears");
    assert.doesNotMatch(content, /disabled-message/, "disabled message not in log");
  });
});

test("logger picks up config from enabled to disabled", async () => {
  await withTempRoot(async (root) => {
    writeConfig(root, true);

    const ttlMs = 40;
    const logger = createToolDisplayDebugLogger(
      loggerOpts(root, {
        cacheTtlMs: ttlMs,
        now: () => Date.now(),
      }),
    );

    logger.log("before-disable");
    await logger.flush();
    assert.ok(
      existsSync(join(root, "debug", "debug.log")),
      "log exists while enabled",
    );

    writeFileSync(join(root, "config.json"), JSON.stringify({ debug: false }), "utf-8");

    await new Promise((r) => setTimeout(r, ttlMs * 2 + 50));

    logger.log("after-disable");
    await logger.flush();

    const content = readLog(root);
    assert.match(content, /before-disable/, "before-disable message present");
    assert.doesNotMatch(
      content,
      /after-disable/,
      "after-disable message not logged",
    );
  });
});

// ---------------------------------------------------------------------------
// Error Redaction in Error Objects
// ---------------------------------------------------------------------------

test("error messages containing secrets are redacted", async () => {
  await withTempRoot(async (root) => {
    writeConfig(root, true);
    const logger = createToolDisplayDebugLogger(loggerOpts(root));

    // The secret value pattern matches sk-[A-Za-z0-9_-]{12,}
    const secretKey = "sk-" + "a".repeat(14) + "b".repeat(8);
    logger.log("auth failed", new Error("invalid key " + secretKey));
    await logger.flush();

    const content = readLog(root);
    assert.doesNotMatch(content, new RegExp(secretKey.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")));
    assert.match(content, /\[REDACTED\]/);
  });
});

test("non-Error error arguments are converted to string", async () => {
  await withTempRoot(async (root) => {
    writeConfig(root, true);
    const logger = createToolDisplayDebugLogger(loggerOpts(root));

    logger.log("string error", "just a string");
    logger.log("number error", 42);
    logger.log("object error", { code: 500 });
    await logger.flush();

    const content = readLog(root);
    assert.match(content, /just a string/);
    assert.match(content, /42/);
    assert.match(content, /\[object Object\]/);
  });
});
