import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@selesai/code";

const state = vi.hoisted(() => ({ settingsPath: "" }));

vi.mock("@selesai/code", () => ({
	getSettingsPath: () => state.settingsPath,
}));

vi.mock("@earendil-works/pi-ai/compat", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-ai/compat")>();
	return { ...actual, complete: vi.fn() };
});

import { complete } from "@earendil-works/pi-ai/compat";
import autoModelExtension, {
	buildConversation,
	buildJevPayload,
	classifierModel,
	classifyTier,
	DEFAULT_AUTO_MODEL_CONFIG,
	parseModelRef,
	readAutoModelConfig,
	TIERS,
	tierFromJevResponse,
	type AutoModelConfig,
} from "./auto-model.ts";

const completeMock = vi.mocked(complete);

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

function templateModel(provider = "tokenin", id = "celestial-pro") {
	return {
		provider,
		id,
		name: id,
		api: "openai-completions",
		baseUrl: "https://lite.andlet.me/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 393216,
		maxTokens: 64000,
	};
}

function userEntry(text: string, id = "u1", content?: unknown): SessionEntry {
	return {
		id,
		type: "message",
		message: { role: "user", content: content ?? [{ type: "text", text }], timestamp: 1 },
		parentId: "root",
		timestamp: "2025-01-01T00:00:00.000Z",
	} as unknown as SessionEntry;
}

function assistantEntry(text: string, id = "a1"): SessionEntry {
	return {
		id,
		type: "message",
		message: { role: "assistant", content: [{ type: "text", text }], timestamp: 1 },
		parentId: "root",
		timestamp: "2025-01-01T00:00:00.000Z",
	} as unknown as SessionEntry;
}

function createHarness(branch: SessionEntry[] = [], scopedModels: unknown[] = []) {
	const handlers = new Map<string, Handler>();
	const setModel = vi.fn().mockResolvedValue(true);
	const setThinkingLevel = vi.fn();
	const pi = {
		on: vi.fn((event: string, handler: Handler) => handlers.set(event, handler)),
		setModel,
		setThinkingLevel,
	} as unknown as ExtensionAPI;
	const target = templateModel();
	const known = new Set(["celestial-pro", "celestial-max", "celestial-ultra", "deepseek-v4.1-flash"]);
	const ctx = {
		modelRegistry: {
			getAll: () => [templateModel()],
			find: vi.fn((provider: string, id: string) =>
				provider === "tokenin" && known.has(id) ? { ...target, id } : undefined,
			),
			getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true, apiKey: "key", headers: {} }),
		},
		sessionManager: { getBranch: () => branch },
		scopedModels,
		getSystemPrompt: () => "system prompt",
	} as unknown as ExtensionContext;
	autoModelExtension(pi);
	return { handlers, ctx, setModel, setThinkingLevel };
}

function writeSettings(value: unknown): void {
	writeFileSync(state.settingsPath, typeof value === "string" ? value : JSON.stringify(value), "utf-8");
}

function jevAnswer(choice: unknown, confidence?: unknown): string {
	return JSON.stringify({ answers: { complexity: { choice, confidence } } });
}

