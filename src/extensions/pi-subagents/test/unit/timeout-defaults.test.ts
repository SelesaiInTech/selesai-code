import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	DEFAULT_ASYNC_TIMEOUT_MS,
	DEFAULT_FOREGROUND_TIMEOUT_MS,
	resolveSingleAgentLaunchTimeout,
} from "../../src/runs/foreground/subagent-executor.ts";

describe("single-agent launch timeout wiring", () => {
	it("async runs default to DEFAULT_ASYNC_TIMEOUT_MS when no explicit/agent timeout", () => {
		assert.deepEqual(resolveSingleAgentLaunchTimeout({}, true), {
			timeoutMs: DEFAULT_ASYNC_TIMEOUT_MS,
		});
	});

	it("foreground runs default to DEFAULT_FOREGROUND_TIMEOUT_MS when no explicit/agent timeout", () => {
		assert.deepEqual(resolveSingleAgentLaunchTimeout({}, false), {
			timeoutMs: DEFAULT_FOREGROUND_TIMEOUT_MS,
		});
	});

	it("explicit timeoutMs wins over the async default", () => {
		assert.deepEqual(resolveSingleAgentLaunchTimeout({ timeoutMs: 5_000 }, true), {
			timeoutMs: 5_000,
		});
	});

	it("maxRuntimeMs alias wins over the async default", () => {
		assert.deepEqual(resolveSingleAgentLaunchTimeout({ maxRuntimeMs: 7_000 }, true), {
			timeoutMs: 7_000,
		});
	});

	it("rejects non-positive timeouts", () => {
		const result = resolveSingleAgentLaunchTimeout({ timeoutMs: 0 }, true);
		assert.ok(result.error);
		assert.match(result.error!, /positive integer/);
	});

	it("rejects mismatched alias values", () => {
		const result = resolveSingleAgentLaunchTimeout({ timeoutMs: 1_000, maxRuntimeMs: 2_000 }, true);
		assert.ok(result.error);
		assert.match(result.error!, /aliases/);
	});

	it("does not apply the async default to async chains (children are bounded individually)", () => {
		assert.deepEqual(
			resolveSingleAgentLaunchTimeout({ agent: "worker", task: "x", chain: [{ agent: "worker", task: "y" }] }, true),
			{},
		);
	});

	it("does not apply the async default to async parallel tasks", () => {
		assert.deepEqual(
			resolveSingleAgentLaunchTimeout({ agent: "worker", task: "x", tasks: [{ agent: "worker", task: "y" }] }, true),
			{},
		);
	});

	it("does not apply the async default to async workflowScript", () => {
		assert.deepEqual(
			resolveSingleAgentLaunchTimeout({ workflowScript: "return runs.run('a', { agent: 'worker', task: 'x' })" }, true),
			{},
		);
	});

	it("explicit top-level timeout still applies to async chains", () => {
		assert.deepEqual(
			resolveSingleAgentLaunchTimeout({ agent: "worker", task: "x", chain: [{ agent: "worker", task: "y" }], timeoutMs: 5_000 }, true),
			{ timeoutMs: 5_000 },
		);
	});
});
