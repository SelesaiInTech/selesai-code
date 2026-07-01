import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// ponytail: extension tests import .ts via jiti dynamically under
		// vi.resetModules(), which is slow on first cold load (~8s). Bump the
		// per-test ceiling so the adapter smoke tests don't time out.
		testTimeout: 20000,
	},
});