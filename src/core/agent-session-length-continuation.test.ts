import { describe, expect, it, vi } from "vitest";
import { AgentSession } from "./agent-session.ts";
import type { ExtensionRunner } from "./extensions/runner.ts";
import { SettingsManager } from "./settings-manager.ts";

function createMockSession() {
	const settings = SettingsManager.inMemory({});

	const extensionRunner = {
		getCommand: vi.fn(),
		createCommandContext: vi.fn(),
		emitError: vi.fn(),
		emit: vi.fn(),
		emitMessageEnd: vi.fn(),
		hasHandlers: vi.fn(() => false),
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

	const followUp = vi.fn();
	const hasQueuedMessages = vi.fn(() => false);
	const agent = {
		state: { messages: [], tools: [] },
		subscribe: vi.fn(() => () => {}),
		followUp,
		hasQueuedMessages,
	};

	const session = new AgentSession({
		agent: agent as unknown as never,
		sessionManager: { getBranch: () => [], appendMessage: vi.fn() } as unknown as never,
		settingsManager: settings,
		cwd: "/tmp",
		resourceLoader: resourceLoader as unknown as never,
		modelRuntime: modelRegistry as unknown as never,
	});

	(session as any)._extensionRunner = extensionRunner;

	return { session, followUp, hasQueuedMessages };
}

function lengthStopMessage(text: string) {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		stopReason: "length",
		timestamp: Date.now(),
		usage: { input: 100, output: 500, cacheRead: 0, cacheWrite: 0, totalTokens: 600, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	};
}

describe("AgentSession length-stop continuation", () => {
	it("queues a follow-up continuation and returns true for a truncated text response", async () => {
		const { session, followUp } = createMockSession();
		(session as any)._lastAssistantMessage = lengthStopMessage("partial response...");

		const result = await (session as any)._handlePostAgentRun();

		expect(result).toBe(true);
		expect(followUp).toHaveBeenCalledTimes(1);
		const queued = followUp.mock.calls[0][0];
		expect(queued.role).toBe("user");
		expect(queued.content[0].text).toContain("Continue from where you left off");
	});

	it("does not continue when the truncated message contains tool calls", async () => {
		const { session, followUp } = createMockSession();
		(session as any)._lastAssistantMessage = {
			role: "assistant",
			content: [{ type: "toolCall", id: "tc_1", name: "bash", arguments: "{}" }],
			stopReason: "length",
			timestamp: Date.now(),
		};

		const result = await (session as any)._handlePostAgentRun();

		expect(result).toBe(false);
		expect(followUp).not.toHaveBeenCalled();
	});

	it("stops after MAX_LENGTH_CONTINUATIONS consecutive length stops", async () => {
		const { session, followUp } = createMockSession();
		(session as any)._lengthContinuations = 3;

		(session as any)._lastAssistantMessage = lengthStopMessage("still truncated...");
		const result = await (session as any)._handlePostAgentRun();

		expect(result).toBe(false);
		expect(followUp).not.toHaveBeenCalled();
	});

	it("resets the continuation counter on a non-length assistant stop", async () => {
		const { session } = createMockSession();
		(session as any)._lengthContinuations = 2;

		await (session as any)._handleAgentEvent({
			type: "message_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "done" }],
				stopReason: "stop",
				timestamp: Date.now(),
			},
		});

		expect((session as any)._lengthContinuations).toBe(0);
	});
});
