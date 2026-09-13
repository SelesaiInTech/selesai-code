import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import graftExtension from "./index.ts";
import { TELEMETRY_ENV } from "./cli.ts";
import { INJECTION_ENTRY_TYPE, MODE_ENTRY_TYPE, type RetrievalMode } from "./state.ts";
import { handlerFor, makeCtx, makePi, notified, OK, toolFor, type PiHarness } from "./test-support.ts";

const ASK_JSON = JSON.stringify({
	mode: "lexical",
	coverage: 0.8,
	hits: [{ kind: "symbol", title: "verify · function", pointer: "src/auth.ts:L1-L9", snippet: "checks", code: "code" }],
});

let root: string;
let repo: string;
let agentDir: string;

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "graft-lifecycle-"));
	agentDir = join(root, "agent");
	repo = join(root, "repo");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(join(repo, ".selesai"), { recursive: true });
	mkdirSync(join(repo, "graft", ".graph"), { recursive: true });
	writeFileSync(join(repo, "graft", ".graph", "wiring.json"), "{}", "utf-8");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

function writeProjectSettings(value: unknown): void {
	writeFileSync(join(repo, ".selesai", "settings.json"), JSON.stringify({ graft: value }), "utf-8");
}

/** A git-root + graft-version aware exec stub. */
function exec(graftOutput = ASK_JSON) {
	return async (command: string, args: string[]) => {
		if (command === "git" && args.includes("--show-toplevel")) return { ...OK, stdout: `${repo}\n` };
		if (args.includes("--version")) return { ...OK, stdout: "0.18.0\n" };
		return { ...OK, stdout: graftOutput };
	};
}

interface Booted extends PiHarness {
	ctx: ReturnType<typeof makeCtx>;
	reset(): Promise<void>;
}

/**
 * Start a session the way Selesai does, with the project settings and branch
 * entries the test needs, and return the harness for further events.
 */
async function bootSession(
	options: { settings?: Record<string, unknown>; branch?: unknown[]; hasUI?: boolean; trusted?: boolean } = {},
): Promise<Booted> {
	process.env.PI_CODING_AGENT_DIR = agentDir;
	writeProjectSettings(options.settings ?? {});
	const harness = makePi(exec());
	graftExtension(harness.pi as never);
	const ctx = makeCtx({ cwd: repo, trusted: options.trusted ?? true, hasUI: options.hasUI ?? true, branch: options.branch });
	await (handlerFor(harness, "session_start") as (event: unknown, ctx: unknown) => Promise<void>)(
		{ type: "session_start", reason: "startup" },
		ctx,
	);
	return {
		...harness,
		ctx,
		reset: async () => {
			await (handlerFor(harness, "session_shutdown") as (event: unknown, ctx: unknown) => Promise<void>)(
				{ type: "session_shutdown", reason: "quit" },
				ctx,
			);
		},
	};
}

afterEach(() => {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
	delete process.env[TELEMETRY_ENV];
	vi.restoreAllMocks();
});

