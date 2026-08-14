import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { resolveSessionLineage } from "../../src/shared/session-lineage.ts";

function sessionFile(dir: string, name: string, parentSession?: string): string {
	const file = path.join(dir, name);
	const header = {
		type: "session",
		version: 1,
		id: name,
		timestamp: new Date().toISOString(),
		cwd: dir,
		...(parentSession ? { parentSession } : {}),
	};
	fs.writeFileSync(file, `${JSON.stringify(header)}\n`);
	return file;
}

describe("session lineage", () => {
	it("resolves self plus the parent chain from session headers", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "selesai-lineage-"));
		const grandparent = sessionFile(dir, "a.jsonl");
		const parent = sessionFile(dir, "b.jsonl", grandparent);
		const current = sessionFile(dir, "c.jsonl", parent);
		const lineage = resolveSessionLineage({ sessionManager: { getSessionFile: () => current, getHeader: () => ({ parentSession: parent }) } });
		assert.deepEqual(lineage, [current, parent, grandparent]);
	});

	it("prefers an explicit parent hint over the header", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "selesai-lineage-"));
		const hinted = sessionFile(dir, "hinted.jsonl");
		const headed = sessionFile(dir, "headed.jsonl");
		const current = sessionFile(dir, "current.jsonl", headed);
		const lineage = resolveSessionLineage({ sessionManager: { getSessionFile: () => current, getHeader: () => ({ parentSession: headed }) } }, { parentHint: hinted });
		assert.deepEqual(lineage, [current, hinted]);
	});

	it("bounds the walk depth", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "selesai-lineage-"));
		const files: string[] = [];
		for (let i = 0; i < 12; i++) files.push(sessionFile(dir, `s${i}.jsonl`, i > 0 ? files[i - 1]! : undefined));
		const current = sessionFile(dir, "current.jsonl", files[11]);
		const lineage = resolveSessionLineage({ sessionManager: { getSessionFile: () => current } }, { depth: 3 });
		assert.equal(lineage.length, 3);
		assert.equal(lineage[0], current);
		assert.equal(lineage[1], files[11]);
		assert.equal(lineage[2], files[10]);
	});

	it("stops at missing parent files", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "selesai-lineage-"));
		const missing = path.join(dir, "missing.jsonl");
		const current = sessionFile(dir, "current.jsonl", missing);
		const lineage = resolveSessionLineage({ sessionManager: { getSessionFile: () => current, getHeader: () => ({ parentSession: missing }) } });
		assert.deepEqual(lineage, [current]);
	});

	it("does not loop on cyclic parent chains", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "selesai-lineage-"));
		const a = sessionFile(dir, "a.jsonl");
		const b = sessionFile(dir, "b.jsonl", a);
		fs.writeFileSync(a, `${JSON.stringify({ type: "session", version: 1, id: "a", timestamp: new Date().toISOString(), cwd: dir, parentSession: b })}\n`);
		const lineage = resolveSessionLineage({ sessionManager: { getSessionFile: () => b, getHeader: () => ({ parentSession: a }) } });
		assert.deepEqual(lineage, [b, a]);
	});

	it("handles session managers without getHeader or session file", () => {
		assert.deepEqual(resolveSessionLineage({ sessionManager: { getSessionFile: () => null } }, { parentHint: "/nonexistent/parent.jsonl" }), []);
	});
});
