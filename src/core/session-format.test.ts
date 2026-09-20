import { describe, expect, it } from "vitest";
import {
	buildContextEntries,
	buildSessionContext,
	sessionEntryToContextMessages,
	type SessionEntry,
} from "./session-manager.ts";

const base = (id: string, parentId: string | null) => ({
	id,
	parentId,
	timestamp: "2026-01-01T00:00:00.000Z",
});

const user = (id: string, parentId: string | null, text: string): SessionEntry => ({
	...base(id, parentId),
	type: "message",
	message: { role: "user", content: [{ type: "text", text }], timestamp: 1 },
});

const system = (
	id: string,
	parentId: string | null,
	content: string | null,
	sections?: Record<string, string | null>,
): SessionEntry => ({
	...base(id, parentId),
	type: "message",
	// Session files are parsed without validation; a null content is the readable-old-entry case.
	message: { role: "system", content: content as never, sections, timestamp: 1 },
});

const usage = (id: string, parentId: string | null): SessionEntry => ({
	...base(id, parentId),
	type: "usage",
	kind: "cache_warm",
	provider: "provider",
	model: "model",
	usage: {
		input: 1,
		output: 1,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 2,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
});

const compaction = (id: string, parentId: string | null, withSystem: boolean): SessionEntry => ({
	...base(id, parentId),
	type: "compaction",
	summary: "summary text",
	firstKeptEntryId: "",
	tokensBefore: 100,
	...(withSystem
		? { systemMessage: { role: "system" as const, content: "prompt state", sections: { rules: "<rules>r</rules>" }, timestamp: 1 } }
		: {}),
});

describe("session entries to rebuilt context", () => {
	it("tolerates a system entry whose content is absent", () => {
		expect(sessionEntryToContextMessages(system("s1", null, null))).toEqual([
			{ role: "system", content: "", sections: undefined, timestamp: 1 },
		]);
	});

	it("keeps a system entry's sections so a resumed session restores its prompt state", () => {
		const [message] = sessionEntryToContextMessages(system("s1", null, "base", { rules: "<rules>x</rules>" }));
		expect(message.role).toBe("system");
		expect((message as { sections?: unknown }).sections).toEqual({ rules: "<rules>x</rules>" });
	});

	it("does not contribute a usage entry to the message sequence", () => {
		expect(sessionEntryToContextMessages(usage("u1", null))).toEqual([]);
	});

	it("replays a compaction boundary's system message before its summary", () => {
		const messages = sessionEntryToContextMessages(compaction("c1", null, true));
		expect(messages.map((m) => m.role)).toEqual(["system", "compactionSummary"]);
	});

	it("replays only the summary for a compaction boundary without prompt state", () => {
		const messages = sessionEntryToContextMessages(compaction("c2", null, false));
		expect(messages.map((m) => m.role)).toEqual(["compactionSummary"]);
	});

	it("rebuilds resume, branch navigation and backward tolerance in one sequence", () => {
		const entries: SessionEntry[] = [
			user("m1", null, "first"),
			system("s1", "m1", "instructions"),
			usage("u1", "s1"),
			system("s2", "u1", null),
			compaction("c1", "s2", true),
			user("m2", "c1", "second"),
		];
		const byId = new Map(entries.map((entry) => [entry.id, entry]));
		const context = buildSessionContext(entries, "m2", byId);
		const roles = context.messages.map((message) => message.role);

		// The compaction boundary replaces everything before its first-kept entry.
		expect(roles[roles.length - 2]).toBe("compactionSummary");
		expect(roles[roles.length - 1]).toBe("user");
		expect(roles).toContain("system");
	});

	it("restores a branch's own prompt and tool state when navigating to it", () => {
		const entries: SessionEntry[] = [
			user("a1", null, "root"),
			system("as", "a1", "branch-a instructions"),
			user("a2", "as", "on branch a"),
			user("b2", "a1", "on branch b"),
		];
		const byId = new Map(entries.map((entry) => [entry.id, entry]));
		const branchA = buildContextEntries(entries, "a2", byId);
		const branchB = buildContextEntries(entries, "b2", byId);

		expect(branchA.map((entry) => entry.id)).toContain("as");
		expect(branchB.map((entry) => entry.id)).not.toContain("as");
	});
});
