import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import {
	appendRunnerStepsToStatus,
	consumeChainAppendRequests,
	countPendingChainAppendRequests,
	enqueueChainAppendRequest,
	readPendingChainAppendRequests,
	runnerStepOutputNames,
} from "../../src/runs/background/chain-append.ts";
import type { AsyncStatus } from "../../src/shared/types.ts";
import type { RunnerStep } from "../../src/runs/shared/parallel-utils.ts";
import { claimRunFanoutBatchWithCommit, createRunFanoutBudget, getRunFanoutBudgetSnapshot } from "../../src/runs/shared/run-fanout-budget.ts";
import { PROMPT_REDACTED } from "../../src/shared/utils.ts";
import { createTempDir, removeTempDir } from "../support/helpers.ts";

function writeStatus(asyncDir: string, status: Partial<AsyncStatus> & Pick<AsyncStatus, "runId" | "mode" | "state" | "startedAt">): void {
	fs.mkdirSync(asyncDir, { recursive: true });
	fs.writeFileSync(path.join(asyncDir, "status.json"), JSON.stringify(status), "utf-8");
}

function readStatus(asyncDir: string): AsyncStatus {
	return JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf-8")) as AsyncStatus;
}

function runnerStep(agent: string, task = "Use {previous}"): RunnerStep {
	return {
		agent,
		task,
		inheritProjectContext: false,
		inheritSkills: false,
	};
}