function textResponse(text: string) {
	return { content: [{ type: "text", text }], stopReason: "stop" } as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	state.settingsPath = join(mkdtempSync(join(tmpdir(), "auto-model-")), "settings.json");
	writeSettings({ autoModel: { enabled: true } });
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("readAutoModelConfig", () => {
	it("falls back to the disabled defaults on a missing or malformed file", () => {
		expect(readAutoModelConfig(join(tmpdir(), "auto-model-does-not-exist", "settings.json"))).toEqual(
			DEFAULT_AUTO_MODEL_CONFIG,
		);

		writeSettings("{ not json");
		expect(readAutoModelConfig()).toEqual(DEFAULT_AUTO_MODEL_CONFIG);

		writeSettings([1, 2, 3]);
		expect(readAutoModelConfig()).toEqual(DEFAULT_AUTO_MODEL_CONFIG);

		writeSettings({ autoModel: "nope" });
		expect(readAutoModelConfig()).toEqual(DEFAULT_AUTO_MODEL_CONFIG);
	});

	it("merges partial config over the defaults and honors a valid fallback tier", () => {
		writeSettings({
			autoModel: {
				enabled: true,
				classifier: {
					model: "jev-9",
					baseUrl: "https://custom/v1",
					timeoutMs: 1,
					minConfidence: 0.2,
					contextTurns: 2,
					contextChars: "bad",
				},
				tiers: { simple: "tokenin/x" },
				fallbackTier: "reasoning",
			},
		});
		const config = readAutoModelConfig();
		expect(config.enabled).toBe(true);
		expect(config.classifier).toEqual({
			provider: "tokenin",
			model: "jev-9",
			baseUrl: "https://custom/v1",
			timeoutMs: 1,
			minConfidence: 0.2,
			contextTurns: 2,
			contextChars: DEFAULT_AUTO_MODEL_CONFIG.classifier.contextChars,
		});
		expect(config.tiers).toEqual({ ...DEFAULT_AUTO_MODEL_CONFIG.tiers, simple: "tokenin/x" });
		expect(config.fallbackTier).toBe("reasoning");
	});

	it("rejects bad field types and an unknown fallback tier", () => {
		writeSettings({
			autoModel: {
				enabled: "yes",
				classifier: { provider: 1, model: "", baseUrl: "", timeoutMs: -1, minConfidence: "x", contextTurns: 0, contextChars: 0 },
				tiers: { nonTier: "ignored" },
				fallbackTier: "nonsense",
			},
		});
		const config = readAutoModelConfig();
		expect(config.enabled).toBe(false);
		expect(config.classifier.provider).toBe("tokenin");
		expect(config.classifier.baseUrl).toBeUndefined();
		expect(config.fallbackTier).toBe("medium");
		expect(config.tiers).toEqual(DEFAULT_AUTO_MODEL_CONFIG.tiers);
	});
});

describe("buildJevPayload", () => {
	it("puts the turns in state and the four tiers in the choice question", () => {
		const payload = buildJevPayload([{ role: "user", text: "hi" }], "  be terse  ", 100) as any;
		expect(payload.state).toEqual({ conversation: [{ role: "user", text: "hi" }], system_prompt: "be terse" });
		expect(Object.keys(payload.questions.complexity.criteria)).toEqual(["SIMPLE", "MEDIUM", "COMPLEX", "REASONING"]);
		expect(payload.questions.complexity.type).toBe("choice");
	});

	it("omits an empty or missing system prompt and caps a long one", () => {
		expect((buildJevPayload([], undefined, 10) as any).state.system_prompt).toBeUndefined();
		expect((buildJevPayload([], "   ", 10) as any).state.system_prompt).toBeUndefined();
		expect((buildJevPayload([], "x".repeat(50), 10) as any).state.system_prompt).toHaveLength(10);
	});
});

describe("tierFromJevResponse", () => {
	it("reads the chosen tier and rejects unusable or unsure answers", () => {
		expect(tierFromJevResponse(jevAnswer("COMPLEX", 0.9), 0.5)).toBe("complex");
		expect(tierFromJevResponse(jevAnswer("simple"), 0.5)).toBe("simple");
		expect(tierFromJevResponse(jevAnswer("REASONING", 0.5), 0.5)).toBe("reasoning");
		expect(tierFromJevResponse(jevAnswer("MEDIUM", 0.4), 0.5)).toBeUndefined();
		expect(tierFromJevResponse(jevAnswer("MEDIUM", "high"), 0.5)).toBe("medium");
		expect(tierFromJevResponse(jevAnswer("UNKNOWN", 0.9), 0.5)).toBeUndefined();
		expect(tierFromJevResponse(jevAnswer(7, 0.9), 0.5)).toBeUndefined();
		expect(tierFromJevResponse("{ bad", 0.5)).toBeUndefined();
		expect(tierFromJevResponse(JSON.stringify({ answers: null }), 0.5)).toBeUndefined();
		expect(tierFromJevResponse(JSON.stringify({ answers: { complexity: 1 } }), 0.5)).toBeUndefined();
		expect(tierFromJevResponse("42", 0.5)).toBeUndefined();
	});
});

describe("parseModelRef", () => {
	it("splits provider, id, and an optional thinking level", () => {
		expect(parseModelRef("tokenin/celestial-max")).toEqual({ provider: "tokenin", id: "celestial-max" });
		expect(parseModelRef("tokenin/celestial-max:max")).toEqual({
			provider: "tokenin",
			id: "celestial-max",
			thinking: "max",
		});
		expect(parseModelRef("no-slash")).toBeUndefined();
		expect(parseModelRef("/leading")).toBeUndefined();
		expect(parseModelRef("trailing/")).toBeUndefined();
		expect(parseModelRef("tokenin/:max")).toEqual({ provider: "tokenin", id: ":max" });
	});
});

describe("buildConversation", () => {
	it("keeps the current ask last and pulls prior user turns under the budget", () => {
		const branch = [
			userEntry("oldest", "u1"),
			assistantEntry("ignored narration"),
			{ id: "x", type: "model_change" } as unknown as SessionEntry,
			userEntry("previous", "u2"),
		];
		const turns = buildConversation("current", branch, { contextTurns: 4, contextChars: 1000 });
		expect(turns.map((t) => t.text)).toEqual(["oldest", "previous", "current"]);
	});

	it("drops empty turns, array-content text, and enforces turn and char caps", () => {
		const branch = [
			userEntry("", "e1"),
			userEntry("", "e2", [{ type: "image", data: "x" }]),
			userEntry("", "e3", 42),
			userEntry("", "e4", "plain string"),
			userEntry("kept", "u2"),
		];
		expect(buildConversation(" ", branch, { contextTurns: 4, contextChars: 100 })).toEqual([
			{ role: "user", text: "plain string" },
			{ role: "user", text: "kept" },
		]);
		expect(buildConversation("current", branch, { contextTurns: 2, contextChars: 100 }).map((t) => t.text)).toEqual([
			"kept",
			"current",
		]);
		const truncated = buildConversation("abcdef", [], { contextTurns: 4, contextChars: 3 });
		expect(truncated).toEqual([{ role: "user", text: "def" }]);
		const exhausted = buildConversation("abc", [userEntry("later", "u1")], { contextTurns: 4, contextChars: 3 });
		expect(exhausted).toEqual([{ role: "user", text: "abc" }]);
	});
});

describe("classifierModel", () => {
	it("inherits the provider template, or uses an explicit baseUrl", () => {
		const registry = { getAll: () => [templateModel()] } as unknown as ExtensionContext["modelRegistry"];
		const model = classifierModel(registry, DEFAULT_AUTO_MODEL_CONFIG.classifier);
		expect(model).toMatchObject({
			id: "jev-1.13",
			provider: "tokenin",
			baseUrl: "https://lite.andlet.me/v1",
			contextWindow: 393216,
		});

		const bare = { getAll: () => [] } as unknown as ExtensionContext["modelRegistry"];
		expect(classifierModel(bare, DEFAULT_AUTO_MODEL_CONFIG.classifier)).toBeUndefined();
		const override = classifierModel(bare, { ...DEFAULT_AUTO_MODEL_CONFIG.classifier, baseUrl: "https://x/v1" });
		expect(override).toMatchObject({ baseUrl: "https://x/v1", reasoning: false, input: ["text"] });
	});
});

describe("classifyTier", () => {
	const config: AutoModelConfig = { ...DEFAULT_AUTO_MODEL_CONFIG, enabled: true };

	function ctxWith(overrides: Partial<ExtensionContext> = {}): ExtensionContext {
		return {
			modelRegistry: {
				getAll: () => [templateModel()],
				getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true, apiKey: "key", headers: {} }),
			},
			sessionManager: { getBranch: () => [] },
			getSystemPrompt: () => "sys",
			...overrides,
		} as unknown as ExtensionContext;
	}

	it("returns the tier Jev answers", async () => {
		completeMock.mockResolvedValue(textResponse(jevAnswer("COMPLEX", 0.9)));
		await expect(classifyTier(ctxWith(), config, "fix the parser")).resolves.toBe("complex");
	});

	it("returns undefined when the classifier is unusable", async () => {
		const noTemplate = { modelRegistry: { getAll: () => [] } } as unknown as ExtensionContext;
		await expect(classifyTier(noTemplate, config, "hi")).resolves.toBeUndefined();

		const noAuth = ctxWith({
			modelRegistry: {
				getAll: () => [templateModel()],
				getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: false, error: "no key" }),
			} as unknown as ExtensionContext["modelRegistry"],
		});
		await expect(classifyTier(noAuth, config, "hi")).resolves.toBeUndefined();
	});
});

