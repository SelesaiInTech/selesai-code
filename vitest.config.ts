import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
	test: {
		// ponytail: extension tests import .ts via jiti dynamically under
		// vi.resetModules(), which is slow on first cold load (~8s). Bump the
		// per-test ceiling so the adapter smoke tests don't time out.
		testTimeout: 20000,
	},
	resolve: {
		alias: {
			// Self-referencing package — vitest can't resolve @selesai/code
			// without a node_modules symlink. Point it at the built dist.
			"@selesai/code": resolve(__dirname, "dist/index.js"),
		},
	},
});