describe("chain append requests", () => {
	it("persists append requests for running async chains and records pending status", () => {
		const root = createTempDir("pi-chain-append-");
		try {
			const asyncDir = path.join(root, "run-a");
			writeStatus(asyncDir, {
				runId: "run-a",
				mode: "chain",
				state: "running",
				startedAt: 100,
				lastUpdate: 100,
				chainStepCount: 1,
				steps: [{ agent: "scout", status: "running" }],
			});

			const result = enqueueChainAppendRequest({
				asyncDir,
				runId: "run-a",
				steps: [runnerStep("worker")],
				now: 200,
			});

			assert.equal(result.pendingCount, 1);
			assert.equal(countPendingChainAppendRequests(asyncDir), 1);
			const status = readStatus(asyncDir);
			assert.equal(status.pendingAppends, 1);
			assert.equal(status.lastUpdate, 200);
			const eventLog = fs.readFileSync(path.join(asyncDir, "events.jsonl"), "utf-8");
			assert.match(eventLog, /subagent\.chain\.append\.requested/);

			const consumed = consumeChainAppendRequests(asyncDir);
			assert.equal(consumed.length, 1);
			assert.equal(consumed[0]!.id, result.request.id);
			assert.equal(countPendingChainAppendRequests(asyncDir), 0);
		} finally {
			removeTempDir(root);
		}
	});

	it("persists the request inside the admission callback", () => {
		const root = createTempDir("pi-chain-append-admission-");
		try {
			const asyncDir = path.join(root, "run-admission");
			writeStatus(asyncDir, {
				runId: "run-admission",
				mode: "chain",
				state: "running",
				startedAt: 100,
				steps: [{ agent: "scout", status: "running" }],
			});
			let admitted = false;
			const result = enqueueChainAppendRequest({
				asyncDir,
				runId: "run-admission",
				steps: [runnerStep("worker")],
				now: 200,
				admit: (persist) => {
					assert.equal(countPendingChainAppendRequests(asyncDir), 0);
					persist();
					admitted = true;
				},
			});

			assert.equal(admitted, true);
			assert.equal(result.pendingCount, 1);
		} finally {
			removeTempDir(root);
		}
	});

	it("reports accepted appends and keeps admission claims when bookkeeping fails after persistence", () => {
		const root = createTempDir("pi-chain-append-bookkeeping-");
		const budget = createRunFanoutBudget("append-bookkeeping", 1);
		try {
			const asyncDir = path.join(root, "run-bookkeeping");
			writeStatus(asyncDir, {
				runId: "run-bookkeeping",
				mode: "chain",
				state: "running",
				startedAt: 100,
				steps: [{ agent: "scout", status: "running" }],
			});
			const statusPath = path.join(asyncDir, "status.json");
			fs.mkdirSync(path.join(asyncDir, "events.jsonl"));

			const result = enqueueChainAppendRequest({
				asyncDir,
				runId: "run-bookkeeping",
				steps: [runnerStep("worker")],
				now: 200,
				admit: (persist) => claimRunFanoutBatchWithCommit(budget, ["chain[1]"], () => {
					persist();
					fs.rmSync(statusPath, { force: true });
					fs.mkdirSync(statusPath);
				}),
			});

			assert.equal(result.pendingCount, 1);
			assert.match(result.bookkeepingError ?? "", /status update failed/);
			assert.match(result.bookkeepingError ?? "", /event append failed/);
			assert.equal(readPendingChainAppendRequests(asyncDir).length, 1);
			assert.deepEqual(getRunFanoutBudgetSnapshot(budget), { used: 1, limit: 1, remaining: 0 });
		} finally {
			fs.rmSync(budget.directory, { recursive: true, force: true });
			removeTempDir(root);
		}
	});

	it("reads pending append requests without consuming them and reports reserved output names", () => {
		const root = createTempDir("pi-chain-append-pending-");
		try {
			const asyncDir = path.join(root, "run-pending");
			writeStatus(asyncDir, {
				runId: "run-pending",
				mode: "chain",
				state: "running",
				startedAt: 100,
				steps: [{ agent: "scout", status: "running" }],
			});
			enqueueChainAppendRequest({
				asyncDir,
				runId: "run-pending",
				steps: [{
					parallel: [
						{ ...runnerStep("worker"), outputName: "draft" },
						{ ...runnerStep("reviewer"), outputName: "review" },
					],
				}],
				now: 200,
			});

			const pending = readPendingChainAppendRequests(asyncDir);

			assert.equal(pending.length, 1);
			assert.deepEqual(runnerStepOutputNames(pending[0]!.steps), ["draft", "review"]);
			assert.equal(countPendingChainAppendRequests(asyncDir), 1);
		} finally {
			removeTempDir(root);
		}
	});

	it("rejects terminal and non-chain async runs", () => {
		const root = createTempDir("pi-chain-append-reject-");
		try {
			const completeDir = path.join(root, "complete");
			writeStatus(completeDir, {
				runId: "complete",
				mode: "chain",
				state: "complete",
				startedAt: 100,
				steps: [{ agent: "scout", status: "complete" }],
			});
			assert.throws(
				() => enqueueChainAppendRequest({ asyncDir: completeDir, runId: "complete", steps: [runnerStep("worker")] }),
				/only running chain runs/,
			);

			const parallelDir = path.join(root, "parallel");
			writeStatus(parallelDir, {
				runId: "parallel",
				mode: "parallel",
				state: "running",
				startedAt: 100,
				steps: [{ agent: "scout", status: "running" }],
			});
			assert.throws(
				() => enqueueChainAppendRequest({ asyncDir: parallelDir, runId: "parallel", steps: [runnerStep("worker")] }),
				/only active chain runs/,
			);

			const drainedDir = path.join(root, "drained");
			writeStatus(drainedDir, {
				runId: "drained",
				mode: "chain",
				state: "running",
				startedAt: 100,
				steps: [{ agent: "scout", status: "complete" }],
			});
			assert.throws(
				() => enqueueChainAppendRequest({ asyncDir: drainedDir, runId: "drained", steps: [runnerStep("worker")] }),
				/no running or pending chain steps left/,
			);
		} finally {
			removeTempDir(root);
		}
	});

	it("extends async chain status, parallel groups, and workflow graph", () => {
		const status: AsyncStatus = {
			runId: "run-graph",
			mode: "chain",
			state: "running",
			startedAt: 100,
			currentStep: 0,
			chainStepCount: 1,
			steps: [{ agent: "scout", status: "complete" }],
			parallelGroups: [],
			workflowGraph: {
				runId: "run-graph",
				mode: "chain",
				phases: [],
				nodes: [{
					id: "step-0",
					kind: "step",
					agent: "scout",
					label: "scout",
					status: "completed",
					flatIndex: 0,
					stepIndex: 0,
				}],
			},
		};
		const appended: RunnerStep[] = [
			runnerStep("worker"),
			{
				parallel: [
					runnerStep("reviewer"),
					runnerStep("auditor"),
				],
				concurrency: 2,
			},
		];

		const result = appendRunnerStepsToStatus({ status, steps: appended, now: 300, pendingAppends: 0 });

		assert.deepEqual(result, { addedChainSteps: 2, addedFlatSteps: 3 });
		assert.equal(status.chainStepCount, 3);
		assert.equal(status.pendingAppends, 0);
		assert.equal(status.lastUpdate, 300);
		assert.deepEqual(status.steps?.map((step) => `${step.agent}:${step.status}`), [
			"scout:complete",
			"worker:pending",
			"reviewer:pending",
			"auditor:pending",
		]);
		// Appended steps must not carry raw task text into durable status.
		assert.deepEqual(status.steps?.slice(1).map((step) => step.description), [
			PROMPT_REDACTED,
			PROMPT_REDACTED,
			PROMPT_REDACTED,
		]);
		assert.deepEqual(status.parallelGroups, [{ start: 2, count: 2, stepIndex: 2 }]);
		assert.equal(status.workflowGraph?.nodes[1]?.id, "step-1");
		assert.equal(status.workflowGraph?.nodes[2]?.kind, "parallel-group");
		assert.deepEqual(status.workflowGraph?.nodes[2]?.children?.map((child) => child.flatIndex), [2, 3]);
	});
});
