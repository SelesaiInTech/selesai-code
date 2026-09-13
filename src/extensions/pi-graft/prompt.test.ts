import { describe, expect, it } from "vitest";
import type { AskPayload } from "./cli.ts";
import {
	buildInjectionPack,
	classifyTask,
	createInjectionGuard,
	describeStrategy,
	injectionBudget,
	injectionMessage,
	MAX_QUERY_CHARS,
	planInjection,
	retrievalQuery,
} from "./prompt.ts";
import { DEFAULT_MIN_COVERAGE, type GraftState } from "./state.ts";

const FRESH: GraftState = { name: "fresh-structural", version: "0.18.0" };

function payload(overrides: Partial<AskPayload> = {}): AskPayload {
	return {
		hits: [
			{
				kind: "symbol",
				title: "verify · function",
				pointer: "src/auth.ts:L10-L20",
				snippet: "checks the token",
				code: "export function verify() {}",
			},
		],
		mode: "lexical",
		...overrides,
	};
}

describe("classifyTask", () => {
	it("recognizes the repository work that warrants context", () => {
		const coding = [
			"Fix the login crash when the token is expired",
			"Refactor the retry logic in the HTTP client",
			"Add a migration for the new column",
			"Review this diff before I merge it",
			"Why does `parseRequest` throw on empty input?",
			"Update the build to include the new package",
			"Write tests for src/core/exec.ts",
			"Verify the release changes before deployment",
			"Check implementations of subagent: is it compatible with Graft?",
			"debug the flaky retryIntervals helper",
		];
		for (const prompt of coding) expect(classifyTask(prompt), prompt).toBe("coding");
	});

	it("leaves conversation, meta questions and commands alone", () => {
		const other = [
			"hi",
			"Thanks!",
			"what can you do",
			"/graft doctor",
			"   ",
			"Tell me a joke about databases",
		];
		for (const prompt of other) expect(classifyTask(prompt), prompt).toBe("other");
	});

	it("treats an explicit path or identifier as a task even without an action verb", () => {
		expect(classifyTask("src/extensions/pi-graft/index.ts")).toBe("coding");
		expect(classifyTask("What does buildGraphIfMissing return?")).toBe("coding");
	});
});

describe("retrievalQuery", () => {
	it("strips fenced code so a pasted snippet does not become the query", () => {
		expect(retrievalQuery("Fix this\n```ts\nconst a = 1;\n```\nplease")).toBe("Fix this please");
	});

	it("collapses whitespace and bounds the length", () => {
		expect(retrievalQuery("  a\n\n  b  ")).toBe("a b");
		const long = retrievalQuery("word ".repeat(1000));
		expect(long.length).toBe(MAX_QUERY_CHARS + 1);
		expect(long.endsWith("…")).toBe(true);
	});
});

describe("planInjection", () => {
	const eligible = { mode: "push" as const, prompt: "Fix the login crash", state: FRESH, enabled: true };

	it("injects nothing in pull mode, whatever the prompt", () => {
		const plan = planInjection({ ...eligible, mode: "pull" });
		expect(plan.inject).toBe(false);
		expect(plan.reason).toContain("pull");
	});

	it("injects one bounded pack for an eligible repository task", () => {
		expect(planInjection(eligible)).toEqual({
			inject: true,
			mode: "push",
			query: "Fix the login crash",
			reason: "eligible repository task",
		});
	});

	it("skips prompts that are not repository work, so no latency is paid for chat", () => {
		expect(planInjection({ ...eligible, prompt: "hey there" }).inject).toBe(false);
		expect(planInjection({ ...eligible, prompt: "  " }).inject).toBe(false);
	});

	it("skips turns where Graft cannot answer", () => {
		for (const state of [{ name: "unbuilt" }, { name: "unavailable" }, { name: "unsupported" }] as GraftState[]) {
			const plan = planInjection({ ...eligible, state });
			expect(plan.inject, state.name).toBe(false);
			expect(plan.reason).toContain(state.name);
		}
	});

	it("still injects for a graph marked changed, because Graft refreshes on query", () => {
		expect(planInjection({ ...eligible, state: { name: "changed" } }).inject).toBe(true);
	});

	it("injects nothing when the extension is disabled", () => {
		expect(planInjection({ ...eligible, enabled: false }).inject).toBe(false);
	});
});

