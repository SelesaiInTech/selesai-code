import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@selesai/code", () => ({
	getAgentDir: () => process.env.SELESAI_CODING_AGENT_DIR ?? join(require("node:os").homedir(), ".selesai", "agent"),
	getSettingsPath: () => join(process.env.SELESAI_CODING_AGENT_DIR ?? join(require("node:os").homedir(), ".selesai", "agent"), "settings.json"),
}));

import {
	BRAVE_KEYS_URL,
	getBraveApiKey,
	getWebAgentConfigPath,
	isPlaceholderKey,
	ONBOARDING_MARKER_NAME,
	readSettingsJson,
	setBraveApiKey,
	validateBraveKey,
	WEB_AGENT_CONFIG_SUBPATH,
	writeSettingsJson,
	writeWebAgentBraveBackendConfig,
} from "./web-agent-onboarding.ts";
import webAgentOnboardingExtension from "./web-agent-onboarding.ts";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, SessionStartEvent } from "../core/extensions/types.ts";

let agentDir: string;

beforeEach(() => {
	agentDir = mkdtempSync(join(tmpdir(), "web-agent-ob-"));
	process.env.SELESAI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
	rmSync(agentDir, { recursive: true, force: true });
	delete process.env.SELESAI_CODING_AGENT_DIR;
});

describe("web-agent-onboarding helpers", () => {
	it("isPlaceholderKey returns true for missing/empty/non-string values", () => {
		expect(isPlaceholderKey(undefined)).toBe(true);
		expect(isPlaceholderKey(null)).toBe(true);
		expect(isPlaceholderKey("")).toBe(true);
		expect(isPlaceholderKey("   ")).toBe(true);
		expect(isPlaceholderKey(42)).toBe(true);
		expect(isPlaceholderKey("BSA123abc")).toBe(false);
	});

	it("getBraveApiKey reads the nested value safely", () => {
		expect(getBraveApiKey({})).toBeUndefined();
		expect(getBraveApiKey({ webAgent: "not-an-object" })).toBeUndefined();
		expect(getBraveApiKey({ webAgent: [] })).toBeUndefined();
		expect(getBraveApiKey({ webAgent: { braveApiKey: "key-1" } })).toBe("key-1");
	});

	it("setBraveApiKey clones and sets the nested value", () => {
		const original = { other: 1, webAgent: { braveApiKey: "old" } };
		const next = setBraveApiKey(original, "new-key");
		expect(next.webAgent).toEqual({ braveApiKey: "new-key" });
		expect(next.other).toBe(1);
		// original is not mutated
		expect(original.webAgent.braveApiKey).toBe("old");
		// missing/non-object webAgent is replaced
		expect(setBraveApiKey({}, "k").webAgent).toEqual({ braveApiKey: "k" });
		expect(setBraveApiKey({ webAgent: "x" }, "k").webAgent).toEqual({ braveApiKey: "k" });
		expect(setBraveApiKey({ webAgent: [] }, "k").webAgent).toEqual({ braveApiKey: "k" });
	});

	it("validateBraveKey trims and reports errors", () => {
		expect(validateBraveKey("  BSA-key  ")).toEqual({ key: "BSA-key" });
		expect(validateBraveKey("")).toEqual({ error: "Key cannot be empty." });
		expect(validateBraveKey("   ")).toEqual({ error: "Key cannot be empty." });
		expect(validateBraveKey(undefined)).toEqual({ error: "No key entered." });
		expect(validateBraveKey(null as unknown as string)).toEqual({ error: "No key entered." });
	});

	it("readSettingsJson parses existing file, defaults to {} for missing/corrupt", () => {
		const settingsPath = join(agentDir, "settings.json");
		writeFileSync(settingsPath, '{"webAgent":{"braveApiKey":"k"}}', "utf-8");
		expect(readSettingsJson(settingsPath)).toEqual({ webAgent: { braveApiKey: "k" } });
		expect(readSettingsJson(join(agentDir, "missing.json"))).toEqual({});
		writeFileSync(settingsPath, "{not json", "utf-8");
		expect(readSettingsJson(settingsPath)).toEqual({});
	});

	it("writeSettingsJson creates dirs and writes pretty JSON with trailing newline", () => {
		const deep = join(agentDir, "nested", "dir");
		const settingsPath = join(deep, "settings.json");
		writeSettingsJson({ a: 1 }, settingsPath);
		expect(readFileSync(settingsPath, "utf-8")).toBe('{\n  "a": 1\n}\n');
	});

	it("getWebAgentConfigPath joins agentDir with the config subpath", () => {
		expect(getWebAgentConfigPath(agentDir)).toBe(join(agentDir, "extensions", "pi-web-agent", "config.json"));
		expect(WEB_AGENT_CONFIG_SUBPATH).toBe(join("extensions", "pi-web-agent", "config.json"));
	});

	it("writeWebAgentBraveBackendConfig writes brave with duckduckgo fallback, merging existing", () => {
		const configPath = getWebAgentConfigPath(agentDir);
		// Pre-seed an existing config to verify merge-not-clobber.
		mkdirSync(join(agentDir, "extensions", "pi-web-agent"), { recursive: true });
		writeFileSync(configPath, '{"presentation":{"theme":"dark"}}', "utf-8");
		writeWebAgentBraveBackendConfig(agentDir);
		const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
		expect(parsed.presentation).toEqual({ theme: "dark" });
		expect(parsed.backends.search).toEqual({ provider: "brave", fallback: "duckduckgo" });
	});

	it("writeWebAgentBraveBackendConfig tolerates missing/corrupt existing config", () => {
		const configPath = getWebAgentConfigPath(agentDir);
		mkdirSync(join(agentDir, "extensions", "pi-web-agent"), { recursive: true });
		writeFileSync(configPath, "{corrupt", "utf-8");
		writeWebAgentBraveBackendConfig(agentDir);
		const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
		expect(parsed.backends.search).toEqual({ provider: "brave", fallback: "duckduckgo" });

		// Missing file entirely -> starts fresh.
		const freshDir = mkdtempSync(join(tmpdir(), "web-agent-fresh-"));
		writeWebAgentBraveBackendConfig(freshDir);
		const freshParsed = JSON.parse(readFileSync(join(freshDir, WEB_AGENT_CONFIG_SUBPATH), "utf-8"));
		expect(freshParsed.backends.search).toEqual({ provider: "brave", fallback: "duckduckgo" });
		rmSync(freshDir, { recursive: true, force: true });
	});
});