describe("auto-model extension", () => {
	it("registers the session, model, and input handlers", () => {
		const { handlers } = createHarness();
		expect([...handlers.keys()]).toEqual(["session_start", "model_select", "input"]);
	});

	it("routes an idle prompt to the classified tier model", async () => {
		completeMock.mockResolvedValue(textResponse(jevAnswer("COMPLEX", 0.9)));
		const { handlers, ctx, setModel, setThinkingLevel } = createHarness();
		await handlers.get("input")!({ type: "input", text: "fix the parser", source: "interactive" }, ctx);
		expect(setModel).toHaveBeenCalledWith(expect.objectContaining({ provider: "tokenin" }));
		expect(setThinkingLevel).not.toHaveBeenCalled();
	});

	it("applies a per-tier thinking level when the mapping carries one", async () => {
		writeSettings({ autoModel: { enabled: true, tiers: { complex: "tokenin/celestial-pro:max" } } });
		completeMock.mockResolvedValue(textResponse(jevAnswer("COMPLEX", 0.9)));
		const { handlers, ctx, setThinkingLevel } = createHarness();
		await handlers.get("input")!({ type: "input", text: "fix", source: "interactive" }, ctx);
		expect(setThinkingLevel).toHaveBeenCalledWith("max");
	});

	it("skips non-eligible input and disabled routing", async () => {
		const { handlers, ctx, setModel } = createHarness();
		const input = handlers.get("input")!;
		await input({ type: "input", text: "hi", source: "extension" }, ctx);
		await input({ type: "input", text: "hi", source: "interactive", streamingBehavior: "steer" }, ctx);
		await input({ type: "input", text: "   ", source: "interactive" }, ctx);
		await input({ type: "input", text: "/model", source: "interactive" }, ctx);
		writeSettings({ autoModel: { enabled: false } });
		await input({ type: "input", text: "hi", source: "interactive" }, ctx);
		expect(setModel).not.toHaveBeenCalled();
		expect(completeMock).not.toHaveBeenCalled();
	});

	it("suspends after a manual model change and resumes on the next session", async () => {
		completeMock.mockResolvedValue(textResponse(jevAnswer("SIMPLE", 0.9)));
		const { handlers, ctx, setModel } = createHarness();
		await handlers.get("model_select")!({ type: "model_select", model: templateModel(), source: "cycle" }, ctx);
		await handlers.get("input")!({ type: "input", text: "hi", source: "interactive" }, ctx);
		expect(setModel).not.toHaveBeenCalled();

		handlers.get("session_start")!({ type: "session_start" }, ctx);
		await handlers.get("input")!({ type: "input", text: "hi", source: "interactive" }, ctx);
		expect(setModel).toHaveBeenCalledTimes(1);
	});

	it("ignores its own routing switch and session restore", async () => {
		completeMock.mockResolvedValue(textResponse(jevAnswer("SIMPLE", 0.9)));
		const { handlers, ctx, setModel } = createHarness();
		const modelSelect = handlers.get("model_select")!;
		modelSelect({ type: "model_select", model: templateModel(), source: "restore" }, ctx);
		// The model_select emitted by our own setModel must not suspend the next prompt.
		setModel.mockImplementation(async () => {
			modelSelect({ type: "model_select", model: templateModel(), source: "set" }, ctx);
			return true;
		});
		await handlers.get("input")!({ type: "input", text: "hi", source: "interactive" }, ctx);
		await handlers.get("input")!({ type: "input", text: "again", source: "interactive" }, ctx);
		expect(setModel).toHaveBeenCalledTimes(2);
	});

	it("keeps the current model when no mapping resolves or the target is out of scope", async () => {
		completeMock.mockResolvedValue(textResponse(jevAnswer("COMPLEX", 0.9)));
		const unparsable = createHarness();
		writeSettings({ autoModel: { enabled: true, tiers: { complex: "no-slash-here" } } });
		await unparsable.handlers.get("input")!({ type: "input", text: "go", source: "interactive" }, unparsable.ctx);
		expect(unparsable.setModel).not.toHaveBeenCalled();

		writeSettings({ autoModel: { enabled: true, tiers: { complex: "tokenin/missing" } } });
		const missing = createHarness();
		await missing.handlers.get("input")!({ type: "input", text: "go", source: "interactive" }, missing.ctx);
		expect(missing.setModel).not.toHaveBeenCalled();

		const scoped = createHarness([], [{ model: templateModel("other", "x") }]);
		writeSettings({ autoModel: { enabled: true } });
		await scoped.handlers.get("input")!({ type: "input", text: "go", source: "interactive" }, scoped.ctx);
		expect(scoped.setModel).not.toHaveBeenCalled();

		const sameProvider = createHarness([], [{ model: templateModel("tokenin", "other-id") }]);
		await sameProvider.handlers.get("input")!({ type: "input", text: "go", source: "interactive" }, sameProvider.ctx);
		expect(sameProvider.setModel).not.toHaveBeenCalled();
	});

	it("falls back to the fallback tier and survives classifier and switch failures", async () => {
		writeSettings({ autoModel: { enabled: true, fallbackTier: "medium", tiers: { medium: "tokenin/celestial-pro" } } });
		completeMock.mockRejectedValue(new Error("network down"));
		const failed = createHarness();
		await failed.handlers.get("input")!({ type: "input", text: "go", source: "interactive" }, failed.ctx);
		expect(failed.setModel).toHaveBeenCalledWith(expect.objectContaining({ id: "celestial-pro" }));

		writeSettings({ autoModel: { enabled: true, tiers: { medium: "tokenin/celestial-pro" } } });
		completeMock.mockResolvedValue(textResponse(jevAnswer("COMPLEX", 0.9)));
		const refused = createHarness();
		refused.setModel.mockResolvedValue(false);
		await refused.handlers.get("input")!({ type: "input", text: "go", source: "interactive" }, refused.ctx);
		expect(refused.setThinkingLevel).not.toHaveBeenCalled();
	});

	it("serializes concurrent prompts so only one classification runs", async () => {
		let release: (() => void) | undefined;
		completeMock.mockImplementation(
			() =>
				new Promise((resolve) => {
					release = () => resolve(textResponse(jevAnswer("SIMPLE", 0.9)));
				}) as never,
		);
		const { handlers, ctx, setModel } = createHarness();
		const input = handlers.get("input")!;
		const first = input({ type: "input", text: "one", source: "interactive" }, ctx);
		const second = input({ type: "input", text: "two", source: "interactive" }, ctx);
		await vi.waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1));
		release?.();
		await Promise.all([first, second]);
		expect(setModel).toHaveBeenCalledTimes(1);
	});

	it("exposes the tier list used by the payload", () => {
		expect(TIERS).toEqual(["simple", "medium", "complex", "reasoning"]);
	});
});
