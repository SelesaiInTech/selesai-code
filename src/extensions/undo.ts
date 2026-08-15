import type { ExtensionAPI } from "@selesai/code";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const MAX_OLD_CONTENT_BYTES = 512 * 1024;

type EditInput = { path: string; edits: { oldText: string; newText: string }[] };
type WriteInput = { path: string; content: string };
type BashInput = { command: string };

type UndoOp =
	| {
			type: "edit";
			path: string;
			afterHash: string;
			inverseEdits: { oldText: string; newText: string }[];
	  }
	| {
			type: "write";
			path: string;
			existed: boolean;
			oldContent?: string;
			oldContentTooLarge?: boolean;
			afterHash: string;
	  };

type Checkpoint = {
	userEntryId: string;
	parentId: string | null;
	prompt: string;
	ops: UndoOp[];
	untrackedBash: string[];
	skipped: string[];
};

type Pending =
	| { kind: "edit"; checkpoint: Checkpoint; input: EditInput; absPath: string }
	| { kind: "write"; checkpoint: Checkpoint; input: WriteInput; absPath: string; existed: boolean; oldContent?: string; tooLarge: boolean }
	| { kind: "bash"; checkpoint: Checkpoint; input: BashInput; mutating: boolean };

const checkpoints = new Map<string, Checkpoint>();
const pending = new Map<string, Pending>();

function sha(text: string) {
	return createHash("sha256").update(text).digest("hex");
}

function resolveInCwd(cwd: string, p: string) {
	return path.isAbsolute(p) ? p : path.resolve(cwd, p);
}

async function readTextIfExists(absPath: string): Promise<{ exists: boolean; text?: string; bytes: number }> {
	try {
		const buf = await readFile(absPath);
		return { exists: true, text: buf.toString("utf8"), bytes: buf.byteLength };
	} catch (error: any) {
		if (error?.code === "ENOENT") return { exists: false, bytes: 0 };
		throw error;
	}
}

function extractPrompt(content: any): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (part?.type === "text") return part.text ?? "";
				if (part?.type === "image") return `[image ${part.mimeType ?? ""}]`;
				return "";
			})
			.filter(Boolean)
			.join("\n");
	}
	return "";
}

function latestUserEntry(ctx: any): any | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry?.type === "message" && entry.message?.role === "user") return entry;
	}
	return undefined;
}

function checkpointForCurrentTurn(ctx: any): Checkpoint | undefined {
	const userEntry = latestUserEntry(ctx);
	if (!userEntry) return undefined;
	let checkpoint = checkpoints.get(userEntry.id);
	if (!checkpoint) {
		checkpoint = {
			userEntryId: userEntry.id,
			parentId: userEntry.parentId ?? null,
			prompt: extractPrompt(userEntry.message.content),
			ops: [],
			untrackedBash: [],
			skipped: [],
		};
		checkpoints.set(userEntry.id, checkpoint);
	}
	return checkpoint;
}

function countOccurrences(text: string, needle: string) {
	if (needle.length === 0) return Number.POSITIVE_INFINITY;
	let count = 0;
	let index = 0;
	while ((index = text.indexOf(needle, index)) !== -1) {
		count++;
		index += needle.length;
	}
	return count;
}

function looksReadonlyBash(command: string) {
	const c = command.trim();
	if (!c) return true;
	if (/[;&|>]\s*(rm|mv|cp|touch|mkdir|rmdir|chmod|chown|sed\s+-i|perl\s+-pi|python|node|npm|pnpm|yarn|bun|cargo|go|make|git\s+(apply|checkout|reset|clean|commit|merge|rebase|am|cherry-pick|stash|add|rm|mv))/i.test(c)) return false;
	return /^(ls|pwd|cat|less|head|tail|grep|rg|find|wc|git\s+(status|diff|log|show|branch|rev-parse|ls-files)|npm\s+(test|run\s+test)|pnpm\s+(test|run\s+test)|yarn\s+(test|run\s+test)|bun\s+test|cargo\s+test|go\s+test)\b/i.test(c);
}

async function captureWrite(ctx: any, event: any, checkpoint: Checkpoint) {
	const input = event.input as WriteInput;
	const absPath = resolveInCwd(ctx.cwd, input.path);
	const old = await readTextIfExists(absPath);
	const tooLarge = old.exists && old.bytes > MAX_OLD_CONTENT_BYTES;
	if (tooLarge) checkpoint.skipped.push(`${input.path}: old content too large (${old.bytes} bytes)`);
	pending.set(event.toolCallId, {
		kind: "write",
		checkpoint,
		input,
		absPath,
		existed: old.exists,
		oldContent: old.exists && !tooLarge ? old.text : undefined,
		tooLarge,
	});
}

async function restoreEdit(op: Extract<UndoOp, { type: "edit" }>, cwd: string, force: boolean) {
	const absPath = resolveInCwd(cwd, op.path);
	const current = await readTextIfExists(absPath);
	if (!current.exists || current.text === undefined) throw new Error(`${op.path}: missing`);
	if (!force && sha(current.text) !== op.afterHash) throw new Error(`${op.path}: changed since edit; use /undo --force`);
	let next = current.text;
	for (const edit of op.inverseEdits) {
		const count = countOccurrences(next, edit.oldText);
		if (count !== 1) throw new Error(`${op.path}: inverse edit match count ${count}, expected 1`);
		next = next.replace(edit.oldText, edit.newText);
	}
	await writeFile(absPath, next, "utf8");
}

