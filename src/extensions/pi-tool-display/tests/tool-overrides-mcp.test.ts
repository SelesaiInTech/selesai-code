import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isMcpToolCandidate } from "../src/tool-metadata.ts";
import { registerToolDisplayOverrides } from "../src/tool-overrides.ts";
import { DEFAULT_TOOL_DISPLAY_CONFIG, type ToolDisplayConfig } from "../src/types.ts";

// ─── Test Types ──────────────────────────────────────────────────────────────

interface RenderThemeLike {
	fg(color: string, value: string): string;
	bold(value: string): string;
}

interface RegisteredToolLike {
	name: string;
	description?: string;
	parameters?: unknown;
	promptSnippet?: string;
	promptGuidelines?: string[];
	renderCall?: (...args: unknown[]) => unknown;
	renderResult?: (...args: unknown[]) => unknown;
	execute?: (...args: unknown[]) => unknown;
}

interface ToolEventHandlers {
	session_start?: () => Promise<void> | void;
	before_agent_start?: () => Promise<void> | void;
}

interface RuntimeTool extends Record<string, unknown> {
	name: string;
	description: string;
	parameters?: unknown;
	execute?: (...args: unknown[]) => unknown;
	renderCall?: (...args: unknown[]) => unknown;
	renderResult?: (...args: unknown[]) => unknown;
	promptSnippet?: string;
	promptGuidelines?: string[];
	label?: string;
}

// ─── Test Helpers ────────────────────────────────────────────────────────────

function buildConfig(overrides: Partial<ToolDisplayConfig>): ToolDisplayConfig {
	return {
		...DEFAULT_TOOL_DISPLAY_CONFIG,
		...overrides,
		boxedToolCalls: overrides.boxedToolCalls ?? false,
		registerToolOverrides: {
			...DEFAULT_TOOL_DISPLAY_CONFIG.registerToolOverrides,
			...overrides.registerToolOverrides,
		},
	};
}

function withDefaultReadEditOwners(tools: RuntimeTool[] = []): RuntimeTool[] {
	const names = new Set(tools.map((t) => t.name));
	const defaults: RuntimeTool[] = ["read", "edit"]
		.filter((name) => !names.has(name))
		.map((name) => ({
			name,
			description: `Built-in ${name} tool`,
			sourceInfo: { source: "builtin", path: `<builtin:${name}>` },
		}));
	return [...defaults, ...tools];
}

function createExtensionApiStub(allTools: RuntimeTool[] = []): {
	api: ExtensionAPI;
	registeredTools: RegisteredToolLike[];
	runtimeTools: RuntimeTool[];
	eventHandlers: ToolEventHandlers;
} {
	const registeredTools: RegisteredToolLike[] = [];
	const eventHandlers: ToolEventHandlers = {};
	const api = {
		registerTool(tool: RegisteredToolLike): void {
			registeredTools.push(tool);
		},
		on(event: keyof ToolEventHandlers, handler: () => Promise<void> | void): void {
			eventHandlers[event] = handler;
		},
		getAllTools(): RuntimeTool[] {
			return withDefaultReadEditOwners(allTools);
		},
	} as unknown as ExtensionAPI;

	return { api, registeredTools, runtimeTools: allTools, eventHandlers };
}

async function runLifecycle(eventHandlers: ToolEventHandlers): Promise<void> {
	await eventHandlers.session_start?.();
	await eventHandlers.before_agent_start?.();
}

function createTheme(): RenderThemeLike {
	return {
		fg: (_color: string, value: string): string => value,
		bold: (value: string): string => value,
	};
}

function renderToText(component: unknown): string {
	return (component as { render: (width: number) => string[] }).render(120).map((line) => line.trimEnd()).join("\n").trim();
}

// ─── isMcpToolCandidate Unit Tests ───────────────────────────────────────────

test("isMcpToolCandidate returns true when name is 'mcp'", () => {
	assert.equal(isMcpToolCandidate({ name: "mcp", description: "unified gateway" }), true);
});

test("isMcpToolCandidate returns true when description contains whole word 'mcp' (case-insensitive)", () => {
	assert.equal(isMcpToolCandidate({ name: "web_search", description: "MCP tool for web search" }), true);
	assert.equal(isMcpToolCandidate({ name: "web_search", description: "mcp tool for web search" }), true);
	assert.equal(isMcpToolCandidate({ name: "web_search", description: "An MCP-based search" }), true);
});

