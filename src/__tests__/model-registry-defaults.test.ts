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
});
