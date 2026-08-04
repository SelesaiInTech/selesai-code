import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	formatTaskAwareAgentRecommendation,
	recommendTaskAwareAgent,
} from "../../src/agents/task-aware-routing.ts";
import type { AgentConfig } from "../../src/agents/agents.ts";

function agent(name: string, overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name,
		description: `${name} agent`,
		systemPrompt: `${name} prompt`,
		systemPromptMode: "append",
		inheritProjectContext: false,
		inheritSkills: false,
		source: "builtin",
		filePath: `/tmp/${name}.md`,
		...overrides,
	};
}

describe("recommendTaskAwareAgent", () => {
	it("no-ops for empty or whitespace-only tasks", () => {
		assert.equal(recommendTaskAwareAgent({ task: "", agents: [] }), undefined);
		assert.equal(recommendTaskAwareAgent({ task: "   \n\t ", agents: [] }), undefined);
	});

	it("recommends a canonical writer for an implementation task, never a read-only agent", () => {
		const recommendation = recommendTaskAwareAgent({
			task: "Implement the fix",
			agents: [
				agent("commentator", { tools: ["read", "grep"] }),
				agent("builder"),
			],
		});
		assert.ok(recommendation);
		assert.equal(recommendation.intent, "implementation");
		assert.equal(recommendation.agent?.name, "builder");
		assert.equal(recommendation.agent?.role, "writer");
		assert.equal(recommendation.agent?.roleBasis, "inferred");
	});

	it("recommends a read-only agent without known write tools, never a writer", () => {
		const recommendation = recommendTaskAwareAgent({
			task: "Review only; do not edit files",
			agents: [
				agent("builder"),
				agent("commentator", { tools: ["read", "grep", "find", "ls"] }),
			],
		});
		assert.ok(recommendation);
		assert.equal(recommendation.intent, "read-only");
		assert.equal(recommendation.agent?.name, "commentator");
		assert.equal(recommendation.agent?.role, "read-only");
		assert.equal(recommendation.agent?.roleBasis, "inferred");
	});

	it("never recommends a read-only agent whose tools are unset or include bash", () => {
		for (const candidate of [
			agent("commentator"),
			agent("commentator", { tools: ["read", "bash"] }),
		]) {
			const recommendation = recommendTaskAwareAgent({
				task: "Review only; do not edit files",
				agents: [candidate],
			});
			assert.ok(recommendation);
			assert.equal(recommendation.agent, undefined);
			assert.match(recommendation.next ?? "", /read-only role without known write tools/);
		}
	});

	it("gives recovery guidance, not a guess, for unknown intent", () => {
		const recommendation = recommendTaskAwareAgent({
			task: "Look into this",
			agents: [agent("builder"), agent("commentator", { tools: ["read", "grep"] })],
		});
		assert.ok(recommendation);
		assert.equal(recommendation.intent, "unknown");
		assert.equal(recommendation.agent, undefined);
		assert.match(recommendation.next ?? "", /Clarify whether the task is read-only analysis\/review or implementation allowed to edit files/);
	});

	it("excludes disabled agents even when they match the task role", () => {
		const recommendation = recommendTaskAwareAgent({
			task: "Implement the fix",
			agents: [
				agent("builder", { disabled: true }),
				agent("fixer", { source: "project", acceptanceRole: "writer", tools: ["edit"] }),
			],
		});
		assert.ok(recommendation);
		assert.equal(recommendation.agent?.name, "fixer");
	});

	it("excludes agents denied by the capability ceiling allowedAgents", () => {
		const recommendation = recommendTaskAwareAgent({
			task: "Implement the fix",
			agents: [agent("builder"), agent("fixer", { source: "project", acceptanceRole: "writer", tools: ["edit"] })],
			capabilityCeiling: { version: 1, allowedAgents: ["builder"], denyExtensions: false, sources: ["plan"] },
		});
		assert.ok(recommendation);
		assert.equal(recommendation.agent?.name, "builder");
	});

	it("refuses a writer recommendation when allowedTools has no writer tool", () => {
		const recommendation = recommendTaskAwareAgent({
			task: "Implement the fix",
			agents: [agent("builder")],
			capabilityCeiling: { version: 1, allowedTools: ["read", "grep"], denyExtensions: false, sources: ["plan"] },
		});
		assert.ok(recommendation);
		assert.equal(recommendation.intent, "implementation");
		assert.equal(recommendation.agent, undefined);
		assert.match(recommendation.next ?? "", /capability ceiling/);
	});

	it("recommends a writer when allowedTools includes a writer tool", () => {
		const recommendation = recommendTaskAwareAgent({
			task: "Implement the fix",
			agents: [agent("builder")],
			capabilityCeiling: { version: 1, allowedTools: ["read", "edit"], denyExtensions: false, sources: ["plan"] },
		});
		assert.ok(recommendation);
		assert.equal(recommendation.agent?.name, "builder");
	});

	it("prefers project over user, package, and builtin candidates", () => {
		const recommendation = recommendTaskAwareAgent({
			task: "Implement the fix",
			agents: [
				agent("builder", { source: "builtin" }),
				agent("builder", { source: "package" }),
				agent("builder", { source: "user" }),
				agent("builder", { source: "project" }),
			],
		});
		assert.ok(recommendation);
		assert.equal(recommendation.agent?.name, "builder");
		assert.equal(recommendation.agent?.source, "project");
	});

	it("sorts equal candidates by canonical name", () => {
		const recommendation = recommendTaskAwareAgent({
			task: "Implement the fix",
			agents: [
				agent("zeta-builder", { source: "user", acceptanceRole: "writer", tools: ["edit"] }),
				agent("alpha-builder", { source: "user", acceptanceRole: "writer", tools: ["edit"] }),
			],
		});
		assert.ok(recommendation);
		assert.equal(recommendation.agent?.name, "alpha-builder");
	});

	it("prefers a declared role over an inferred role at the same source", () => {
		const recommendation = recommendTaskAwareAgent({
			task: "Implement the fix",
			agents: [
				agent("builder", { source: "user" }),
				agent("fixer", { source: "user", acceptanceRole: "writer", tools: ["edit"] }),
			],
		});
		assert.ok(recommendation);
		assert.equal(recommendation.agent?.name, "fixer");
		assert.equal(recommendation.agent?.roleBasis, "declared");
	});

	it("never emits an alias as the recommended launch name", () => {
		const recommendation = recommendTaskAwareAgent({
			task: "Implement the fix",
			agents: [
				agent("canonical-builder", { aliases: ["developer"], source: "user", acceptanceRole: "writer", tools: ["edit"] }),
			],
		});
		assert.ok(recommendation);
		assert.equal(recommendation.agent?.name, "canonical-builder");
	});
});

