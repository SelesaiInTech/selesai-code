/**
 * Test doubles for the Jev advisory routing extension.
 *
 * The extension is driven the way Selesai drives it: an `input` event opens a
 * turn, `before_agent_start` answers it, and telemetry arrives on the shared
 * event bus. Tests assert observable outcomes — the advisory context the parent
 * would receive, the request Jev would be sent, and the telemetry shape — never
 * private helper order.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@selesai/code";
import { JEV_ROUTING_EVENT, type JevAdvisoryConfig } from "./decisions.ts";
import {
	isMemorySearchRequest,
	MEMORY_SEARCH_REQUEST_EVENT,
	type MemorySearchRequestInput,
	type MemorySearchResponse,
} from "../pi-hermes-memory/src/memory-search-bridge.ts";

export interface SkillStub {
	name: string;
	description: string;
	filePath: string;
	scope?: "user" | "project" | "temporary";
	disableModelInvocation?: boolean;
}

export interface CommandStub {
	name: string;
	description?: string;
	source: "extension" | "prompt" | "skill";
}

export interface AdvisoryMessage {
	customType: string;
	content: string;
	display?: boolean;
	details?: unknown;
}

type Handler = (event: unknown, ctx: unknown) => unknown;

export interface AdvisoryHarness {
	pi: Record<string, unknown>;
	handlers: Map<string, Handler[]>;
	ctx: Record<string, unknown>;
	cwd: string;
	/** Every telemetry payload published on the routing channel, in order. */
	telemetry: Record<string, unknown>[];

	/** The message the extension would hand the parent, if it recommended anything. */
	advise(prompt: string, input?: Record<string, unknown>): Promise<AdvisoryMessage | undefined>;
	fire(event: string, payload?: unknown): Promise<unknown>;
	/** Fire the same turn's hook again, as a retry or a replayed run would. */
	replay(prompt: string): Promise<unknown>;
}

/** A registered model `jevModel` inherits its base URL from. */
export function providerTemplate() {
	return {
		provider: "tokenin",
		id: "celestial-pro",
		name: "celestial-pro",
		api: "openai-completions",
		baseUrl: "https://lite.andlet.me/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 393216,
		maxTokens: 64000,
	};
}

/** A directory that looks like the working tree of a Git repository. */
export function makeRepo(prefix: string): { root: string; repo: string } {
	const root = mkdtempSync(join(tmpdir(), prefix));
	const repo = join(root, "repo");
	mkdirSync(join(repo, ".git"), { recursive: true });
	return { root, repo };
}

export function writeJevSettings(settingsPath: string, advisory: unknown): void {
	writeFileSync(settingsPath, JSON.stringify({ jevAdvisory: advisory }), "utf-8");
}

