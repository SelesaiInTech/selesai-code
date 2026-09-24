import type { Api, Model, Provider, RefreshModelsContext } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { withRemoteCatalog } from "./remote-catalog-provider.ts";

const cachedModel = {
	id: "gpt-6-sol",
	provider: "openai-codex",
} as Model<Api>;

function refreshContext(stored: RefreshModelsContext["stored"]): RefreshModelsContext {
	return {
		stored,
		allowNetwork: false,
		signal: new AbortController().signal,
		publish: async ({ update }) => {
			update?.();
			return true;
		},
	};
}

describe("remote model catalog cache", () => {
	it("keeps a newer cached catalog when Last-Modified is unavailable", async () => {
		const localGeneratedAt = 100;
		const provider = {
			id: "openai-codex",
			getModels: () => [],
		} as unknown as Provider;
		const wrapped = withRemoteCatalog(provider, "https://example.test", localGeneratedAt);

		await wrapped.refreshModels?.(
			refreshContext({ models: [cachedModel], checkedAt: localGeneratedAt + 1, lastModified: 0 }),
		);

		expect(wrapped.getModels().map((model) => model.id)).toEqual(["gpt-6-sol"]);
	});
});
