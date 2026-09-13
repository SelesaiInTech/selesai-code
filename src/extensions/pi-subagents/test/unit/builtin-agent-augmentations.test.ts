import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyBuiltinAgentAugmentations, type BuiltinAgentAugmentation } from "../../src/agents/builtin-agent-augmentations.ts";
import type { AgentConfig } from "../../src/agents/agents.ts";

const graft: BuiltinAgentAugmentation = {
	id: "pi-graft",
	agentNames: ["worker"],
	addTools: ["graft_find_code"],
	subagentOnlyExtensions: ["/extensions/pi-graft/index.ts"],
};

function agent(source: AgentConfig["source"], fields: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name: "worker",
		description: "Worker",
		systemPrompt: "Work.",
		systemPromptMode: "replace",
		inheritProjectContext: false,
		inheritGlobalContext: false,
		inheritSkills: false,
		filePath: "/agents/worker.md",
		source,
		tools: ["read"],
		...fields,
	};
}

describe("builtin agent augmentations", () => {
	it("augments only an uncustomized selected builtin", () => {
		const [builtin, user, overridden] = applyBuiltinAgentAugmentations([
			agent("builtin"),
			agent("user"),
			agent("builtin", { override: { scope: "user", path: "/settings.json", fields: ["tools", "subagentOnlyExtensions"] } }),
		], [graft]);

		assert.deepEqual(builtin?.tools, ["read", "graft_find_code"]);
		assert.deepEqual(builtin?.subagentOnlyExtensions, ["/extensions/pi-graft/index.ts"]);
		assert.deepEqual(user?.tools, ["read"]);
		assert.equal(user?.subagentOnlyExtensions, undefined);
		assert.deepEqual(overridden?.tools, ["read"]);
		assert.equal(overridden?.subagentOnlyExtensions, undefined);
	});
});
