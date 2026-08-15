import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Handler = (event: any, ctx: any) => any;
type Command = { description: string; handler: (args: string, ctx: any) => Promise<void> };

let undoExtension: (pi: any) => void;
let handlers: Map<string, Handler>;
let commands: Map<string, Command>;

beforeEach(async () => {
	vi.resetModules();
	const mod = await import("./undo.ts");
	undoExtension = mod.default;
	handlers = new Map();
	commands = new Map();
	const pi = {
		on: vi.fn((event: string, handler: Handler) => {
			handlers.set(event, handler);
		}),
		registerCommand: vi.fn((name: string, opts: Command) => {
			commands.set(name, opts);
		}),
	};
	undoExtension(pi);
});

function makeCtx(opts: {
	cwd?: string;
	branch?: any[];
	notify?: ReturnType<typeof vi.fn>;
	setEditorText?: ReturnType<typeof vi.fn>;
	navigateTree?: ReturnType<typeof vi.fn>;
	waitForIdle?: ReturnType<typeof vi.fn>;
} = {}) {
	const notify = opts.notify ?? vi.fn();
	const setEditorText = opts.setEditorText ?? vi.fn();
	const navigateTree = opts.navigateTree ?? vi.fn(async () => {});
	const waitForIdle = opts.waitForIdle ?? vi.fn(async () => {});
	const ctx = {
		cwd: opts.cwd ?? "/tmp",
		sessionManager: {
			getBranch: () => opts.branch ?? [],
		},
		ui: { notify, setEditorText },
		navigateTree,
		waitForIdle,
	};
	return { ctx, notify, setEditorText, navigateTree, waitForIdle };
}

function userEntry(id: string, content: any, parentId: string | null = "root") {
	return { id, type: "message", message: { role: "user", content }, parentId };
}

