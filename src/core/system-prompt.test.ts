import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./system-prompt.ts";
import type { AgentPersona } from "./agents.ts";
import type { Skill } from "./skills.ts";

describe("buildSystemPrompt", () => {
	it("includes the generic delegation-routing threshold in the default prompt", () => {
		const prompt = buildSystemPrompt({ cwd: "/tmp/project" });

		expect(prompt).toMatch(/When a delegation\/subagent tool is available/i);
		expect(prompt).toMatch(/keep tiny targeted reads and simple answers local/i);
		expect(prompt).toMatch(/broad local investigation, external research, and mutation\/implementation work/i);
		expect(prompt).toMatch(/capable delegated agent/i);
		expect(prompt).toMatch(/inspecting the delegation catalog\/list before selecting/i);
		expect(prompt).toMatch(/parent remains the decision-maker and normally the sole writer/i);
		expect(prompt).toMatch(/Guidelines:/);
		expect(prompt).toContain("Current working directory: /tmp/project");
	});

	it("keeps the collapsed Pi-docs block without the per-topic filename map", () => {
		const prompt = buildSystemPrompt({ cwd: "/tmp/project" });

		expect(prompt).toContain("Pi documentation");
		expect(prompt).not.toContain("When asked about:");
		expect(prompt).not.toContain("(docs/extensions.md");
	});

	it("keeps the default tool snippets, skills, and agents XML read-gated", () => {
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

		const withoutRead = buildSystemPrompt({
			cwd: "/tmp/project",
			selectedTools: ["bash"],
			skills: [skill],
			agents: [agent],
		});
		expect(withoutRead).not.toContain("<available_skills>");
		expect(withoutRead).not.toContain("<available_agents>");
		expect(withoutRead).toContain("Current working directory: /tmp/project");

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
		expect(prompt).toContain("Current working directory: /tmp/project");
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
		expect(prompt).toContain("Current working directory: /tmp/project");
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
