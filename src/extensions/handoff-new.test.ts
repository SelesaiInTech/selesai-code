// Tests for /handoff-new. These import runtime values from "@selesai/code",
// which is this package itself and only resolves against a built dist
// (vitest.config.ts aliases @selesai/code -> dist/index.js).
import { describe, expect, it, vi } from "vitest";

vi.mock("@selesai/code", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@selesai/code")>();
	return {
		...actual,
		BorderedLoader: vi.fn().mockImplementation(function (this: any, _tui: any, _theme: any, _label: string) {
			this.signal = new AbortController().signal;
			this.onAbort = null;
		}),
	};
});

vi.mock("@earendil-works/pi-ai/compat", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-ai/compat")>();
	return {
		...actual,
		complete: vi.fn(),
	};
});

import { complete } from "@earendil-works/pi-ai/compat";
import handoffNewExtension, {
	DEFAULT_GOAL,
	buildAiContext,
	entryToMessage,
	getHandoffMessages,
} from "./handoff-new.ts";
import type { SessionEntry } from "@selesai/code";

// ---- registration ----

type Cmd = { description: string; handler: (a: string, c: any) => Promise<void> };

function createPiHarness() {
	const commands = new Map<string, Cmd>();
	const pi = {
		registerCommand(name: string, options: Cmd) {
			commands.set(name, options);
		},
	};
	handoffNewExtension(pi as any);
	return { commands };
}

