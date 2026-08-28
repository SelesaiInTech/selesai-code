import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@selesai/code";
import autoSessionNameExtension, {
	MAX_MESSAGE_CHARS,
	MAX_NAME_WORDS,
	MAX_PREVIOUS_MESSAGES,
	NAMING_MAX_TOKENS,
	NAMING_SYSTEM_PROMPT,
	previousUserMessages,
} from "./auto-session-name.ts";

vi.mock("@earendil-works/pi-ai/compat", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-ai/compat")>();
	return {
		...actual,
		complete: vi.fn(),
	};
});

import { complete } from "@earendil-works/pi-ai/compat";
const completeMock = vi.mocked(complete);

type Handler = (event: unknown, ctx: ExtensionContext) => void | Promise<void>;

function userEntry(text: string, id: string): SessionEntry {
	return {
		id,
		type: "message",
		message: { role: "user", content: [{ type: "text", text }], timestamp: 100 },
		parentId: "root",
		timestamp: "2025-01-01T00:00:00.000Z",
	} as unknown as SessionEntry;
}

function createHarness(branch: SessionEntry[] = []) {
	const handlers = new Map<string, Handler>();
	const setSessionName = vi.fn();
	const pi = {
		on: vi.fn((event: string, handler: Handler) => handlers.set(event, handler)),
		setSessionName,
	} as unknown as ExtensionAPI;
	const model = { provider: "openai", id: "gpt-5", name: "GPT-5" };
	const ctx = {
		model,
		modelRegistry: {
			getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true, apiKey: "key", headers: {} }),
		},
		sessionManager: { getBranch: () => branch },
	} as unknown as ExtensionContext;

	autoSessionNameExtension(pi);
	return { handlers, setSessionName, ctx };
}

function textResponse(text: string) {
	return {
		content: [{ type: "text", text }],
		stopReason: "stop",
		usage: { input: 0, output: 0 },
	} as never;
}

describe("auto-session-name", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("registers an input handler", () => {
		const { handlers } = createHarness();
		expect(handlers.has("input")).toBe(true);
	});

	it("names the session from the user prompt with a small system prompt and 10-token cap", async () => {
		const { handlers, setSessionName, ctx } = createHarness();
		completeMock.mockResolvedValue(textResponse("Refactor auth"));

		await handlers.get("input")!({ type: "input", text: "refactor the auth module", source: "interactive" }, ctx);
		await vi.waitFor(() => expect(setSessionName).toHaveBeenCalledWith("Refactor auth"));

		expect(completeMock).toHaveBeenCalledTimes(1);
		const [model, context, options] = completeMock.mock.calls[0];
		expect(model).toBe(ctx.model);
		expect(context.systemPrompt).toBe(NAMING_SYSTEM_PROMPT);
		expect(context.messages).toHaveLength(1);
		expect(context.messages[0].role).toBe("user");
		expect(context.messages[0].content).toBe("refactor the auth module");
		expect(options?.maxTokens).toBe(NAMING_MAX_TOKENS);
		expect(options?.samplingParams).toEqual({ reasoning_effort: "none" });
		expect(setSessionName).toHaveBeenCalledWith("Refactor auth");
	});

	it("caps the name at 5 words even if the model returns more", async () => {
		const { handlers, setSessionName, ctx } = createHarness();
		completeMock.mockResolvedValue(textResponse("one two three four five six seven"));

		await handlers.get("input")!({ type: "input", text: "hello", source: "interactive" }, ctx);
		await vi.waitFor(() => expect(setSessionName).toHaveBeenCalledWith("one two three four five"));

		expect(setSessionName.mock.calls[0][0].split(/\s+/)).toHaveLength(MAX_NAME_WORDS);
	});

	it("includes previous user messages (newest first) for context", async () => {
		const branch = [userEntry("first message", "u1"), userEntry("second message", "u2")];
		const { handlers, ctx } = createHarness(branch);
		completeMock.mockResolvedValue(textResponse("Auth refactor"));

		await handlers.get("input")!({ type: "input", text: "now fix the tests", source: "interactive" }, ctx);

		const [, context] = completeMock.mock.calls[0];
		expect(context.messages[0].content).toBe("second message\nfirst message\nnow fix the tests");
	});

	it("truncates long previous messages and caps the count", () => {
		const long = "x".repeat(MAX_MESSAGE_CHARS + 50);
		const branch = Array.from({ length: MAX_PREVIOUS_MESSAGES + 5 }, (_, i) =>
			userEntry(i === MAX_PREVIOUS_MESSAGES + 4 ? long : `msg ${i}`, `u${i}`),
		);
		const texts = previousUserMessages({ getBranch: () => branch });

		expect(texts).toHaveLength(MAX_PREVIOUS_MESSAGES);
		expect(texts[0]).toBe(`${"x".repeat(MAX_MESSAGE_CHARS)}…`);
		expect(texts[1]).toBe("msg 23");
	});

	it("skips extension-sourced input, commands, and empty text", async () => {
		const { handlers, setSessionName, ctx } = createHarness();

		await handlers.get("input")!({ type: "input", text: "hi", source: "extension" }, ctx);
		await handlers.get("input")!({ type: "input", text: "/name foo", source: "interactive" }, ctx);
		await handlers.get("input")!({ type: "input", text: "   ", source: "interactive" }, ctx);

		expect(completeMock).not.toHaveBeenCalled();
		expect(setSessionName).not.toHaveBeenCalled();
	});

	it("does not set a name when the model returns no text", async () => {
		const { handlers, setSessionName, ctx } = createHarness();
		completeMock.mockResolvedValue({ content: [], stopReason: "stop" } as never);

		await handlers.get("input")!({ type: "input", text: "hello", source: "interactive" }, ctx);

		expect(setSessionName).not.toHaveBeenCalled();
	});

	it("swallows auth and completion errors without breaking the message flow", async () => {
		const { handlers, setSessionName, ctx } = createHarness();
		ctx.modelRegistry.getApiKeyAndHeaders = vi.fn().mockResolvedValue({ ok: false, error: "no key" });
		await handlers.get("input")!({ type: "input", text: "hello", source: "interactive" }, ctx);
		expect(setSessionName).not.toHaveBeenCalled();

		ctx.modelRegistry.getApiKeyAndHeaders = vi.fn().mockResolvedValue({ ok: true, apiKey: "key" });
		completeMock.mockRejectedValue(new Error("boom"));
		await handlers.get("input")!({ type: "input", text: "hello", source: "interactive" }, ctx);
		await vi.waitFor(() => expect(completeMock).toHaveBeenCalled());
		expect(setSessionName).not.toHaveBeenCalled();
	});
});