describe("session start", () => {
	it("resolves the Git working tree, probes the executable, and publishes a status line", async () => {
		const session = await bootSession();
		expect(session.commandsRun()).toEqual(["git rev-parse --show-toplevel", "graft --version"]);
		expect(session.ctx.statuses.get("graft")).toBe("graft: ● structural v0.18.0");
		await session.reset();
	});

	it("does nothing at all when the extension is disabled by settings", async () => {
		const session = await bootSession({ settings: { enabled: false } });
		expect(session.exec).not.toHaveBeenCalled();
		expect(session.ctx.statuses.get("graft")).toBeUndefined();
		await session.reset();
	});

	it("ignores project settings until the project is trusted", async () => {
		const session = await bootSession({ settings: { enabled: false }, trusted: false });
		// Untrusted: the project's `enabled: false` must not be honored, so the
		// extension still runs its probe.
		expect(session.commandsRun()).toContain("graft --version");
		await session.reset();
	});

	it("defaults Graft to telemetry opt-out without touching Graft's own settings", async () => {
		delete process.env[TELEMETRY_ENV];
		const session = await bootSession();
		expect(process.env[TELEMETRY_ENV]).toBe("1");
		await session.reset();
		expect(process.env[TELEMETRY_ENV]).toBeUndefined();
	});

	it("leaves an explicit telemetry preference alone", async () => {
		const session = await bootSession({ settings: { telemetry: "inherit" } });
		expect(process.env[TELEMETRY_ENV]).toBeUndefined();
		await session.reset();
	});

	it("keeps a user's own DO_NOT_TRACK setting across the session", async () => {
		process.env[TELEMETRY_ENV] = "0";
		const session = await bootSession();
		expect(process.env[TELEMETRY_ENV]).toBe("0");
		await session.reset();
		expect(process.env[TELEMETRY_ENV]).toBe("0");
	});

	it("restores the retrieval mode chosen on this branch", async () => {
		const session = await bootSession({
			branch: [{ type: "custom", customType: MODE_ENTRY_TYPE, data: { mode: "hybrid" } }],
		});
		expect(session.ctx.statuses.get("graft-mode")).toBe("graft mode: hybrid");
		await session.reset();
	});

	it("does not leak the telemetry default when a session starts twice without a shutdown", async () => {
		delete process.env[TELEMETRY_ENV];
		const session = await bootSession();
		expect(process.env[TELEMETRY_ENV]).toBe("1");

		// A second start with no shutdown in between must still be undone later.
		await (handlerFor(session, "session_start") as (e: unknown, c: unknown) => Promise<void>)(
			{ type: "session_start", reason: "reload" },
			session.ctx,
		);
		await session.reset();
		expect(process.env[TELEMETRY_ENV]).toBeUndefined();
	});

	it("automatically installs a missing CLI once, then rechecks it", async () => {
		process.env.PI_CODING_AGENT_DIR = agentDir;
		writeProjectSettings({});
		let installed = false;
		const harness = makePi(async (command: string, args: string[]) => {
			if (command === "git") return { ...OK, stdout: `${repo}\n` };
			if (command === "npm") {
				installed = true;
				return { ...OK };
			}
			if (args.includes("--version")) {
				if (!installed) throw new Error("spawn graft ENOENT");
				return { ...OK, stdout: "0.18.0\n" };
			}
			return { ...OK };
		});
		graftExtension(harness.pi as never);
		const ctx = makeCtx({ cwd: repo });
		const start = handlerFor(harness, "session_start") as (e: unknown, c: unknown) => Promise<void>;
		await start({ type: "session_start", reason: "startup" }, ctx);
		await vi.waitFor(() => expect(ctx.statuses.get("graft")).toBe("graft: ● structural v0.18.0"));
		expect(harness.commandsRun()).toContain("npm install -g @nanonets/graft@^0.18");

		await start({ type: "session_start", reason: "reload" }, ctx);
		expect(harness.commandsRun().filter((command) => command.startsWith("npm install"))).toHaveLength(1);
	});

	it("reports a failed automatic install without failing the session", async () => {
		process.env.PI_CODING_AGENT_DIR = agentDir;
		writeProjectSettings({});
		const harness = makePi(async (command: string, args: string[]) => {
			if (command === "git") return { ...OK, stdout: `${repo}\n` };
			if (command === "npm") return { ...OK, code: 1, stderr: "npm access denied" };
			if (args.includes("--version")) throw new Error("spawn graft ENOENT");
			return { ...OK };
		});
		graftExtension(harness.pi as never);
		const ctx = makeCtx({ cwd: repo });
		await (handlerFor(harness, "session_start") as (e: unknown, c: unknown) => Promise<void>)(
			{ type: "session_start", reason: "startup" },
			ctx,
		);
		await vi.waitFor(() => expect(notified(ctx)).toContain("npm access denied"));
		expect(ctx.statuses.get("graft")).toBe("graft: ✕ no cli");
	});

	it("reports that Graft needs a Git working tree without probing anything else", async () => {
		process.env.PI_CODING_AGENT_DIR = agentDir;
		writeProjectSettings({});
		const harness = makePi(async (command: string) => {
			if (command === "git") return { code: 128, stdout: "", stderr: "not a git repository", killed: false };
			return { ...OK, stdout: "0.18.0\n" };
		});
		graftExtension(harness.pi as never);
		const ctx = makeCtx({ cwd: repo });
		await (handlerFor(harness, "session_start") as (e: unknown, c: unknown) => Promise<void>)(
			{ type: "session_start", reason: "startup" },
			ctx,
		);
		expect(ctx.statuses.get("graft")).toBe("graft: ✕ n/a");
		expect(ctx.ui.notify).not.toHaveBeenCalled();
	});
});

