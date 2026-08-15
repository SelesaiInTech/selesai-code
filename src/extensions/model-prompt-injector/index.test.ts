import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@selesai/code";
import modelPromptInjector, {
	findRule,
	patternMatches,
	type InjectConfig,
	type InjectRule,
	type ModelRef,
} from "./index.ts";

const model = (provider: string, id: string, name = id): ModelRef => ({ provider, id, name });

function harness(config: InjectConfig, activeModel: ModelRef | undefined) {
	const handlers: Record<string, Function> = {};
	const pi = {
		on: vi.fn((event: string, handler: Function) => {
			handlers[event] = handler;
		}),
	} as unknown as ExtensionAPI;
	const ctx = {
		getModel: () => activeModel,
		ui: { setStatus: vi.fn() },
	};
	modelPromptInjector(pi, config);
	return { handlers, ctx };
}

describe("patternMatches", () => {
	it("matches provider/model exactly, case-insensitively", () => {
		expect(patternMatches("deepseek/deepseek-v4-pro", model("DeepSeek", "deepseek-v4-pro"))).toBe(true);
		expect(patternMatches("deepseek/deepseek-v4-pro", model("openrouter", "deepseek-v4-pro"))).toBe(false);
	});

	it("supports wildcards in provider and id", () => {
		expect(patternMatches("*/deepseek-v4-pro", model("openrouter", "deepseek-v4-pro"))).toBe(true);
		expect(patternMatches("deepseek/*", model("deepseek", "deepseek-v4-pro"))).toBe(true);
		expect(patternMatches("deepseek/*", model("deepseek", "deepseek-chat"))).toBe(true);
		expect(patternMatches("deepseek/*", model("openai", "gpt-5"))).toBe(false);
	});

	it("bare patterns match id or display name", () => {
		expect(patternMatches("deepseek-v4-pro", model("deepseek", "deepseek-v4-pro"))).toBe(true);
		expect(patternMatches("gpt-*", model("openai", "gpt-5", "GPT-5"))).toBe(true);
		expect(patternMatches("deepseek*", model("deepseek", "deepseek-v4-pro"))).toBe(true);
	});

	it("matches * against any model", () => {
		expect(patternMatches("*", model("openai", "gpt-5"))).toBe(true);
	});
});

describe("findRule", () => {
	const rules: InjectRule[] = [
		{ match: ["deepseek/*"], prompt: "A" },
		{ match: ["*/deepseek-v4-pro"], prompt: "B" },
		{ match: ["*"], prompt: "C", enabled: false },
	];

	it("first matching rule wins", () => {
		expect(findRule(rules, model("deepseek", "deepseek-v4-pro"))?.prompt).toBe("A");
		expect(findRule(rules, model("openrouter", "deepseek-v4-pro"))?.prompt).toBe("B");
	});

	it("skips disabled rules", () => {
		expect(findRule([{ match: ["*"], prompt: "C", enabled: false }], model("openai", "gpt-5"))).toBeUndefined();
	});
});

describe("before_agent_start", () => {
	it("appends the rule prompt to the system prompt", async () => {
		const { handlers, ctx } = harness({ rules: [{ match: ["deepseek/*"], prompt: "EXTRA" }] }, model("deepseek", "deepseek-chat"));
		const result = await handlers["before_agent_start"]({ systemPrompt: "BASE" }, ctx);
		expect(result).toEqual({ systemPrompt: "BASE\n\nEXTRA" });
	});

	it("replaces the system prompt in replace mode", async () => {
		const { handlers, ctx } = harness(
			{ rules: [{ match: ["deepseek/*"], prompt: "ONLY ME", mode: "replace" }] },
			model("deepseek", "deepseek-chat"),
		);
		const result = await handlers["before_agent_start"]({ systemPrompt: "BASE" }, ctx);
		expect(result).toEqual({ systemPrompt: "ONLY ME" });
	});

	it("returns undefined when no rule matches", async () => {
		const { handlers, ctx } = harness(
			{ rules: [{ match: ["deepseek/*"], prompt: "EXTRA" }] },
			model("openai", "gpt-5"),
		);
		const result = await handlers["before_agent_start"]({ systemPrompt: "BASE" }, ctx);
		expect(result).toBeUndefined();
	});
});

describe("model_select", () => {
	it("shows status when the selected model matches, clears otherwise", async () => {
		const { handlers, ctx } = harness({ rules: [{ match: ["deepseek/*"], prompt: "EXTRA" }] }, undefined);
		await handlers["model_select"]({ model: model("deepseek", "deepseek-chat") }, ctx);
		expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("model-prompt-injector", "prompt-inject: active");
		await handlers["model_select"]({ model: model("openai", "gpt-5") }, ctx);
		expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("model-prompt-injector", undefined);
	});
});
