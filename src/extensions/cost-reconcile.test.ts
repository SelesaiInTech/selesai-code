import { describe, expect, it } from "vitest";
import { extractCosts, parseCostHeader } from "./cost-reconcile.ts";

describe("parseCostHeader", () => {
	it("parses LiteLLM scientific-notation cost", () => {
		expect(parseCostHeader("4.45284e-06")).toBe(4.45284e-6);
	});

	it("parses plain decimal cost", () => {
		expect(parseCostHeader("0.00123")).toBe(0.00123);
	});

	it("rejects null, garbage, and negatives", () => {
		expect(parseCostHeader(null)).toBeUndefined();
		expect(parseCostHeader("abc")).toBeUndefined();
		expect(parseCostHeader("-1")).toBeUndefined();
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