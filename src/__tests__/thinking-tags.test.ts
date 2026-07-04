import { describe, expect, it } from "vitest";
import { normalizeAssistantThinkingTags, stripThinkingTagsFromText } from "../utils/thinking-tags.ts";

const baseMessage = {
	role: "assistant" as const,
	api: "openai-completions" as const,
	provider: "test",
	model: "test-model",
	usage: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "stop" as const,
	timestamp: 0,
};

describe("thinking tag normalization", () => {
	it("moves literal think tags from text into thinking blocks", () => {
		const message = normalizeAssistantThinkingTags({
			...baseMessage,
			content: [{ type: "text", text: "<think>hidden reasoning</think>visible answer" }],
		});

		expect(message.content).toEqual([
			{ type: "thinking", thinking: "hidden reasoning" },
			{ type: "text", text: "visible answer" },
		]);
	});

	it("keeps unclosed think content hidden", () => {
		const message = normalizeAssistantThinkingTags({
			...baseMessage,
			content: [{ type: "text", text: "<think>still thinking" }],
		});

		expect(message.content).toEqual([{ type: "thinking", thinking: "still thinking" }]);
	});

	it("strips thinking tags when extracting visible text", () => {
		expect(stripThinkingTagsFromText("<think>hidden</think>visible")).toBe("visible");
	});
});
