import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@selesai/code", () => ({
	ensureTool: vi.fn(async () => "/fake/grepai"),
	isToolCallEventType: (toolName: string, event: { toolName?: string }) => event?.toolName === toolName,
}));

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import grepaiExtension, {
	applyGrepaiDefaults,
	findGrepaiProjectRoot,
	getGrepaiConfigPath,
	GREPAI_CONFIG_DIR,
	GREPAI_EMBEDDING_DIMENSIONS,
	GREPAI_STORE_BACKEND,
	GREPAI_EMBEDDING_ENDPOINT,
	GREPAI_EMBEDDING_MODEL,
	getGrepaiSubcommand,
	isGrepaiConfigCommand,
	shouldAutoStartGrepaiWatcher,
} from "./grepai.ts";

function makePi() {
	const handlers = new Map<string, Function[]>();
	const commands = new Map<string, unknown>();
	const pi = {
		on: (event: string, handler: Function) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
		registerCommand: (name: string, command: unknown) => commands.set(name, command),
		exec: vi.fn(),
	};
	return { pi: pi as any, handlers, commands };
}

describe("grepai integration", () => {
	let tempDir: string;

	afterEach(() => {
		if (tempDir) rmSync(tempDir, { recursive: true, force: true });
	});

	it("registers deferred startup and Bash setup hooks plus the setup command", () => {
		const { pi, handlers, commands } = makePi();
		grepaiExtension(pi);

		expect(handlers.has("session_start")).toBe(true);
		expect(handlers.has("tool_call")).toBe(true);
		expect(commands.has("setup-grepai")).toBe(true);
	});

	it("recognizes only config-dependent grepai subcommands", () => {
		expect(isGrepaiConfigCommand("grepai search \"auth flow\"")).toBe(true);
		expect(isGrepaiConfigCommand("grepai watch --background")).toBe(true);
		expect(isGrepaiConfigCommand("grepai.exe status")).toBe(true);
		expect(getGrepaiSubcommand("env grepai search query")).toBe("search");
		expect(shouldAutoStartGrepaiWatcher("grepai search query")).toBe(true);
		expect(shouldAutoStartGrepaiWatcher("grepai watch --background")).toBe(false);
		expect(shouldAutoStartGrepaiWatcher("grepai watch --status")).toBe(false);
		expect(shouldAutoStartGrepaiWatcher("grepai status")).toBe(false);
		expect(isGrepaiConfigCommand("grepai version")).toBe(false);
		expect(isGrepaiConfigCommand("grepai init --yes")).toBe(false);
		expect(isGrepaiConfigCommand("echo grepai search")).toBe(false);
	});

	it("starts the initial scan and background watcher before a semantic search", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "grepai-watch-"));
		const configPath = getGrepaiConfigPath(tempDir);
		mkdirSync(join(tempDir, GREPAI_CONFIG_DIR), { recursive: true });
		writeFileSync(configPath, "version: 1\n", "utf8");

		const { pi, handlers } = makePi();
		pi.exec.mockResolvedValue({ stdout: "Status: not running", stderr: "", code: 0, killed: false });
		const previousOffline = process.env.PI_OFFLINE;
		delete process.env.PI_OFFLINE;
		try {
			grepaiExtension(pi);
			const handler = handlers.get("tool_call")?.[0];
			if (!handler) throw new Error("no tool_call handler registered");
			await handler(
				{ type: "tool_call", toolName: "bash", input: { command: 'grepai search "auth flow"' } },
				{
					cwd: tempDir,
					modelRegistry: { getApiKeyForProvider: vi.fn().mockResolvedValue("sk-token") },
				} as any,
			);
		} finally {
			if (previousOffline === undefined) delete process.env.PI_OFFLINE;
			else process.env.PI_OFFLINE = previousOffline;
		}

		expect(pi.exec).toHaveBeenNthCalledWith(1, "/fake/grepai", ["watch", "--status"], expect.objectContaining({ cwd: tempDir }));
		expect(pi.exec).toHaveBeenNthCalledWith(2, "/fake/grepai", ["watch", "--background"], expect.objectContaining({ cwd: tempDir }));
	});

	it("finds the nearest project config while walking upward", () => {
		tempDir = mkdtempSync(join(tmpdir(), "grepai-root-"));
		const nested = join(tempDir, "packages", "app");
		mkdirSync(nested, { recursive: true });
		const configPath = getGrepaiConfigPath(tempDir);
		mkdirSync(join(tempDir, GREPAI_CONFIG_DIR), { recursive: true });
		writeFileSync(configPath, "version: 1\n", "utf8");

		expect(findGrepaiProjectRoot(nested)).toBe(tempDir);
		expect(findGrepaiProjectRoot(join(tempDir, "missing"))).toBe(tempDir);
	});

	it("applies the LiteLLM OpenAI embedding defaults without dropping other settings", () => {
		const config = {
			store: { backend: "qdrant", collection: "custom-index" },
			ignore: ["custom-dir"],
			embedder: { provider: "ollama", model: "old-model", parallelism: 1 },
		};
		const updated = applyGrepaiDefaults(config, "sk-token");

		expect(updated.store).toEqual({ backend: GREPAI_STORE_BACKEND, collection: "custom-index" });
		expect(updated.ignore).toEqual(["custom-dir"]);
		expect(updated.embedder).toEqual({
			provider: "openai",
			model: GREPAI_EMBEDDING_MODEL,
			endpoint: GREPAI_EMBEDDING_ENDPOINT,
			api_key: "sk-token",
			dimensions: GREPAI_EMBEDDING_DIMENSIONS,
			parallelism: 4,
		});
	});
});
