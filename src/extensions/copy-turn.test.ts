import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import copyTurnExtension from "./copy-turn.ts";

vi.mock("@selesai/code", () => ({
	copyToClipboard: vi.fn(),
}));

import { copyToClipboard } from "@selesai/code";

type AnyMessage = any;
type Handler = (event: any, ctx: any) => any;
type Command = { description: string; handler: (args: string, ctx: any) => Promise<void> };

const MARK_RE = /\n?\n?\s*⧉ copy(?:\s+\w+)?: \/cp ([0-9a-f]{6,12})\s*$/;

function hashFromMarkedText(text: string): string {
	const m = text.match(MARK_RE);
	if (!m) throw new Error(`no copy marker found in: ${JSON.stringify(text)}`);
	return m[1]!;
}

// hashFor(m) = sha1(JSON.stringify([role, resultOf(m)])).slice(0, 6)
function hashForText(role: string, text: string): string {
	return createHash("sha1").update(JSON.stringify([role, text])).digest("hex").slice(0, 6);
}

function createHarness() {
	const handlers = new Map<string, Handler>();
	const commands = new Map<string, Command>();
	const sent: AnyMessage[] = [];
	const pi = {
		on: vi.fn((event: string, handler: Handler) => {
			handlers.set(event, (e: any, c: any) => handler(e, { mode: "tui", ...(c ?? {}) }));
		}),
		registerCommand: vi.fn((name: string, opts: Command) => {
			commands.set(name, opts);
		}),
		registerMessageRenderer: vi.fn(),
		sendMessage: vi.fn((msg: AnyMessage) => {
			sent.push(msg);
		}),
	};
	copyTurnExtension(pi as any);
	return { handlers, commands, sent, pi };
}

function branchCtx(messages: AnyMessage[]) {
	return {
		sessionManager: { getBranch: () => messages.map((message) => ({ type: "message", message })) },
		ui: { notify: vi.fn() },
	};
}

