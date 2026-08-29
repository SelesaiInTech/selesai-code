import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatFrontmatter } from "../../src/store/skill-utils.js";

describe("formatFrontmatter", () => {
  it("quotes string fields safely for YAML", () => {
    const raw = formatFrontmatter({
      name: "audit-agents-md",
      displayName: "Audit AGENTS.md",
      description: "Audit and restructure AGENTS.md files: remove cross-references between sections",
      version: 1,
      created: "2026-05-18",
      updated: "2026-05-18",
      body: "# Steps\n1. Do thing",
    });

    assert.ok(raw.includes('name: "audit-agents-md"'));
    assert.ok(raw.includes('description: "Audit and restructure AGENTS.md files: remove cross-references between sections"'));
    assert.ok(raw.includes('display_name: "Audit AGENTS.md"'));
  });
});
