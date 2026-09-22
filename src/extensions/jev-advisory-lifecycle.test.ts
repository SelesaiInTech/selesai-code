/**
 * Input lifecycle, idempotency, and telemetry for the advisory routes.
 *
 * Only idle, top-level, interactive user input is eligible: extension-injected
 * turns, slash commands, queued steering/follow-up input, and empty input never
 * reach Jev. One eligible input produces at most one advisory, however many
 * times the hook is re-entered, and telemetry never carries content or breaks a
 * turn.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ settingsPath: "" }));

vi.mock("@selesai/code", () => ({ getSettingsPath: () => state.settingsPath }));
// The client speaks through pi's completion transport (the Token-In provider
// layer owns the non-streaming decisions request), so a suite stubs that.
import jevAdvisoryRoutingExtension from "./jev-advisory-routing.ts";
import { JEV_ROUTING_EVENT } from "./jev/decisions.ts";
import {
	enabledAdvisoryRoutes,
	jevAnswers,
	jevResponse,
	makeHarness,
	makeRepo,
	writeJevSettings,
	type SkillStub,
} from "./jev/test-support.ts";

const completeMock = vi.fn();



let root: string;
let repo: string;
const skills: SkillStub[] = [{ name: "implanger", description: "Plan a UI change.", filePath: "/tmp/SKILL.md" }];

beforeAll(() => {
	const created = makeRepo("jev-lifecycle-");
	root = created.root;
	repo = created.repo;
	state.settingsPath = join(root, "agent", "settings.json");
	mkdirSync(join(root, "agent"), { recursive: true });
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

/** One answer envelope carrying a decision for every route's questions. */
function answerEverything(): void {
	completeMock.mockResolvedValue(
		jevResponse(
			jevAnswers({
				memory_target: { choice: "project", confidence: 0.9 },
				memory_category: { choice: "convention", confidence: 0.9 },
				recommendation: { choice: "skill:implanger", confidence: 0.8 },
				verification: { choice: "targeted", confidence: 0.9 },
			}),
		),
	);
}

function harness(advisory: unknown = { routes: enabledAdvisoryRoutes() }) {
	writeJevSettings(state.settingsPath, advisory);
	return makeHarness({
		settingsPath: state.settingsPath,
		extension: jevAdvisoryRoutingExtension,
		cwd: repo,
		skills,
		complete: completeMock,
	});
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("enablement", () => {
	it("does nothing at all while the routes stay disabled", async () => {
		const session = harness({});
		await session.fire("session_start");
		expect(await session.advise("what conventions does this project follow?")).toBeUndefined();
		expect(completeMock).not.toHaveBeenCalled();
		expect(session.telemetry).toEqual([]);
	});

	it("combines every accepted route into one advisory message", async () => {
		answerEverything();
		const session = harness();
		await session.fire("session_start");
		const message = await session.advise("what conventions does this project follow?");
		expect(message?.content).toContain('<jev-memory source="local-memory-search"');
		expect(message?.content).toContain('route="recommendation"');
		expect(message?.details).toEqual({
			routes: [
				{ route: "memory", item: "project" },
				{ route: "recommendations", item: "skill:implanger" },
			],
		});
		expect(completeMock).toHaveBeenCalledTimes(2);
	});
});

describe("eligibility", () => {
	it("ignores extension-injected, queued, command, and empty input", async () => {
		answerEverything();
		const session = harness();
		await session.fire("session_start");

		expect(await session.advise("do the thing", { source: "extension" })).toBeUndefined();
		expect(await session.advise("do the thing", { streamingBehavior: "steer" })).toBeUndefined();
		expect(await session.advise("do the thing", { streamingBehavior: "followUp" })).toBeUndefined();
		expect(await session.advise("/implement")).toBeUndefined();
		expect(await session.advise("   ")).toBeUndefined();
		expect(completeMock).not.toHaveBeenCalled();
		expect(session.telemetry).toEqual([]);
	});

	it("ignores a turn with no eligible input before it", async () => {
		answerEverything();
		const session = harness();
		await session.fire("session_start");
		const result = await session.fire("before_agent_start", {
			type: "before_agent_start",
			prompt: "an extension-injected turn",
		});
		expect(result).toBeUndefined();
		expect(completeMock).not.toHaveBeenCalled();
	});

	it("forgets an eligible window a later input invalidates", async () => {
		answerEverything();
		const session = harness();
		await session.fire("session_start");
		await session.fire("input", { type: "input", text: "do the thing", source: "interactive" });
		await session.fire("input", { type: "input", text: "/model", source: "interactive" });
		const result = await session.fire("before_agent_start", { type: "before_agent_start", prompt: "/model" });
		expect(result).toBeUndefined();
		expect(completeMock).not.toHaveBeenCalled();
	});
});

describe("idempotency", () => {
	it("recommends once per turn, however often the hook is re-entered", async () => {
		answerEverything();
		const session = harness();
		await session.fire("session_start");
		const message = await session.advise("what conventions does this project follow?");
		expect(message).toBeDefined();
		expect(await session.replay("what conventions does this project follow?")).toBeUndefined();
		expect(await session.replay("what conventions does this project follow?")).toBeUndefined();
		expect(completeMock).toHaveBeenCalledTimes(2);
	});

	it("recommends again on the next prompt", async () => {
		answerEverything();
		const session = harness();
		await session.fire("session_start");
		expect(await session.advise("what conventions does this project follow?")).toBeDefined();
		expect(await session.advise("and what else?")).toBeDefined();
		expect(completeMock).toHaveBeenCalledTimes(3);
	});

	it("publishes nothing after the session shuts down", async () => {
		answerEverything();
		const session = harness();
		await session.fire("session_start");
		await session.fire("session_shutdown", { type: "session_shutdown", reason: "quit" });
		await session.fire("input", { type: "input", text: "still there?", source: "interactive" });
		expect(await session.replay("still there?")).toBeUndefined();
	});
});

describe("telemetry", () => {
	it("reports decisions, abstentions, and adoption without any content", async () => {
		answerEverything();
		const session = harness();
		await session.fire("session_start");
		await session.advise("what conventions does this project follow?");
		await session.fire("agent_settled");

		const [memory, recommendations, ...adoption] = session.telemetry;
		expect(memory).toMatchObject({ event: "decision", route: "memory", outcome: "jev", item: "project", confidence: "high" });
		expect(recommendations).toMatchObject({ event: "decision", route: "recommendations", outcome: "jev" });
		expect(typeof memory.elapsedMs).toBe("number");
		expect(adoption).toEqual([{ event: "adoption", route: "recommendations", item: "skill:implanger", adopted: false }]);

		const serialized = JSON.stringify(session.telemetry);
		expect(serialized).not.toContain("conventions");
		expect(serialized).not.toContain("Plan a UI change");
		expect(serialized).not.toContain("answers");
	});

	it("keeps routing when telemetry itself fails", async () => {
		answerEverything();
		const session = harness();
		await session.fire("session_start");
		// A subscriber that throws must not change what the parent receives.
		(session.pi.events as { on(channel: string, handler: () => void): void }).on(JEV_ROUTING_EVENT, () => {
			throw new Error("telemetry sink down");
		});
		const message = await session.advise("what conventions does this project follow?");
		expect(message?.content).toContain("LOCAL_MEMORY_RESULT");
	});
});
