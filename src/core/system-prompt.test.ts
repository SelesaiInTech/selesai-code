import { describe, expect, it } from "vitest";
import type { AgentPersona } from "./agents.ts";
import type { Skill } from "./skills.ts";
import { buildSystemPrompt, buildSystemPromptSections, buildSystemPromptState } from "./system-prompt.ts";

const skill: Skill = {
	name: "test-skill",
	description: "Test skill description",
	filePath: "/tmp/skills/test-skill/SKILL.md",
	baseDir: "/tmp/skills/test-skill",
	sourceInfo: { type: "file", path: "/tmp/skills/test-skill/SKILL.md" } as never,
	disableModelInvocation: false,
};
const agent: AgentPersona = {
	name: "test-agent",
	description: "Test agent description",
	filePath: "/tmp/agents/test-agent.md",
	baseDir: "/tmp/agents",
	sourceInfo: { type: "file", path: "/tmp/agents/test-agent.md" } as never,
	frontmatter: {} as never,
};

describe("buildSystemPrompt", () => {
	it("includes the generic delegation-routing threshold in the default prompt", () => {
		const prompt = buildSystemPrompt({ cwd: "/tmp/project" });

		expect(prompt).toMatch(/When a delegation\/subagent tool is available/i);
		expect(prompt).toMatch(/keep tiny targeted reads and simple answers local/i);
		expect(prompt).toMatch(/broad local investigation, external research, and mutation\/implementation work/i);
		expect(prompt).toMatch(/capable delegated agent/i);
		expect(prompt).toMatch(/inspecting the delegation catalog\/list before selecting/i);
		expect(prompt).toMatch(/parent remains the decision-maker and normally the sole writer/i);
		expect(prompt).toContain("<rules>");
		expect(prompt).toContain("- Be concise in your responses");
		expect(prompt).toContain("<cwd>\n/tmp/project\n</cwd>");
	});

	it("keeps the collapsed Pi-docs block without the per-topic filename map", () => {
		const prompt = buildSystemPrompt({ cwd: "/tmp/project" });

		expect(prompt).toContain("Pi documentation");
		expect(prompt).not.toContain("When asked about:");
		expect(prompt).not.toContain("(docs/extensions.md");
	});

	it("keeps the default tool snippets, skills, and agents XML read-gated", () => {
		const withoutRead = buildSystemPrompt({
			cwd: "/tmp/project",
			selectedTools: ["edit"],
			skills: [skill],
			agents: [agent],
		});
		expect(withoutRead).not.toContain("<available_skills>");
		expect(withoutRead).not.toContain("<available_agents>");
		expect(withoutRead).toContain("<cwd>\n/tmp/project\n</cwd>");

		const withBash = buildSystemPrompt({
			cwd: "/tmp/project",
			selectedTools: ["bash"],
			skills: [skill],
			agents: [agent],
		});
		expect(withBash).toContain("<available_skills>");
		expect(withBash).not.toContain("<available_agents>");

		const withRead = buildSystemPrompt({
			cwd: "/tmp/project",
			selectedTools: ["read", "bash"],
			skills: [skill],
			agents: [agent],
		});
		expect(withRead).toContain("<available_skills>");
		expect(withRead).toContain("<available_agents>");
		expect(withRead).toContain("test-skill");
		expect(withRead).toContain("test-agent");
	});

	it("appends active promptGuidelines to a custom system prompt unchanged", () => {
		const prompt = buildSystemPrompt({
			cwd: "/tmp/project",
			customPrompt: "You are my custom assistant.",
			promptGuidelines: ['Before executing, call { action: "list" }.'],
		});

		expect(prompt).toContain("You are my custom assistant.");
		expect(prompt).toContain("Active tool guidelines:");
		expect(prompt).toContain('- Before executing, call { action: "list" }.');
		expect(prompt).toContain("<cwd>\n/tmp/project\n</cwd>");
	});

	it("deduplicates and trims active promptGuidelines in custom prompts", () => {
		const prompt = buildSystemPrompt({
			cwd: "/tmp/project",
			customPrompt: "Custom.",
			promptGuidelines: ["  Same guideline  ", "Same guideline", "", "   "],
		});

		expect(prompt).toContain("Active tool guidelines:");
		expect(prompt.match(/- Same guideline/g)).toHaveLength(1);
	});

	it("does not add an empty guideline section when no promptGuidelines are supplied", () => {
		const prompt = buildSystemPrompt({ cwd: "/tmp/project", customPrompt: "Custom text." });

		expect(prompt).toContain("Custom text.");
		expect(prompt).not.toContain("Active tool guidelines:");
		expect(prompt).toContain("<cwd>\n/tmp/project\n</cwd>");
	});

	it("renders active promptGuidelines in custom prompts without requiring read", () => {
		const prompt = buildSystemPrompt({
			cwd: "/tmp/project",
			customPrompt: "Custom.",
			selectedTools: ["bash"],
			promptGuidelines: ["Mandatory active-tool guidance."],
		});

		expect(prompt).toContain("- Mandatory active-tool guidance.");
		expect(prompt).not.toContain("<available_agents>");
	});
});

describe("system prompt sections", () => {
	it("tags every non-preamble section with its own name so a later update can address it", () => {
		const sections = buildSystemPromptSections({
			cwd: "/tmp/project",
			selectedTools: ["read", "bash"],
			skills: [skill],
		});

		expect(sections.preamble).toContain("SelesaiCode fork of Pi");
		expect(sections.preamble.startsWith("<")).toBe(false);
		for (const [name, content] of Object.entries(sections)) {
			if (name === "preamble") continue;
			expect(content).toBe(`<${name}>\n${content.slice(name.length + 3, -1 * (name.length + 4))}\n</${name}>`);
		}
		expect(Object.keys(sections)).toContain("tools");
		expect(Object.keys(sections)).toContain("rules");
		expect(Object.keys(sections)).toContain("docs");
		expect(Object.keys(sections)).toContain("skills");
		expect(Object.keys(sections)).toContain("cwd");
	});

	it("carries a forced prompt as opaque content with no sections", () => {
		expect(buildSystemPromptState({ forceSystemPrompt: "exact", cwd: "/tmp" })).toEqual({ content: "exact" });
		expect(buildSystemPrompt({ forceSystemPrompt: "exact", cwd: "/tmp" })).toBe("exact");
	});

	it("rejects an invalid section name rather than producing a malformed prompt", () => {
		expect(() => buildSystemPromptSections({ cwd: "/tmp", sections: { "Bad Name": "x" } })).toThrow(
			/Invalid system prompt section name/,
		);
		expect(() => buildSystemPromptSections({ cwd: "/tmp", sections: { preamble: "x" } })).toThrow(
			/Invalid system prompt section name/,
		);
	});
});