describe("handoff-new extension", () => {
	it("registers handoff-new only", () => {
		const { commands } = createPiHarness();
		expect(commands.has("handoff-new")).toBe(true);
		expect(commands.has("handover-new")).toBe(false);
	});

	// ---- pure helpers ----

	function userEntry(text: string, id = "u1"): SessionEntry {
		return {
			id,
			type: "message",
			message: { role: "user", content: [{ type: "text", text }], timestamp: 100 },
			parentId: "root",
			timestamp: 100,
		} as any as SessionEntry;
	}

	function compactionEntry(id: string, firstKeptEntryId: string): SessionEntry {
		return {
			id,
			type: "compaction",
			summary: "compacted summary",
			tokensBefore: 1000,
			firstKeptEntryId,
			timestamp: 50,
		} as any as SessionEntry;
	}

	it("entryToMessage: message entry -> message", () => {
		const e = userEntry("hi");
		expect(entryToMessage(e)).toEqual((e as any).message);
	});

	it("entryToMessage: compaction entry -> compactionSummary", () => {
		const e = compactionEntry("c1", "k1");
		const m: any = entryToMessage(e);
		expect(m.role).toBe("compactionSummary");
		expect(m.summary).toBe("compacted summary");
	});

	it("entryToMessage: other entry types -> undefined", () => {
		expect(entryToMessage({ type: "label", id: "l1" } as any as SessionEntry)).toBeUndefined();
	});

	it("getHandoffMessages: no compaction returns all messages", () => {
		const branch = [userEntry("a", "1"), userEntry("b", "2")];
		expect(getHandoffMessages(branch)).toHaveLength(2);
	});

	it("getHandoffMessages: compaction prepends summary + kept slice + after", () => {
		const branch = [
			userEntry("old-kept", "k1"),
			compactionEntry("c1", "k1"),
			userEntry("after", "a1"),
		];
		const msgs = getHandoffMessages(branch);
		expect(msgs).toHaveLength(3);
		expect((msgs[0] as any).role).toBe("compactionSummary");
		expect((msgs[1] as any).content[0].text).toBe("old-kept");
		expect((msgs[2] as any).content[0].text).toBe("after");
	});

	it("getHandoffMessages: compaction with unknown firstKeptEntryId keeps only summary + after", () => {
		const branch = [
			userEntry("old-kept", "k1"),
			compactionEntry("c1", "missing-id"),
			userEntry("after", "a1"),
		];
		const msgs = getHandoffMessages(branch);
		expect(msgs).toHaveLength(2);
		expect((msgs[0] as any).role).toBe("compactionSummary");
		expect((msgs[1] as any).content[0].text).toBe("after");
	});

	it("buildAiContext: embeds conversation + goal into one user turn", () => {
		const ctx = buildAiContext("conv-text", "my-goal");
		expect(ctx.systemPrompt.length).toBeGreaterThan(0);
		expect(ctx.messages).toHaveLength(1);
		const text = (ctx.messages[0].content[0] as any).text;
		expect(text).toContain("conv-text");
		expect(text).toContain("my-goal");
	});

	// ---- handler ----

	function createCtx(opts: {
		branch?: SessionEntry[];
		model?: any;
		customResult?: string | null;
		mode?: string;
	} = {}) {
		const calls: { newSession: any; userMessage: string | null; notify: { msg: string; kind: string }[] } = {
			newSession: null,
			userMessage: null,
			notify: [],
		};
		const ctx: any = {
			mode: opts.mode ?? "tui",
			model: opts.model === undefined ? { provider: "test", id: "m" } : opts.model,
			sessionManager: {
				getBranch: () => (opts.branch === undefined ? [userEntry("we decided to build X")] : opts.branch),
				getSessionFile: () => "/tmp/old.json",
			},
			modelRegistry: {
				async getApiKeyAndHeaders() {
					return { ok: true, apiKey: "key", headers: {} };
				},
			},
			ui: {
				notify: (msg: string, kind: string) => calls.notify.push({ msg, kind }),
				custom: async <T>(_factory: any): Promise<T> => (opts.customResult === undefined ? "HANDOFF PROMPT" : opts.customResult) as unknown as T,
			},
			async sendUserMessage(text: string) {
				calls.userMessage = text;
			},
			async newSession(options: any) {
				calls.newSession = options;
				if (options?.withSession) {
					await options.withSession(ctx);
				}
				return { cancelled: false };
			},
		};
		return { ctx, calls };
	}

	it("happy path: newSession called with parentSession, handoff submitted", async () => {
		const { commands } = createPiHarness();
		const { ctx, calls } = createCtx();
		await commands.get("handoff-new")!.handler("continue the fix", ctx);
		expect(calls.newSession.parentSession).toBe("/tmp/old.json");
		expect(calls.userMessage).toBe("HANDOFF PROMPT");
		expect(calls.newSession.cancelled).toBeUndefined();
	});

	it("no goal arg uses DEFAULT_GOAL", async () => {
		const { commands } = createPiHarness();
		const { ctx, calls } = createCtx();
		await commands.get("handoff-new")!.handler("   ", ctx);
		// happy path still completes; default goal only affects the AI prompt text.
		expect(calls.userMessage).toBe("HANDOFF PROMPT");
	});

	it("non-tui mode fails cleanly, no new session", async () => {
		const { commands } = createPiHarness();
		const { ctx, calls } = createCtx({ mode: "rpc" });
		await commands.get("handoff-new")!.handler("goal", ctx);
		expect(calls.newSession).toBeNull();
		expect(calls.notify.some((n) => /interactive mode/.test(n.msg))).toBe(true);
	});

	it("no model fails cleanly", async () => {
		const { commands } = createPiHarness();
		const { ctx, calls } = createCtx({ model: null });
		await commands.get("handoff-new")!.handler("goal", ctx);
		expect(calls.newSession).toBeNull();
		expect(calls.notify.some((n) => /No model/.test(n.msg))).toBe(true);
	});

	it("empty conversation fails cleanly", async () => {
		const { commands } = createPiHarness();
		const { ctx, calls } = createCtx({ branch: [] });
		await commands.get("handoff-new")!.handler("goal", ctx);
		expect(calls.newSession).toBeNull();
		expect(calls.notify.some((n) => /No conversation/.test(n.msg))).toBe(true);
	});

	it("custom null (cancelled) does not open new session", async () => {
		const { commands } = createPiHarness();
		const { ctx, calls } = createCtx({ customResult: null });
		await commands.get("handoff-new")!.handler("goal", ctx);
		expect(calls.newSession).toBeNull();
		expect(calls.notify.some((n) => /Cancelled/.test(n.msg))).toBe(true);
	});

	it("empty generated handoff does not open a blank session", async () => {
		const { commands } = createPiHarness();
		const { ctx, calls } = createCtx({ customResult: "  " });
		await commands.get("handoff-new")!.handler("goal", ctx);
		expect(calls.newSession).toBeNull();
		expect(calls.notify.some((n) => /returned no text/.test(n.msg))).toBe(true);
	});

	it("new session cancelled notifies", async () => {
		const { commands } = createPiHarness();
		const { ctx, calls } = createCtx();
		ctx.newSession = async (options: any) => {
			calls.newSession = options;
			if (options?.withSession) await options.withSession(ctx);
			return { cancelled: true };
		};
		await commands.get("handoff-new")!.handler("goal", ctx);
		expect(calls.notify.some((n) => /New session cancelled/.test(n.msg))).toBe(true);
	});

	// ---- custom factory (BorderedLoader + complete) ----

	function createFactoryCtx(opts: {
		auth?: { ok: boolean; apiKey?: string; error?: string };
		completeResult?: any;
		completeError?: Error;
	}) {
		const calls: { newSession: any; userMessage: string | null; notify: { msg: string; kind: string }[] } = {
			newSession: null,
			userMessage: null,
			notify: [],
		};
		let capturedFactory: ((tui: any, theme: any, kb: any, done: (v: unknown) => void) => unknown) | null = null;
		const ctx: any = {
			mode: "tui",
			model: { provider: "test", id: "m" },
			sessionManager: {
				getBranch: () => [userEntry("we decided to build X")],
				getSessionFile: () => "/tmp/old.json",
			},
			modelRegistry: {
				async getApiKeyAndHeaders() {
					return opts.auth ?? { ok: true, apiKey: "key", headers: {} };
				},
			},
			ui: {
				notify: (msg: string, kind: string) => calls.notify.push({ msg, kind }),
				custom: async <T>(factory: any): Promise<T> => {
					capturedFactory = factory;
					return new Promise<T>((resolve) => {
						const loader = factory({}, {}, {}, resolve);
						if (opts.completeError) {
							// The factory's async IIFE catches errors and calls done(null).
							// complete is mocked to reject; the catch handler runs synchronously
							// after the microtask queue drains.
						}
					});
				},
			},
			async sendUserMessage(text: string) {
				calls.userMessage = text;
			},
			async newSession(options: any) {
				calls.newSession = options;
				if (options?.withSession) {
					await options.withSession(ctx);
				}
				return { cancelled: false };
			},
		};
		return { ctx, calls, getFactory: () => capturedFactory };
	}

	it("factory: complete returns text content and submits the handoff", async () => {
		(complete as any).mockResolvedValueOnce({
			stopReason: "done",
			content: [
				{ type: "text", text: "Handoff part one" },
				{ type: "image", mimeType: "image/png" },
				{ type: "text", text: "Handoff part two" },
			],
		});
		const { commands } = createPiHarness();
		const { ctx, calls } = createFactoryCtx({});
		await commands.get("handoff-new")!.handler("goal", ctx);
		expect(calls.userMessage).toBe("Handoff part one\nHandoff part two");
		expect(calls.newSession).not.toBeNull();
	});

	it("factory: aborted stop reason returns null and notifies Cancelled", async () => {
		(complete as any).mockResolvedValueOnce({ stopReason: "aborted", content: [] });
		const { commands } = createPiHarness();
		const { ctx, calls } = createFactoryCtx({});
		await commands.get("handoff-new")!.handler("goal", ctx);
		expect(calls.newSession).toBeNull();
		expect(calls.notify.some((n) => /Cancelled/.test(n.msg))).toBe(true);
	});

	it("factory: missing API key throws and notifies Cancelled", async () => {
		const { commands } = createPiHarness();
		const { ctx, calls } = createFactoryCtx({ auth: { ok: true, error: "no key" } });
		await commands.get("handoff-new")!.handler("goal", ctx);
		expect(calls.newSession).toBeNull();
		expect(calls.notify.some((n) => /Cancelled/.test(n.msg))).toBe(true);
	});

	it("factory: auth error throws and notifies Cancelled", async () => {
		const { commands } = createPiHarness();
		const { ctx, calls } = createFactoryCtx({ auth: { ok: false, error: "auth failed" } });
		await commands.get("handoff-new")!.handler("goal", ctx);
		expect(calls.newSession).toBeNull();
		expect(calls.notify.some((n) => /Cancelled/.test(n.msg))).toBe(true);
	});

	it("factory: complete rejection is caught and notifies Cancelled", async () => {
		(complete as any).mockRejectedValueOnce(new Error("network down"));
		const { commands } = createPiHarness();
		const { ctx, calls } = createFactoryCtx({});
		await commands.get("handoff-new")!.handler("goal", ctx);
		expect(calls.newSession).toBeNull();
		expect(calls.notify.some((n) => /Cancelled/.test(n.msg))).toBe(true);
	});

	it("factory: loader onAbort resolves null", async () => {
		(complete as any).mockResolvedValueOnce({ stopReason: "done", content: [{ type: "text", text: "x" }] });
		const { commands } = createPiHarness();
		const { ctx, calls } = createFactoryCtx({});
		// Drive the factory manually: capture it, call onAbort, then let the
		// async IIFE finish.
		let factory: any = null;
		const customCtx: any = {
			mode: "tui",
			model: { provider: "test", id: "m" },
			sessionManager: {
				getBranch: () => [userEntry("we decided to build X")],
				getSessionFile: () => "/tmp/old.json",
			},
			modelRegistry: {
				async getApiKeyAndHeaders() {
					return { ok: true, apiKey: "key", headers: {} };
				},
			},
			ui: {
				notify: (msg: string, kind: string) => calls.notify.push({ msg, kind }),
				custom: async <T>(f: any): Promise<T> => {
					factory = f;
					return new Promise<T>((resolve) => {
						const loader = f({}, {}, {}, resolve);
						loader.onAbort();
					});
				},
			},
			async sendUserMessage(text: string) {
				calls.userMessage = text;
			},
			async newSession(options: any) {
				calls.newSession = options;
				if (options?.withSession) await options.withSession(customCtx);
				return { cancelled: false };
			},
		};
		await commands.get("handoff-new")!.handler("goal", customCtx);
		expect(calls.newSession).toBeNull();
		expect(calls.notify.some((n) => /Cancelled/.test(n.msg))).toBe(true);
	});

	// sanity: DEFAULT_GOAL exported and non-empty (used by handler)
	it("DEFAULT_GOAL is non-empty", () => {
		expect(DEFAULT_GOAL.length).toBeGreaterThan(0);
	});
});