describe("mutation awareness", () => {
	const toolResultEvent = (toolName: string, input: Record<string, unknown>, isError = false) => ({
		type: "tool_result",
		toolName,
		toolCallId: "c1",
		input,
		content: [],
		isError,
	});
	const onToolResult = (session: Booted, toolName: string, input: Record<string, unknown>, isError = false) =>
		(handlerFor(session, "tool_result") as (e: unknown, c: unknown) => Promise<void>)(
			toolResultEvent(toolName, input, isError),
			session.ctx,
		);

	it("marks the graph changed after a successful edit", async () => {
		const session = await bootSession();
		await onToolResult(session, "edit", { path: "src/a.ts" });
		expect(session.ctx.statuses.get("graft")).toBe("graft: ◐ changed v0.18.0");
		await session.reset();
	});

	it("marks the graph changed after a clearly mutating bash command", async () => {
		const session = await bootSession();
		await onToolResult(session, "bash", { command: "rm -rf dist" });
		expect(session.ctx.statuses.get("graft")).toBe("graft: ◐ changed v0.18.0");
		await session.reset();
	});

	it("does not mark anything changed for read-only work or failed calls", async () => {
		const session = await bootSession();
		await onToolResult(session, "read", { path: "src/a.ts" });
		await onToolResult(session, "bash", { command: "git status" });
		await onToolResult(session, "edit", { path: "src/a.ts" }, true);
		expect(session.ctx.statuses.get("graft")).toBe("graft: ● structural v0.18.0");
		await session.reset();
	});
});

