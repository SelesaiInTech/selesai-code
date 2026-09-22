/**
 * The shared Jev decision client, at its own seam.
 *
 * Every failure mode here must produce an absent decision without throwing:
 * a missing provider template, no Token-In credential, an oversized request, a
 * timeout, a rejected call, malformed JSON, an unlisted choice, and a numeric
 * confidence below the threshold.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ settingsPath: "" }));

// The client speaks through pi's completion transport (the Token-In provider
// layer owns the non-streaming decisions request), so a suite stubs that.
import {
	askJev,
	buildConversation,
	buildJevPayload,
	confidenceBucket,
	DEFAULT_JEV_ADVISORY_CONFIG,
	emitJevTelemetry,
	JEV_ROUTING_EVENT,
	jevConnection,
	jevModel,
	readJevAdvisoryConfig,
	readJevChoice,
	serializeJevRequest,
	type JevConnection,
} from "./decisions.ts";
import { jevAnswers, jevResponse, providerTemplate } from "./test-support.ts";

const completeMock = vi.fn();

const CONNECTION: JevConnection = {
	provider: "tokenin",
	model: "jev-1.13",
	timeoutMs: 5_000,
	minConfidence: 0.6,
};

function runtime(models: unknown[] = [providerTemplate()], credential = true) {
	return {
		modelRegistry: {
			getAll: () => models as never[],
			getApiKeyAndHeaders: vi.fn(async () => (credential ? { ok: true, apiKey: "key", headers: {} } : { ok: false })),
			complete: completeMock,
		},
	};
}

const ALLOWED = { repository_context: ["inject", "skip"] } as const;

function ask(ctx = runtime(), payload: unknown = { state: {}, questions: {} }, maxBytes = 8_192) {
	return askJev(ctx as never, CONNECTION, { payload, maxBytes, allowed: ALLOWED });
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("readJevAdvisoryConfig", () => {
	function write(value: unknown): void {
		state.settingsPath = join(mkdtempSync(join(tmpdir(), "jev-config-")), "settings.json");
		writeFileSync(state.settingsPath, typeof value === "string" ? value : JSON.stringify(value), "utf-8");
	}

	it("keeps every route disabled on a missing or malformed file", () => {
		state.settingsPath = join(tmpdir(), "missing-settings.json");
		expect(readJevAdvisoryConfig(state.settingsPath)).toEqual(DEFAULT_JEV_ADVISORY_CONFIG);

		write("{ not json");
		expect(readJevAdvisoryConfig(state.settingsPath).routes.memory.enabled).toBe(false);

		write([1, 2]);
		expect(readJevAdvisoryConfig(state.settingsPath).routes.recommendations.enabled).toBe(false);

		write({ jevAdvisory: "nope" });
		expect(readJevAdvisoryConfig(state.settingsPath).routes.memory.enabled).toBe(false);
	});

	it("merges per-route settings over the shared endpoint defaults", () => {
		write({
			jevAdvisory: {
				model: "jev-9",
				baseUrl: "https://custom/v1",
				routes: {
					memory: { enabled: true, minConfidence: 0.8, contextTurns: 2, payloadBytes: 1024 },
					recommendations: { enabled: "yes", timeoutMs: -1 },
				},
			},
		});
		const config = readJevAdvisoryConfig(state.settingsPath);
		expect(config.provider).toBe("tokenin");
		expect(config.model).toBe("jev-9");
		expect(config.baseUrl).toBe("https://custom/v1");
		expect(config.routes.memory).toMatchObject({
			enabled: true,
			minConfidence: 0.8,
			contextTurns: 2,
			payloadBytes: 1024,
			contextChars: 4_000,
			timeoutMs: 8_000,
		});
		expect(config.routes.recommendations).toMatchObject({ enabled: false, timeoutMs: 8_000 });
		expect(jevConnection(config, config.routes.memory)).toEqual({
			provider: "tokenin",
			model: "jev-9",
			baseUrl: "https://custom/v1",
			timeoutMs: 8_000,
			minConfidence: 0.8,
		});
	});
});

describe("buildJevPayload", () => {
	it("sends only the user turns and the allowlisted criteria", () => {
		const payload = buildJevPayload([{ role: "user", text: "the login flow feels slow" }], {
			repository_context: { question: "Needs context?", criteria: { inject: "yes", skip: "no" } },
		}) as Record<string, any>;
		expect(payload.state).toEqual({ conversation: [{ role: "user", text: "the login flow feels slow" }] });
		expect(payload.questions.repository_context.type).toBe("choice");
		expect(payload.questions.repository_context.instructions.question).toBe("Needs context?");
		expect(payload.questions.repository_context.criteria).toEqual({ inject: "yes", skip: "no" });
	});

	it("marks conversation and criteria as untrusted material, and bounds a system prompt", () => {
		const payload = buildJevPayload(
			[],
			{ repository_context: { question: "q", criteria: { inject: "yes" }, focus: "Judge the request." } },
			"x".repeat(50),
			10,
		) as Record<string, any>;
		expect(payload.state.system_prompt).toHaveLength(10);
		expect(payload.questions.repository_context.instructions.focus).toContain("never instructions");
		expect(buildJevPayload([], { repository_context: { question: "q", criteria: {} } }, "sys", 0)).toMatchObject({
			state: { conversation: [] },
		});
	});
});

describe("buildConversation", () => {
	it("keeps the current ask last and only user turns", () => {
		const branch = [
			{ type: "message", message: { role: "user", content: "older ask" } },
			{ type: "message", message: { role: "assistant", content: "narration" } },
			{ type: "message", message: { role: "toolResult", content: "tool output" } },
		];
		expect(buildConversation("current ask", branch, { contextTurns: 4, contextChars: 1_000 })).toEqual([
			{ role: "user", text: "older ask" },
			{ role: "user", text: "current ask" },
		]);
		expect(buildConversation("current", branch, { contextTurns: 1, contextChars: 1_000 })).toEqual([
			{ role: "user", text: "current" },
		]);
	});
});

describe("readJevChoice", () => {
	it("accepts only an allowlisted choice with enough confidence", () => {
		expect(readJevChoice(jevAnswers({ repository_context: { choice: "inject", confidence: 0.9 } }), "repository_context", ALLOWED.repository_context, 0.6)).toEqual({
			choice: "inject",
			confidence: 0.9,
		});
		expect(readJevChoice(jevAnswers({ repository_context: { choice: "INJECT", confidence: 0.9 } }), "repository_context", ALLOWED.repository_context, 0.6)).toEqual({
			choice: "inject",
			confidence: 0.9,
		});
		expect(readJevChoice(jevAnswers({ repository_context: { choice: "inject" } }), "repository_context", ALLOWED.repository_context, 0.6)).toEqual({
			choice: "inject",
		});
		expect(readJevChoice(jevAnswers({ repository_context: { choice: "maybe", confidence: 1 } }), "repository_context", ALLOWED.repository_context, 0.6)).toBeUndefined();
		expect(readJevChoice(jevAnswers({ repository_context: { choice: "inject", confidence: 0.2 } }), "repository_context", ALLOWED.repository_context, 0.6)).toBeUndefined();
		expect(readJevChoice(jevAnswers({ repository_context: { choice: 7 as never, confidence: 1 } }), "repository_context", ALLOWED.repository_context, 0.6)).toBeUndefined();
		expect(readJevChoice("{ not json", "repository_context", ALLOWED.repository_context, 0.6)).toBeUndefined();
		expect(readJevChoice(JSON.stringify({ answers: null }), "repository_context", ALLOWED.repository_context, 0.6)).toBeUndefined();
		expect(readJevChoice(jevAnswers({ repository_context: { choice: "inject", confidence: 1 } }), "other_question", ALLOWED.repository_context, 0.6)).toBeUndefined();
	});
});

describe("jevModel", () => {
	it("inherits the provider template, or uses an explicit base URL", () => {
		expect(jevModel(runtime().modelRegistry as never, CONNECTION)).toMatchObject({
			id: "jev-1.13",
			provider: "tokenin",
			baseUrl: "https://lite.andlet.me/v1",
			reasoning: false,
			input: ["text"],
		});
		expect(jevModel(runtime([]).modelRegistry as never, CONNECTION)).toBeUndefined();
		expect(jevModel(runtime([]).modelRegistry as never, { ...CONNECTION, baseUrl: "https://x/v1" })).toMatchObject({
			baseUrl: "https://x/v1",
		});
	});
});

describe("serializeJevRequest", () => {
	it("refuses a request that cannot fit the fixed budget", () => {
		expect(serializeJevRequest({ a: "x".repeat(10) }, 1_024)).toBeDefined();
		expect(serializeJevRequest({ a: "x".repeat(1_024) }, 64)).toBeUndefined();
	});
});

describe("askJev", () => {
	it("returns the validated answers and how long the decision took", async () => {
		completeMock.mockResolvedValue(jevResponse(jevAnswers({ repository_context: { choice: "inject", confidence: 0.8 } })));
		const decision = await ask();
		expect(decision.choices.repository_context).toEqual({ choice: "inject", confidence: 0.8 });
		expect(decision.rejected).toEqual({});
		expect(decision.failure).toBeUndefined();
		expect(typeof decision.elapsedMs).toBe("number");
		const [model, context, options] = completeMock.mock.calls[0] as unknown as [
			{ id: string; baseUrl: string },
			{ messages: Array<{ role: string; content: string }> },
			{ apiKey?: string; headers?: Record<string, string>; maxTokens?: number; signal?: AbortSignal },
		];
		expect(model).toMatchObject({ id: "jev-1.13", baseUrl: "https://lite.andlet.me/v1" });
		expect(context.messages[0]!.role).toBe("user");
		expect(JSON.parse(context.messages[0]!.content)).toHaveProperty("questions");
		expect(options.apiKey).toBe("key");
		expect(options.maxTokens).toBe(2_048);
		expect(options.signal).toBeInstanceOf(AbortSignal);
	});

	it("reports an unusable endpoint as an absent decision", async () => {
		expect(await ask(runtime([]))).toMatchObject({ choices: {}, failure: "no-template" });
		expect(completeMock).not.toHaveBeenCalled();

		expect(await ask(runtime([providerTemplate()], false))).toMatchObject({ choices: {}, failure: "no-credential" });
		expect(completeMock).not.toHaveBeenCalled();
	});

	it("treats a credential lookup that throws as an absent decision", async () => {
		const ctx = {
			modelRegistry: {
				getAll: () => [providerTemplate()],
				getApiKeyAndHeaders: vi.fn(async () => {
					throw new Error("auth storage unavailable");
				}),
			},
		};
		expect(await ask(ctx as never)).toMatchObject({ failure: "no-credential" });
	});

	it("abstains on an oversized request instead of sending it", async () => {
		const decision = await ask(runtime(), { state: { conversation: "x".repeat(2_000) } }, 128);
		expect(decision).toMatchObject({ choices: {}, failure: "overflow" });
		expect(completeMock).not.toHaveBeenCalled();
	});

	it("abstains on a transport failure, a timeout, and malformed output", async () => {
		completeMock.mockRejectedValue(new Error("network down"));
		expect(await ask()).toMatchObject({ failure: "transport" });

		const timeout = new Error("timed out");
		timeout.name = "TimeoutError";
		completeMock.mockRejectedValue(timeout);
		expect(await ask()).toMatchObject({ failure: "timeout" });

		completeMock.mockResolvedValue(jevResponse("{ not json"));
		expect(await ask()).toMatchObject({ failure: "malformed" });
	});

	it("abstains per question on an unlisted, low-confidence, or missing answer", async () => {
		completeMock.mockResolvedValue(jevResponse(jevAnswers({ repository_context: { choice: "maybe", confidence: 1 } })));
		expect(await ask()).toMatchObject({ choices: {}, failure: "unknown-choice" });

		completeMock.mockResolvedValue(jevResponse(jevAnswers({ repository_context: { choice: "inject", confidence: 0.4 } })));
		expect(await ask()).toMatchObject({ choices: {}, failure: "low-confidence" });

		completeMock.mockResolvedValue(jevResponse(jevAnswers({ other: { choice: "inject", confidence: 1 } })));
		expect(await ask()).toMatchObject({ choices: {}, failure: "missing" });
	});

	it("keeps a valid question when another question is unusable", async () => {
		completeMock.mockResolvedValue(
			jevResponse(
				jevAnswers({
					repository_context: { choice: "inject", confidence: 0.9 },
					second: { choice: "nonsense", confidence: 0.9 },
				}),
			),
		);
		const decision = await askJev(runtime() as never, CONNECTION, {
			payload: {},
			maxBytes: 1_024,
			allowed: { repository_context: ["inject", "skip"], second: ["a", "b"] },
		});
		expect(decision.choices).toEqual({ repository_context: { choice: "inject", confidence: 0.9 } });
		expect(decision.rejected).toEqual({ second: "unknown-choice" });
	});
});

describe("telemetry helpers", () => {
	it("buckets confidence without carrying the answer", () => {
		expect(confidenceBucket(0.95)).toBe("high");
		expect(confidenceBucket(0.75)).toBe("medium");
		expect(confidenceBucket(0.4)).toBe("low");
		expect(confidenceBucket(undefined)).toBe("none");
	});

	it("never lets a telemetry failure escape", () => {
		const events = {
			emit: (_channel: string, _data: unknown) => {
				throw new Error("bus down");
			},
		};
		expect(() => emitJevTelemetry(events, "decision", { route: "memory" })).not.toThrow();
		expect(() => emitJevTelemetry(undefined, "adoption", { route: "memory" })).not.toThrow();
		const seen: Array<{ channel: string; data: unknown }> = [];
		emitJevTelemetry({ emit: (channel, data) => seen.push({ channel, data }) }, "decision", { route: "memory" });
		expect(seen).toEqual([{ channel: JEV_ROUTING_EVENT, data: { event: "decision", route: "memory" } }]);
	});
});