export function makeHarness(options: {
	settingsPath: string;
	extension: (pi: ExtensionAPI) => void;
	cwd: string;
	skills?: SkillStub[];
	commands?: CommandStub[];
	branch?: unknown[];
	credential?: boolean;
	template?: boolean;
	/** The completion transport the route's registry serves; a failing one by default. */
	complete?: ReturnType<typeof vi.fn>;
	/** Local Hermes lookup result; this simulates the bundled memory extension. */
	memorySearch?: (input: MemorySearchRequestInput) => MemorySearchResponse | undefined;
}): AdvisoryHarness {
	const handlers = new Map<string, Handler[]>();
	const telemetry: Record<string, unknown>[] = [];
	const busHandlers = new Map<string, Array<(data: unknown) => void>>();
	const pi = {
		on: vi.fn((event: string, handler: Handler) => {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		}),
		events: {
			on: (channel: string, handler: (data: unknown) => void) => {
				busHandlers.set(channel, [...(busHandlers.get(channel) ?? []), handler]);
			},
			emit: (channel: string, data: unknown) => {
				if (channel === JEV_ROUTING_EVENT) telemetry.push(data as Record<string, unknown>);
				for (const handler of busHandlers.get(channel) ?? []) handler(data);
			},
		},
		getResolvedSkills: () => options.skills ?? [],
		getCommands: () => options.commands ?? [],
	};
	const ctx = {
		cwd: options.cwd,
		hasUI: true,
		mode: "tui",
		isIdle: () => true,
		isProjectTrusted: () => true,
		getSystemPrompt: () => "system prompt",
		modelRegistry: {
			getAll: () => (options.template === false ? [] : [providerTemplate()]),
			getApiKeyAndHeaders: vi.fn(async () =>
				options.credential === false ? { ok: false, error: "no key" } : { ok: true, apiKey: "key", headers: {} },
			),
			// A route that reaches the provider in a test must fail closed, so the
			// default answer is an error message rather than a live call.
			complete: options.complete ?? vi.fn(async () => jevResponse("{}", { stopReason: "error", errorMessage: "no transport" })),
		},
		sessionManager: { getBranch: () => options.branch ?? [], getEntries: () => options.branch ?? [] },
		ui: { notify: vi.fn(), setStatus: vi.fn() },
	};
	options.extension(pi as unknown as ExtensionAPI);
	pi.events.on(MEMORY_SEARCH_REQUEST_EVENT, (request) => {
		if (!isMemorySearchRequest(request)) return;
		const result = (options.memorySearch ?? (() => ({ success: true, count: 1, output: "LOCAL_MEMORY_RESULT" })))(request.input);
		if (result) request.respond(result);
	});

	const fire = async (event: string, payload?: unknown): Promise<unknown> => {
		let result: unknown;
		for (const handler of handlers.get(event) ?? []) {
			result = (await handler(payload ?? { type: event }, ctx)) ?? result;
		}
		return result;
	};

	const advisory: AdvisoryHarness = {
		pi,
		handlers,
		ctx,
		cwd: options.cwd,
		telemetry,
		fire,
		async advise(prompt, input = {}) {
			await fire("input", { type: "input", text: prompt, source: "interactive", ...input });
			const result = await fire("before_agent_start", { type: "before_agent_start", prompt });
			return (result as { message?: AdvisoryMessage } | undefined)?.message;
		},
		replay(prompt) {
			return fire("before_agent_start", { type: "before_agent_start", prompt });
		},
	};
	return advisory;
}

/** The decisions request inside a completion call, or undefined. */
function callContent(call: unknown[] | undefined): string | undefined {
	const content = (call?.[1] as { messages?: Array<{ content?: unknown }> } | undefined)?.messages?.[0]?.content;
	return typeof content === "string" ? content : undefined;
}

/** The parsed decision request sent to Jev last, or undefined. */
export function sentPayload(transport: { mock: { calls: unknown[][] } }): Record<string, unknown> | undefined {
	const content = callContent(transport.mock.calls.at(-1));
	return content === undefined ? undefined : JSON.parse(content);
}

/** Every decision request sent to Jev, parsed, oldest first. */
export function sentPayloads(transport: { mock: { calls: unknown[][] } }): Array<Record<string, unknown>> {
	return transport.mock.calls
		.map(callContent)
		.filter((content): content is string => content !== undefined)
		.map((content) => JSON.parse(content) as Record<string, unknown>);
}

/** The answers envelope Jev returns for the given choices. */
export function jevAnswers(answers: Record<string, { choice: string; confidence?: number }>): string {
	return JSON.stringify({
		answers: Object.fromEntries(
			Object.entries(answers).map(([question, answer]) => [
				question,
				{ type: "choice", choice: answer.choice, ...(answer.confidence === undefined ? {} : { confidence: answer.confidence }) },
			]),
		),
	});
}

/** A decisions answer as pi's completion transport hands it back. */
export function jevResponse(text: string, overrides: Partial<AssistantMessage> = {}): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-completions",
		provider: "tokenin",
		model: "jev-1.13",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 1,
		...overrides,
	} as AssistantMessage;
}

/** A route config with everything enabled, for tests that are not about enablement. */
export function enabledAdvisoryRoutes(routes: Array<"memory" | "recommendations"> = ["memory", "recommendations"]) {
	return Object.fromEntries(routes.map((route) => [route, { enabled: true }])) as Partial<JevAdvisoryConfig>["routes"];
}