describe("proactive refresh", () => {
	it("does nothing when the graph was never marked changed", async () => {
		const session = await bootSession();
		const before = session.exec.mock.calls.length;
		await (handlerFor(session, "agent_end") as (e: unknown, c: unknown) => Promise<void>)({}, session.ctx);
		expect(session.exec.mock.calls.length).toBe(before);
		await session.reset();
	});

	it("never creates a graph that does not exist", async () => {
		process.env.PI_CODING_AGENT_DIR = agentDir;
		const bare = join(root, "bare-repo");
		mkdirSync(join(bare, ".selesai"), { recursive: true });
		writeFileSync(join(bare, ".selesai", "settings.json"), JSON.stringify({ graft: {} }), "utf-8");
		const harness = makePi(async (command: string, args: string[]) => {
			if (command === "git") return { ...OK, stdout: `${bare}\n` };
			if (args.includes("--version")) return { ...OK, stdout: "0.18.0\n" };
			return { ...OK, stdout: ASK_JSON };
		});
		graftExtension(harness.pi as never);
		const ctx = makeCtx({ cwd: bare });
		await (handlerFor(harness, "session_start") as (e: unknown, c: unknown) => Promise<void>)(
			{ type: "session_start", reason: "startup" },
			ctx,
		);
		expect(ctx.statuses.get("graft")).toBe("graft: ○ unbuilt v0.18.0");
		const before = harness.exec.mock.calls.length;
		await (handlerFor(harness, "agent_end") as (e: unknown, c: unknown) => Promise<void>)({}, ctx);
		expect(harness.exec.mock.calls.length).toBe(before);
	});

	it("re-indexes after edits, shows the sync phase, and returns to fresh", async () => {
		const session = await bootSession({ settings: { refreshDebounceSeconds: 0 } });
		await (handlerFor(session, "tool_result") as (e: unknown, c: unknown) => Promise<void>)(
			{ type: "tool_result", toolName: "read", toolCallId: "c", input: {}, content: [], isError: false },
			session.ctx,
		);
		await (handlerFor(session, "tool_result") as (e: unknown, c: unknown) => Promise<void>)(
			{ type: "tool_result", toolName: "write", toolCallId: "c1", input: {}, content: [], isError: false },
			session.ctx,
		);
		expect(session.ctx.statuses.get("graft")).toBe("graft: ◐ changed v0.18.0");

		await (handlerFor(session, "agent_end") as (e: unknown, c: unknown) => Promise<void>)({}, session.ctx);
		expect(session.ctx.statuses.get("graft")).toBe("graft: ⚙ syncing v0.18.0");
		await vi.waitFor(() => expect(session.ctx.statuses.get("graft")).toBe("graft: ● structural v0.18.0"));
		expect(session.commandsRun()).toContain("graft build");
		await session.reset();
	});

	it("honors the debounce window across consecutive turns", async () => {
		const session = await bootSession({ settings: { refreshDebounceSeconds: 600 } });
		const handler = handlerFor(session, "tool_result") as (e: unknown, c: unknown) => Promise<void>;
		await handler({ type: "tool_result", toolName: "write", toolCallId: "c", input: {}, content: [], isError: false }, session.ctx);
		await (handlerFor(session, "agent_end") as (e: unknown, c: unknown) => Promise<void>)({}, session.ctx);
		await vi.waitFor(() => expect(session.commandsRun()).toContain("graft build"));

		const builds = () => session.commandsRun().filter((line) => line.startsWith("graft build")).length;
		expect(builds()).toBe(1);

		// A second turn inside the debounce window must not queue another rebuild.
		await handler({ type: "tool_result", toolName: "write", toolCallId: "c2", input: {}, content: [], isError: false }, session.ctx);
		await (handlerFor(session, "agent_end") as (e: unknown, c: unknown) => Promise<void>)({}, session.ctx);
		expect(builds()).toBe(1);
		await session.reset();
	});

	it("survives a refresh that fails, and reports it", async () => {
		process.env.PI_CODING_AGENT_DIR = agentDir;
		writeProjectSettings({ refreshDebounceSeconds: 0 });
		const harness = makePi(async (command: string, args: string[]) => {
			if (command === "git") return { ...OK, stdout: `${repo}\n` };
			if (args.includes("--version")) return { ...OK, stdout: "0.18.0\n" };
			if (args.includes("build")) return { code: 1, stdout: "", stderr: "✗ index failed", killed: false };
			return { ...OK, stdout: ASK_JSON };
		});
		graftExtension(harness.pi as never);
		const ctx = makeCtx({ cwd: repo });
		await (handlerFor(harness, "session_start") as (e: unknown, c: unknown) => Promise<void>)(
			{ type: "session_start", reason: "startup" },
			ctx,
		);
		await (handlerFor(harness, "tool_result") as (e: unknown, c: unknown) => Promise<void>)(
			{ type: "tool_result", toolName: "write", toolCallId: "c", input: {}, content: [], isError: false },
			ctx,
		);
		await (handlerFor(harness, "agent_end") as (e: unknown, c: unknown) => Promise<void>)({}, ctx);
		await vi.waitFor(() => expect(ctx.statuses.get("graft")).toBe("graft: ✕ failed v0.18.0"));
	});
});