test("isMcpToolCandidate returns false when description has 'mcp' substring but not whole word", () => {
	// 'mcp' as substring of a larger word should NOT match /\bmcp\b/i
	assert.equal(isMcpToolCandidate({ name: "some_tool", description: "McPherson's tool" }), false);
	assert.equal(isMcpToolCandidate({ name: "some_tool", description: "mcp_test function" }), false);
	assert.equal(isMcpToolCandidate({ name: "some_tool", description: "mcpExample" }), false);
});

test("isMcpToolCandidate returns false for false positives (tool with 'mcp' in description not actually MCP)", () => {
	// Tool named "mcpify" that mentions mcp in its description but isn't actually an MCP tool
	// The word boundary in /\bmcp\b/i means "mcpm" and "mcpify" won't match
	assert.equal(isMcpToolCandidate({ name: "mcpify", description: "Tool to mcpify your code" }), false);
	assert.equal(isMcpToolCandidate({ name: "mcp_manager", description: "Manage mcp connections" }), true); // whole word
});

test("isMcpToolCandidate recognises pi-mcp-adapter direct tools through sourceInfo", () => {
	assert.equal(
		isMcpToolCandidate({
			name: "xcodebuild_list_sims",
			description: "List available iOS simulators.",
			parameters: {},
			sourceInfo: {
				source: "local",
				path: "C:/Users/Administrator/.selesai/agent/extensions/pi-mcp-adapter/index.ts",
			},
		}),
		true,
	);
});

test("isMcpToolCandidate returns false when description is undefined", () => {
	assert.equal(isMcpToolCandidate({ name: "random_tool" }), false);
});

test("isMcpToolCandidate returns false when description is empty string", () => {
	assert.equal(isMcpToolCandidate({ name: "random_tool", description: "" }), false);
});

test("isMcpToolCandidate returns false when description is only whitespace", () => {
	assert.equal(isMcpToolCandidate({ name: "random_tool", description: "   " }), false);
});

test("isMcpToolCandidate returns false when tool is null", () => {
	assert.equal(isMcpToolCandidate(null), false);
});

test("isMcpToolCandidate returns false when tool is undefined", () => {
	assert.equal(isMcpToolCandidate(undefined), false);
});

test("isMcpToolCandidate returns false when tool is a string", () => {
	assert.equal(isMcpToolCandidate("mcp"), false);
});

// ─── MCP Decoration ──────────────────────────────────────────────────────────

test("MCP tool receives renderCall and renderResult decorations after lifecycle", async () => {
	const mcpTool: RuntimeTool = {
		name: "mcp",
		description: "Unified MCP gateway for status, discovery, reconnects, and proxy tool calls.",
		parameters: {},
		execute: () => {},
	};
	const { api, runtimeTools, eventHandlers } = createExtensionApiStub([mcpTool]);

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);
	await runLifecycle(eventHandlers);

	assert.equal(typeof mcpTool.renderCall, "function", "MCP proxy should get renderCall");
	assert.equal(typeof mcpTool.renderResult, "function", "MCP proxy should get renderResult");
	assert.equal(mcpTool.label, "MCP Proxy");
});

test("MCP tool decoration preserves execute function", async () => {
	const mcpTool: RuntimeTool = {
		name: "mcp",
		description: "Unified MCP gateway.",
		parameters: {},
		execute: () => "executed",
	};
	const { api, eventHandlers } = createExtensionApiStub([mcpTool]);

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);
	await runLifecycle(eventHandlers);

	assert.equal(typeof mcpTool.execute, "function", "execute should be preserved");
});

test("MCP tool without execute function gets rendered without it", async () => {
	// Tool from pi.getAllTools() that has no execute — rendering should still work
	const mcpTool: RuntimeTool = {
		name: "example_mcp",
		description: "An MCP example tool for testing.",
		parameters: {},
	};
	const { api, runtimeTools, eventHandlers } = createExtensionApiStub([mcpTool]);

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);
	await runLifecycle(eventHandlers);

	assert.equal(typeof mcpTool.renderCall, "function", "should get renderCall even without execute");
	assert.equal(typeof mcpTool.renderResult, "function", "should get renderResult even without execute");
});

test("MCP tool with missing parameters still gets decorations", async () => {
	const mcpTool: RuntimeTool = {
		name: "minimal_mcp",
		description: "An MCP tool.",
		// No parameters field
		execute: () => {},
	};
	const { api, eventHandlers } = createExtensionApiStub([mcpTool]);

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);
	await runLifecycle(eventHandlers);

	assert.equal(typeof mcpTool.renderCall, "function");
	assert.equal(typeof mcpTool.renderResult, "function");
});

// ─── wrappedMcpToolNames: No Double Decoration ───────────────────────────────

