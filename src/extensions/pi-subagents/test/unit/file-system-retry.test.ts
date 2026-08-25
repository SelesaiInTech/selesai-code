import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	FS_RETRY_MAX_TOTAL_MS_ENV,
	resolveFileSystemRetryDelays,
	runFileSystemOperationWithRetry,
} from "../../src/shared/file-system-retry.ts";

const BASE = [10, 25, 50, 100, 200, 500, 1000, 2000, 4000];
const total = (delays: readonly number[]): number => delays.reduce((sum, value) => sum + value, 0);

describe("file system retry budget", () => {
	it("is unchanged when the environment variable is unset or blank", () => {
		assert.deepEqual(resolveFileSystemRetryDelays({}, BASE), BASE);
		assert.deepEqual(resolveFileSystemRetryDelays({ [FS_RETRY_MAX_TOTAL_MS_ENV]: "" }, BASE), BASE);
		assert.deepEqual(resolveFileSystemRetryDelays({ [FS_RETRY_MAX_TOTAL_MS_ENV]: "   " }, BASE), BASE);
	});

	it("clamps the total sleep to the configured budget", () => {
		const delays = resolveFileSystemRetryDelays({ [FS_RETRY_MAX_TOTAL_MS_ENV]: "1000" }, BASE);
		assert.equal(total(delays), 1000);
		assert.deepEqual(delays, [10, 25, 50, 100, 200, 500, 115, 0, 0]);
	});

	it("keeps the ladder length, because callers use it as an attempt budget", () => {
		// run-fanout-budget.ts and workflow-state.ts index this array by attempt
		// number and treat an undefined entry as "timed out acquiring lock".
		// Dropping entries would silently shrink those budgets.
		for (const budget of ["0", "1", "250", "100000"]) {
			const delays = resolveFileSystemRetryDelays({ [FS_RETRY_MAX_TOTAL_MS_ENV]: budget }, BASE);
			assert.equal(delays.length, BASE.length, `length preserved for budget ${budget}`);
			assert.ok(delays.every((value) => Number.isInteger(value) && value >= 0));
		}
	});

	it("never exceeds the base ladder, even for a huge budget", () => {
		assert.deepEqual(resolveFileSystemRetryDelays({ [FS_RETRY_MAX_TOTAL_MS_ENV]: "99999999" }, BASE), BASE);
	});

	it("supports a zero budget as retry-without-sleeping", () => {
		const delays = resolveFileSystemRetryDelays({ [FS_RETRY_MAX_TOTAL_MS_ENV]: "0" }, BASE);
		assert.equal(total(delays), 0);
		let attempts = 0;
		const slept: number[] = [];
		assert.throws(() => runFileSystemOperationWithRetry(() => {
			attempts += 1;
			throw Object.assign(new Error("EPERM"), { code: "EPERM" });
		}, { retryDelaysMs: delays, wait: (delayMs) => slept.push(delayMs) }), /EPERM/);
		assert.equal(attempts, BASE.length + 1, "all attempts still run");
		// waitForFileSystemRetry returns immediately for <= 0, so the thread is
		// never parked even though wait() is still called between attempts.
		assert.ok(slept.every((value) => value === 0), "no non-zero sleep is requested");
	});

	it("rejects values that are not a non-negative integer", () => {
		for (const value of ["-1", "abc", "1.5", "NaN", "1e3ms"]) {
			assert.throws(
				() => resolveFileSystemRetryDelays({ [FS_RETRY_MAX_TOTAL_MS_ENV]: value }, BASE),
				new RegExp(FS_RETRY_MAX_TOTAL_MS_ENV),
				`rejects ${value}`,
			);
		}
	});
});
