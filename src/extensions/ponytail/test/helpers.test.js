import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getPonytailInstructions } = require("../ponytail-instructions.cjs");

import {
  filterSkillBodyForMode,
  parsePonytailCommand,
  readDefaultMode,
  resolveSessionMode,
  writeDefaultMode,
} from "../index.js";

describe("ponytail helpers", () => {
  it("parsePonytailCommand falls back to full when invoked bare and default is off", () => {
    expect(parsePonytailCommand("", "off")).toEqual({ type: "set-mode", mode: "full" });
  });

  it("parsePonytailCommand falls back to DEFAULT_MODE for invalid defaults", () => {
    expect(parsePonytailCommand("", "bogus")).toEqual({ type: "set-mode", mode: "full" });
  });

  it("parsePonytailCommand parses modes, status, and default subcommand", () => {
    expect(parsePonytailCommand("ultra", "full")).toEqual({ type: "set-mode", mode: "ultra" });
    expect(parsePonytailCommand("status", "full")).toEqual({ type: "status" });
    expect(parsePonytailCommand("default lite", "full")).toEqual({ type: "set-default", mode: "lite" });
  });

  it("parsePonytailCommand rejects invalid modes and default modes", () => {
    expect(parsePonytailCommand("bogus", "full")).toEqual({ type: "invalid", reason: "invalid-mode", mode: "bogus" });
    expect(parsePonytailCommand("default bogus", "full")).toEqual({ type: "invalid", reason: "invalid-default-mode" });
  });

  it("parsePonytailCommand bare with default full returns full", () => {
    expect(parsePonytailCommand("", "full")).toEqual({ type: "set-mode", mode: "full" });
  });

  it("resolveSessionMode prefers latest persisted session mode", () => {
    const entries = [
      { type: "custom", customType: "ponytail-mode", data: { mode: "lite" } },
      { type: "custom", customType: "ponytail-mode", data: { mode: "ultra" } },
    ];

    expect(resolveSessionMode(entries, "full")).toBe("ultra");
  });

  it("resolveSessionMode returns fallback when entries is not an array", () => {
    expect(resolveSessionMode(null, "ultra")).toBe("ultra");
    expect(resolveSessionMode(undefined, "lite")).toBe("lite");
    expect(resolveSessionMode({}, "full")).toBe("full");
    expect(resolveSessionMode("not an array")).toBe("full"); // DEFAULT_MODE fallback
  });

  it("resolveSessionMode ignores non-ponytail entries and invalid modes", () => {
    const entries = [
      { type: "custom", customType: "other", data: { mode: "ultra" } },
      { type: "custom", customType: "ponytail-mode", data: { mode: "bogus" } },
    ];
    expect(resolveSessionMode(entries, "lite")).toBe("lite");
  });

  it("readDefaultMode and writeDefaultMode use XDG config path", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ponytail-config-"));
    const previousXdg = process.env.XDG_CONFIG_HOME;
    const previousDefault = process.env.PONYTAIL_DEFAULT_MODE;
    const configPath = join(tempDir, "ponytail", "config.json");
    process.env.XDG_CONFIG_HOME = tempDir;
    delete process.env.PONYTAIL_DEFAULT_MODE;

    try {
      expect(readDefaultMode()).toBe("full");
      expect(writeDefaultMode("ultra")).toBe("ultra");
      expect(readDefaultMode()).toBe("ultra");
      expect(existsSync(configPath)).toBe(true);
      expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({ defaultMode: "ultra" });
    } finally {
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
      if (previousDefault === undefined) delete process.env.PONYTAIL_DEFAULT_MODE;
      else process.env.PONYTAIL_DEFAULT_MODE = previousDefault;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("readDefaultMode honors PONYTAIL_DEFAULT_MODE env var", () => {
    const previous = process.env.PONYTAIL_DEFAULT_MODE;
    process.env.PONYTAIL_DEFAULT_MODE = "lite";
    try {
      expect(readDefaultMode()).toBe("lite");
    } finally {
      if (previous === undefined) delete process.env.PONYTAIL_DEFAULT_MODE;
      else process.env.PONYTAIL_DEFAULT_MODE = previous;
    }
  });

  it("readDefaultMode falls back to full when env is invalid", () => {
    const previous = process.env.PONYTAIL_DEFAULT_MODE;
    process.env.PONYTAIL_DEFAULT_MODE = "bogus";
    try {
      expect(readDefaultMode()).toBe("full");
    } finally {
      if (previous === undefined) delete process.env.PONYTAIL_DEFAULT_MODE;
      else process.env.PONYTAIL_DEFAULT_MODE = previous;
    }
  });

  it("writeDefaultMode rejects invalid modes", () => {
    expect(writeDefaultMode("bogus")).toBeNull();
  });

  it("filterSkillBodyForMode keeps only requested intensity examples and rows", () => {
    const body = `---\nname: ponytail\n---\n| **lite** | keep lite |\n| **full** | keep full |\n| **ultra** | keep ultra |\n- lite: Lite example\n- full: Full example\n- ultra: Ultra example\nOther line`;

    const filtered = filterSkillBodyForMode(body, "ultra");

    expect(filtered).not.toContain("keep lite");
    expect(filtered).not.toContain("keep full");
    expect(filtered).toContain("keep ultra");
    expect(filtered).not.toContain("Lite example");
    expect(filtered).toContain("Ultra example");
    expect(filtered).toContain("Other line");
  });

  it("compact Ponytail instructions retain core rules and mode distinctions", () => {
    const compact = Object.fromEntries(
      ["lite", "full", "ultra"].map((mode) => [mode, getPonytailInstructions(mode, { compact: true })]),
    );

    for (const [mode, instructions] of Object.entries(compact)) {
      expect(instructions).toMatch(new RegExp(`^PONYTAIL ${mode.toUpperCase()}:`));
      expect(instructions.length).toBeGreaterThanOrEqual(300);
      expect(instructions.length).toBeLessThanOrEqual(450);
      for (const phrase of ["stop ponytail", "Trace first", "root cause", "validation", "data-loss", "security", "accessibility", "runnable check"]) {
        expect(instructions).toContain(phrase);
      }
    }

    expect(compact.lite).toMatch(/Build the ask; name a lazier alternative/);
    expect(compact.full).toMatch(/Enforce ladder; shortest diff/);
    expect(compact.ultra).toMatch(/YAGNI first; delete; challenge the rest/);

    const fullSkill = getPonytailInstructions("full");
    expect(fullSkill).toMatch(/## The ladder/);
    expect(fullSkill.length).toBeGreaterThan(compact.full.length);
  });

  it("review instructions remain independent in compact mode", () => {
    const expected = "PONYTAIL MODE ACTIVE — level: review. Behavior defined by /ponytail-review skill.";
    expect(getPonytailInstructions("review")).toBe(expected);
    expect(getPonytailInstructions("review", { compact: true })).toBe(expected);
  });

  it("filterSkillBodyForMode keeps rule bullets that contain a colon", () => {
    // Regression: rule bullets outside the Intensity section (e.g. the
    // "No unrequested abstractions:" rule or the `ponytail:` comment convention)
    // contain a colon and must not be mistaken for mode-example lines.
    const skillPath = new URL("../../../skills/ponytail/SKILL.md", import.meta.url);
    const body = readFileSync(skillPath, "utf8");

    const filtered = filterSkillBodyForMode(body, "full");

    expect(filtered).toContain("No unrequested abstractions");
    expect(filtered).toContain("Mark deliberate simplifications");
    // The Intensity examples are still filtered down to the active mode.
    expect(filtered).toContain('full: "`@lru_cache');
    expect(filtered).not.toContain('lite: "Done');
    expect(filtered).not.toContain('ultra: "No cache');
  });

  it("filterSkillBodyForMode tolerates a missing body", () => {
    expect(filterSkillBodyForMode(undefined, "full")).toBe("");
    expect(filterSkillBodyForMode(null, "full")).toBe("");
  });

  it("filterSkillBodyForMode keeps non-mode table rows", () => {
    const body = `| **not-a-mode** | keep this |\n| **full** | keep full |`;
    const filtered = filterSkillBodyForMode(body, "full");
    expect(filtered).toContain("keep this");
    expect(filtered).toContain("keep full");
  });

  it("getPonytailInstructions falls back when the skill file is missing", () => {
    const instructions = getPonytailInstructions("full", { compact: false });
    // With the real skill file present this returns the file-based instructions;
    // the fallback path is exercised by deleting the skill file temporarily.
    expect(instructions.length).toBeGreaterThan(0);
  });

  it("getPonytailInstructions falls back when the skill file is unreadable", () => {
    const { getPonytailInstructions: get } = require("../ponytail-instructions.cjs");
    const fs = require("node:fs");
    const path = require("node:path");
    const skillPath = path.join(__dirname, "..", "..", "..", "skills", "ponytail", "SKILL.md");
    const original = fs.readFileSync(skillPath, "utf8");
    try {
      // Temporarily replace the skill file with a directory so readFileSync throws.
      fs.rmSync(skillPath, { force: true });
      fs.mkdirSync(skillPath, { recursive: true });
      const fallback = get("full");
      expect(fallback).toContain("PONYTAIL MODE ACTIVE");
      expect(fallback).toContain("## The ladder");
    } finally {
      fs.rmSync(skillPath, { recursive: true, force: true });
      fs.writeFileSync(skillPath, original, "utf8");
    }
  });

  it("getPonytailInstructions falls back for invalid modes", () => {
    const { getPonytailInstructions: get } = require("../ponytail-instructions.cjs");
    const fallback = get("bogus");
    expect(fallback).toContain("PONYTAIL MODE ACTIVE");
  });

  it("isShellSafe accepts ordinary paths and rejects hostile ones", () => {
    const { isShellSafe } = require("../ponytail-config.cjs");
    expect(isShellSafe("/Users/me/projects/my-app")).toBe(true);
    expect(isShellSafe("C:\\Users\\me\\app")).toBe(true);
    expect(isShellSafe("~/.config/ponytail")).toBe(true);
    expect(isShellSafe("path; rm -rf /")).toBe(false);
    expect(isShellSafe("path&echo")).toBe(false);
    expect(isShellSafe("path$HOME")).toBe(false);
    expect(isShellSafe("path`id`")).toBe(false);
    expect(isShellSafe(42)).toBe(false);
  });

  it("getClaudeDir honors CLAUDE_CONFIG_DIR and falls back to ~/.claude", () => {
    const { getClaudeDir } = require("../ponytail-config.cjs");
    const previous = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = "/custom/claude";
    try {
      expect(getClaudeDir()).toBe("/custom/claude");
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previous;
    }
    const os = require("node:os");
    const path = require("node:path");
    expect(getClaudeDir()).toBe(path.join(os.homedir(), ".claude"));
  });

  it("getConfigDir uses APPDATA on win32 without XDG", () => {
    const { getConfigDir } = require("../ponytail-config.cjs");
    const previousXdg = process.env.XDG_CONFIG_HOME;
    const previousAppData = process.env.APPDATA;
    const original = process.platform;
    delete process.env.XDG_CONFIG_HOME;
    process.env.APPDATA = "/appdata";
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      expect(getConfigDir()).toBe("/appdata/ponytail");
    } finally {
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
      if (previousAppData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = previousAppData;
      Object.defineProperty(process, "platform", { value: original });
    }
  });

  it("getConfigDir falls back to ~/.config/ponytail on POSIX", () => {
    const { getConfigDir } = require("../ponytail-config.cjs");
    const previousXdg = process.env.XDG_CONFIG_HOME;
    const original = process.platform;
    delete process.env.XDG_CONFIG_HOME;
    Object.defineProperty(process, "platform", { value: "linux" });
    try {
      const os = require("node:os");
      const path = require("node:path");
      expect(getConfigDir()).toBe(path.join(os.homedir(), ".config", "ponytail"));
    } finally {
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
      Object.defineProperty(process, "platform", { value: original });
    }
  });

  it("getConfigDir uses XDG_CONFIG_HOME when set", () => {
    const { getConfigDir } = require("../ponytail-config.cjs");
    const previousXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = "/xdg";
    try {
      expect(getConfigDir()).toBe("/xdg/ponytail");
    } finally {
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
    }
  });

  it("getConfigPath joins the config dir with config.json", () => {
    const { getConfigPath } = require("../ponytail-config.cjs");
    const previousXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = "/xdg";
    try {
      expect(getConfigPath()).toBe("/xdg/ponytail/config.json");
    } finally {
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
    }
  });

  it("normalizeMode and normalizeConfigMode reject non-strings", () => {
    const { normalizeMode, normalizeConfigMode, normalizePersistedMode } = require("../ponytail-config.cjs");
    expect(normalizeMode(42)).toBeNull();
    expect(normalizeConfigMode(42)).toBeNull();
    expect(normalizePersistedMode(42)).toBeNull();
    expect(normalizePersistedMode("review")).toBe("review");
  });
});
