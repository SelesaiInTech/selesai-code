import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		testTimeout: 30000,
		// Tests run offline by default; opt in with allowNetwork() from test/test-network-env.ts.
		env: { PI_OFFLINE: "1" },
		unstubEnvs: true,
		reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
		silent: "passed-only",
		server: {
			deps: {
				external: [/@silvia-odwyer\/photon-node/],
			},
		},
	},
	resolve: {
		alias: {
			// Self-reference resolves to the built package in this flattened fork.
			"@selesai/code": resolve(__dirname, "dist/index.js"),
		},
	},
});
