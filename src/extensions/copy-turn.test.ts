import { beforeEach, describe, expect, it, vi } from "vitest";
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

function createHarness() {
	const handlers = new Map<string, Handler>();
	const commands = new Map<string, Command>();
	const sent: AnyMessage[] = [];
	const pi = {
		on: vi.fn((event: string, handler: Handler) => {
			handlers.set(event, handler);
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
});
