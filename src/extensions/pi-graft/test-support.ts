/**
 * Test doubles for the Graft extension.
 *
 * These mirror the seam the existing bundled-extension tests use (see
 * `agent-browser.test.ts`): a minimal ExtensionAPI stub that captures what the
 * extension registers, plus a controllable extension context. Tests assert
 * observable behavior — registered names, command arguments, working
 * directories, diagnostics, session entries — never private helpers.
 */

import { vi } from "vitest";

export interface StubExecResult {
	code: number;
	stdout: string;
	stderr: string;
	killed: boolean;
}

export const OK: StubExecResult = { code: 0, stdout: "", stderr: "", killed: false };
export const FAILED: StubExecResult = { code: 1, stdout: "", stderr: "command not found", killed: false };

export type ExecImpl = (command: string, args: string[], options?: unknown) => Promise<StubExecResult>;
export type RegisteredHandler = (...args: never[]) => unknown;

/** The subset of ExtensionAPI these extensions actually call. */
export interface PiApiStub {
	exec: ReturnType<typeof vi.fn>;
	on: (event: string, handler: RegisteredHandler) => void;
	registerTool: (tool: Record<string, unknown>) => void;
	registerCommand: (name: string, options: Record<string, unknown>) => void;
	appendEntry: (customType: string, data?: unknown) => void;
	sendUserMessage: ReturnType<typeof vi.fn>;
	sendMessage: ReturnType<typeof vi.fn>;
	events: {
		on(event: string, handler: (data: unknown) => void): void;
		emit(event: string, data: unknown): void;
	};
	[key: string]: unknown;
}

export interface PiHarness {
	/** The ExtensionAPI the extension under test receives. */
	pi: PiApiStub;
	exec: ReturnType<typeof vi.fn>;
	handlers: Map<string, RegisteredHandler[]>;
	tools: Map<string, Record<string, unknown>>;
	commands: Map<string, Record<string, unknown>>;
	/** Every `appendEntry` call, in order. */
	entries: { customType: string; data: unknown }[];
	/** Every exec call flattened to `command arg arg` for readable assertions. */
	commandsRun(): string[];
}

/** Build an ExtensionAPI stub that records everything an extension registers. */
export function makePi(execImpl?: ExecImpl): PiHarness {
	const handlers = new Map<string, RegisteredHandler[]>();
	const tools = new Map<string, Record<string, unknown>>();
	const commands = new Map<string, Record<string, unknown>>();
	const entries: { customType: string; data: unknown }[] = [];
	const eventHandlers = new Map<string, Array<(data: unknown) => void>>();
	const exec = vi.fn(execImpl ?? (async () => ({ ...OK })));

	const harness: PiHarness = {
		pi: {
			exec,
			on: (event: string, handler: RegisteredHandler) => {
				handlers.set(event, [...(handlers.get(event) ?? []), handler]);
			},
			registerTool: (tool: Record<string, unknown>) => {
				tools.set(tool.name as string, tool);
			},
			registerCommand: (name: string, options: Record<string, unknown>) => {
				commands.set(name, options);
			},
			appendEntry: (customType: string, data: unknown) => {
				entries.push({ customType, data });
			},
			sendUserMessage: vi.fn(),
			sendMessage: vi.fn(),
			events: {
				on: (event, handler) => eventHandlers.set(event, [...(eventHandlers.get(event) ?? []), handler]),
				emit: (event, data) => eventHandlers.get(event)?.forEach((handler) => handler(data)),
			},
		},
		exec,
		handlers,
		tools,
		commands,
		entries,
		commandsRun: () =>
			exec.mock.calls.map((call) => [call[0], ...((call[1] as string[]) ?? [])].join(" ")),
	};
	return harness;
}

/** Every handler registered for an event, in registration order. */
export function handlersFor(harness: PiHarness, event: string): RegisteredHandler[] {
	return harness.handlers.get(event) ?? [];
}

/** The first handler for an event, or a clear failure when none was registered. */
export function handlerFor(harness: PiHarness, event: string, index = 0): RegisteredHandler {
	const handler = handlersFor(harness, event)[index];
	if (!handler) throw new Error(`no ${event} handler registered at index ${index}`);
	return handler;
}

/** The named tool definition the extension registered. */
export function toolFor(harness: PiHarness, name: string): Record<string, unknown> {
	const tool = harness.tools.get(name);
	if (!tool) throw new Error(`no ${name} tool registered`);
	return tool;
}

export interface CtxStub {
	ui: {
		notify: ReturnType<typeof vi.fn>;
		confirm: ReturnType<typeof vi.fn>;
		setStatus: ReturnType<typeof vi.fn>;
		select: ReturnType<typeof vi.fn>;
		input: ReturnType<typeof vi.fn>;
	};
	hasUI: boolean;
	mode: string;
	cwd: string;
	isProjectTrusted: ReturnType<typeof vi.fn>;
	isIdle: ReturnType<typeof vi.fn>;
	getSystemPrompt: ReturnType<typeof vi.fn>;
	sessionManager: {
		getBranch: () => unknown[];
		getEntries: () => unknown[];
		getLeafId: () => string | null;
		getSessionFile: () => string | undefined;
	};
	signal: AbortSignal | undefined;
	abort: ReturnType<typeof vi.fn>;
	/** Latest value written for each status key. */
	statuses: Map<string, string | undefined>;
}

/** All notify messages, joined, for readable `toContain` assertions. */
export function notified(ctx: CtxStub): string {
	return ctx.ui.notify.mock.calls.map((call) => String(call[0])).join("\n");
}

export function makeCtx(
	overrides: Partial<{
		hasUI: boolean;
		confirm: boolean;
		cwd: string;
		trusted: boolean;
		branch: unknown[];
		signal: AbortSignal;
	}> = {},
): CtxStub {
	const statuses = new Map<string, string | undefined>();
	const ctx: CtxStub = {
		ui: {
			notify: vi.fn(),
			confirm: vi.fn(async () => overrides.confirm ?? true),
			setStatus: vi.fn((key: string, text: string | undefined) => {
				statuses.set(key, text);
			}),
			select: vi.fn(async () => undefined),
			input: vi.fn(async () => undefined),
		},
		hasUI: overrides.hasUI ?? true,
		mode: overrides.hasUI === false ? "print" : "tui",
		cwd: overrides.cwd ?? process.cwd(),
		isProjectTrusted: vi.fn(() => overrides.trusted ?? true),
		isIdle: vi.fn(() => true),
		getSystemPrompt: vi.fn(() => ""),
		sessionManager: {
			getBranch: () => overrides.branch ?? [],
			getEntries: () => overrides.branch ?? [],
			getLeafId: () => null,
			getSessionFile: () => undefined,
		},
		signal: overrides.signal,
		abort: vi.fn(),
		statuses,
	};
	return ctx;
}

/**
 * `git rev-parse` answers with `gitRoot`, the Graft probe answers with `version`,
 * and every other command succeeds with empty output.
 */
export function healthyExec(overrides: { gitRoot?: string; version?: string; queryOutput?: string } = {}): ExecImpl {
	const gitRoot = overrides.gitRoot ?? "/repo";
	const version = overrides.version ?? "0.18.0";
	return async (command, args) => {
		if (command === "git" && args.includes("--show-toplevel")) return { ...OK, stdout: `${gitRoot}\n` };
		if (args.includes("--version")) return { ...OK, stdout: `${version}\n` };
		return { ...OK, stdout: overrides.queryOutput ?? "" };
	};
}
