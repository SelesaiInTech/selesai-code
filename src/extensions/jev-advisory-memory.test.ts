/**
 * Jev's memory lane is deliberately narrow: an explicit durable-memory cue
 * chooses one local read-only scope, then Hermes performs that lookup.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ settingsPath: "" }));

vi.mock("@selesai/code", () => ({ getSettingsPath: () => state.settingsPath }));

import jevAdvisoryRoutingExtension, {
	activeProjectName,
	hasMemoryCue,
	MAX_MEMORY_QUERY_CHARS,
	MAX_MEMORY_RESULT_CHARS,
	memoryQuery,
} from "./jev-advisory-routing.ts";
const completeMock = vi.fn();

import {
	enabledAdvisoryRoutes,
	jevAnswers,
	jevResponse,
	makeHarness,
	makeRepo,
	sentPayload,
	writeJevSettings,
	type AdvisoryHarness,
} from "./jev/test-support.ts";

const MEMORY_SECRETS = ["SECRET_MEMORY_ENTRY", "SECRET_USER_ENTRY", "SECRET_STANDING_RULE"];
let root: string;
let agentDir: string;
let repo: string;

beforeAll(() => {
	const created = makeRepo("jev-memory-");
	root = created.root;
	repo = created.repo;
	agentDir = join(root, "agent");
	mkdirSync(agentDir, { recursive: true });
	state.settingsPath = join(agentDir, "settings.json");
	writeFileSync(join(agentDir, "MEMORY.md"), `- ${MEMORY_SECRETS[0]}\n`, "utf-8");
	writeFileSync(join(agentDir, "USER.md"), `- ${MEMORY_SECRETS[1]}\n`, "utf-8");
	writeFileSync(join(agentDir, "standing.md"), `- ${MEMORY_SECRETS[2]}\n`, "utf-8");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

type MemoryAnswer = { target: string; confidence?: number } | "malformed" | "rejected";

function harness(
	options: {
		branch?: unknown[];
		credential?: boolean;
		answer?: MemoryAnswer;
		memorySearch?: Parameters<typeof makeHarness>[0]["memorySearch"];
	} = {},
): AdvisoryHarness {
	writeJevSettings(state.settingsPath, { routes: enabledAdvisoryRoutes(["memory"]) });
	const session = makeHarness({
		settingsPath: state.settingsPath,
		extension: jevAdvisoryRoutingExtension,
		cwd: repo,
		branch: options.branch,
		credential: options.credential,
		complete: completeMock,
		memorySearch: options.memorySearch,
	});
	const answer = options.answer ?? { target: "project" };
	if (answer === "malformed") completeMock.mockResolvedValue(jevResponse("{ not json"));
	else if (answer === "rejected") completeMock.mockRejectedValue(new Error("network down"));
	else completeMock.mockResolvedValue(jevResponse(jevAnswers({ memory_target: { choice: answer.target, confidence: answer.confidence ?? 0.9 } })));
	return session;
}

beforeEach(() => vi.clearAllMocks());

describe("memory cues", () => {
	it("only classifies explicit references to durable context", () => {
		for (const prompt of ["use the convention we decided", "do it as before", "don't repeat the past failure", "what are my preferences?"]) {
			expect(hasMemoryCue(prompt), prompt).toBe(true);
		}
		for (const prompt of ["fix the login crash", "tell me a joke about databases", "what are we doing lately?"]) {
			expect(hasMemoryCue(prompt), prompt).toBe(false);
		}
	});

	it("does not call Jev or local memory for a normal coding request", async () => {
		const session = harness();
		await session.fire("session_start");
		expect(await session.advise("fix the login crash")).toBeUndefined();
		expect(completeMock).not.toHaveBeenCalled();
		expect(session.telemetry).toEqual([]);
	});
});

describe("local read-only lookup", () => {
	it("selects one scope, then injects the bounded local result", async () => {
		const calls: unknown[] = [];
		const session = harness({
			answer: { target: "project" },
			memorySearch: (input) => {
				calls.push(input);
				return { success: true, count: 1, output: "DEPLOYMENT_CONVENTION" };
			},
		});
		await session.fire("session_start");
		const message = await session.advise("use the deployment convention we decided");

		expect(calls).toEqual([{ query: "use the deployment convention we decided", target: "project", project: "repo", limit: 5 }]);
		expect(message?.content).toContain('<jev-memory source="local-memory-search" confidence="0.90">');
		expect(message?.content).toContain("DEPLOYMENT_CONVENTION");
		expect(message?.content).not.toContain("memory_search {");
		expect(session.telemetry.at(-1)).toMatchObject({ route: "memory", outcome: "jev", item: "project" });
	});

	it("does not inject an unavailable, empty, or failed local result", async () => {
		for (const result of [undefined, { success: true, count: 0 }, { success: false, message: "unavailable" }]) {
			const session = harness({ answer: { target: "project" }, memorySearch: () => result });
			await session.fire("session_start");
			expect(await session.advise("use the convention we decided"), String(result)).toBeUndefined();
			expect(session.telemetry.at(-1)).toMatchObject({ route: "memory", outcome: "fallback" });
		}
	});

	it("bounds long local entries before they reach the turn", async () => {
		const session = harness({ answer: { target: "memory" }, memorySearch: () => ({ success: true, output: "x".repeat(MAX_MEMORY_RESULT_CHARS + 100) }) });
		await session.fire("session_start");
		const message = await session.advise("what do you remember about our convention?");
		expect(message?.content).toContain(`${"x".repeat(MAX_MEMORY_RESULT_CHARS)}…`);
		expect(message?.content).not.toContain("x".repeat(MAX_MEMORY_RESULT_CHARS + 1));
	});
});

describe("abstention and privacy", () => {
	it("does not search for none, low confidence, malformed, rejected, or credential-less decisions", async () => {
		const cases: Array<[string, MemoryAnswer, boolean | undefined]> = [
			["none", { target: "none" }, undefined],
			["low confidence", { target: "project", confidence: 0.2 }, undefined],
			["malformed", "malformed", undefined],
			["rejected", "rejected", undefined],
			["no credential", { target: "project" }, false],
		];
		for (const [name, answer, credential] of cases) {
			const memorySearch = vi.fn(() => ({ success: true, output: "SHOULD_NOT_SEARCH" }));
			const session = harness({ answer, credential, memorySearch });
			await session.fire("session_start");
			expect(await session.advise("use the convention we decided"), name).toBeUndefined();
			expect(memorySearch, name).not.toHaveBeenCalled();
		}
	});

	it("sends Jev only the bounded current prompt, never history or memory contents", async () => {
		const branch = [
			{ type: "message", message: { role: "user", content: "OLDER_USER_TURN" } },
			{ type: "message", message: { role: "assistant", content: "ASSISTANT_NARRATION" } },
			{ type: "message", message: { role: "toolResult", content: "TOOL_OUTPUT" } },
		];
		const session = harness({ branch, memorySearch: () => ({ success: true, output: "LOCAL_MEMORY_RESULT" }) });
		await session.fire("session_start");
		await session.advise("what do you remember about our convention?");

		const request = JSON.stringify(sentPayload(completeMock));
		for (const forbidden of [...MEMORY_SECRETS, "OLDER_USER_TURN", "ASSISTANT_NARRATION", "TOOL_OUTPUT"]) {
			expect(request, forbidden).not.toContain(forbidden);
		}
		expect(sentPayload(completeMock)?.state).toEqual({
			conversation: [{ role: "user", text: "what do you remember about our convention?" }],
		});
	});
});

describe("query and project identity", () => {
	it("derives a bounded plain-text query", () => {
		expect(memoryQuery("  what   does\nthe release process look like? ")).toBe("what does the release process look like?");
		expect(memoryQuery("Fix this\n```ts\nconst a = 1;\n```\nplease")).toBe("Fix this please");
		expect(memoryQuery("word ".repeat(100))).toHaveLength(MAX_MEMORY_QUERY_CHARS);
	});

	it("uses the repository root name for project memory", () => {
		expect(activeProjectName(repo)).toBe("repo");
		const nested = join(repo, "src", "deep");
		mkdirSync(nested, { recursive: true });
		expect(activeProjectName(nested)).toBe("repo");
		expect(activeProjectName(homedir())).toBeUndefined();
	});
});
