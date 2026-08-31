import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import costReconcileExtension, { extractCosts, parseCostHeader } from "./cost-reconcile.ts";

type Handler = (event: any, ctx: any) => any;

const FETCH_PATCHED = Symbol.for("selesai.cost-reconcile.fetch-patched");
let originalFetch: typeof globalThis.fetch;

function createHarness() {
	const handlers = new Map<string, Handler>();
	const appendEntry = vi.fn();
	const pi = {
		on: vi.fn((event: string, handler: Handler) => handlers.set(event, handler)),
		appendEntry,
	};
	costReconcileExtension(pi as any);
	return { appendEntry, handlers };
}

async function startSession(handlers: Map<string, Handler>): Promise<void> {
	await handlers.get("session_start")!({}, { sessionManager: { getEntries: () => [] } });
}

function assistantMessage(responseId: string, total = 0.75) {
	return {
		role: "assistant",
		provider: "openrouter",
		model: "openai/gpt-4.1-mini",
		responseModel: "openai/gpt-4.1-mini",
		responseId,
		stopReason: "stop",
		content: [],
		usage: {
			input: 10,
			output: 5,
			cacheRead: 2,
			cacheWrite: 1,
			cost: { input: 0.2, output: 0.4, cacheRead: 0.1, cacheWrite: 0.05, total },
		},
	};
}

function installFetch(body: string, headers: Record<string, string> = {}) {
	const upstreamFetch = vi.fn(async () =>
		new Response(body, { headers: { "content-type": "text/event-stream", ...headers } }),
	);
	globalThis.fetch = upstreamFetch as typeof globalThis.fetch;
	return upstreamFetch;
}

beforeEach(() => {
	originalFetch = globalThis.fetch;
	delete (globalThis as typeof globalThis & { [FETCH_PATCHED]?: boolean })[FETCH_PATCHED];
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	delete (globalThis as typeof globalThis & { [FETCH_PATCHED]?: boolean })[FETCH_PATCHED];
	vi.restoreAllMocks();
});

describe("parseCostHeader", () => {
	it("parses LiteLLM scientific-notation cost", () => {
		expect(parseCostHeader("4.45284e-06")).toBe(4.45284e-6);
	});

	it("parses plain decimal cost", () => {
		expect(parseCostHeader("0.00123")).toBe(0.00123);
	});

	it("rejects null, blank, garbage, and negative values", () => {
		expect(parseCostHeader(null)).toBeUndefined();
		expect(parseCostHeader("")).toBeUndefined();
		expect(parseCostHeader(" \t ")).toBeUndefined();
		expect(parseCostHeader("abc")).toBeUndefined();
		expect(parseCostHeader("-1")).toBeUndefined();
	});

	it("trims valid zero-valued headers", () => {
		expect(parseCostHeader(" 0 ")).toBe(0);
	});
});

describe("extractCosts", () => {
	it("reads OpenRouter chat-completions usage cost from a final SSE chunk", () => {
		const body =
			'Data: {"id":"gen-abc","provider":"OpenAI"}\n\n' +
			'data: {"id":"gen-abc","usage":{"prompt_tokens":10,"cost":0.0123},"choices":[]}\n\n' +
			"data: [DONE]\n\n";
		const { ids, cost } = extractCosts(body);
		expect(ids).toContain("gen-abc");
		expect(cost).toBe(0.0123);
	});

	it("reads OpenRouter native total_cost from a JSON body", () => {
		const { ids, cost } = extractCosts(
			'{"id":"gen-xyz","total_cost":0.05152,"usage":{"total_tokens":330}}',
		);
		expect(ids).toEqual(["gen-xyz"]);
		expect(cost).toBe(0.05152);
	});

	it("reads object-shaped cost {total} payloads", () => {
		const { cost } = extractCosts('{"id":"gen-obj","cost":{"input":0.01,"total":0.0456}}');
		expect(cost).toBe(0.0456);
	});

	it("keeps the last cost when multiple chunks carry usage", () => {
		const body =
			'data: {"id":"gen-1","usage":{"cost":0.01}}\n\ndata: {"id":"gen-1","usage":{"cost":0.02}}\n\n';
		const { cost } = extractCosts(body);
		expect(cost).toBe(0.02);
	});

	it("returns no cost when the payload has none", () => {
		const { ids, cost } = extractCosts('data: {"id":"resp-1","delta":"hi"}\n\n');
		expect(ids).toContain("resp-1");
		expect(cost).toBeUndefined();
	});

	it("ignores negative or non-finite costs", () => {
		const { cost } = extractCosts('{"id":"gen-neg","cost":-1}');
		expect(cost).toBeUndefined();
	});

	it("extracts ids from anthropic-style message_start without cost", () => {
		const body =
			'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_01ABC","usage":{}}}\n\n' +
			'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":15}}\n\n';
		const { ids, cost } = extractCosts(body);
		expect(ids).toContain("msg_01ABC");
		expect(cost).toBeUndefined();
	});

	it("caps captured ids", () => {
		const body = Array.from({ length: 100 }, (_, i) => `{"id":"id-${i}"}`).join("\n");
		const { ids } = extractCosts(body);
		expect(ids.length).toBe(50);
	});
});

