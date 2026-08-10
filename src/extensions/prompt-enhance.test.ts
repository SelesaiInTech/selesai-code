import { beforeEach, describe, expect, it, vi } from "vitest";
import promptEnhanceExtension, {
	buildEnhanceContext,
	extractText,
	resolvePromptEnhanceConfig,
} from "./prompt-enhance.ts";

vi.mock("@selesai/code", () => ({
	BorderedLoader: class BorderedLoader {
		onAbort: (() => void) | undefined;
		signal: undefined;
		constructor(_tui: unknown, _theme: unknown, _message: string) {}
	},
	CONFIG_DIR_NAME: ".pi",
	getAgentDir: () => "/tmp/fake-agent-dir",
}));

type AnyHandler = (ctx: any) => Promise<void> | void;
type Shortcut = { description?: string; handler: AnyHandler };
type Command = { description: string; handler: (args: string, ctx: any) => Promise<void> };

function createHarness() {
	const shortcuts = new Map<string, Shortcut>();
	const commands = new Map<string, Command>();
	const pi = {
		registerShortcut: vi.fn((key: string, opts: Shortcut) => {
			shortcuts.set(key, opts);
		}),
		registerCommand: vi.fn((name: string, opts: Command) => {
			commands.set(name, opts);
		}),
	};
	promptEnhanceExtension(pi as any);
	return { shortcuts, commands, pi };
}

function baseCtx(overrides: Record<string, unknown> = {}) {
	return {
		mode: "tui",
		cwd: "/tmp/project",
		model: { provider: "test", id: "model" },
		isProjectTrusted: () => true,
		ui: {
			notify: vi.fn(),
			getEditorText: () => "write a test",
			setEditorText: vi.fn(),
			select: vi.fn(async () => "append"),
			custom: vi.fn(),
		},
		modelRegistry: { getApiKeyAndHeaders: vi.fn() },
		...overrides,
	};
}

describe("resolvePromptEnhanceConfig", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("defaults to replace mode when nothing is configured", () => {
		expect(resolvePromptEnhanceConfig(undefined, undefined, true)).toEqual({ mode: "replace" });
	});

	it("lets the trusted project config override the global config", () => {
		const globalRaw = { mode: "replace", instructions: "global notes" };
		const projectRaw = { mode: "append", instructions: "project notes" };
		expect(resolvePromptEnhanceConfig(globalRaw, projectRaw, true)).toEqual({
			mode: "append",
			instructions: "project notes",
		});
	});

	it("ignores the project config when the project is not trusted", () => {
		const globalRaw = { mode: "replace", instructions: "global notes" };
		const projectRaw = { mode: "append", instructions: "project notes" };
		expect(resolvePromptEnhanceConfig(globalRaw, projectRaw, false)).toEqual({
			mode: "replace",
			instructions: "global notes",
		});
	});

	it("falls back to defaults when the raw config is malformed", () => {
		expect(resolvePromptEnhanceConfig("garbage", { mode: "sideways" }, true)).toEqual({ mode: "replace" });
		expect(resolvePromptEnhanceConfig({ mode: "replace", instructions: 42 }, undefined, true)).toEqual({
			mode: "replace",
		});
	});
});

describe("buildEnhanceContext", () => {
	it("uses the replace system prompt and passes the draft through", () => {
		const ctx = buildEnhanceContext("do the thing", "replace", undefined);
		expect(ctx.systemPrompt).toContain("Rewrite the user's draft into a complete, improved prompt");
		expect(ctx.messages[0].content).toEqual([{ type: "text", text: "do the thing" }]);
	});

	it("uses the append system prompt and prepends instructions when given", () => {
		const ctx = buildEnhanceContext("do the thing", "append", "be concise");
		expect(ctx.systemPrompt).toContain("Write an ADDITIVE supplement that extends the user's draft prompt");
		expect(ctx.messages[0].content).toEqual([{ type: "text", text: "be concise\n\ndo the thing" }]);
	});
});

describe("extractText", () => {
	it("joins text blocks and skips non-text blocks", () => {
		expect(extractText([{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }])).toBe("a\nb");
	});

	it("returns an empty string for no text blocks", () => {
		expect(extractText([{ type: "image" }])).toBe("");
	});
});

describe("registration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("registers the alt+e shortcut and the enhance command", () => {
		const { shortcuts, commands, pi } = createHarness();
		expect(pi.registerShortcut).toHaveBeenCalledTimes(1);
		expect(pi.registerCommand).toHaveBeenCalledTimes(1);

		const shortcut = shortcuts.get("alt+e");
		expect(shortcut).toBeDefined();
		expect(shortcut!.description).toBe("Enhance editor prompt");

		const command = commands.get("enhance");
		expect(command).toBeDefined();
		expect(command!.description).toBe("Enhance the draft prompt in the editor");
	});

	it("shortcut handler and command handler both guard against non-tui contexts", async () => {
		const { shortcuts, commands } = createHarness();

		const rpcCtx = baseCtx({ mode: "rpc" });
		await commands.get("enhance")!.handler("", rpcCtx);
		expect(rpcCtx.ui.notify).toHaveBeenCalledWith("prompt enhance requires interactive mode", "error");

		const shortcutCtx = baseCtx({ mode: "rpc" });
		await shortcuts.get("alt+e")!.handler(shortcutCtx);
		expect(shortcutCtx.ui.notify).toHaveBeenCalledWith("prompt enhance requires interactive mode", "error");
	});

	it("notifies when no model is selected", async () => {
		const { commands } = createHarness();
		const ctx = baseCtx({ model: undefined });
		await commands.get("enhance")!.handler("", ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith("No model selected", "error");
	});

	it("notifies info and leaves the editor untouched when the draft is empty", async () => {
		const { commands } = createHarness();
		const ctx = baseCtx({ ui: { ...baseCtx().ui, getEditorText: () => "   " } });
		await commands.get("enhance")!.handler("", ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith("Editor is empty; nothing to enhance", "info");
		expect(ctx.ui.setEditorText).not.toHaveBeenCalled();
	});
});
