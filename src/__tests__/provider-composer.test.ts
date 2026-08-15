import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../core/auth-storage.ts";
import { ModelRegistry } from "../core/model-registry.ts";
import { ModelRuntime } from "../core/model-runtime.ts";

/** Custom tokenin entries inherit api/baseUrl from this minimal provider block. */
const TOKENIN = {
	api: "openai-completions",
	baseUrl: "https://test.example/v1",
};

function writeModels(dir: string, providers: unknown): void {
	writeFileSync(join(dir, "models.json"), JSON.stringify({ providers }));
}

describe("provider-composer maxTokens guard", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "provider-composer-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	async function registry(): Promise<ModelRegistry> {
		return new ModelRegistry(
			await ModelRuntime.create({
				credentials: AuthStorage.inMemory(),
				modelsPath: join(dir, "models.json"),
			}),
		);
	}

	it("falls back to a safe default when maxTokens is missing", async () => {
		writeModels(dir, { tokenin: { ...TOKENIN, models: [{ id: "guard-missing" }] } });
		const model = (await registry()).find("tokenin", "guard-missing");
		expect(model?.maxTokens).toBe(16384);
		expect(model!.maxTokens).toBeLessThanOrEqual(model!.contextWindow);
	});

	it("preserves an explicit maxTokens", async () => {
		writeModels(dir, {
			tokenin: { ...TOKENIN, models: [{ id: "guard-explicit", contextWindow: 512000, maxTokens: 64000 }] },
		});
		const model = (await registry()).find("tokenin", "guard-explicit");
		expect(model?.maxTokens).toBe(64000);
	});

	it("clamps maxTokens above the context window", async () => {
		writeModels(dir, {
			tokenin: { ...TOKENIN, models: [{ id: "guard-over", contextWindow: 100000, maxTokens: 200000 }] },
		});
		const model = (await registry()).find("tokenin", "guard-over");
		expect(model?.maxTokens).toBe(100000);
	});

	it("rejects a non-positive maxTokens", async () => {
		writeModels(dir, { tokenin: { ...TOKENIN, models: [{ id: "guard-negative", maxTokens: 0 }] } });
		const reg = await registry();
		expect(reg.find("tokenin", "guard-negative")).toBeUndefined();
		expect(reg.getError()).toMatch(/invalid maxTokens/);
	});

	it("applies modelOverrides maxTokens with the same fallback and clamp", async () => {
		writeModels(dir, {
			tokenin: {
				...TOKENIN,
				models: [{ id: "guard-override" }],
				modelOverrides: { "guard-override": { maxTokens: 64000 } },
			},
		});
		const model = (await registry()).find("tokenin", "guard-override");
		expect(model?.maxTokens).toBe(64000);

		writeModels(dir, {
			tokenin: {
				...TOKENIN,
				models: [{ id: "guard-override", contextWindow: 100000 }],
				modelOverrides: { "guard-override": { maxTokens: 200000 } },
			},
		});
		const clamped = (await registry()).find("tokenin", "guard-override");
		expect(clamped?.maxTokens).toBe(100000);
	});

	it("carries the maxTokensField compat through to composed models", async () => {
		writeModels(dir, {
			tokenin: {
				...TOKENIN,
				compat: { maxTokensField: "max_completion_tokens" },
				models: [{ id: "guard-field" }],
			},
		});
		const model = (await registry()).find("tokenin", "guard-field");
		expect(model?.compat?.maxTokensField).toBe("max_completion_tokens");
	});
});
