/**
 * The registry facade's completion path.
 *
 * An extension that calls a model must reach the *composed* provider layer —
 * provider `streamSimple` overrides (the Token-In decisions transport), auth
 * resolution, and base-URL overrides — rather than pi-ai's compat dispatch,
 * which knows nothing about the providers this runtime composes.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, type AssistantMessageEvent, type Context, type Model } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelRegistry } from "../core/model-registry.ts";
import { ModelRuntime } from "../core/model-runtime.ts";

const jev: Model<any> = {
	id: "jev-1.13",
	name: "Jev 1.13",
	api: "openai-completions",
	provider: "tokenin",
	baseUrl: "https://lite.andlet.me/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 32_000,
	maxTokens: 4_000,
};
const context: Context = { messages: [{ role: "user", content: "{}" }] };

let agentDir: string;

beforeEach(() => {
	agentDir = mkdtempSync(join(tmpdir(), "model-registry-completion-"));
	process.env.SELESAI_CODING_AGENT_DIR = agentDir;
	// The bundled models.json declares tokenin with `authHeader: true`, so the
	// runtime needs a credential before it will send anything.
	writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ tokenin: { type: "api_key", key: "sk-test" } }), {
		mode: 0o600,
	});
});

afterEach(() => {
	rmSync(agentDir, { recursive: true, force: true });
});

describe("ModelRegistry completion", () => {
	it("applies a provider's streamSimple override instead of the api default", async () => {
		const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null });
		const seen: string[] = [];
		runtime.registerProvider("tokenin", {
			api: "openai-completions",
			streamSimple: (model) => {
				seen.push(model.id);
				const stream = createAssistantMessageEventStream();
				const message = {
					role: "assistant" as const,
					content: [{ type: "text" as const, text: "overridden" }],
					api: model.api,
					provider: model.provider,
					model: model.id,
					usage: {
						input: 1,
						output: 2,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 3,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop" as const,
					timestamp: 1,
				};
				stream.push({ type: "text_delta", contentIndex: 0, delta: "overridden", partial: message });
				stream.push({ type: "done", reason: "stop", message });
				stream.end(message);
				return stream;
			},
		});
		const registry = new ModelRegistry(runtime);

		const completion = await registry.complete(jev, context, { apiKey: "sk-test" });
		expect(seen).toEqual(["jev-1.13"]);
		expect(completion.content).toEqual([{ type: "text", text: "overridden" }]);
		expect(completion.stopReason).toBe("stop");
		expect(completion.usage.totalTokens).toBe(3);
	});

	it("resolves request auth for the composed provider", async () => {
		const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null });
		const registry = new ModelRegistry(runtime);
		await expect(registry.getApiKeyAndHeaders(jev)).resolves.toMatchObject({ ok: true, apiKey: "sk-test" });
	});

	it("streams through the same composed provider", async () => {
		const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null });
		const streamed = vi.fn(() => {
			const model = jev;
			const stream = createAssistantMessageEventStream();
			const message = {
				role: "assistant" as const,
				content: [{ type: "text" as const, text: "streamed" }],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop" as const,
				timestamp: 1,
			};
			stream.push({ type: "done", reason: "stop", message });
			return stream;
		});
		runtime.registerProvider("tokenin", { api: "openai-completions", streamSimple: streamed });
		const registry = new ModelRegistry(runtime);

		const events: AssistantMessageEvent[] = [];
		for await (const event of registry.streamSimple(jev, context, { apiKey: "sk-test" })) events.push(event);
		expect(streamed).toHaveBeenCalled();
		expect(events.at(-1)?.type).toBe("done");
	});
});
