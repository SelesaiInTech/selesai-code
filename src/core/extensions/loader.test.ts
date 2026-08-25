import { describe, expect, test } from "vitest";
import { createEventBus } from "../event-bus.ts";
import { createExtensionRuntime, loadExtensionFromFactory } from "./loader.ts";
import type { ExtensionAPI } from "./types.ts";

describe("extension factory failure", () => {
	test("discards pending provider and flag state and disables the failed API", async () => {
		const runtime = createExtensionRuntime();
		let capturedApi: ExtensionAPI | undefined;
		let calls = 0;

		await expect(
			loadExtensionFromFactory(
				(pi) => {
					capturedApi = pi;
					pi.events.on("failed-load", () => calls++);
					pi.registerFlag("failed-flag", { type: "boolean", default: true });
					pi.registerProvider("failed-provider", { baseUrl: "https://provider.test", apiKey: "key" });
					throw new Error("factory failed");
				},
				process.cwd(),
				createEventBus(),
				runtime,
				"<failing>",
			),
		).rejects.toThrow("factory failed");

		expect(runtime.flagValues.has("failed-flag")).toBe(false);
		expect(runtime.pendingProviderRegistrations).toEqual([]);
		expect(calls).toBe(0);
		expect(() => capturedApi?.registerFlag("late", { type: "boolean", default: true })).toThrow(
			'Extension "<failing>" failed to load and its API is no longer active.',
		);
	});
});