test("MCP tool is not decorated twice when registerMcpToolOverrides runs multiple times", async () => {
	const mcpTool: RuntimeTool = {
		name: "single_mcp",
		description: "An MCP tool.",
		parameters: {},
		execute: () => {},
	};
	const { api, runtimeTools, eventHandlers } = createExtensionApiStub([mcpTool]);

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);

	// Run lifecycle multiple times (simulating multiple session_start events)
	await runLifecycle(eventHandlers);
	await runLifecycle(eventHandlers);

	// renderCall should only be set once — verify it's a function and calling it works
	assert.equal(typeof mcpTool.renderCall, "function");
	const firstRenderCall = mcpTool.renderCall;
	// Running lifecycle again should not replace renderCall
	await runLifecycle(eventHandlers);
	assert.equal(mcpTool.renderCall, firstRenderCall, "renderCall should not be replaced on second decoration pass");
});

// ─── Late MCP Tool Registration (Race Condition) ─────────────────────────────

test("MCP tool registered AFTER session_start but BEFORE before_agent_start gets decorated", async () => {
	const { api, runtimeTools, eventHandlers } = createExtensionApiStub([]);

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);

	// session_start fires
	await eventHandlers.session_start?.();

	// Another extension registers an MCP tool after session_start
	const lateMcpTool: RuntimeTool = {
		name: "late_registered_mcp",
		description: "MCP tool registered after session start.",
		parameters: {},
		execute: () => {},
	};
	runtimeTools.push(lateMcpTool);

	// before_agent_start fires — should discover the late tool
	await eventHandlers.before_agent_start?.();

	assert.equal(
		typeof lateMcpTool.renderCall,
		"function",
		"late-registered MCP tool should be decorated at before_agent_start",
	);
});

test("MCP tool discovered after both session_start and before_agent_start is decorated by delayed discovery", async () => {
	const { api, runtimeTools, eventHandlers } = createExtensionApiStub([]);

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);

	await runLifecycle(eventHandlers);

	const veryLateMcpTool: RuntimeTool = {
		name: "very_late_mcp",
		description: "A tool using MCP protocol registered after lifecycle.",
		parameters: {},
		execute: () => {},
	};
	runtimeTools.push(veryLateMcpTool);

	await new Promise((resolve) => setTimeout(resolve, 80));

	assert.equal(
		typeof veryLateMcpTool.renderCall,
		"function",
		"tool discovered after full lifecycle should be decorated by retry discovery",
	);
});

test("MCP tools registered before lifecycle are all decorated after session_start", async () => {
	const mcpTools: RuntimeTool[] = [
		{ name: "mcp_user_search", description: "Search users via MCP.", parameters: {}, execute: () => {} },
		{ name: "mcp_db_query", description: "Query database via MCP.", parameters: {}, execute: () => {} },
	];
	const { api, eventHandlers } = createExtensionApiStub(mcpTools);

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);
	await eventHandlers.session_start?.();

	for (const tool of mcpTools) {
		assert.equal(
			typeof tool.renderCall,
			"function",
			`MCP tool '${tool.name}' should be decorated after session_start`,
		);
	}
});

// ─── MCP renderCall Output ───────────────────────────────────────────────────

test("MCP renderCall shows tool target and arg count with no args", async () => {
	const mcpTool: RuntimeTool = {
		name: "mcp",
		description: "Unified MCP gateway for status, discovery, reconnects, and proxy tool calls.",
		parameters: {},
		execute: () => {},
	};
	const { api, eventHandlers } = createExtensionApiStub([mcpTool]);

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);
	await runLifecycle(eventHandlers);

	const component = mcpTool.renderCall!({}, createTheme());
	const rendered = (component as { render: (w: number) => string[] }).render(120).map(l => l.trimEnd()).join("\n").trim();
	assert.equal(rendered, "MCP status (no args)");
});

test("MCP renderCall shows server:tool when both tool and server args are present", async () => {
	const mcpTool: RuntimeTool = {
		name: "mcp",
		description: "Unified MCP gateway.",
		parameters: {},
		execute: () => {},
	};
	const { api, eventHandlers } = createExtensionApiStub([mcpTool]);

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);
	await runLifecycle(eventHandlers);

	const component = mcpTool.renderCall!({ tool: "read_file", server: "filesystem" }, createTheme());
	assert.equal(renderToText(component), "MCP call filesystem:read_file (2 args)");
});

// ─── Existing MCP Adapter Renderers ──────────────────────────────────────────

