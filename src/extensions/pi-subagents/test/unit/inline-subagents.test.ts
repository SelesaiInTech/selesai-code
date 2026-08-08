import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { createInlineSubagentAutocompleteProvider, parseInlineSubagentInput } from "../../src/slash/inline-subagents.ts";

const baseProvider = () => ({
	getSuggestions: async () => null,
	applyCompletion: () => ({}),
	shouldTriggerFileCompletion: () => true,
});

describe("createInlineSubagentAutocompleteProvider", () => {
	const cwd = mkdtempSync(join(tmpdir(), "inline-subagents-"));
	after(() => rmSync(cwd, { recursive: true, force: true }));
	const state = { baseCwd: cwd } as never;

	it("suggests installed agents after # at message start", async () => {
		const provider = createInlineSubagentAutocompleteProvider(state, baseProvider());
		const result = await provider.getSuggestions(["#"], 0, 1, {} as never);
		assert.ok(result);
		assert.equal(result.prefix, "#");
		// Builtin agents always exist, so the picker must not be empty.
		assert.ok(result.items.length > 0);
	});

	it("suggests agents for # anywhere in the message, like the $ skill picker", async () => {
		const base = baseProvider();
		const provider = createInlineSubagentAutocompleteProvider(state, base);

		// # mid-line.
		const mid = await provider.getSuggestions(["see #arch"], 0, 9, {} as never);
		assert.ok(mid);
		assert.equal(mid.prefix, "#arch");
		assert.ok(mid.items.some((item) => item.value === "#architect"));

		// # on a later line.
		const later = await provider.getSuggestions(["", "#arch"], 1, 5, {} as never);
		assert.ok(later);
		assert.equal(later.prefix, "#arch");
		assert.ok(later.items.some((item) => item.value === "#architect"));
	});

	it("falls back to the base provider without a # token or before baseCwd", async () => {
		const base = baseProvider();
		const provider = createInlineSubagentAutocompleteProvider(state, base);

		// No # token on the current line.
		assert.equal(await provider.getSuggestions(["plain text"], 0, 10, {} as never), null);
		// # mid-word (no boundary before it) is not a mention.
		assert.equal(await provider.getSuggestions(["pre#arch"], 0, 9, {} as never), null);
		// No baseCwd yet (session_start not processed) falls back too.
		const noCwd = createInlineSubagentAutocompleteProvider({ baseCwd: "" } as never, base);
		assert.equal(await noCwd.getSuggestions(["#"], 0, 1, {} as never), null);
	});
});

describe("parseInlineSubagentInput", () => {
	it("parses #agent-name with a task", () => {
		assert.deepEqual(parseInlineSubagentInput("#architect review the plan"), {
			agentName: "architect",
			task: "review the plan",
			atStart: true,
		});
	});

	it("parses hyphenated agent names", () => {
		assert.deepEqual(parseInlineSubagentInput("#batch-grill-me interview the user"), {
			agentName: "batch-grill-me",
			task: "interview the user",
			atStart: true,
		});
	});

	it("parses #agent-name with no task", () => {
		assert.deepEqual(parseInlineSubagentInput("#architect"), { agentName: "architect", task: "", atStart: true });
	});

	it("is case-insensitive and lowercases the agent name", () => {
		assert.deepEqual(parseInlineSubagentInput("#Architect plan"), { agentName: "architect", task: "plan", atStart: true });
	});

	it("allows leading whitespace", () => {
		assert.deepEqual(parseInlineSubagentInput("  #architect plan"), {
			agentName: "architect",
			task: "plan",
			atStart: true,
		});
	});

	it("parses #agent-name mid-message and at the end, taking the text after the mention as the task", () => {
		assert.deepEqual(parseInlineSubagentInput("can you #architect review the plan"), {
			agentName: "architect",
			task: "review the plan",
			atStart: false,
		});
		assert.deepEqual(parseInlineSubagentInput("let's get #architect"), {
			agentName: "architect",
			task: "",
			atStart: false,
		});
	});

	it("returns null without a #mention", () => {
		assert.equal(parseInlineSubagentInput("review the plan"), null);
		assert.equal(parseInlineSubagentInput("pre#architect"), null);
		assert.equal(parseInlineSubagentInput("#"), null);
		assert.equal(parseInlineSubagentInput("#-architect"), null);
	});

	it("treats a run-on identifier as a single (possibly unknown) agent token", () => {
		assert.deepEqual(parseInlineSubagentInput("#architectreview"), {
			agentName: "architectreview",
			task: "",
			atStart: true,
		});
	});

	it("trims the task text", () => {
		assert.deepEqual(parseInlineSubagentInput("#architect   review the plan   "), {
			agentName: "architect",
			task: "review the plan",
			atStart: true,
		});
	});
});
