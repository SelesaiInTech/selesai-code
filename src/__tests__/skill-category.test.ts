import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSkillsFromDir } from "../core/skills.ts";

describe("skill category frontmatter", () => {
	const dirs: string[] = [];

	afterEach(() => {
		for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
		dirs.length = 0;
	});

	function makeSkillDir(name: string, frontmatter: string): string {
		const dir = mkdtempSync(join(tmpdir(), "selesai-skills-"));
		dirs.push(dir);
		mkdirSync(join(dir, name), { recursive: true });
		writeFileSync(join(dir, name, "SKILL.md"), `---\n${frontmatter}\n---\n\nBody.\n`);
		return dir;
	}

	it("parses category from frontmatter", () => {
		const dir = makeSkillDir(
			"my-skill",
			"name: my-skill\ncategory: design\ndescription: A test skill.",
		);
		const { skills } = loadSkillsFromDir({ dir, source: "test" });
		expect(skills).toHaveLength(1);
		expect(skills[0].category).toBe("design");
	});

	it("category is undefined when absent", () => {
		const dir = makeSkillDir("plain-skill", "name: plain-skill\ndescription: No category.");
		const { skills } = loadSkillsFromDir({ dir, source: "test" });
		expect(skills[0].category).toBeUndefined();
	});

	it("blank category becomes undefined", () => {
		const dir = makeSkillDir("blank-cat", "name: blank-cat\ncategory:   \ndescription: Blank.");
		const { skills } = loadSkillsFromDir({ dir, source: "test" });
		expect(skills[0].category).toBeUndefined();
	});
});