describe("injectionBudget", () => {
	it("lets push spend the configured budget and keeps hybrid to a small orientation pack", () => {
		expect(injectionBudget("push", 12_000)).toEqual({ limit: 8, maxBytes: 12_000 });
		expect(injectionBudget("hybrid", 12_000)).toEqual({ limit: 3, maxBytes: 6 * 1024 });
		expect(injectionBudget("hybrid", 2_000)).toEqual({ limit: 3, maxBytes: 2_000 });
	});
});

describe("buildInjectionPack", () => {
	it("refuses an empty result rather than injecting an empty block", () => {
		expect(buildInjectionPack(payload({ hits: [] }), { maxBytes: 4096 })).toBeUndefined();
	});

	it("refuses a pack whose terms barely overlap the graph", () => {
		expect(buildInjectionPack(payload({ coverage: 0.05 }), { maxBytes: 4096 })).toBeUndefined();
		expect(buildInjectionPack(payload({ coverage: DEFAULT_MIN_COVERAGE }), { maxBytes: 4096 })).toBeDefined();
	});

	it("accepts a pack when the CLI reported no coverage at all", () => {
		expect(buildInjectionPack(payload(), { maxBytes: 4096 })).toBeDefined();
	});

	it("bounds the pack and records its references and truncation", () => {
		const pack = buildInjectionPack(
			payload({
				hits: [
					{
						kind: "symbol",
						title: "big",
						pointer: "src/big.ts:L1-L2",
						snippet: "",
						code: "x".repeat(100_000),
					},
				],
				coverage: 0.9,
			}),
			{ maxBytes: 2_000, minCoverage: 0.25 },
		)!;
		expect(pack.truncated).toBe(true);
		expect(pack.bytes).toBeLessThanOrEqual(2_000 + 200);
		expect(pack.references).toEqual([{ path: "src/big.ts", span: "L1-L2" }]);
		expect(pack.coverage).toBe(0.9);
	});
});

describe("injectionMessage", () => {
	it("declares its source, its mode, the graph quality, and that source files win", () => {
		const pack = buildInjectionPack(payload({ coverage: 0.9 }), { maxBytes: 4096 })!;
		const message = injectionMessage({ pack, mode: "hybrid", state: "fresh-structural" });
		expect(message).toContain('<graft-context source="graft" mode="hybrid" graph="fresh-structural" references="1">');
		expect(message).toContain("derived summary");
		expect(message).toContain("authoritative");
		expect(message).toContain("src/auth.ts:L10-L20");
		expect(message).toContain("</graft-context>");
	});

	it("says a deep graph is deep, so the reader knows the provenance", () => {
		const pack = buildInjectionPack(payload(), { maxBytes: 4096 })!;
		expect(injectionMessage({ pack, mode: "push", state: "fresh-deep" })).toContain('graph="fresh-deep"');
	});
});

describe("createInjectionGuard", () => {
	it("injects at most once per turn even if the hook runs again", () => {
		const guard = createInjectionGuard();
		expect(guard.shouldInject()).toBe(true);
		guard.markInjected();
		expect(guard.shouldInject()).toBe(false);
		guard.markInjected();
		expect(guard.shouldInject()).toBe(false);
	});

	it("allows a new injection once the next turn begins", () => {
		const guard = createInjectionGuard();
		guard.markInjected();
		guard.beginTurn();
		expect(guard.shouldInject()).toBe(true);
	});
});

describe("describeStrategy", () => {
	it("explains each mode in the user's terms", () => {
		expect(describeStrategy("pull")).toContain("nothing is injected");
		expect(describeStrategy("push")).toContain("source-backed");
		expect(describeStrategy("hybrid")).toContain("orientation");
	});

	it("never claims injection happens in pull mode", () => {
		expect(describeStrategy("pull")).not.toContain("starts from");
		expect(describeStrategy("push")).not.toContain("nothing is injected");
	});
});
