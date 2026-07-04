import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../core/auth-storage.ts";
import { ModelRegistry } from "../core/model-registry.ts";

describe("model registry bundled defaults", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "model-registry-defaults-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("loads bundled models without requiring a copied user models.json", () => {
		const registry = ModelRegistry.create(AuthStorage.inMemory(), join(dir, "models.json"));
		const model = registry.find("tokenin", "glm-5.2");

		expect(model?.name).toBe("GLM-5.2");
		expect(model?.baseUrl).toBe("https://lite.andlet.me/v1");
	});

	it("keeps bundled model list when user models.json only stores apiKey", () => {
		writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: { tokenin: { apiKey: "sk-user" } } }));

		const registry = ModelRegistry.create(AuthStorage.inMemory(), join(dir, "models.json"));
		const model = registry.find("tokenin", "glm-5.2");

		expect(model?.name).toBe("GLM-5.2");
		expect(registry.hasConfiguredAuth(model!)).toBe(true);
	});
});
