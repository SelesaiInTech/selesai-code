import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import {
	applyCapabilityConfigGuards,
	detectToolDisplayCapabilities,
} from "../src/capabilities.ts";
import { DEFAULT_TOOL_DISPLAY_CONFIG } from "../src/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createApiStub(
	allTools: unknown[],
	commands: Array<{ name: string }> = [],
	getAllToolsThrows = false,
	getCommandsThrows = false,
): ExtensionAPI {
	return {
		getAllTools: () => {
			if (getAllToolsThrows) {
				throw new Error("getAllTools failed");
			}
			return allTools;
		},
		getCommands: () => {
			if (getCommandsThrows) {
				throw new Error("getCommands failed");
			}
			return commands;
		},
	} as unknown as ExtensionAPI;
}

function makeMcpTool(name: string, description?: string): unknown {
	return {
		name,
		description: description ?? `MCP wrapper for ${name}`,
		parameters: {},
	};
}

function makeNonMcpTool(name: string): unknown {
	return {
		name,
		description: `Built-in ${name} tool`,
		parameters: {},
		execute: () => {},
	};
}

function withTempDir(name: string, fn: (dir: string) => void): void {
	const dir = mkdtempSync(join(tmpdir(), name));
	try {
		fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("returns no capabilities when API is empty", () => {
	withTempDir("pi-cap-empty-", (dir) => {
		const oldEnv = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = dir;
		try {
			const api = createApiStub([], []);
			const caps = detectToolDisplayCapabilities(api, dir);
			assert.equal(caps.hasMcpTooling, false);
			assert.equal(caps.hasRtkOptimizer, false);
		} finally {
			if (oldEnv === undefined) {
				delete process.env.PI_CODING_AGENT_DIR;
			} else {
				process.env.PI_CODING_AGENT_DIR = oldEnv;
			}
		}
	});
});

test("detects MCP capability via isMcpToolCandidate with 'MCP' in description", () => {
	const api = createApiStub([
		makeMcpTool("exa_web_search_exa", "Search the web. Direct MCP wrapper for 'exa:web_search_exa'."),
	]);
	const caps = detectToolDisplayCapabilities(api, "/tmp");

	assert.equal(caps.hasMcpTooling, true);
});

test("detects MCP capability via tool named 'mcp'", () => {
	const api = createApiStub([
		makeNonMcpTool("read"),
		{ name: "mcp", description: "MCP proxy", parameters: {} },
	]);
	const caps = detectToolDisplayCapabilities(api, "/tmp");

	assert.equal(caps.hasMcpTooling, true);
});

test("non-MCP tools do not set hasMcpTooling", () => {
	const api = createApiStub([
		makeNonMcpTool("read"),
		makeNonMcpTool("edit"),
		makeNonMcpTool("bash"),
	]);
	const caps = detectToolDisplayCapabilities(api, "/tmp");

	assert.equal(caps.hasMcpTooling, false);
});

test("handles getAllTools throwing gracefully", () => {
	const api = createApiStub([], [], true);
	const caps = detectToolDisplayCapabilities(api, "/tmp");

	assert.equal(caps.hasMcpTooling, false);
	// Should still attempt RTK detection
	assert.equal(typeof caps.hasRtkOptimizer, "boolean");
});

test("recognises RTK capability via registered command", () => {
	const api = createApiStub([], [{ name: "rtk" }]);
	const caps = detectToolDisplayCapabilities(api, "/tmp");

	assert.equal(caps.hasRtkOptimizer, true);
});

test("recognises RTK capability via rtk- prefix command", () => {
	const api = createApiStub([], [{ name: "rtk-compact" }]);
	const caps = detectToolDisplayCapabilities(api, "/tmp");

	assert.equal(caps.hasRtkOptimizer, true);
});

test("handles getCommands throwing gracefully and falls back to path probe", () => {
	withTempDir("pi-cap-cmd-throw-", (dir) => {
		const oldEnv = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = dir;
		try {
			const api = createApiStub([], [], false, true);
			const caps = detectToolDisplayCapabilities(api, dir);
			assert.equal(caps.hasRtkOptimizer, false);
		} finally {
			if (oldEnv === undefined) {
				delete process.env.PI_CODING_AGENT_DIR;
			} else {
				process.env.PI_CODING_AGENT_DIR = oldEnv;
			}
		}
	});
});

test("detects RTK extension path when pi-rtk-optimizer exists in agent dir", () => {
	withTempDir("pi-rtk-test-", (dir) => {
		const extDir = join(dir, "extensions", "pi-rtk-optimizer");
		mkdirSync(extDir, { recursive: true });

		const oldEnv = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = dir;

		try {
			const api = createApiStub([], []);
			const caps = detectToolDisplayCapabilities(api, dir);
			assert.equal(caps.hasRtkOptimizer, true);
		} finally {
			if (oldEnv === undefined) {
				delete process.env.PI_CODING_AGENT_DIR;
			} else {
				process.env.PI_CODING_AGENT_DIR = oldEnv;
			}
		}
	});
});

test("detects RTK extension via cwd config-dir path", () => {
	withTempDir("pi-rtk-cwd-", (dir) => {
		const extDir = join(dir, CONFIG_DIR_NAME, "extensions", "pi-rtk-optimizer");
		mkdirSync(extDir, { recursive: true });

		const api = createApiStub([], []);
		const caps = detectToolDisplayCapabilities(api, dir);

		assert.equal(caps.hasRtkOptimizer, true);
	});
});

test("no false positive when both commands and path are absent", () => {
	withTempDir("pi-cap-no-fp-", (dir) => {
		const oldEnv = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = dir;
		try {
			const api = createApiStub([], []);
			const caps = detectToolDisplayCapabilities(api, dir);
			assert.equal(caps.hasRtkOptimizer, false);
		} finally {
			if (oldEnv === undefined) {
				delete process.env.PI_CODING_AGENT_DIR;
			} else {
				process.env.PI_CODING_AGENT_DIR = oldEnv;
			}
		}
	});
});

test("applyCapabilityConfigGuards preserves MCP output when MCP may appear dynamically", () => {
	const guarded = applyCapabilityConfigGuards(
		{ ...DEFAULT_TOOL_DISPLAY_CONFIG, mcpOutputMode: "preview" },
		{ hasMcpTooling: false, hasRtkOptimizer: true },
	);

	assert.equal(guarded.mcpOutputMode, "preview");
	assert.equal(guarded.showRtkCompactionHints, DEFAULT_TOOL_DISPLAY_CONFIG.showRtkCompactionHints);
});

test("applyCapabilityConfigGuards disables RTK hints when RTK unavailable", () => {
	const guarded = applyCapabilityConfigGuards(
		{ ...DEFAULT_TOOL_DISPLAY_CONFIG, showRtkCompactionHints: true },
		{ hasMcpTooling: true, hasRtkOptimizer: false },
	);

	assert.equal(guarded.mcpOutputMode, DEFAULT_TOOL_DISPLAY_CONFIG.mcpOutputMode);
	assert.equal(guarded.showRtkCompactionHints, false);
});

test("applyCapabilityConfigGuards preserves values when both capabilities present", () => {
	const input = {
		...DEFAULT_TOOL_DISPLAY_CONFIG,
		mcpOutputMode: "preview" as const,
		showRtkCompactionHints: true,
	};
	const guarded = applyCapabilityConfigGuards(input, {
		hasMcpTooling: true,
		hasRtkOptimizer: true,
	});

	assert.equal(guarded.mcpOutputMode, "preview");
	assert.equal(guarded.showRtkCompactionHints, true);
});

test("applyCapabilityConfigGuards clones registerToolOverrides", () => {
	const input = { ...DEFAULT_TOOL_DISPLAY_CONFIG };
	const guarded = applyCapabilityConfigGuards(input, {
		hasMcpTooling: false,
		hasRtkOptimizer: false,
	});

	// Modifying the source should not affect the guarded copy
	const originalOverrides = input.registerToolOverrides;
	const guardedOverrides = guarded.registerToolOverrides;
	assert.notEqual(originalOverrides, guardedOverrides, "should be a different object");
	assert.deepEqual(originalOverrides, guardedOverrides);
});

// #6: PI_CODING_AGENT_DIR support — env var changes affect RTK path probe
test("PI_CODING_AGENT_DIR influences RTK extension path detection", () => {
	withTempDir("pi-coding-agent-dir-", (dir) => {
		// Create the expected rtk-optimizer path inside a custom agent dir
		const extDir = join(dir, "extensions", "pi-rtk-optimizer");
		mkdirSync(extDir, { recursive: true });

		const previousEnv = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = dir;

		try {
			const api = createApiStub([], []);
			const caps = detectToolDisplayCapabilities(api, dir);
			assert.equal(caps.hasRtkOptimizer, true, "PI_CODING_AGENT_DIR should point to dir with rtk-optimizer");
		} finally {
			if (previousEnv === undefined) {
				delete process.env.PI_CODING_AGENT_DIR;
			} else {
				process.env.PI_CODING_AGENT_DIR = previousEnv;
			}
		}
	});
});

test("PI_CODING_AGENT_DIR set to dir without rtk-optimizer yields no RTK capability", () => {
	withTempDir("pi-cap-no-rtk-", (dir) => {
		const oldEnv = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = dir;
		try {
			const api = createApiStub([], []);
			const caps = detectToolDisplayCapabilities(api, dir);
			assert.equal(caps.hasRtkOptimizer, false, "dir without rtk-optimizer should yield false");
		} finally {
			if (oldEnv === undefined) {
				delete process.env.PI_CODING_AGENT_DIR;
			} else {
				process.env.PI_CODING_AGENT_DIR = oldEnv;
			}
		}
	});
});

// #20: peer dependency compatibility — missing/renamed APIs
test("tools without description do not trigger false MCP detection", () => {
	const api = createApiStub([
		{ name: "custom-tool", parameters: {} },
	]);
	const caps = detectToolDisplayCapabilities(api, "/tmp");

	assert.equal(caps.hasMcpTooling, false);
});

test("tools with 'MCP' in the description but no MCP-like name are detected", () => {
	const api = createApiStub([
		{
			name: "random_tool",
			description: "This uses the MCP protocol for communication with external servers.",
			parameters: {},
		},
	]);
	const caps = detectToolDisplayCapabilities(api, "/tmp");

	assert.equal(caps.hasMcpTooling, true);
});

test("tool with empty name string is handled safely", () => {
	const api = createApiStub([
		{ name: "", description: "empty name tool", parameters: {} },
	]);
	const caps = detectToolDisplayCapabilities(api, "/tmp");

	assert.equal(caps.hasMcpTooling, false);
});

test("tool with undefined name is handled safely", () => {
	const api = createApiStub([
		{ description: "no name field", parameters: {} },
	]);
	const caps = detectToolDisplayCapabilities(api, "/tmp");

	assert.equal(caps.hasMcpTooling, false);
});

test("commands list can contain non-string name entries", () => {
	const api = createApiStub(
		[],
		// @ts-expect-error testing edge case
		[{ name: 123 }, { name: "rtk" }],
	);
	const caps = detectToolDisplayCapabilities(api, "/tmp");

	assert.equal(caps.hasRtkOptimizer, true);
});

test("empty allTools array does not throw", () => {
	const api = createApiStub([]);
	const caps = detectToolDisplayCapabilities(api, "/tmp");

	assert.equal(caps.hasMcpTooling, false);
});