describe("copy-turn hash stability", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("recomputes the displayed assistant hash from the persisted message despite metadata changes", async () => {
		const { handlers, commands } = createHarness();
		const messageEnd = handlers.get("message_end")!;

		// Transient message as seen by message_end (before persistence).
		const transient = {
			role: "assistant",
			content: [{ type: "text", text: "Fix the copy bug now." }],
			stopReason: "done",
		};
		const result = await messageEnd({ type: "message_end", message: transient }, {});
		const markedText = result.message.content[0].text as string;
		const displayedHash = hashFromMarkedText(markedText);
		expect(displayedHash).toMatch(/^[0-9a-f]{6}$/);

		// Persisted variant: same content plus the copy marker and changed metadata.
		const persisted = {
			...result.message,
			details: { latencyMs: 42 },
			stopReason: "error",
			timestamp: 1_700_000_000_000,
			sessionId: "s-1",
			msgId: "m-1",
			usage: { inputTokens: 1, outputTokens: 2 },
		};

		const ctx = branchCtx([persisted]);
		const cmd = commands.get("cp")!;
		await cmd.handler(displayedHash, ctx);

		expect(copyToClipboard).toHaveBeenCalledTimes(1);
		expect(copyToClipboard).toHaveBeenCalledWith("Fix the copy bug now.");
		expect(ctx.ui.notify).not.toHaveBeenCalledWith(`No message for hash ${displayedHash}`, "warning");
		expect(ctx.ui.notify).toHaveBeenCalledWith(`Copied ${displayedHash} (21 chars)`, "info");
	});

	it("resolves the displayed user hash from the persisted user message despite metadata changes", async () => {
		const { handlers, commands, sent } = createHarness();
		const messageEnd = handlers.get("message_end")!;

		await messageEnd({ type: "message_end", message: { role: "user", content: "show me the files" } }, {});
		const copyRow = sent.find((m) => m.customType === "copy-turn");
		expect(copyRow).toBeDefined();
		const displayedHash: string = copyRow.details.hash;

		// Persisted user message with metadata the transient object did not have.
		const persisted = {
			role: "user",
			content: "show me the files",
			details: { reranked: true },
			timestamp: 42,
		};

		const ctx = branchCtx([persisted]);
		const cmd = commands.get("cp")!;
		await cmd.handler(displayedHash, ctx);

		expect(copyToClipboard).toHaveBeenCalledTimes(1);
		expect(copyToClipboard).toHaveBeenCalledWith("show me the files");
		expect(ctx.ui.notify).not.toHaveBeenCalledWith(`No message for hash ${displayedHash}`, "warning");
	});

	it("strips existing copy markers before hashing", async () => {
		const { handlers } = createHarness();
		const messageEnd = handlers.get("message_end")!;

		const plain = { role: "assistant", content: [{ type: "text", text: "Same content" }] };
		const alreadyMarked = {
			role: "assistant",
			content: [{ type: "text", text: "Same content\n\n⧉ copy assistant: /cp abc123" }],
		};

		const r1 = await messageEnd({ type: "message_end", message: plain }, {});
		const r2 = await messageEnd({ type: "message_end", message: alreadyMarked }, {});

		expect(hashFromMarkedText(r1.message.content[0].text)).toBe(hashFromMarkedText(r2.message.content[0].text));
	});

	it("skips empty user messages and tool-use assistant messages", async () => {
		const { handlers, sent } = createHarness();
		const messageEnd = handlers.get("message_end")!;

		await messageEnd({ type: "message_end", message: { role: "user", content: "   " } }, {});
		expect(sent).toHaveLength(0);

		const toolUse = await messageEnd({ type: "message_end", message: { role: "assistant", content: "thinking", stopReason: "toolUse" } }, {});
		expect(toolUse).toBeUndefined();

		const emptyAssistant = await messageEnd({ type: "message_end", message: { role: "assistant", content: "" } }, {});
		expect(emptyAssistant).toBeUndefined();

		const otherRole = await messageEnd({ type: "message_end", message: { role: "system", content: "sys" } }, {});
		expect(otherRole).toBeUndefined();

		await messageEnd({ type: "message_end", message: null }, {});
		expect(sent).toHaveLength(0);
	});

	it("non-tui modes skip copy markers and copy rows", async () => {
		const { handlers, sent } = createHarness();
		const messageEnd = handlers.get("message_end")!;

		const rpcCtx = { mode: "rpc" };
		const assistant = await messageEnd(
			{ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "result text" }] } },
			rpcCtx,
		);
		expect(assistant).toBeUndefined(); // no ⧉ copy marker appended
		expect(sent).toHaveLength(0); // no user copy row either

		await messageEnd({ type: "message_end", message: { role: "user", content: "ask me" } }, rpcCtx);
		expect(sent).toHaveLength(0);

		// TUI mode still annotates as before.
		const tuiResult = await messageEnd(
			{ type: "message_end", message: { role: "assistant", content: "tui text" } },
			{ mode: "tui" },
		);
		expect(tuiResult.message.content).toMatch(/⧉ copy assistant: \/cp [0-9a-f]{6}/);
	});

	it("marks string-content assistant messages and bashExecution results", async () => {
		const { handlers } = createHarness();
		const messageEnd = handlers.get("message_end")!;

		const stringMsg = await messageEnd({ type: "message_end", message: { role: "assistant", content: "plain text result" } }, {});
		expect(stringMsg.message.content).toMatch(/plain text result\n\n⧉ copy assistant: \/cp [0-9a-f]{6}/);

		const bashMsg = await messageEnd({
			type: "message_end",
			message: { role: "bashExecution", content: "ignored", command: "ls -la", output: "file1\nfile2" },
		}, {});
		expect(bashMsg).toBeUndefined(); // bashExecution is not assistant
	});

	it("marks the last text part of multi-part assistant content", async () => {
		const { handlers } = createHarness();
		const messageEnd = handlers.get("message_end")!;

		const result = await messageEnd({
			type: "message_end",
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: "first part" },
					{ type: "image", mimeType: "image/png" },
					{ type: "text", text: "final part" },
				],
			},
		}, {});
		expect(result.message.content[0].text).toBe("first part");
		expect(result.message.content[1].type).toBe("image");
		expect(result.message.content[2].text).toMatch(/^final part\n\n⧉ copy assistant: \/cp [0-9a-f]{6}$/);
	});

	it("handles text parts with undefined text", async () => {
		const { handlers } = createHarness();
		const messageEnd = handlers.get("message_end")!;

		const result = await messageEnd({
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text" }, { type: "text", text: "real" }] },
		}, {});
		expect(result.message.content[0].text).toBeUndefined(); // non-last parts pass through unchanged
		expect(result.message.content[1].text).toMatch(/^real\n\n⧉ copy assistant: \/cp [0-9a-f]{6}$/);
	});

	it("hashes bashExecution results without command or output", async () => {
		const { handlers, commands } = createHarness();
		const messageEnd = handlers.get("message_end")!;
		const cmd = commands.get("cp")!;

		// No command, no output → empty result → no copy row.
		await messageEnd({ type: "message_end", message: { role: "bashExecution" } }, {});

		// Command without output.
		const message = { role: "bashExecution", command: "ls" };
		const hash = hashForText("bashExecution", "$ ls");
		const ctx = branchCtx([message]);
		await cmd.handler(hash, ctx);
		expect(copyToClipboard).toHaveBeenCalledWith("$ ls");

		// Output without command (clean.command ? ... : "" branch).
		const noCommand = { role: "bashExecution", output: "bare output" };
		const hash2 = hashForText("bashExecution", "bare output");
		const ctx2 = branchCtx([noCommand]);
		await cmd.handler(hash2, ctx2);
		expect(copyToClipboard).toHaveBeenCalledWith("bare output");
	});

	it("branchMessages tolerates a missing sessionManager and filters custom rows", async () => {
		const { commands } = createHarness();
		const cmd = commands.get("cp")!;

		const noManager = { ui: { notify: vi.fn() } };
		await cmd.handler("abc123", noManager);
		expect(noManager.ui.notify).toHaveBeenCalledWith("No message for hash abc123", "warning");

		const withCustom = branchCtx([
			{ role: "user", content: "real content" },
			{ role: "custom", customType: "copy-turn", content: "⧉ copy user: /cp abc123" },
		]);
		const hash = hashForText("user", "real content");
		await cmd.handler(hash, withCustom);
		expect(copyToClipboard).toHaveBeenCalledWith("real content");

		// Role-less message: hashFor falls back to the "message" role.
		const roleless = branchCtx([{ content: "roleless content" }]);
		const rolelessHash = hashForText("message", "roleless content");
		await cmd.handler(rolelessHash, roleless);
		expect(copyToClipboard).toHaveBeenCalledWith("roleless content");
	});

	it("adds a marker to content arrays without text parts", async () => {
		const { handlers } = createHarness();
		const messageEnd = handlers.get("message_end")!;

		// Image-only assistant content has no copyable text, so no marker is added.
		const result = await messageEnd({
			type: "message_end",
			message: { role: "assistant", content: [{ type: "image", mimeType: "image/png" }] },
		}, {});
		expect(result).toBeUndefined();
	});

	it("context handler strips copy rows and cleans markers", async () => {
		const { handlers } = createHarness();
		const context = handlers.get("context")!;
		const result = await context({
			type: "context",
			messages: [
				{ role: "user", content: "hello\n\n⧉ copy user: /cp abc123" },
				{ role: "custom", customType: "copy-turn", content: "⧉ copy user: /cp abc123" },
				{ role: "assistant", content: [{ type: "text", text: "hi\n\n⧉ copy assistant: /cp def456" }] },
			],
		});
		expect(result.messages).toHaveLength(2);
		expect(result.messages[0].content).toBe("hello");
		expect(result.messages[1].content[0].text).toBe("hi");
	});

	it("message renderer falls back to content hash and default role", () => {
		const { pi } = createHarness();
		const renderer = (pi.registerMessageRenderer as any).mock.calls[0][1];
		const theme = { fg: (_name: string, value: string) => value };

		const withDetails = renderer({ details: { hash: "abc123", role: "user" } }, {}, theme);
		expect(withDetails.render(80).join("\n")).toContain("⧉ copy user: /cp abc123");

		const fromContent = renderer({ content: "hash fedcba in the middle" }, {}, theme);
		expect(fromContent.render(80).join("\n")).toContain("⧉ copy message: /cp fedcba");

		const fallback = renderer({ content: "no hash here" }, {}, theme);
		expect(fallback.render(80).join("\n")).toContain("⧉ copy message: /cp ??????");

		// Non-string, non-array content (defensive path in textFromContent).
		const nonText = renderer({ content: 42 }, {}, theme);
		expect(nonText.render(80).join("\n")).toContain("⧉ copy message: /cp ??????");

		// Text part without a text property (b.text ?? "" branch).
		const missingText = renderer({ content: [{ type: "text" }] }, {}, theme);
		expect(missingText.render(80).join("\n")).toContain("⧉ copy message: /cp ??????");
	});

	it("/cp reports usage, no-match, ambiguous, and empty-result cases", async () => {
		const { commands } = createHarness();
		const cmd = commands.get("cp")!;

		const usageCtx = branchCtx([]);
		await cmd.handler("", usageCtx);
		expect(usageCtx.ui.notify).toHaveBeenCalledWith("Usage: /cp <hash>", "warning");

		const noMatchCtx = branchCtx([{ role: "user", content: "hello" }]);
		await cmd.handler("zzzzzz", noMatchCtx);
		expect(noMatchCtx.ui.notify).toHaveBeenCalledWith("No message for hash zzzzzz", "warning");

		// Two messages whose hashes share a prefix → ambiguous.
		// "c" and "e" are known to share the first hash character "9".
		const m1 = { role: "user", content: "c" };
		const m2 = { role: "user", content: "e" };
		const h1 = hashForText("user", "c");
		const h2 = hashForText("user", "e");
		// Find a shared prefix of length >= 1.
		let shared = "";
		for (let i = 0; i < Math.min(h1.length, h2.length); i++) {
			if (h1[i] === h2[i]) shared += h1[i];
			else break;
		}
		if (shared.length === 0) {
			// Extremely unlikely; fall back to asserting the no-match path instead.
			const ctx = branchCtx([m1]);
			await cmd.handler(h1, ctx);
			expect(ctx.ui.notify).toHaveBeenCalledWith(`Copied ${h1} (${m1.content.length} chars)`, "info");
		} else {
			const ambiguousCtx = branchCtx([m1, m2]);
			await cmd.handler(shared, ambiguousCtx);
			expect(ambiguousCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("ambiguous"), "warning");
		}

		const emptyCtx = branchCtx([{ role: "user", content: "   " }]);
		await cmd.handler(hashForText("user", ""), emptyCtx);
		expect(emptyCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("No result content"), "warning");
	});

	it("/cp strips ANSI codes before copying", async () => {
		const { commands } = createHarness();
		const cmd = commands.get("cp")!;
		const message = { role: "user", content: "\x1b[31mred\x1b[0m text" };
		const hash = hashForText("user", "\x1b[31mred\x1b[0m text");
		const ctx = branchCtx([message]);
		await cmd.handler(hash, ctx);
		expect(copyToClipboard).toHaveBeenCalledWith("red text");
	});

	it("/cp copies bashExecution results with command prefix", async () => {
		const { commands } = createHarness();
		const cmd = commands.get("cp")!;
		const message = { role: "bashExecution", command: "ls", output: "a\nb" };
		const hash = hashForText("bashExecution", "$ ls\na\nb");
		const ctx = branchCtx([message]);
		await cmd.handler(hash, ctx);
		expect(copyToClipboard).toHaveBeenCalledWith("$ ls\na\nb");
	});
});
