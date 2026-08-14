import * as fs from "node:fs";

/**
 * Resolve the chain of session identities whose workflow estate the current
 * session should adopt. Session files record their parent in the header's
 * `parentSession` field, so a fresh session created by handoff/new/fork can
 * walk back to every predecessor and re-attach its persisted async runs,
 * results, retained children, and wait subscriptions.
 */

export interface SessionLineageInput {
	sessionManager: {
		getSessionFile(): string | null | undefined;
		getHeader?(): { parentSession?: string | null } | null;
	};
}

export interface SessionLineageOptions {
	/** Maximum number of session identities retained in the lineage. Defaults to 8. */
	depth?: number;
	/** Explicit parent session file (e.g. SessionStartEvent.previousSessionFile). */
	parentHint?: string | null;
}

const MAX_HEADER_BYTES = 2048;

function readParentSessionHeader(sessionFile: string): string | undefined {
	let text: string;
	try {
		const fd = fs.openSync(sessionFile, "r");
		try {
			const buffer = Buffer.alloc(MAX_HEADER_BYTES);
			const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
			text = buffer.subarray(0, read).toString("utf-8");
		} finally {
			fs.closeSync(fd);
		}
	} catch {
		return undefined;
	}
	const newline = text.indexOf("\n");
	const line = newline >= 0 ? text.slice(0, newline) : text;
	if (!line.trim()) return undefined;
	try {
		const header = JSON.parse(line) as { type?: unknown; parentSession?: unknown };
		if (header.type !== "session") return undefined;
		return typeof header.parentSession === "string" && header.parentSession ? header.parentSession : undefined;
	} catch {
		return undefined;
	}
}

export function resolveSessionLineage(input: SessionLineageInput, options: SessionLineageOptions = {}): string[] {
	const depth = Math.max(1, Math.floor(options.depth ?? 8));
	const lineage: string[] = [];
	const seen = new Set<string>();
	const current = input.sessionManager.getSessionFile();
	if (current) {
		lineage.push(current);
		seen.add(current);
	}
	let parent = options.parentHint ?? input.sessionManager.getHeader?.()?.parentSession;
	if (!parent && current) parent = readParentSessionHeader(current);
	while (parent && lineage.length < depth && !seen.has(parent)) {
		if (!fs.existsSync(parent)) break;
		lineage.push(parent);
		seen.add(parent);
		parent = readParentSessionHeader(parent);
	}
	return lineage;
}