async function restoreWrite(op: Extract<UndoOp, { type: "write" }>, cwd: string, force: boolean) {
	const absPath = resolveInCwd(cwd, op.path);
	const current = await readTextIfExists(absPath);
	const currentHash = current.exists && current.text !== undefined ? sha(current.text) : "missing";
	if (!force && currentHash !== op.afterHash) throw new Error(`${op.path}: changed since write; use /undo --force`);
	if (op.oldContentTooLarge) throw new Error(`${op.path}: old content too large; cannot restore`);
	if (op.existed) {
		await mkdir(path.dirname(absPath), { recursive: true });
		// oldContent is always set when existed && !oldContentTooLarge (the
		// too-large case throws above), so the ?? fallback is unreachable.
		/* v8 ignore next 1 */
		await writeFile(absPath, op.oldContent ?? "", "utf8");
	} else {
		if (existsSync(absPath)) await rm(absPath, { force: true });
	}
}

async function restoreCheckpoint(checkpoint: Checkpoint, cwd: string, force: boolean) {
	const errors: string[] = [];
	for (const op of [...checkpoint.ops].reverse()) {
		try {
			if (op.type === "edit") await restoreEdit(op, cwd, force);
			else await restoreWrite(op, cwd, force);
		} catch (error: any) {
			// restoreEdit/restoreWrite always throw Error instances, so the
			// String(error) fallback is unreachable.
			/* v8 ignore next 1 */
			errors.push(error?.message ?? String(error));
			if (!force) break;
		}
	}
	return errors;
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event: any, ctx: any) => {
		const checkpoint = checkpointForCurrentTurn(ctx);
		if (!checkpoint) return;

		if (event.toolName === "edit") {
			const input = event.input as EditInput;
			pending.set(event.toolCallId, { kind: "edit", checkpoint, input, absPath: resolveInCwd(ctx.cwd, input.path) });
			return;
		}

		if (event.toolName === "write") {
			await captureWrite(ctx, event, checkpoint);
			return;
		}

		if (event.toolName === "bash") {
			const input = event.input as BashInput;
			pending.set(event.toolCallId, { kind: "bash", checkpoint, input, mutating: !looksReadonlyBash(input.command) });
		}
	});

	pi.on("tool_result", async (event: any) => {
		const item = pending.get(event.toolCallId);
		if (!item) return;
		pending.delete(event.toolCallId);
		if (event.isError) return;

		if (item.kind === "edit") {
			const after = await readTextIfExists(item.absPath);
			if (!after.exists || after.text === undefined) return;
			item.checkpoint.ops.push({
				type: "edit",
				path: item.input.path,
				afterHash: sha(after.text),
				inverseEdits: [...item.input.edits].reverse().map((e) => ({ oldText: e.newText, newText: e.oldText })),
			});
			return;
		}

		if (item.kind === "write") {
			const after = await readTextIfExists(item.absPath);
			if (!after.exists || after.text === undefined) return;
			item.checkpoint.ops.push({
				type: "write",
				path: item.input.path,
				existed: item.existed,
				oldContent: item.oldContent,
				oldContentTooLarge: item.tooLarge,
				afterHash: sha(after.text),
			});
			return;
		}

		if (item.kind === "bash" && item.mutating) {
			item.checkpoint.untrackedBash.push(item.input.command);
		}
	});

	pi.registerCommand("undo", {
		description: "Undo previous user turn and tracked edit/write file changes",
		handler: async (args: string, ctx: any) => {
			await ctx.waitForIdle();
			const force = args.trim().split(/\s+/).includes("--force");
			const userEntry = latestUserEntry(ctx);
			if (!userEntry) {
				ctx.ui.notify("Nothing to undo", "warning");
				return;
			}

			if (!userEntry.parentId) {
				ctx.ui.notify("Cannot undo root prompt in-place yet. Use /new or /tree.", "warning");
				return;
			}

			const checkpoint = checkpoints.get(userEntry.id);
			const prompt = checkpoint?.prompt ?? extractPrompt(userEntry.message.content);
			let restored = 0;
			let warnings: string[] = [];

			if (checkpoint) {
				const errors = await restoreCheckpoint(checkpoint, ctx.cwd, force);
				if (errors.length && !force) {
					ctx.ui.notify(`Undo stopped: ${errors[0]}`, "error");
					return;
				}
				restored = checkpoint.ops.length - errors.length;
				warnings = [...checkpoint.skipped];
				if (checkpoint.untrackedBash.length) warnings.push(`${checkpoint.untrackedBash.length} bash command(s) not tracked`);
				if (errors.length) warnings.push(`${errors.length} restore error(s)`);
			}

			await ctx.navigateTree(userEntry.parentId, { summarize: false });
			ctx.ui.setEditorText(prompt);
			checkpoints.delete(userEntry.id);

			const suffix = warnings.length ? ` Warnings: ${warnings.join("; ")}` : "";
			ctx.ui.notify(`Undid turn ${userEntry.id}; restored ${restored} file op(s).${suffix}`, warnings.length ? "warning" : "info");
		},
	});

	pi.registerCommand("undo-status", {
		description: "Show tracked undo checkpoints",
		handler: async (_args: string, ctx: any) => {
			const current = latestUserEntry(ctx)?.id;
			const lines = [...checkpoints.values()].map((c) => `${c.userEntryId}${c.userEntryId === current ? " *" : ""}: ${c.ops.length} op(s), ${c.untrackedBash.length} bash, ${c.skipped.length} skipped`);
			ctx.ui.notify(lines.length ? lines.join("\n") : "No undo checkpoints tracked", "info");
		},
	});
}
