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
		exclude: ["dist/**", "**/node_modules/**"],
		server: {
			deps: {
				external: [/@silvia-odwyer\/photon-node/],
			},
		},
		coverage: {
			provider: "v8",
			include: ["src/extensions/**"],
			exclude: [
				"src/extensions/pi-intercom/**",
				"src/extensions/pi-powerline-footer/**",
				"src/extensions/pi-rewind-hook/**",
				"src/extensions/pi-subagents/**",
				"src/extensions/pi-web-agent/**",
				"src/extensions/**/*.test.ts",
				"src/extensions/**/*.test.js",
				"src/extensions/**/tests/**",
				"src/extensions/**/test/**",
				"src/extensions/**/package.json",
				"src/extensions/**/types.ts",
				"src/extensions/test-resolve-hook*.mjs",
			],
			thresholds: {
				statements: 100,
				functions: 100,
				branches: 100,
				lines: 100,
			},
		},
	},
	resolve: {
		alias: {
			// Self-reference resolves to the built package in this flattened fork.
			"@selesai/code": resolve(__dirname, "dist/index.js"),
			// Bundled pi extensions import the upstream package; map it to the host core too.
			"@earendil-works/pi-coding-agent": resolve(__dirname, "dist/index.js"),
		},
	},
});