describe("formatTaskAwareAgentRecommendation", () => {
	it("renders nothing for an empty-task no-op", () => {
		assert.deepEqual(formatTaskAwareAgentRecommendation(undefined), []);
	});

	it("renders a safe recommendation with the canonical agent and explicit-launch note", () => {
		const lines = formatTaskAwareAgentRecommendation({
			intent: "implementation",
			agent: { name: "builder", source: "project", role: "writer", roleBasis: "declared", reason: "declared writer role with write tools" },
		});
		assert.deepEqual(lines, [
			"Task-aware advisory routing:",
			"- Intent: implementation",
			"- Recommended: builder (project)",
			"- Reason: declared writer role with write tools",
			"- Advisory only: no subagent was launched. To proceed, explicitly call subagent with this canonical agent name and the task.",
		]);
	});

	it("renders recovery guidance without an agent name", () => {
		const lines = formatTaskAwareAgentRecommendation({
			intent: "unknown",
			next: "Clarify whether the task is read-only analysis/review or implementation allowed to edit files.",
		});
		assert.deepEqual(lines, [
			"Task-aware advisory routing:",
			"- Intent: unknown",
			"- Recommendation: none",
			"- Next: Clarify whether the task is read-only analysis/review or implementation allowed to edit files.",
			"- Advisory only: no subagent was launched.",
		]);
	});
});
