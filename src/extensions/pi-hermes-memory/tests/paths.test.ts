import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { resolveAgentRoot } from "../src/paths.js";

describe("agent root path resolution", () => {
  it("prefers PI_CODING_AGENT_DIR over the host default", () => {
    const root = resolveAgentRoot({ PI_CODING_AGENT_DIR: "/tmp/pi-agent-dir" });

    assert.strictEqual(root, path.resolve("/tmp/pi-agent-dir"));
  });

  it("falls back to the host agent-dir resolver when no override is set", () => {
    const expected = getAgentDir();

    assert.strictEqual(resolveAgentRoot({}), expected);
    assert.strictEqual(resolveAgentRoot({ PI_CODING_AGENT_DIR: "  " }), expected);
  });

  it("expands home-relative PI_CODING_AGENT_DIR values", () => {
    const root = resolveAgentRoot({ PI_CODING_AGENT_DIR: "~/custom-pi-agent" });

    assert.strictEqual(root, path.join(os.homedir(), "custom-pi-agent"));
  });
});
