import { describe, expect, it, vi } from "vitest";
import { Type } from "typebox";
import { AgentSession } from "./agent-session.ts";
import type { ExtensionRunner } from "./extensions/runner.ts";
import type { ResolvedCommand, ToolDefinition } from "./extensions/types.ts";
import { SettingsManager } from "./settings-manager.ts";

function createMockSession({
	enabled,
	threshold = 128_000,
	tokens,
	mode = "tui",
	command,
	customTools,
	allowedToolNames,
}: {
	enabled: boolean;
	threshold?: number;
	tokens: number | null;
	mode?: "tui" | "print" | "rpc";
	command?: ResolvedCommand | undefined;
	customTools?: ToolDefinition[];
	allowedToolNames?: string[];
}) {
	const settings = SettingsManager.inMemory({
		autoHandoff: { enabled, thresholdTokens: threshold },
	});

	const getCommand = vi.fn(() => command);
	const handler = command?.handler ?? vi.fn();
	const createCommandContext = vi.fn(() => ({ mock: "ctx" }) as unknown as never);
	const emitError = vi.fn();

	const extensionRunner = {
		getCommand,
		createCommandContext,
		emitError,
		emit: vi.fn(),
	} as unknown as ExtensionRunner;

	const resourceLoader = {
		getExtensions: () => ({ extensions: [], errors: [], runtime: { flagValues: new Map(), pendingProviderRegistrations: [], pendingNativeProviderRegistrations: [], assertActive: () => {} } }),
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPromptSkills: () => [],
		setSkillsIndexFilter: () => {},
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgents: () => ({ agents: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => undefined,
		getAppendSystemPrompt: () => [],
		getExtensionDiagnostics: () => [],
		extendResources: () => {},
		reload: vi.fn(),
	};

	const modelRegistry = {
		registerProvider: vi.fn(),
		unregisterProvider: vi.fn(),
		getProvider: vi.fn(),
		getProviders: vi.fn(() => []),
		getModels: vi.fn(() => []),
	};

	const agent = {
		state: { messages: [], tools: [] },
		subscribe: vi.fn(() => () => {}),
	};

	const session = new AgentSession({
		agent: agent as unknown as never,
		sessionManager: { getBranch: () => [] } as unknown as never,
		settingsManager: settings,
		cwd: "/tmp",
		resourceLoader: resourceLoader as unknown as never,
		customTools,
		modelRuntime: modelRegistry as unknown as never,
		allowedToolNames,
	});

	(session as any)._extensionRunner = extensionRunner;
	(session as any)._extensionMode = mode;
	(session as any).getContextUsage = () =>
		tokens === null ? null : { tokens, contextWindow: 200_000, percent: tokens / 200_000 };

	return { session, getCommand, createCommandContext, handler, emitError, settings };
}

describe("AgentSession tools", () => {
	const customTool: ToolDefinition = {
		name: "custom",
		label: "Custom",
		description: "A custom tool",
		parameters: Type.Object({}),
		execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
	};

	it("keeps custom tools inactive by default but activates explicitly allowed ones", () => {
		const defaults = createMockSession({ enabled: false, tokens: null, customTools: [customTool] });
		expect(defaults.session.getActiveToolNames()).not.toContain("custom");

		const allowed = createMockSession({
			enabled: false,
			tokens: null,
			customTools: [customTool],
			allowedToolNames: ["custom"],
		});
		expect(allowed.session.getActiveToolNames()).toEqual(["custom"]);
	});
});

describe("AgentSession auto handoff", () => {
	it("invokes handoff-new once when enabled and threshold reached in tui mode", async () => {
		const command = { handler: vi.fn() } as unknown as ResolvedCommand;
		const { session, getCommand, createCommandContext, emitError } = createMockSession({
			enabled: true,
			tokens: 128_000,
			command,
		});

		await (session as any)._checkAutoHandoff();
		await (session as any)._checkAutoHandoff();

		expect(getCommand).toHaveBeenCalledWith("handoff-new");
		expect(createCommandContext).toHaveBeenCalled();
		expect(command.handler).toHaveBeenCalledTimes(1);
		expect(command.handler).toHaveBeenCalledWith("", expect.anything());
		expect(emitError).not.toHaveBeenCalled();
	});

	it("dispatches auto handoff via _emitAgentSettled in tui mode", async () => {
		const command = { handler: vi.fn() } as unknown as ResolvedCommand;
		const { session } = createMockSession({ enabled: true, tokens: 200_000, command });
		const events: string[] = [];
		session.subscribe((event) => {
			if (event.type === "agent_settled") events.push(event.type);
		});

		await (session as any)._emitAgentSettled();

		expect(events).toEqual(["agent_settled"]);
		expect(command.handler).toHaveBeenCalledTimes(1);
	});

	it("_emitAgentSettled does not auto-handoff in non-tui mode", async () => {
		const command = { handler: vi.fn() } as unknown as ResolvedCommand;
		const { session } = createMockSession({
			enabled: true,
			tokens: 200_000,
			mode: "print",
			command,
		});
		const events: string[] = [];
		session.subscribe((event) => {
			if (event.type === "agent_settled") events.push(event.type);
		});

		await (session as any)._emitAgentSettled();

		expect(events).toEqual(["agent_settled"]);
		expect(command.handler).not.toHaveBeenCalled();
	});

	it("does nothing when disabled", async () => {
		const command = { handler: vi.fn() } as unknown as ResolvedCommand;
		const { session, getCommand } = createMockSession({ enabled: false, tokens: 200_000, command });

		await (session as any)._checkAutoHandoff();

		expect(getCommand).not.toHaveBeenCalled();
	});

	it("does nothing when tokens are below threshold", async () => {
		const command = { handler: vi.fn() } as unknown as ResolvedCommand;
		const { session, getCommand } = createMockSession({ enabled: true, tokens: 127_999, command });

		await (session as any)._checkAutoHandoff();

		expect(getCommand).not.toHaveBeenCalled();
	});

	it("does nothing when tokens are null", async () => {
		const command = { handler: vi.fn() } as unknown as ResolvedCommand;
		const { session, getCommand } = createMockSession({ enabled: true, tokens: null, command });

		await (session as any)._checkAutoHandoff();

		expect(getCommand).not.toHaveBeenCalled();
	});

	it("does nothing in non-tui mode", async () => {
		const command = { handler: vi.fn() } as unknown as ResolvedCommand;
		const { session, getCommand } = createMockSession({
			enabled: true,
			tokens: 200_000,
			mode: "rpc",
			command,
		});

		await (session as any)._checkAutoHandoff();

		expect(getCommand).not.toHaveBeenCalled();
	});

	it("does nothing when handoff-new command is not registered", async () => {
		const { session, getCommand } = createMockSession({ enabled: true, tokens: 200_000, command: undefined });

		await (session as any)._checkAutoHandoff();

		expect(getCommand).toHaveBeenCalledWith("handoff-new");
	});

	it("emits error when handoff-new throws but does not rethrow", async () => {
		const command = {
			handler: vi.fn(() => Promise.reject(new Error("boom"))),
		} as unknown as ResolvedCommand;
		const { session, emitError } = createMockSession({ enabled: true, tokens: 200_000, command });

		await expect((session as any)._checkAutoHandoff()).resolves.toBeUndefined();

		expect(emitError).toHaveBeenCalledWith({
			extensionPath: "command:handoff-new",
			event: "auto-handoff",
			error: "boom",
		});
	});

	it("resets triggered flag when tokens drop below threshold", async () => {
		const command = { handler: vi.fn() } as unknown as ResolvedCommand;
		const { session, getCommand } = createMockSession({ enabled: true, tokens: 200_000, command });

		await (session as any)._checkAutoHandoff();
		expect(command.handler).toHaveBeenCalledTimes(1);

		// Simulate tokens dropping below threshold (e.g. compaction/new session)
		(session as any).getContextUsage = () => ({ tokens: 1000, contextWindow: 200_000, percent: 0.5 });
		await (session as any)._checkAutoHandoff();
		expect(command.handler).toHaveBeenCalledTimes(1); // still once

		// Tokens rise above threshold again
		(session as any).getContextUsage = () => ({ tokens: 200_000, contextWindow: 200_000, percent: 100 });
		await (session as any)._checkAutoHandoff();
		expect(command.handler).toHaveBeenCalledTimes(2);
	});
});