describe("undo extension", () => {
	it("registers undo and undo-status commands", () => {
		expect(commands.has("undo")).toBe(true);
		expect(commands.has("undo-status")).toBe(true);
	});

	it("tracks an edit and restores it on /undo", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-edit-"));
		const file = join(dir, "a.ts");
		writeFileSync(file, "line1\nline2\n", "utf-8");
		const { ctx, notify, setEditorText, navigateTree } = makeCtx({
			cwd: dir,
			branch: [userEntry("u1", "fix the bug")],
		});

		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "edit", toolCallId: "c1", input: { path: "a.ts", edits: [{ oldText: "line1", newText: "line1 changed" }] } },
			ctx,
		);
		writeFileSync(file, "line1 changed\nline2\n", "utf-8");
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);

		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Undid turn u1; restored 1 file op(s)."), "info");
		expect(setEditorText).toHaveBeenCalledWith("fix the bug");
		expect(navigateTree).toHaveBeenCalledWith("root", { summarize: false });
		expect(require("node:fs").readFileSync(file, "utf-8")).toBe("line1\nline2\n");
	});

	it("tracks a write to a new file and removes it on /undo", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-write-new-"));
		const file = join(dir, "new.ts");
		const { ctx, notify } = makeCtx({ cwd: dir, branch: [userEntry("u2", "add file")] });

		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "write", toolCallId: "c1", input: { path: "new.ts", content: "content" } },
			ctx,
		);
		writeFileSync(file, "content", "utf-8");
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);

		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("restored 1 file op(s)."), "info");
		expect(require("node:fs").existsSync(file)).toBe(false);
	});

	it("tracks a write to an existing file and restores the old content", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-write-old-"));
		const file = join(dir, "a.ts");
		writeFileSync(file, "old content", "utf-8");
		const { ctx, notify } = makeCtx({ cwd: dir, branch: [userEntry("u3", "overwrite")] });

		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "write", toolCallId: "c1", input: { path: "a.ts", content: "new content" } },
			ctx,
		);
		writeFileSync(file, "new content", "utf-8");
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);

		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("restored 1 file op(s)."), "info");
		expect(require("node:fs").readFileSync(file, "utf-8")).toBe("old content");
	});

	it("tracks mutating bash commands and warns on /undo", async () => {
		const { ctx, notify } = makeCtx({ branch: [userEntry("u4", "run stuff")] });

		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "bash", toolCallId: "c1", input: { command: "rm -rf build" } },
			ctx,
		);
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);

		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("1 bash command(s) not tracked"), "warning");
	});

	it("does not track readonly bash commands", async () => {
		const { ctx, notify } = makeCtx({ branch: [userEntry("u5", "read")] });

		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "bash", toolCallId: "c1", input: { command: "ls -la" } },
			ctx,
		);
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);

		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("restored 0 file op(s)."), "info");
	});

	it("notifies when there is nothing to undo", async () => {
		const { ctx, notify } = makeCtx();
		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith("Nothing to undo", "warning");
	});

	it("refuses to undo a root prompt", async () => {
		const { ctx, notify } = makeCtx({ branch: [userEntry("u6", "root", null)] });
		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith("Cannot undo root prompt in-place yet. Use /new or /tree.", "warning");
	});

	it("stops on a restore error without --force", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-error-"));
		const file = join(dir, "a.ts");
		writeFileSync(file, "original", "utf-8");
		const { ctx, notify } = makeCtx({ cwd: dir, branch: [userEntry("u7", "edit")] });

		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "edit", toolCallId: "c1", input: { path: "a.ts", edits: [{ oldText: "original", newText: "changed" }] } },
			ctx,
		);
		writeFileSync(file, "changed", "utf-8");
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);

		// Modify the file after the edit so the hash check fails.
		writeFileSync(file, "changed by someone else", "utf-8");
		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Undo stopped"), "error");
	});

	it("forces restore past errors with --force", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-force-"));
		const file = join(dir, "a.ts");
		writeFileSync(file, "original", "utf-8");
		const { ctx, notify } = makeCtx({ cwd: dir, branch: [userEntry("u8", "edit")] });

		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "edit", toolCallId: "c1", input: { path: "a.ts", edits: [{ oldText: "original", newText: "changed" }] } },
			ctx,
		);
		writeFileSync(file, "changed", "utf-8");
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);

		// Modify the file after the edit so the hash check fails.
		writeFileSync(file, "changed by someone else", "utf-8");
		await commands.get("undo")!.handler("--force", ctx);
		// Force skips the hash check and applies the inverse edit ("changed" → "original").
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("restored 1 file op(s)."), "info");
		expect(require("node:fs").readFileSync(file, "utf-8")).toBe("original by someone else");
	});

	it("skips tool results for unknown tool call ids", async () => {
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "unknown", isError: false }, {});
	});

	it("ignores tool results with errors", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-err-"));
		const file = join(dir, "a.ts");
		writeFileSync(file, "original", "utf-8");
		const { ctx, notify } = makeCtx({ cwd: dir, branch: [userEntry("u9", "edit")] });

		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "edit", toolCallId: "c1", input: { path: "a.ts", edits: [{ oldText: "original", newText: "changed" }] } },
			ctx,
		);
		writeFileSync(file, "changed", "utf-8");
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: true }, ctx);

		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("restored 0 file op(s)."), "info");
	});

	it("skips tool results when the file is missing after an edit", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-missing-"));
		const { ctx, notify } = makeCtx({ cwd: dir, branch: [userEntry("u10", "edit")] });

		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "edit", toolCallId: "c1", input: { path: "a.ts", edits: [{ oldText: "x", newText: "y" }] } },
			ctx,
		);
		// No file written → tool_result sees a missing file.
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);

		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("restored 0 file op(s)."), "info");
	});

	it("skips tool results when the file is missing after a write", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-write-missing-"));
		const { ctx, notify } = makeCtx({ cwd: dir, branch: [userEntry("u11", "write")] });

		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "write", toolCallId: "c1", input: { path: "a.ts", content: "x" } },
			ctx,
		);
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);

		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("restored 0 file op(s)."), "info");
	});

	it("warns when the old write content is too large to restore", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-large-"));
		const file = join(dir, "big.ts");
		writeFileSync(file, "x".repeat(600 * 1024), "utf-8");
		const { ctx, notify } = makeCtx({ cwd: dir, branch: [userEntry("u12", "write big")] });

		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "write", toolCallId: "c1", input: { path: "big.ts", content: "small" } },
			ctx,
		);
		writeFileSync(file, "small", "utf-8");
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);

		// Without --force the restore stops with an error.
		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Undo stopped"), "error");
	});

	it("restoreWrite throws when the old content is too large", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-large-restore-"));
		const file = join(dir, "big.ts");
		writeFileSync(file, "x".repeat(600 * 1024), "utf-8");
		const { ctx, notify } = makeCtx({ cwd: dir, branch: [userEntry("u13", "write big")] });

		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "write", toolCallId: "c1", input: { path: "big.ts", content: "small" } },
			ctx,
		);
		writeFileSync(file, "small", "utf-8");
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);

		// Force restore: the too-large op throws, but --force continues.
		await commands.get("undo")!.handler("--force", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("restore error(s)"), "warning");
	});

	it("restoreEdit throws when the file is missing", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-edit-missing-"));
		const { ctx, notify } = makeCtx({ cwd: dir, branch: [userEntry("u14", "edit")] });

		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "edit", toolCallId: "c1", input: { path: "a.ts", edits: [{ oldText: "x", newText: "y" }] } },
			ctx,
		);
		writeFileSync(join(dir, "a.ts"), "y", "utf-8");
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);

		// Delete the file before undo.
		rmSync(join(dir, "a.ts"), { force: true });
		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Undo stopped"), "error");
	});

	it("restoreEdit throws when the inverse edit matches multiple times", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-multi-"));
		const file = join(dir, "a.ts");
		writeFileSync(file, "x\nx\n", "utf-8");
		const { ctx, notify } = makeCtx({ cwd: dir, branch: [userEntry("u15", "edit")] });

		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "edit", toolCallId: "c1", input: { path: "a.ts", edits: [{ oldText: "x", newText: "y" }] } },
			ctx,
		);
		writeFileSync(file, "y\ny\n", "utf-8");
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);

		// The inverse edit oldText is "y" which appears twice.
		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Undo stopped"), "error");
	});

	it("restoreWrite removes a file that was recreated after the write", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-recreate-"));
		const file = join(dir, "a.ts");
		const { ctx, notify } = makeCtx({ cwd: dir, branch: [userEntry("u16", "write")] });

		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "write", toolCallId: "c1", input: { path: "a.ts", content: "content" } },
			ctx,
		);
		writeFileSync(file, "content", "utf-8");
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);

		// Recreate the file with different content → hash mismatch without force.
		writeFileSync(file, "different", "utf-8");
		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Undo stopped"), "error");

		// With --force the file is removed.
		await commands.get("undo")!.handler("--force", ctx);
		expect(require("node:fs").existsSync(file)).toBe(false);
	});

	it("undo-status reports tracked checkpoints", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-status-"));
		const file = join(dir, "a.ts");
		writeFileSync(file, "x", "utf-8");
		const { ctx, notify } = makeCtx({ cwd: dir, branch: [userEntry("u17", "edit")] });

		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "edit", toolCallId: "c1", input: { path: "a.ts", edits: [{ oldText: "x", newText: "y" }] } },
			ctx,
		);
		writeFileSync(file, "y", "utf-8");
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);

		await commands.get("undo-status")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("u17 *: 1 op(s), 0 bash, 0 skipped"), "info");
	});

	it("undo-status reports no checkpoints when none are tracked", async () => {
		const { ctx, notify } = makeCtx({ branch: [userEntry("u18", "hi")] });
		await commands.get("undo-status")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith("No undo checkpoints tracked", "info");
	});

	it("extracts prompts from string, array, and non-text content", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-prompt-"));
		const file = join(dir, "a.ts");
		writeFileSync(file, "x", "utf-8");

		// String content.
		const { ctx: ctx1, setEditorText: set1 } = makeCtx({
			cwd: dir,
			branch: [userEntry("u19", "plain string prompt")],
		});
		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "edit", toolCallId: "c1", input: { path: "a.ts", edits: [{ oldText: "x", newText: "y" }] } },
			ctx1,
		);
		writeFileSync(file, "y", "utf-8");
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx1);
		await commands.get("undo")!.handler("", ctx1);
		expect(set1).toHaveBeenCalledWith("plain string prompt");

		// Array content with text + image parts.
		const { ctx: ctx2, setEditorText: set2 } = makeCtx({
			cwd: dir,
			branch: [userEntry("u20", [{ type: "text", text: "text part" }, { type: "image", mimeType: "image/png" }, { type: "tool", text: "ignored" }])],
		});
		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "edit", toolCallId: "c2", input: { path: "a.ts", edits: [{ oldText: "y", newText: "z" }] } },
			ctx2,
		);
		writeFileSync(file, "z", "utf-8");
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c2", isError: false }, ctx2);
		await commands.get("undo")!.handler("", ctx2);
		expect(set2).toHaveBeenCalledWith("text part\n[image image/png]");

		// Non-string non-array content.
		const { ctx: ctx3, setEditorText: set3 } = makeCtx({
			cwd: dir,
			branch: [userEntry("u21", 42)],
		});
		await commands.get("undo")!.handler("", ctx3);
		expect(set3).toHaveBeenCalledWith("");
	});

	it("handles absolute paths in edit inputs", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-abs-"));
		const file = join(dir, "a.ts");
		writeFileSync(file, "x", "utf-8");
		const { ctx, notify } = makeCtx({ cwd: "/other", branch: [userEntry("u22", "edit")] });

		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "edit", toolCallId: "c1", input: { path: file, edits: [{ oldText: "x", newText: "y" }] } },
			ctx,
		);
		writeFileSync(file, "y", "utf-8");
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);

		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("restored 1 file op(s)."), "info");
		expect(require("node:fs").readFileSync(file, "utf-8")).toBe("x");
	});

	it("restores multiple ops in reverse order", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-multi-op-"));
		const file = join(dir, "a.ts");
		writeFileSync(file, "one", "utf-8");
		const { ctx, notify } = makeCtx({ cwd: dir, branch: [userEntry("u23", "edit twice")] });

		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "edit", toolCallId: "c1", input: { path: "a.ts", edits: [{ oldText: "one", newText: "two" }] } },
			ctx,
		);
		writeFileSync(file, "two", "utf-8");
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);

		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "edit", toolCallId: "c2", input: { path: "a.ts", edits: [{ oldText: "two", newText: "three" }] } },
			ctx,
		);
		writeFileSync(file, "three", "utf-8");
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c2", isError: false }, ctx);

		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("restored 2 file op(s)."), "info");
		expect(require("node:fs").readFileSync(file, "utf-8")).toBe("one");
	});

	it("restores a write to a nested directory", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-nested-"));
		const nested = join(dir, "sub", "dir");
		mkdirSync(nested, { recursive: true });
		const file = join(nested, "a.ts");
		writeFileSync(file, "old", "utf-8");
		const { ctx, notify } = makeCtx({ cwd: dir, branch: [userEntry("u24", "write")] });

		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "write", toolCallId: "c1", input: { path: "sub/dir/a.ts", content: "new" } },
			ctx,
		);
		writeFileSync(file, "new", "utf-8");
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);

		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("restored 1 file op(s)."), "info");
		expect(require("node:fs").readFileSync(file, "utf-8")).toBe("old");
	});

	it("restores a write to a deleted directory by recreating it with --force", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-recreate-dir-"));
		const nested = join(dir, "sub");
		mkdirSync(nested, { recursive: true });
		const file = join(nested, "a.ts");
		writeFileSync(file, "old", "utf-8");
		const { ctx, notify } = makeCtx({ cwd: dir, branch: [userEntry("u25", "write")] });

		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "write", toolCallId: "c1", input: { path: "sub/a.ts", content: "new" } },
			ctx,
		);
		writeFileSync(file, "new", "utf-8");
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);

		// Delete the whole sub dir before undo → the file is missing, so the
		// hash check fails without --force.
		rmSync(nested, { recursive: true, force: true });
		await commands.get("undo")!.handler("--force", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("restored 1 file op(s)."), "info");
		expect(require("node:fs").readFileSync(file, "utf-8")).toBe("old");
	});

	it("restoreWrite with --force removes a recreated file", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-force-rm-"));
		const file = join(dir, "a.ts");
		const { ctx, notify } = makeCtx({ cwd: dir, branch: [userEntry("u26", "write")] });

		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "write", toolCallId: "c1", input: { path: "a.ts", content: "content" } },
			ctx,
		);
		writeFileSync(file, "content", "utf-8");
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);

		// Recreate with different content.
		writeFileSync(file, "different", "utf-8");
		await commands.get("undo")!.handler("--force", ctx);
		expect(require("node:fs").existsSync(file)).toBe(false);
	});

	it("ignores tool calls when there is no user entry in the branch", async () => {
		const { ctx } = makeCtx({ branch: [{ type: "message", message: { role: "assistant", content: "hi" } }] });
		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "edit", toolCallId: "c1", input: { path: "a.ts", edits: [] } },
			ctx,
		);
		// No crash; nothing tracked.
	});

	it("readTextIfExists rethrows non-ENOENT errors", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-readerr-"));
		const file = join(dir, "a.ts");
		mkdirSync(file, { recursive: true }); // a directory, not a file → EISDIR
		const { ctx, notify } = makeCtx({ cwd: dir, branch: [userEntry("u27", "edit")] });

		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "edit", toolCallId: "c1", input: { path: "a.ts", edits: [{ oldText: "x", newText: "y" }] } },
			ctx,
		);
		// The tool_result read of the directory throws EISDIR, which propagates.
		await expect(handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx)).rejects.toThrow();
	});

	it("countOccurrences handles empty needles and multiple matches", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-count-"));
		const file = join(dir, "a.ts");
		writeFileSync(file, "x", "utf-8");
		const { ctx, notify } = makeCtx({ cwd: dir, branch: [userEntry("u28", "edit")] });

		// An edit with an empty newText produces an inverse edit with an empty
		// oldText, which countOccurrences treats as infinite matches → error.
		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "edit", toolCallId: "c1", input: { path: "a.ts", edits: [{ oldText: "x", newText: "" }] } },
			ctx,
		);
		writeFileSync(file, "", "utf-8");
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);

		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Undo stopped"), "error");
	});

	it("looksReadonlyBash treats empty commands as readonly", async () => {
		const { ctx, notify } = makeCtx({ branch: [userEntry("u29", "")] });
		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "bash", toolCallId: "c1", input: { command: "   " } },
			ctx,
		);
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);
		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("restored 0 file op(s)."), "info");
	});

	it("looksReadonlyBash treats compound mutating commands as mutating", async () => {
		const { ctx, notify } = makeCtx({ branch: [userEntry("u30", "run")] });
		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "bash", toolCallId: "c1", input: { command: "cd build && rm -rf dist" } },
			ctx,
		);
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);
		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("1 bash command(s) not tracked"), "warning");
	});

	it("looksReadonlyBash treats git checkout as mutating", async () => {
		const { ctx, notify } = makeCtx({ branch: [userEntry("u31", "run")] });
		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "bash", toolCallId: "c1", input: { command: "git checkout main" } },
			ctx,
		);
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);
		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("1 bash command(s) not tracked"), "warning");
	});

	it("looksReadonlyBash treats git status as readonly", async () => {
		const { ctx, notify } = makeCtx({ branch: [userEntry("u32", "run")] });
		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "bash", toolCallId: "c1", input: { command: "git status" } },
			ctx,
		);
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);
		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("restored 0 file op(s)."), "info");
	});

	it("looksReadonlyBash treats npm test as readonly", async () => {
		const { ctx, notify } = makeCtx({ branch: [userEntry("u33", "run")] });
		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "bash", toolCallId: "c1", input: { command: "npm test" } },
			ctx,
		);
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);
		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("restored 0 file op(s)."), "info");
	});

	it("looksReadonlyBash treats unknown commands as mutating", async () => {
		const { ctx, notify } = makeCtx({ branch: [userEntry("u34", "run")] });
		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "bash", toolCallId: "c1", input: { command: "echo hello" } },
			ctx,
		);
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);
		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("1 bash command(s) not tracked"), "warning");
	});

	it("ignores tool calls with unknown tool names", async () => {
		const { ctx } = makeCtx({ branch: [userEntry("u35", "run")] });
		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "read", toolCallId: "c1", input: { path: "a.ts" } },
			ctx,
		);
		// No crash; nothing tracked.
	});

	it("extracts prompts with missing text and mimeType fields", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-prompt2-"));
		const file = join(dir, "a.ts");
		writeFileSync(file, "x", "utf-8");
		const { ctx, setEditorText } = makeCtx({
			cwd: dir,
			branch: [userEntry("u36", [{ type: "text" }, { type: "image" }])],
		});
		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "edit", toolCallId: "c1", input: { path: "a.ts", edits: [{ oldText: "x", newText: "y" }] } },
			ctx,
		);
		writeFileSync(file, "y", "utf-8");
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);
		await commands.get("undo")!.handler("", ctx);
		expect(setEditorText).toHaveBeenCalledWith("[image ]");
	});

	it("handles user entries without a parentId", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-noparent-"));
		const file = join(dir, "a.ts");
		writeFileSync(file, "x", "utf-8");
		const { ctx, notify } = makeCtx({
			cwd: dir,
			branch: [{ id: "u37", type: "message", message: { role: "user", content: "edit" }, parentId: "root" }],
		});
		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "edit", toolCallId: "c1", input: { path: "a.ts", edits: [{ oldText: "x", newText: "y" }] } },
			ctx,
		);
		writeFileSync(file, "y", "utf-8");
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);
		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("restored 1 file op(s)."), "info");
	});

	it("skips the rm when a written file was already deleted", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-already-gone-"));
		const file = join(dir, "a.ts");
		const { ctx, notify } = makeCtx({ cwd: dir, branch: [userEntry("u38", "write")] });

		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "write", toolCallId: "c1", input: { path: "a.ts", content: "content" } },
			ctx,
		);
		writeFileSync(file, "content", "utf-8");
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);

		// Delete the file before undo → hash check fails without --force.
		rmSync(file, { force: true });
		await commands.get("undo")!.handler("--force", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("restored 1 file op(s)."), "info");
	});

	it("undo-status marks only the current user's checkpoint", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-status2-"));
		const file = join(dir, "a.ts");
		writeFileSync(file, "x", "utf-8");

		// Track a checkpoint while u39 is the current entry.
		const { ctx: ctx1 } = makeCtx({ cwd: dir, branch: [userEntry("u39", "first")] });
		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "edit", toolCallId: "c1", input: { path: "a.ts", edits: [{ oldText: "x", newText: "y" }] } },
			ctx1,
		);
		writeFileSync(file, "y", "utf-8");
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx1);

		// Now u40 is the current entry; u39's checkpoint has no star.
		const { ctx: ctx2, notify } = makeCtx({ cwd: dir, branch: [userEntry("u39", "first"), userEntry("u40", "second")] });
		await commands.get("undo-status")!.handler("", ctx2);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("u39: 1 op(s), 0 bash, 0 skipped"), "info");
	});

	it("handles user entries with an undefined parentId", async () => {
		const dir = mkdtempSync(join(tmpdir(), "undo-undefined-parent-"));
		const file = join(dir, "a.ts");
		writeFileSync(file, "x", "utf-8");
		const { ctx, notify } = makeCtx({
			cwd: dir,
			branch: [{ id: "u41", type: "message", message: { role: "user", content: "edit" }, parentId: undefined }],
		});
		await handlers.get("tool_call")!(
			{ type: "tool_call", toolName: "edit", toolCallId: "c1", input: { path: "a.ts", edits: [{ oldText: "x", newText: "y" }] } },
			ctx,
		);
		writeFileSync(file, "y", "utf-8");
		await handlers.get("tool_result")!({ type: "tool_result", toolCallId: "c1", isError: false }, ctx);
		await commands.get("undo")!.handler("", ctx);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Cannot undo root prompt"), "warning");
	});
});
