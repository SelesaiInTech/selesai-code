import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { AGENT_ROOT, normalizeConfiguredMemoryDir, normalizeProjectsMemoryDir } from "../src/paths.js";

describe("agent root path resolution", () => {
  it("uses the host agent-dir resolver (SELESAI_CODING_AGENT_DIR honored by host)", () => {
    assert.strictEqual(AGENT_ROOT, getAgentDir());
  });

  it("expands home-relative memoryDir values", () => {
    assert.strictEqual(
      normalizeConfiguredMemoryDir("~/custom-memory"),
      path.join(os.homedir(), "custom-memory"),
    );
  });

  it("rejects unsafe projectsMemoryDir values", () => {
    assert.strictEqual(normalizeProjectsMemoryDir("../escape"), undefined);
  });
});