describe("web-agent-onboarding constants and markers", () => {
	it("exports the Brave keys URL and marker name", () => {
		expect(BRAVE_KEYS_URL).toContain("brave.com");
		expect(ONBOARDING_MARKER_NAME).toBe(".webAgentOnboardingComplete");
	});
});

describe("web-agent-onboarding extension lifecycle", () => {
	function makePi(overrides: Partial<ExtensionAPI> = {}): { pi: ExtensionAPI; on: ReturnType<typeof vi.fn>; registerCommand: ReturnType<typeof vi.fn> } {
		const on = vi.fn();
		const registerCommand = vi.fn();
		const pi = { on, registerCommand, ...overrides } as unknown as ExtensionAPI;
		webAgentOnboardingExtension(pi);
		return { pi, on, registerCommand };
	}

	function sessionStartHandler(pi: ExtensionAPI): (event: SessionStartEvent, ctx: ExtensionContext) => Promise<void> {
		return (pi.on as ReturnType<typeof vi.fn>).mock.calls.find(([event]: [string]) => event === "session_start")![1];
	}

	it("registers session_start and setup-web-search command", () => {
		const { on, registerCommand } = makePi();
		expect(on).toHaveBeenCalledWith("session_start", expect.any(Function));
		expect(registerCommand).toHaveBeenCalledWith("setup-web-search", expect.objectContaining({ description: expect.stringContaining("Brave") }));
	});

	it("session_start ignores non-startup reasons", async () => {
		const { pi } = makePi();
		const handler = sessionStartHandler(pi);
		const ctx = { hasUI: true } as unknown as ExtensionContext;
		await handler({ reason: "reload" } as SessionStartEvent, ctx);
		// No marker written, no prompt: marker missing proves no completion occurred.
		expect(existsSync(join(agentDir, ONBOARDING_MARKER_NAME))).toBe(false);
	});

	it("session_start skips when onboarding is already complete", async () => {
		writeFileSync(join(agentDir, ONBOARDING_MARKER_NAME), "1", "utf-8");
		const { pi } = makePi();
		const handler = sessionStartHandler(pi);
		const input = vi.fn();
		const ctx = { hasUI: true, ui: { input } } as unknown as ExtensionContext;
		await handler({ reason: "startup" } as SessionStartEvent, ctx);
		expect(input).not.toHaveBeenCalled();
	});

	it("session_start defers when SELESAI_SKIP_WEB_AGENT_ONBOARDING=1", async () => {
		process.env.SELESAI_SKIP_WEB_AGENT_ONBOARDING = "1";
		try {
			const { pi } = makePi();
			const handler = sessionStartHandler(pi);
			const input = vi.fn();
			const ctx = { hasUI: true, ui: { input } } as unknown as ExtensionContext;
			await handler({ reason: "startup" } as SessionStartEvent, ctx);
			expect(input).not.toHaveBeenCalled();
		} finally {
			delete process.env.SELESAI_SKIP_WEB_AGENT_ONBOARDING;
		}
	});

	it("session_start skips when no UI is available", async () => {
		const { pi } = makePi();
		const handler = sessionStartHandler(pi);
		const input = vi.fn();
		const ctx = { hasUI: false, ui: { input } } as unknown as ExtensionContext;
		await handler({ reason: "startup" } as SessionStartEvent, ctx);
		expect(input).not.toHaveBeenCalled();
	});

	it("already-configured key defers and marks complete", async () => {
		const settingsPath = join(agentDir, "settings.json");
		writeFileSync(settingsPath, '{"webAgent":{"braveApiKey":"existing-key"}}', "utf-8");
		const { pi } = makePi();
		const handler = sessionStartHandler(pi);
		const confirm = vi.fn();
		const ctx = { hasUI: true, ui: { confirm } } as unknown as ExtensionContext;
		await handler({ reason: "startup" } as SessionStartEvent, ctx);
		expect(confirm).not.toHaveBeenCalled();
		expect(existsSync(join(agentDir, ONBOARDING_MARKER_NAME))).toBe(true);
	});

	it("declining Brave skips onboarding and notifies", async () => {
		const { pi } = makePi();
		const handler = sessionStartHandler(pi);
		const notify = vi.fn();
		const ctx = { hasUI: true, ui: { confirm: async () => false, notify } } as unknown as ExtensionContext;
		await handler({ reason: "startup" } as SessionStartEvent, ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("skipped"), "info");
		expect(existsSync(join(agentDir, ONBOARDING_MARKER_NAME))).toBe(true);
	});

	it("accepting Brave saves the key and config", async () => {
		const { pi } = makePi();
		const handler = sessionStartHandler(pi);
		const notify = vi.fn();
		const exec = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
		const ctx = {
			hasUI: true,
			ui: { confirm: async () => true, input: async () => "  BSA-my-key  ", notify },
		} as unknown as ExtensionContext;
		await handler({ reason: "startup" } as SessionStartEvent, ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("saved"), "info");
		expect(exec).not.toHaveBeenCalled(); // openBraveKeysUrl uses pi.exec — not provided here
		const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"));
		expect(settings.webAgent.braveApiKey).toBe("BSA-my-key");
		const config = JSON.parse(readFileSync(join(agentDir, WEB_AGENT_CONFIG_SUBPATH), "utf-8"));
		expect(config.backends.search).toEqual({ provider: "brave", fallback: "duckduckgo" });
		expect(existsSync(join(agentDir, ONBOARDING_MARKER_NAME))).toBe(true);
	});

	it("accepting Brave with browser open failure still saves", async () => {
		const { pi } = makePi();
		const handler = sessionStartHandler(pi);
		const notify = vi.fn();
		const exec = vi.fn().mockResolvedValue({ code: 1, stdout: "", stderr: "no browser" });
		const ctx = {
			hasUI: true,
			ui: { confirm: async () => true, input: async () => "BSA-key", notify },
		} as unknown as ExtensionContext;
		await handler({ reason: "startup" } as SessionStartEvent, ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Could not open browser"), "warning");
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("manually"), "info");
		const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"));
		expect(settings.webAgent.braveApiKey).toBe("BSA-key");
	});

	describe("openBraveKeysUrl platform branches", () => {
		it("uses win32 command and still saves on zero exit", async () => {
			const original = process.platform;
			const exec = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
			try {
				Object.defineProperty(process, "platform", { value: "win32", configurable: true });
				const { pi } = makePi({ exec } as unknown as ExtensionAPI);
				const handler = sessionStartHandler(pi);
				const notify = vi.fn();
				const ctx = {
					hasUI: true,
					ui: { confirm: async () => true, input: async () => "BSA-win", notify },
				} as unknown as ExtensionContext;
				await handler({ reason: "startup" } as SessionStartEvent, ctx);
				expect(exec).toHaveBeenCalledWith("cmd", ["/c", "start", "", BRAVE_KEYS_URL], { timeout: 10_000 });
				expect(notify).toHaveBeenCalledWith(expect.stringContaining("Opened the Brave API key dashboard"), "info");
			} finally {
				Object.defineProperty(process, "platform", { value: original, configurable: true });
			}
		});

		it("uses xdg-open on other platforms", async () => {
			const original = process.platform;
			const exec = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
			try {
				Object.defineProperty(process, "platform", { value: "linux", configurable: true });
				const { pi } = makePi({ exec } as unknown as ExtensionAPI);
				const handler = sessionStartHandler(pi);
				const notify = vi.fn();
				const ctx = {
					hasUI: true,
					ui: { confirm: async () => true, input: async () => "BSA-lin", notify },
				} as unknown as ExtensionContext;
				await handler({ reason: "startup" } as SessionStartEvent, ctx);
				expect(exec).toHaveBeenCalledWith("xdg-open", [BRAVE_KEYS_URL], { timeout: 10_000 });
			} finally {
				Object.defineProperty(process, "platform", { value: original, configurable: true });
			}
		});

		it("non-zero exit warns and opens the manual URL even after a string error", async () => {
			const original = process.platform;
			const exec = vi.fn().mockResolvedValue({ code: 1, stdout: "", stderr: "browser failed" });
			try {
				Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
				const { pi } = makePi({ exec } as unknown as ExtensionAPI);
				const handler = sessionStartHandler(pi);
				const notify = vi.fn();
				const ctx = {
					hasUI: true,
					ui: { confirm: async () => true, input: async () => "BSA-err", notify },
				} as unknown as ExtensionContext;
				await handler({ reason: "startup" } as SessionStartEvent, ctx);
				expect(notify).toHaveBeenCalledWith(expect.stringContaining("Could not open browser: Failed to open"), "warning");
				expect(notify).toHaveBeenCalledWith(expect.stringContaining("manually"), "info");
				// Even though the browser failed, the key is still saved.
				const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"));
				expect(settings.webAgent.braveApiKey).toBe("BSA-err");
			} finally {
				Object.defineProperty(process, "platform", { value: original, configurable: true });
			}
		});

		it("a rejecting exec (non-Error) still warns without crashing the flow", async () => {
			const original = process.platform;
			const exec = vi.fn().mockRejectedValue("plain string failure");
			try {
				Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
				const { pi } = makePi({ exec } as unknown as ExtensionAPI);
				const handler = sessionStartHandler(pi);
				const notify = vi.fn();
				const ctx = {
					hasUI: true,
					ui: { confirm: async () => true, input: async () => "BSA-rej", notify },
				} as unknown as ExtensionContext;
				await handler({ reason: "startup" } as SessionStartEvent, ctx);
				expect(notify).toHaveBeenCalledWith(expect.stringContaining("Could not open browser: plain string failure"), "warning");
				const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"));
				expect(settings.webAgent.braveApiKey).toBe("BSA-rej");
			} finally {
				Object.defineProperty(process, "platform", { value: original, configurable: true });
			}
		});
		it("non-zero exit with both stderr and stdout empty falls back to unknown error", async () => {
			const original = process.platform;
			const exec = vi.fn().mockResolvedValue({ code: 1, stdout: "", stderr: "" });
			try {
				Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
				const { pi } = makePi({ exec } as unknown as ExtensionAPI);
				const handler = sessionStartHandler(pi);
				const notify = vi.fn();
				const ctx = {
					hasUI: true,
					ui: { confirm: async () => true, input: async () => "BSA-un", notify },
				} as unknown as ExtensionContext;
				await handler({ reason: "startup" } as SessionStartEvent, ctx);
				expect(notify).toHaveBeenCalledWith(expect.stringContaining("unknown error"), "warning");
				const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"));
				expect(settings.webAgent.braveApiKey).toBe("BSA-un");
			} finally {
				Object.defineProperty(process, "platform", { value: original, configurable: true });
			}
		});
	});

	it("empty pasted key defers without saving", async () => {
		const { pi } = makePi();
		const handler = sessionStartHandler(pi);
		const notify = vi.fn();
		const ctx = {
			hasUI: true,
			ui: { confirm: async () => true, input: async () => "  ", notify },
		} as unknown as ExtensionContext;
		await handler({ reason: "startup" } as SessionStartEvent, ctx);
		expect(notify).toHaveBeenCalledWith("Key cannot be empty.", "warning");
		expect(existsSync(join(agentDir, ONBOARDING_MARKER_NAME))).toBe(false);
		expect(existsSync(join(agentDir, "settings.json"))).toBe(false);
	});

	it("setup-web-search command saves and reloads extensions", async () => {
		const exec = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
		const { registerCommand } = makePi({ exec } as unknown as ExtensionAPI);
		const { handler } = registerCommand.mock.calls.find(([name]: [string]) => name === "setup-web-search")![1] as { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> };
		const reload = vi.fn().mockResolvedValue(undefined);
		const notify = vi.fn();
		const ctx = {
			hasUI: true,
			reload,
			ui: { confirm: async () => true, input: async () => "BSA-key", notify },
		} as unknown as ExtensionCommandContext;
		await handler("", ctx);
		expect(reload).toHaveBeenCalled();
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("reloading extensions"), "info");
		const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"));
		expect(settings.webAgent.braveApiKey).toBe("BSA-key");
	});

	it("setup-web-search command does not reload when skipped", async () => {
		const { registerCommand } = makePi();
		const { handler } = registerCommand.mock.calls.find(([name]: [string]) => name === "setup-web-search")![1] as { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> };
		const reload = vi.fn();
		const notify = vi.fn();
		const ctx = {
			hasUI: true,
			reload,
			ui: { confirm: async () => false, notify },
		} as unknown as ExtensionCommandContext;
		await handler("", ctx);
		expect(reload).not.toHaveBeenCalled();
	});

	it("setup-web-search command defers (no reload) when key is invalid", async () => {
		const { registerCommand } = makePi();
		const { handler } = registerCommand.mock.calls.find(([name]: [string]) => name === "setup-web-search")![1] as { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> };
		const reload = vi.fn();
		const notify = vi.fn();
		const ctx = {
			hasUI: true,
			reload,
			ui: { confirm: async () => true, input: async () => "", notify },
		} as unknown as ExtensionCommandContext;
		await handler("", ctx);
		expect(reload).not.toHaveBeenCalled();
	});
});