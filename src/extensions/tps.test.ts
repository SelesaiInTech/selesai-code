import { describe, expect, it } from "vitest";
import { calculateReliableTps, type TpsTiming } from "./tps.ts";

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

describe("calculateReliableTps", () => {
	it("uses active stream time for sufficiently sampled output", () => {
		expect(calculateReliableTps(100, timing())).toEqual({
			tps: 500,
			effectiveMs: 200,
			isPrimary: true,
		});
	});

	it("falls back around stalls and rejects implausible samples", () => {
		expect(
			calculateReliableTps(100, timing({ updateCount: 2, firstStreamUpdateMs: 150, lastStreamUpdateMs: 250, generationMs: 500 })),
		).toEqual({ tps: 200, effectiveMs: 500, isPrimary: false });
		expect(calculateReliableTps(100, timing({ stallMs: 100 }))).toEqual({
			tps: 333.3,
			effectiveMs: 300,
			isPrimary: false,
		});
		expect(calculateReliableTps(10_001, timing())).toBeNull();
	});
});
