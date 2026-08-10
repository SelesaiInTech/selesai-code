import test from "node:test";
import assert from "node:assert/strict";
import { shouldShowStartupWelcome, isStaleExtensionContextError } from "../lifecycle.ts";

test("startup welcome only shows on startup when enabled", () => {
  assert.equal(shouldShowStartupWelcome("startup", true), true);
  assert.equal(shouldShowStartupWelcome("reload", true), false);
  assert.equal(shouldShowStartupWelcome("startup", false), false);
});

test("stale extension context errors are recognized", () => {
  assert.equal(isStaleExtensionContextError(new Error("This extension instance is stale")), true);
  assert.equal(isStaleExtensionContextError(new Error("other")), false);
});
