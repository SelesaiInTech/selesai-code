import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAgentPath, getAgentSessionDirs, getLegacyPiPath } from "../paths.ts";

function withTemporaryPathEnv(run: (home: string, agentDir: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "powerline-paths-"));
  const home = join(root, "home");
  const agentDir = join(root, "custom-agent");
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalAgentDir = process.env.SELESAI_CODING_AGENT_DIR;

  try {
    mkdirSync(home, { recursive: true });
    process.env.HOME = home;
    delete process.env.USERPROFILE;
    run(home, agentDir);
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    if (originalAgentDir === undefined) delete process.env.SELESAI_CODING_AGENT_DIR;
    else process.env.SELESAI_CODING_AGENT_DIR = originalAgentDir;
    rmSync(root, { recursive: true, force: true });
  }
}

test("agent dir uses non-empty SELESAI_CODING_AGENT_DIR", () => {
  withTemporaryPathEnv((_home, agentDir) => {
    process.env.SELESAI_CODING_AGENT_DIR = agentDir;

    assert.equal(getAgentPath("settings.json"), join(agentDir, "settings.json"));
  });
});

test("agent dir falls back to HOME config dir agent for empty env values", () => {
  withTemporaryPathEnv((home) => {
    process.env.SELESAI_CODING_AGENT_DIR = "";

    assert.equal(getAgentPath("settings.json"), join(home, ".selesai", "agent", "settings.json"));
    assert.equal(getAgentPath("sessions"), join(home, ".selesai", "agent", "sessions"));
  });
});

test("agent sessions include legacy config-dir sessions only when it exists", () => {
  withTemporaryPathEnv((home, agentDir) => {
    process.env.SELESAI_CODING_AGENT_DIR = agentDir;
    assert.deepEqual(getAgentSessionDirs(), [join(agentDir, "sessions")]);

    mkdirSync(join(home, ".selesai", "sessions"), { recursive: true });
    assert.deepEqual(getAgentSessionDirs(), [join(agentDir, "sessions"), join(home, ".selesai", "sessions")]);
  });
});

test("legacy path resolves under the fork config dir name", () => {
  withTemporaryPathEnv((home) => {
    assert.equal(getLegacyPiPath("sessions"), join(home, ".selesai", "sessions"));
  });
});
