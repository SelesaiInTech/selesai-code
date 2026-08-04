import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleList } from "../../src/agents/agent-management.ts";
import type { AgentConfig } from "../../src/agents/agents.ts";
import { resolveSubagentLaunchContract } from "../../src/api/preflight.ts";
import {
	decodeSubagentCapabilityCeiling,
	encodeSubagentCapabilityCeiling,
	intersectSubagentCapabilityCeilings,
	parseSubagentCapabilityCeiling,
	registerSubagentCapabilityCeiling,
} from "../../src/api/capability-ceiling.ts";
import { runSync } from "../../src/runs/foreground/execution.ts";
import { buildPiArgs } from "../../src/runs/shared/pi-args.ts";

function agent(name: string): AgentConfig {
	return {
		name,
		description: `${name} agent`,
		systemPrompt: `${name} prompt`,
		systemPromptMode: "replace",
		inheritProjectContext: false,
		inheritSkills: false,
		source: "project",
		filePath: `/tmp/${name}.md`,
	};
}

describe("capability ceiling agent allowlist", () => {
	it("parses, round-trips, and intersects allowedAgents", () => {
		const parsed = parseSubagentCapabilityCeiling({ version: 1, allowedAgents: ["worker", "reviewer", "worker"], denyExtensions: false, sources: ["plan"] });
		assert.deepEqual(parsed.allowedAgents, ["reviewer", "worker"]);
		assert.deepEqual(decodeSubagentCapabilityCeiling(encodeSubagentCapabilityCeiling(parsed)), parsed);

		assert.deepEqual(intersectSubagentCapabilityCeilings(
			{ version: 1, allowedAgents: ["worker", "reviewer"], denyExtensions: false, sources: ["outer"] },
			{ version: 1, allowedAgents: ["reviewer", "scout"], denyExtensions: true, sources: ["inner"] },
		), {
			version: 1,
			allowedAgents: ["reviewer"],
			denyExtensions: true,
			sources: ["inner", "outer"],
		});

		assert.deepEqual(intersectSubagentCapabilityCeilings(
			{ version: 1, allowedTools: ["read"], denyExtensions: false, sources: ["tools-only"] },
			{ version: 1, allowedAgents: [], denyExtensions: false, sources: ["none"] },
		)?.allowedAgents, []);
	});

	it("marks non-allowlisted agents as restricted in list output", () => {
		const sessionId = `allowlist-list-${Date.now()}-${Math.random()}`;
		const handle = registerSubagentCapabilityCeiling({ sessionId, source: "plan-mode", ceiling: { allowedAgents: ["commentator"] } });
		try {
			const result = handleList({}, { cwd: process.cwd(), currentSessionId: sessionId, modelRegistry: { getAvailable: () => [] } });
			const text = result.content[0]?.text ?? "";
			assert.match(text, /Executable agents:/);
			assert.match(text, /- commentator /);
			assert.match(text, /Restricted agents \(not executable in this session; capability ceiling: plan-mode\):/);
			assert.match(text, /- builder /);

			const catalog = (result as { details: { catalog?: unknown } }).details.catalog as
				| undefined
				| {
					version: number;
					agents: Array<{ name: string; executable: boolean; restrictionSources?: string[]; defaultContext: string }>;
					capabilityCeilingSources?: string[];
				};
			assert.ok(catalog, "list result must include machine catalog metadata");
			assert.equal(catalog.version, 1);
			assert.deepEqual(catalog.capabilityCeilingSources, ["plan-mode"]);
			const commentator = catalog.agents.find((entry) => entry.name === "commentator");
			const builder = catalog.agents.find((entry) => entry.name === "builder");
			assert.equal(commentator?.executable, true);
			assert.equal(commentator?.restrictionSources, undefined);
			assert.equal(commentator?.defaultContext, "fresh");
			assert.equal(builder?.executable, false);
			assert.deepEqual(builder?.restrictionSources, ["plan-mode"]);
		} finally {
			handle.dispose();
		}
	});

	it("never recommends a capability-restricted writer for implementation list task advice", () => {
		const sessionId = `allowlist-advice-${Date.now()}-${Math.random()}`;
		const handle = registerSubagentCapabilityCeiling({ sessionId, source: "plan-mode", ceiling: { allowedAgents: ["commentator"] } });
		try {
			const result = handleList({ task: "Implement the fix" }, { cwd: process.cwd(), currentSessionId: sessionId, modelRegistry: { getAvailable: () => [] } });
			assert.equal(result.isError, false);
			const text = result.content[0]?.text ?? "";
			assert.match(text, /Task-aware advisory routing:/);
			assert.match(text, /- Intent: implementation/);
			assert.match(text, /- Recommendation: none/);
			assert.doesNotMatch(text, /- Recommended: /);
		} finally {
			handle.dispose();
		}
	});

	it("rejects a non-allowlisted agent in preflight launch resolution", async () => {
		const result = await resolveSubagentLaunchContract({
			agent: "builder",
			cwd: process.cwd(),
			capabilityCeiling: { version: 1, allowedAgents: ["commentator"], denyExtensions: false, sources: ["plan-mode"] },
		});
		assert.equal(result.ok, false);
		assert.equal(result.code, "restricted_agent");
		assert.match(result.message, /does not allow agent 'builder'/);
		assert.match(result.message, /Allowed agents: commentator/);
	});

	it("rejects a non-allowlisted foreground launch before spawning", async () => {
		const result = await runSync(process.cwd(), [agent("builder"), agent("commentator")], "builder", "Do work", {
			capabilityCeiling: { version: 1, allowedAgents: ["commentator"], denyExtensions: false, sources: ["plan-mode"] },
		});
		assert.equal(result.exitCode, 1);
		assert.match(result.error ?? "", /does not allow agent 'builder'/);
		assert.deepEqual(result.capabilityCeiling?.allowedAgents, ["commentator"]);
	});

	it("includes allowedAgents in propagated launch env and audit metadata", () => {
		const { env, capabilityAudit } = buildPiArgs({
			baseArgs: [],
			task: "Review",
			sessionEnabled: false,
			inheritProjectContext: false,
			inheritSkills: false,
			childAgentName: "commentator",
			capabilityCeiling: { version: 1, allowedAgents: ["commentator"], allowedTools: ["read"], denyExtensions: true, sources: ["plan-mode"] },
		});
		assert.equal(capabilityAudit?.agentAllowed, true);
		assert.deepEqual(capabilityAudit?.agentRestrictionSources, ["plan-mode"]);
		assert.ok(env.SELESAI_SUBAGENT_CAPABILITY_CEILING_V1);
		assert.deepEqual(decodeSubagentCapabilityCeiling(env.SELESAI_SUBAGENT_CAPABILITY_CEILING_V1)?.allowedAgents, ["commentator"]);
	});
});
