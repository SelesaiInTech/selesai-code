import test from "node:test";
import assert from "node:assert/strict";
import { calculateReliableTps, type TpsTiming } from "../tps.ts";

function timing(overrides: Partial<TpsTiming> = {}): TpsTiming {
	return {
		messageStartMs: 0,
		lastUpdateMs: 350,
		firstTokenMs: 100,
		updateCount: 5,
		firstStreamUpdateMs: 150,
		lastStreamUpdateMs: 350,
		stallMs: 0,
		generationMs: 400,
		...overrides,
	};
}

test("calculateReliableTps uses active stream time for sufficiently sampled output", () => {
	assert.deepEqual(calculateReliableTps(100, timing()), {
		tps: 500,
		effectiveMs: 200,
		isPrimary: true,
	});
});

test("calculateReliableTps falls back around stalls and rejects implausible samples", () => {
	assert.deepEqual(calculateReliableTps(100, timing({ updateCount: 2, firstStreamUpdateMs: 150, lastStreamUpdateMs: 250, generationMs: 500 })), {
		tps: 200,
		effectiveMs: 500,
		isPrimary: false,
	});
	assert.deepEqual(calculateReliableTps(100, timing({ stallMs: 100 })), {
		tps: 333.3,
		effectiveMs: 300,
		isPrimary: false,
	});
	assert.equal(calculateReliableTps(10_001, timing()), null);
});
