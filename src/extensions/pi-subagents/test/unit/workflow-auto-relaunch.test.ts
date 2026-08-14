import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	DEFAULT_MAX_WORKFLOW_AUTO_RELAUNCHES,
	resolveAutoRelaunchDecision,
	resolveMaxWorkflowAutoRelaunches,
} from "../../src/workflows/workflow-auto-relaunch.ts";

describe("workflow auto-relaunch policy", () => {
	it("relaunches on a budget result while under the cap", () => {
		const decision = resolveAutoRelaunchDecision({ result: "budget", rounds: 3 }, 2, 12);
		assert.deepEqual(decision, { relaunch: true, capped: false });
	});

	it("does not relaunch a clean result", () => {
		const decision = resolveAutoRelaunchDecision({ result: "clean", rounds: 3 }, 0, 12);
		assert.deepEqual(decision, { relaunch: false, capped: false });
	});

	it("does not relaunch non-workflow values", () => {
		for (const value of [undefined, null, 5, "budget", ["budget"], { result: "failed" }]) {
			const decision = resolveAutoRelaunchDecision(value, 0, 12);
			assert.deepEqual(decision, { relaunch: false, capped: false });
		}
	});

	it("marks the cap as reached when the relaunch count equals the cap", () => {
		const decision = resolveAutoRelaunchDecision({ result: "budget" }, 12, 12);
		assert.deepEqual(decision, { relaunch: false, capped: true });
	});

	it("relaunches indefinitely when the cap is unlimited", () => {
		const decision = resolveAutoRelaunchDecision({ result: "budget" }, 50, undefined);
		assert.deepEqual(decision, { relaunch: true, capped: false });
	});

	it("resolves the configured cap with a safe default and 0 as unlimited", () => {
		assert.equal(resolveMaxWorkflowAutoRelaunches(undefined), DEFAULT_MAX_WORKFLOW_AUTO_RELAUNCHES);
		assert.equal(resolveMaxWorkflowAutoRelaunches(5), 5);
		assert.equal(resolveMaxWorkflowAutoRelaunches(0), undefined);
		assert.equal(resolveMaxWorkflowAutoRelaunches(-3), DEFAULT_MAX_WORKFLOW_AUTO_RELAUNCHES);
		assert.equal(resolveMaxWorkflowAutoRelaunches("12"), DEFAULT_MAX_WORKFLOW_AUTO_RELAUNCHES);
		assert.equal(resolveMaxWorkflowAutoRelaunches(2.5), DEFAULT_MAX_WORKFLOW_AUTO_RELAUNCHES);
	});
});
