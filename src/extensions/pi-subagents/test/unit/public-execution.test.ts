import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizePublicSubagentExecution } from "../../src/extension/public-execution.ts";

describe("public subagent execution normalization", () => {
	it("accepts all four execution modes, management, and direct-field schedules", () => {
		assert.deepEqual(normalizePublicSubagentExecution({ workflowScript: "return 1" }), { ok: true, params: { workflowScript: "return 1" } });
		assert.deepEqual(normalizePublicSubagentExecution({ agent: "worker", task: "work" }), { ok: true, params: { agent: "worker", task: "work" } });
		assert.deepEqual(normalizePublicSubagentExecution({ tasks: [{ agent: "worker" }] }), { ok: true, params: { tasks: [{ agent: "worker" }] } });
		assert.deepEqual(normalizePublicSubagentExecution({ chain: [{ agent: "worker" }] }), { ok: true, params: { chain: [{ agent: "worker" }] } });
		assert.deepEqual(normalizePublicSubagentExecution({ action: " list " }), { ok: true, params: { action: "list" } });
		assert.deepEqual(
			normalizePublicSubagentExecution({ action: " schedule.create ", every: "1h", workflowScript: "return 1" }),
			{ ok: true, params: { action: "schedule.create", every: "1h", workflowScript: "return 1" } },
		);
		assert.deepEqual(
			normalizePublicSubagentExecution({ action: "schedule.create", agent: "worker", task: "work" }),
			{ ok: true, params: { action: "schedule.create", agent: "worker", task: "work" } },
		);
	});

	it("rejects private run fan-out fields at the public boundary", () => {
		for (const params of [
			{ workflowScript: "return 1", runFanoutBudget: { version: 1 } },
			{ workflowScript: "return 1", runFanoutAdmitted: true },
		] as const) {
			const result = normalizePublicSubagentExecution(params);
			assert.equal(result.ok, false);
			if (!result.ok) assert.match(result.error, /does not accept internal run fan-out fields/);
		}
	});

	it("rejects removed public execution shapes", () => {
		for (const params of [
			{ action: " " },
			{ action: "single" },
			{ action: "parallel" },
			{ action: "chain" },
			{ parallel: [{ agent: "worker" }] },
			{ concurrency: 2 },
			{ clarify: true, workflowScript: "return 1" },
			{ resume: "retained-run", workflowScript: "return 1" },
			{},
			{ workflowScript: " " },
			{ action: "status", workflowScript: "return 1" },
			{ action: "schedule.create", every: "1h" },
		] as const) {
			assert.equal(normalizePublicSubagentExecution(params).ok, false, JSON.stringify(params));
		}
	});
});
