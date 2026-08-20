import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../core/auth-storage.ts";
import { ModelRegistry } from "../core/model-registry.ts";
import { ModelRuntime } from "../core/model-runtime.ts";

describe("model registry bundled defaults", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "model-registry-defaults-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("loads bundled models without requiring a copied user models.json", async () => {
		const registry = new ModelRegistry(
			await ModelRuntime.create({ credentials: AuthStorage.inMemory(), modelsPath: join(dir, "models.json") }),
		);
		const model = registry.find("tokenin", "glm-5.2");

		expect(model?.name).toBe("GLM-5.2");
		expect(model?.baseUrl).toBe("https://lite.andlet.me/v1");
		expect(registry.hasConfiguredAuth(model!)).toBe(false);

		// Gemma is a vision-capable default usable as an image captioner.
		const gemma = registry.find("tokenin", "gemma-4");
		expect(gemma?.name).toBe("Gemma 4 (Vision)");
		expect(gemma?.input).toContain("image");
	});

	it("keeps bundled model list when user models.json only stores apiKey", async () => {
		writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: { tokenin: { apiKey: "sk-user" } } }));

		const registry = new ModelRegistry(
			await ModelRuntime.create({ credentials: AuthStorage.inMemory(), modelsPath: join(dir, "models.json") }),
		);
		const model = registry.find("tokenin", "glm-5.2");

		expect(model?.name).toBe("GLM-5.2");
		expect(registry.hasConfiguredAuth(model!)).toBe(true);
	});

	it("reloads user models while retaining bundled defaults", async () => {
		const modelsPath = join(dir, "models.json");
		const config = (id: string) => ({
			providers: {
				custom: {
					baseUrl: "https://example.test/v1",
					api: "openai-completions",
					apiKey: "test-key",
					models: [{ id }],
				},
			},
		});
		writeFileSync(modelsPath, JSON.stringify(config("first")));
		const runtime = await ModelRuntime.create({ credentials: AuthStorage.inMemory(), modelsPath });
		const registry = new ModelRegistry(runtime);

		expect(registry.find("custom", "first")?.id).toBe("first");
		writeFileSync(modelsPath, JSON.stringify(config("second")));
		await runtime.refresh({ allowNetwork: false });

		expect(registry.find("custom", "first")).toBeUndefined();
		expect(registry.find("custom", "second")?.id).toBe("second");
		expect(registry.find("tokenin", "glm-5.2")?.id).toBe("glm-5.2");
	});
});
