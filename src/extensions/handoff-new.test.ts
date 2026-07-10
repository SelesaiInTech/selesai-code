// Tests for /handoff-new. These import runtime values from "@selesai/code",
// which is this package itself and only resolves against a built dist.
// Run with the resolve hook that maps @selesai/code -> src/index.ts:
//   node --import ./src/extensions/test-resolve-hook.mjs --test src/extensions/handoff-new.test.ts
import test from "node:test";
import assert from "node:assert/strict";

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

test("registers handoff-new only", () => {
	const { commands } = createPiHarness();
	assert.ok(commands.has("handoff-new"));
	assert.equal(commands.has("handover-new"), false);
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

test("entryToMessage: message entry -> message", () => {
	const e = userEntry("hi");
	assert.deepEqual(entryToMessage(e), (e as any).message);
});

test("entryToMessage: compaction entry -> compactionSummary", () => {
	const e = compactionEntry("c1", "k1");
	const m: any = entryToMessage(e);
	assert.equal(m.role, "compactionSummary");
	assert.equal(m.summary, "compacted summary");
});

test("entryToMessage: other entry types -> undefined", () => {
	assert.equal(entryToMessage({ type: "label", id: "l1" } as any as SessionEntry), undefined);
});

test("getHandoffMessages: no compaction returns all messages", () => {
	const branch = [userEntry("a", "1"), userEntry("b", "2")];
	assert.equal(getHandoffMessages(branch).length, 2);
});

test("getHandoffMessages: compaction prepends summary + kept slice + after", () => {
	const branch = [
		userEntry("old-kept", "k1"),
		compactionEntry("c1", "k1"),
		userEntry("after", "a1"),
	];
	const msgs = getHandoffMessages(branch);
	assert.equal(msgs.length, 3);
	assert.equal((msgs[0] as any).role, "compactionSummary");
	assert.equal((msgs[1] as any).content[0].text, "old-kept");
	assert.equal((msgs[2] as any).content[0].text, "after");
});

test("buildAiContext: embeds conversation + goal into one user turn", () => {
	const ctx = buildAiContext("conv-text", "my-goal");
	assert.ok(ctx.systemPrompt.length > 0);
	assert.equal(ctx.messages.length, 1);
	const text = (ctx.messages[0].content[0] as any).text;
	assert.ok(text.includes("conv-text"));
	assert.ok(text.includes("my-goal"));
});

// ---- handler ----

function createCtx(opts: {
	branch?: SessionEntry[];
	model?: any;
	customResult?: string | null;
	mode?: string;
} = {}) {
	const calls: { newSession: any; editorText: string | null; notify: { msg: string; kind: string }[] } = {
		newSession: null,
		editorText: null,
		notify: [],
	};
	const ctx: any = {
		mode: opts.mode ?? "tui",
		model: opts.model === undefined ? { provider: "test", id: "m" } : opts.model,
		sessionManager: {
			getBranch: () => opts.branch === undefined ? [userEntry("we decided to build X")] : opts.branch,
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
			setEditorText: (text: string) => {
				calls.editorText = text;
			},
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

test("happy path: newSession called with parentSession, editor text set", async () => {
	const { commands } = createPiHarness();
	const { ctx, calls } = createCtx();
	await commands.get("handoff-new")!.handler("continue the fix", ctx);
	assert.equal(calls.newSession.parentSession, "/tmp/old.json");
	assert.equal(calls.editorText, "HANDOFF PROMPT");
	assert.equal(calls.newSession.cancelled, undefined);
});

test("no goal arg uses DEFAULT_GOAL", async () => {
	const { commands } = createPiHarness();
	const { ctx, calls } = createCtx();
	await commands.get("handoff-new")!.handler("   ", ctx);
	// happy path still completes; default goal only affects the AI prompt text.
	assert.equal(calls.editorText, "HANDOFF PROMPT");
	assert.ok(calls.notify.some((n) => /Handoff ready/.test(n.msg)));
});

test("non-tui mode fails cleanly, no new session", async () => {
	const { commands } = createPiHarness();
	const { ctx, calls } = createCtx({ mode: "rpc" });
	await commands.get("handoff-new")!.handler("goal", ctx);
	assert.equal(calls.newSession, null);
	assert.ok(calls.notify.some((n) => /interactive mode/.test(n.msg)));
});

test("no model fails cleanly", async () => {
	const { commands } = createPiHarness();
	const { ctx, calls } = createCtx({ model: null });
	await commands.get("handoff-new")!.handler("goal", ctx);
	assert.equal(calls.newSession, null);
	assert.ok(calls.notify.some((n) => /No model/.test(n.msg)));
});

test("empty conversation fails cleanly", async () => {
	const { commands } = createPiHarness();
	const { ctx, calls } = createCtx({ branch: [] });
	await commands.get("handoff-new")!.handler("goal", ctx);
	assert.equal(calls.newSession, null);
	assert.ok(calls.notify.some((n) => /No conversation/.test(n.msg)));
});

test("custom null (cancelled) does not open new session", async () => {
	const { commands } = createPiHarness();
	const { ctx, calls } = createCtx({ customResult: null });
	await commands.get("handoff-new")!.handler("goal", ctx);
	assert.equal(calls.newSession, null);
	assert.ok(calls.notify.some((n) => /Cancelled/.test(n.msg)));
});

// sanity: DEFAULT_GOAL exported and non-empty (used by handler)
test("DEFAULT_GOAL is non-empty", () => {
	assert.ok(DEFAULT_GOAL.length > 0);
});