describe("live assistant usage reconciliation", () => {
	it("replaces finalized assistant usage only after the streamed body completes and keeps the custom entry", async () => {
		const responseId = "live-reconcile-1";
		const body = `data: {"id":"${responseId}","usage":{"cost":0.0123}}\n\ndata: [DONE]\n\n`;
		installFetch(body);
		const { appendEntry, handlers } = createHarness();
		await startSession(handlers);

		const response = await globalThis.fetch("https://openrouter.ai/api/v1/chat/completions");
		const messageEnd = handlers.get("message_end")!;
		expect(await messageEnd({ message: assistantMessage(responseId) }, {})).toBeUndefined();

		expect(await response.text()).toBe(body);
		const result = await messageEnd({ message: assistantMessage(responseId) }, {});
		expect(result.message.usage.cost).toEqual({
			input: 0.2,
			output: 0.4,
			cacheRead: 0.1,
			cacheWrite: 0.05,
			total: 0.0123,
		});
		expect(appendEntry).toHaveBeenCalledWith(
			"cost-reconcile",
			expect.objectContaining({ provider: "openrouter", responseId, cost: 0.0123, source: "payload" }),
		);
	});

	it("uses a valid zero-valued billed header over the payload cost", async () => {
		const responseId = "live-header-zero-2";
		installFetch(`data: {"id":"${responseId}","usage":{"cost":0.0123}}\n\n`, {
			"x-litellm-response-cost": "0",
		});
		const { handlers } = createHarness();
		await startSession(handlers);

		const response = await globalThis.fetch("https://gateway.example/v1/chat/completions");
		await response.text();
		const result = await handlers.get("message_end")!({ message: assistantMessage(responseId) }, {});
		expect(result.message.usage.cost.total).toBe(0);
	});

	it("reconciles a tool-call stream: keys cost by every id, message_end consumes the matching one", async () => {
		const responseId = "live-toolcall-3";
		const body =
			`data: {"id":"${responseId}","choices":[{"delta":{"tool_calls":[{"id":"call_abc123","function":{"name":"bash","arguments":""}}]}}]}\n\n` +
			`data: {"id":"${responseId}","usage":{"cost":0.0123}}\n\n` +
			"data: [DONE]\n\n";
		installFetch(body);
		const { appendEntry, handlers } = createHarness();
		await startSession(handlers);

		const response = await globalThis.fetch("https://gateway.example/v1/chat/completions");
		await response.text();
		const message = assistantMessage(responseId);
		const result = await handlers.get("message_end")!({ message }, {});
		expect(result.message.usage.cost.total).toBe(0.0123);
		expect(appendEntry).toHaveBeenCalledWith(
			"cost-reconcile",
			expect.objectContaining({ provider: "openrouter", responseId, cost: 0.0123, source: "payload" }),
		);
	});

	it("does not apply a captured cost to a message whose id was not in the body", async () => {
		const body = `data: {"id":"other-response","usage":{"cost":0.0123}}\n\ndata: [DONE]\n\n`;
		installFetch(body);
		const { appendEntry, handlers } = createHarness();
		await startSession(handlers);

		const response = await globalThis.fetch("https://gateway.example/v1/chat/completions");
		await response.text();
		const message = assistantMessage("unrelated-message");
		expect(await handlers.get("message_end")!({ message }, {})).toBeUndefined();
		expect(message.usage.cost.total).toBe(0.75);
		expect(appendEntry).not.toHaveBeenCalled();
	});

	it("falls back when the process cache sees a duplicate response id", async () => {
		const responseId = "live-duplicate-response-4";
		installFetch(`data: {"id":"${responseId}","usage":{"cost":0.0123}}\n\n`);
		const { appendEntry, handlers } = createHarness();
		await startSession(handlers);

		const first = await globalThis.fetch("https://gateway.example/v1/chat/completions");
		const second = await globalThis.fetch("https://gateway.example/v1/chat/completions");
		await Promise.all([first.text(), second.text()]);
		const message = assistantMessage(responseId);
		expect(await handlers.get("message_end")!({ message }, {})).toBeUndefined();
		expect(message.usage.cost.total).toBe(0.75);
		expect(appendEntry).not.toHaveBeenCalled();
	});

	it("preserves the original message when no valid billed cost was captured", async () => {
		const responseId = "live-no-cost-3";
		installFetch(`data: {"id":"${responseId}","usage":{"cost":-1}}\n\n`);
		const { appendEntry, handlers } = createHarness();
		await startSession(handlers);

		const response = await globalThis.fetch("https://gateway.example/v1/chat/completions");
		await response.text();
		const message = assistantMessage(responseId);
		expect(await handlers.get("message_end")!({ message }, {})).toBeUndefined();
		expect(message.usage.cost.total).toBe(0.75);
		expect(appendEntry).not.toHaveBeenCalled();
	});

	it("preserves terminal error messages even when a billed cost was captured", async () => {
		const responseId = "live-terminal-4";
		installFetch(`data: {"id":"${responseId}","usage":{"cost":0.0123}}\n\n`);
		const { appendEntry, handlers } = createHarness();
		await startSession(handlers);

		const response = await globalThis.fetch("https://gateway.example/v1/chat/completions");
		await response.text();
		const message = { ...assistantMessage(responseId), stopReason: "error" };
		expect(await handlers.get("message_end")!({ message }, {})).toBeUndefined();
		expect(message.usage.cost.total).toBe(0.75);
		expect(appendEntry).not.toHaveBeenCalled();
	});

	it("does not capture unrelated fetches", async () => {
		const responseId = "unrelated-fetch-5";
		const body = `data: {"id":"${responseId}","usage":{"cost":0.0123}}\n\n`;
		installFetch(body);
		const { handlers } = createHarness();
		await startSession(handlers);

		const response = await globalThis.fetch("https://example.com/data.json");
		expect(await response.text()).toBe(body);
		expect(await handlers.get("message_end")!({ message: assistantMessage(responseId) }, {})).toBeUndefined();
	});
});