describe("retrieval strategy", () => {
	const beforeAgentStart = (session: Booted, prompt: string) =>
		(handlerFor(session, "before_agent_start") as (e: unknown, c: unknown) => Promise<unknown>)(
			{ type: "before_agent_start", prompt },
			session.ctx,
		);

	it("injects a source-backed pack in push mode, which is the default", async () => {
		const session = await bootSession();
		const result = await beforeAgentStart(session, "Fix the login crash");
		expect(result).toBeDefined();
		expect(session.entries).toHaveLength(1);
		await session.reset();
	});

	it("injects one bounded, declared pack for an eligible task in push mode", async () => {
		const session = await bootSession({ settings: { mode: "push" } });
		const result = (await beforeAgentStart(session, "Fix the login crash in src/auth.ts")) as {
			message: { customType: string; content: string; display: boolean; details: Record<string, unknown> };
		};

		expect(result.message.customType).toBe("graft-context");
		expect(result.message.display).toBe(true);
		expect(result.message.content).toContain('<graft-context source="graft" mode="push"');
		expect(result.message.content).toContain("src/auth.ts:L1-L9");
		expect(session.commandsRun().join(" ")).toContain("ask");
		expect(session.commandsRun().join(" ")).toContain("--source");

		const entry = session.entries.find((e) => e.customType === INJECTION_ENTRY_TYPE);
		expect(entry?.data).toMatchObject({
			mode: "push",
			state: "fresh-structural",
			references: ["src/auth.ts:L1-L9"],
			truncated: false,
			coverage: 0.8,
		});
		await session.reset();
	});

	it("injects only once per turn even if the hook is re-entered", async () => {
		const session = await bootSession({ settings: { mode: "push" } });
		const first = await beforeAgentStart(session, "Fix the login crash");
		const second = await beforeAgentStart(session, "Fix the login crash");
		expect(first).toBeDefined();
		expect(second).toBeUndefined();
		expect(session.entries.filter((e) => e.customType === INJECTION_ENTRY_TYPE)).toHaveLength(1);
		await session.reset();
	});

	it("injects again on the next turn", async () => {
		const session = await bootSession({ settings: { mode: "push" } });
		await beforeAgentStart(session, "Fix the login crash");
		await (handlerFor(session, "turn_start") as (e: unknown, c: unknown) => Promise<void>)({}, session.ctx);
		expect(await beforeAgentStart(session, "Now add a regression test")).toBeDefined();
		await session.reset();
	});

	it("never injects for chat, even in hybrid mode", async () => {
		const session = await bootSession({ settings: { mode: "hybrid" } });
		expect(await beforeAgentStart(session, "thanks!")).toBeUndefined();
		expect(session.entries).toHaveLength(0);
		await session.reset();
	});

	it("drops a pack the relevance gate rejects rather than adding prompt noise", async () => {
		process.env.PI_CODING_AGENT_DIR = agentDir;
		writeProjectSettings({ mode: "push" });
		const weak = JSON.stringify({ mode: "lexical", coverage: 0.01, hits: [{ pointer: "src/a.ts", title: "a", snippet: "" }] });
		const harness = makePi(exec(weak));
		graftExtension(harness.pi as never);
		const ctx = makeCtx({ cwd: repo });
		await (handlerFor(harness, "session_start") as (e: unknown, c: unknown) => Promise<void>)(
			{ type: "session_start", reason: "startup" },
			ctx,
		);
		expect(
			await (handlerFor(harness, "before_agent_start") as (e: unknown, c: unknown) => Promise<unknown>)(
				{ type: "before_agent_start", prompt: "Fix the login crash" },
				ctx,
			),
		).toBeUndefined();
	});

	it("never breaks a turn when the Graft query fails", async () => {
		process.env.PI_CODING_AGENT_DIR = agentDir;
		writeProjectSettings({ mode: "push" });
		const harness = makePi(async (command: string, args: string[]) => {
			if (command === "git") return { ...OK, stdout: `${repo}\n` };
			if (args.includes("--version")) return { ...OK, stdout: "0.18.0\n" };
			return { code: 1, stdout: "", stderr: "✗ graph missing", killed: false };
		});
		graftExtension(harness.pi as never);
		const ctx = makeCtx({ cwd: repo });
		await (handlerFor(harness, "session_start") as (e: unknown, c: unknown) => Promise<void>)(
			{ type: "session_start", reason: "startup" },
			ctx,
		);
		const result = await (handlerFor(harness, "before_agent_start") as (e: unknown, c: unknown) => Promise<unknown>)(
			{ type: "before_agent_start", prompt: "Fix the login crash" },
			ctx,
		);
		expect(result).toBeUndefined();
		expect(notified(ctx)).toContain("Graft context unavailable");
	});

	it("injects nothing when the graph has never been built, and says how to fix it", async () => {
		process.env.PI_CODING_AGENT_DIR = agentDir;
		const bare = join(root, "unbuilt-repo");
		mkdirSync(join(bare, ".selesai"), { recursive: true });
		writeFileSync(join(bare, ".selesai", "settings.json"), JSON.stringify({ graft: { mode: "push" } }), "utf-8");
		const harness = makePi(async (command: string, args: string[]) => {
			if (command === "git") return { ...OK, stdout: `${bare}\n` };
			if (args.includes("--version")) return { ...OK, stdout: "0.18.0\n" };
			return { ...OK, stdout: ASK_JSON };
		});
		graftExtension(harness.pi as never);
		const ctx = makeCtx({ cwd: bare });
		await (handlerFor(harness, "session_start") as (e: unknown, c: unknown) => Promise<void>)(
			{ type: "session_start", reason: "startup" },
			ctx,
		);
		expect(
			await (handlerFor(harness, "before_agent_start") as (e: unknown, c: unknown) => Promise<unknown>)(
				{ type: "before_agent_start", prompt: "Fix the login crash" },
				ctx,
			),
		).toBeUndefined();
	});
});

