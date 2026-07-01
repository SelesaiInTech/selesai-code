import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the self-package alias that the extension imports under at runtime.
// jiti maps @earendil-works/pi-coding-agent -> the package's own index; vitest
// has no such alias, so redirect to a stub here. getAgentDir points at a temp
// dir so global-candidate resolution never finds a real ~/.selesai/agent file.
let globalDir: string;
vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => globalDir,
}));

import {
  appendLessonContentToAgentsMd,
  persistedLessonHashes,
} from "../extensions/tool-error-autofix.ts";

const SECTION_START = "<!-- tool-error-autofix -->";
const SECTION_END = "<!-- /tool-error-autofix -->";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "autofix-"));
  globalDir = mkdtempSync(join(tmpdir(), "autofix-global-"));
});

describe("appendLessonContentToAgentsMd", () => {
  it("creates the section when no AGENTS.md exists (default: global)", () => {
    const out = appendLessonContentToAgentsMd(dir, { hash: "abc123", text: "edit: read first" });
    expect(out).toContain(SECTION_START);
    expect(out).toContain(SECTION_END);
    expect(out).toContain("edit: read first");
    expect(existsSync(join(globalDir, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });

  it("appends into an existing section without duplicating the header", () => {
    const first = appendLessonContentToAgentsMd(dir, { hash: "abc123", text: "rule one" });
    writeFileSync(join(globalDir, "AGENTS.md"), first, "utf-8");
    const second = appendLessonContentToAgentsMd(dir, { hash: "def456", text: "rule two" });
    expect(second.match(/### Tool Autofix Lessons/g)?.length).toBe(1);
    expect(second).toContain("rule one");
    expect(second).toContain("rule two");
    expect(second.indexOf("rule one") < second.indexOf("rule two")).toBe(true);
  });

  it("preserves existing non-autofix content above the section", () => {
    writeFileSync(join(globalDir, "AGENTS.md"), "# Global\n\nExisting notes.\n", "utf-8");
    const out = appendLessonContentToAgentsMd(dir, { hash: "abc123", text: "rule one" });
    expect(out.startsWith("# Global")).toBe(true);
    expect(out).toContain("Existing notes.");
    expect(out).toContain("rule one");
  });

  it("prefers the global agent dir over a project-local AGENTS.md", () => {
    // Seed both; lesson must land in the global file, not the project one.
    writeFileSync(join(globalDir, "AGENTS.md"), "# Global\n", "utf-8");
    writeFileSync(join(dir, "AGENTS.md"), "# Project\n", "utf-8");
    const out = appendLessonContentToAgentsMd(dir, { hash: "abc123", text: "global rule" });
    expect(out).toContain("# Global");
    expect(out).toContain("global rule");
    const projectContent = require("node:fs").readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(projectContent).toBe("# Project\n");
  });

  it("falls back to a project-local AGENTS.md when no global file exists", () => {
    // Only the project file exists; lesson should land there.
    writeFileSync(join(dir, "AGENTS.md"), "# Project\n", "utf-8");
    const out = appendLessonContentToAgentsMd(dir, { hash: "abc123", text: "project rule" });
    expect(out).toContain("# Project");
    expect(out).toContain("project rule");
  });

  it("creates a global AGENTS.md by default when neither exists", () => {
    // Nothing exists; default to global, not a new project file.
    const out = appendLessonContentToAgentsMd(dir, { hash: "abc123", text: "fresh rule" });
    expect(existsSync(join(globalDir, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
    expect(out).toContain("fresh rule");
  });
});

describe("persistedLessonHashes", () => {
  it("returns empty when no section", () => {
    expect(persistedLessonHashes("no section here").size).toBe(0);
  });

  it("extracts hashes from a managed section", () => {
    const content = `# Project\n\n${SECTION_START}\n\n### Tool Autofix Lessons\n\n- [ ] a <!-- hash="abc123" -->\n- [ ] b <!-- hash="def456" -->\n\n${SECTION_END}\n`;
    const hashes = persistedLessonHashes(content);
    expect(hashes.has("abc123")).toBe(true);
    expect(hashes.has("def456")).toBe(true);
    expect(hashes.size).toBe(2);
  });
});

describe("dedupe across reloads", () => {
  it("appended hash is parseable by persistedLessonHashes", () => {
    const out = appendLessonContentToAgentsMd(dir, { hash: "abc123def456", text: "rule" });
    expect(persistedLessonHashes(out).has("abc123def456")).toBe(true);
  });
});