test("pi-mcp-adapter tools with existing renderers are overridden by MCP display decoration", async () => {
	const config = buildConfig({ mcpOutputMode: "summary" });
	const mcpTool: RuntimeTool = {
		name: "mcp",
		label: "MCP",
		description: "MCP gateway - connect to MCP servers and call their tools",
		parameters: {},
		execute: () => {},
		renderCall: () => ({ render: () => ["RAW MCP CALL"] }),
		renderResult: () => ({ render: () => ["RAW MCP RESULT"] }),
	};
	const { api, eventHandlers } = createExtensionApiStub([mcpTool]);

	registerToolDisplayOverrides(api, () => config);
	await runLifecycle(eventHandlers);

	const callText = renderToText(mcpTool.renderCall!({ tool: "read_file", server: "filesystem" }, createTheme()));
	const resultText = renderToText(mcpTool.renderResult!({ content: [{ type: "text", text: "line 1\nline 2" }] }, { expanded: false }, createTheme()));

	assert.equal(callText, "MCP call filesystem:read_file (2 args)");
	assert.equal(resultText, "↳ 2 lines returned • Ctrl+O to expand");
});

// ─── Prompt Metadata ─────────────────────────────────────────────────────────

test("MCP proxy tool gets promptSnippet and promptGuidelines", async () => {
	const mcpTool: RuntimeTool = {
		name: "mcp",
		description: "Unified MCP gateway.",
		parameters: {},
		execute: () => {},
	};
	const { api, runtimeTools, eventHandlers } = createExtensionApiStub([mcpTool]);

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);
	await runLifecycle(eventHandlers);

	assert.equal(
		mcpTool.promptSnippet,
		"Discover, inspect, and call MCP tools across configured servers",
	);
	assert.deepEqual(mcpTool.promptGuidelines, [
		"Use mcp for MCP discovery first: search by capability, describe one exact tool, then call it.",
	]);
});

test("non-proxy MCP tool gets promptSnippet from its description", async () => {
	// Tool description must contain "mcp" as a whole word for isMcpToolCandidate to match
	const mcpTool: RuntimeTool = {
		name: "web_search",
		description: "Search the web for current information using an MCP tool.",
		parameters: {},
		execute: () => {},
	};
	const { api, runtimeTools, eventHandlers } = createExtensionApiStub([mcpTool]);

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);
	await runLifecycle(eventHandlers);

	assert.match(mcpTool.promptSnippet ?? "", /Search the web/);
	assert.equal(mcpTool.promptGuidelines, undefined);
});

// ─── Config Controls ─────────────────────────────────────────────────────────

test("MCP decoration is independent of registerToolOverrides config", async () => {
	// MCP decoration happens regardless of registerToolOverrides settings
	const config = buildConfig({
		registerToolOverrides: {
			read: false,
			grep: false,
			find: false,
			ls: false,
			bash: false,
			edit: false,
			write: false,
		},
	});
	const mcpTool: RuntimeTool = {
		name: "mcp",
		description: "Unified MCP gateway for status, discovery, reconnects, and proxy tool calls.",
		parameters: {},
		execute: () => {},
	};
	const { api, eventHandlers } = createExtensionApiStub([mcpTool]);

	registerToolDisplayOverrides(api, () => config);
	await runLifecycle(eventHandlers);

	assert.equal(typeof mcpTool.renderCall, "function", "MCP decoration should work even with all built-in overrides disabled");
});

// ─── Multiple MCP Tools ──────────────────────────────────────────────────────

test("multiple non-proxy MCP tools each get independent decorations", async () => {
	const tools: RuntimeTool[] = [
		{ name: "filesystem_list", description: "List files via MCP.", parameters: {}, execute: () => {} },
		{ name: "db_query", description: "Query database via MCP.", parameters: {}, execute: () => {} },
		{ name: "web_search", description: "Search via MCP.", parameters: {}, execute: () => {} },
	];
	const { api, runtimeTools, eventHandlers } = createExtensionApiStub(tools);

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);
	await runLifecycle(eventHandlers);

	for (const tool of tools) {
		assert.equal(typeof tool.renderCall, "function", `${tool.name} should have renderCall`);
		assert.equal(typeof tool.renderResult, "function", `${tool.name} should have renderResult`);
	}
});

// ─── Edge: getAllTools Throws ────────────────────────────────────────────────

test("registerMcpToolOverrides handles getAllTools throwing gracefully", async () => {
	const { api, registeredTools, eventHandlers } = createExtensionApiStub([]);

	// Override getAllTools to throw
	(api as { getAllTools: () => unknown[] }).getAllTools = () => {
		throw new Error("getAllTools failed");
	};

	registerToolDisplayOverrides(api, () => DEFAULT_TOOL_DISPLAY_CONFIG);

	// Should not throw during lifecycle
	await runLifecycle(eventHandlers);
	assert.ok(true, "should not throw when getAllTools fails");
});