describe("session shutdown", () => {
	it("clears status, restores the environment, and stops all further work", async () => {
		const session = await bootSession({ settings: { mode: "push" } });
		await session.reset();

		expect(session.ctx.statuses.get("graft")).toBeUndefined();
		expect(session.ctx.statuses.get("graft-mode")).toBeUndefined();
		expect(process.env[TELEMETRY_ENV]).toBeUndefined();

		const before = session.exec.mock.calls.length;
		await (handlerFor(session, "agent_end") as (e: unknown, c: unknown) => Promise<void>)({}, session.ctx);
		await (handlerFor(session, "before_agent_start") as (e: unknown, c: unknown) => Promise<unknown>)(
			{ type: "before_agent_start", prompt: "Fix the login crash" },
			session.ctx,
		);
		expect(session.exec.mock.calls.length).toBe(before);
	});

	it("refuses tool calls after the session is torn down", async () => {
		const session = await bootSession();
		const tool = toolFor(session, "graft_repo_map");
		await session.reset();
		await expect(
			(tool.execute as (...args: unknown[]) => Promise<unknown>)("c", {}, undefined, undefined, session.ctx),
		).rejects.toThrow(/no active Selesai session/);
	});
});

describe("tool readiness", () => {
	it("fails with recovery guidance when the executable is missing", async () => {
		process.env.PI_CODING_AGENT_DIR = agentDir;
		writeProjectSettings({});
		const harness = makePi(async (command: string) => {
			if (command === "git") return { ...OK, stdout: `${repo}\n` };
			throw new Error("spawn graft ENOENT");
		});
		graftExtension(harness.pi as never);
		const ctx = makeCtx({ cwd: repo });
		await (handlerFor(harness, "session_start") as (e: unknown, c: unknown) => Promise<void>)(
			{ type: "session_start", reason: "startup" },
			ctx,
		);
		const tool = toolFor(harness, "graft_find_code");
		await expect(
			(tool.execute as (...args: unknown[]) => Promise<unknown>)("c", { question: "x" }, undefined, undefined, ctx),
		).rejects.toThrow(/Run \/graft doctor/);
	});

	it("tells the user to build before answering from a graph that is not there", async () => {
		process.env.PI_CODING_AGENT_DIR = agentDir;
		const bare = join(root, "unbuilt-tools");
		mkdirSync(join(bare, ".selesai"), { recursive: true });
		writeFileSync(join(bare, ".selesai", "settings.json"), JSON.stringify({ graft: {} }), "utf-8");
		const harness = makePi(async (command: string, args: string[]) => {
			if (command === "git") return { ...OK, stdout: `${bare}\n` };
			if (args.includes("--version")) return { ...OK, stdout: "0.18.0\n" };
			return { ...OK, stdout: ASK_JSON };
		});
		graftExtension(harness.pi as never);
		const ctx = makeCtx({ cwd: bare });
		await (handlerFor(harness, "session_start") as (e: unknown, c: unknown) => Promise<void>)(
			{ type: "session_start", reason: "startup" },
			ctx,
		);
		const tool = toolFor(harness, "graft_find_code");
		await expect(
			(tool.execute as (...args: unknown[]) => Promise<unknown>)("c", { question: "x" }, undefined, undefined, ctx),
		).rejects.toThrow(/graft build/);
	});

	it("re-resolves lazily when an earlier attempt found no repository", async () => {
		process.env.PI_CODING_AGENT_DIR = agentDir;
		writeProjectSettings({});
		let gitCalls = 0;
		const harness = makePi(async (command: string, args: string[]) => {
			if (command === "git") {
				gitCalls += 1;
				return { code: 128, stdout: "", stderr: "not a git repository", killed: false };
			}
			if (args.includes("--version")) return { ...OK, stdout: "0.18.0\n" };
			return { ...OK, stdout: ASK_JSON };
		});
		graftExtension(harness.pi as never);
		const ctx = makeCtx({ cwd: repo });
		await (handlerFor(harness, "session_start") as (e: unknown, c: unknown) => Promise<void>)(
			{ type: "session_start", reason: "startup" },
			ctx,
		);
		const tool = toolFor(harness, "graft_repo_map");
		await expect(
			(tool.execute as (...args: unknown[]) => Promise<unknown>)("c", {}, undefined, undefined, ctx),
		).rejects.toThrow(/needs a Git repository/);
		// Session start plus one lazy re-resolve: a failed resolution is not cached
		// as permanent, because the user may have fixed it a moment ago.
		expect(gitCalls).toBe(2);
	});

	it("refuses a tool call that arrives before any session exists", async () => {
		const harness = makePi(exec());
		graftExtension(harness.pi as never);
		const tool = toolFor(harness, "graft_repo_map");
		await expect(
			(tool.execute as (...args: unknown[]) => Promise<unknown>)("c", {}, undefined, undefined, makeCtx({ cwd: repo })),
		).rejects.toThrow(/no active Selesai session/);
		expect(harness.exec).not.toHaveBeenCalled();
	});

	it("refuses tool calls when the extension is disabled", async () => {
		const session = await bootSession({ settings: { enabled: false } });
		const tool = toolFor(session, "graft_repo_map");
		await expect(
			(tool.execute as (...args: unknown[]) => Promise<unknown>)("c", {}, undefined, undefined, session.ctx),
		).rejects.toThrow(/disabled by settings/);
	});
});

describe("mode selection through commands", () => {
	it("persists the chosen mode and applies it to the next turn", async () => {
		const session = await bootSession();
		const handler = session.commands.get("graft")!.handler as (args: string, ctx: unknown) => Promise<void>;
		await handler("mode hybrid", session.ctx);
		expect(session.entries).toContainEqual({ customType: MODE_ENTRY_TYPE, data: { mode: "hybrid" as RetrievalMode } });
		expect(session.ctx.statuses.get("graft-mode")).toBe("graft mode: hybrid");

		const result = await (handlerFor(session, "before_agent_start") as (e: unknown, c: unknown) => Promise<unknown>)(
			{ type: "before_agent_start", prompt: "Refactor src/auth.ts" },
			session.ctx,
		);
		expect(result).toBeDefined();
		await session.reset();
	});
});
