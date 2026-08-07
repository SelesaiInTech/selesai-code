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

	it("falls back to the base provider outside message start or without a # token", async () => {
		const base = baseProvider();
		const provider = createInlineSubagentAutocompleteProvider(state, base);

		// # on a later line is not an inline invocation.
		assert.equal(await provider.getSuggestions(["", "#"], 1, 1, {} as never), null);
		// # mid-line is not an inline invocation.
		assert.equal(await provider.getSuggestions(["see #"], 0, 5, {} as never), null);
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
		});
	});

	it("parses hyphenated agent names", () => {
		assert.deepEqual(parseInlineSubagentInput("#batch-grill-me interview the user"), {
			agentName: "batch-grill-me",
			task: "interview the user",
		});
	});

	it("parses #agent-name with no task", () => {
		assert.deepEqual(parseInlineSubagentInput("#architect"), { agentName: "architect", task: "" });
	});

	it("is case-insensitive and lowercases the agent name", () => {
		assert.deepEqual(parseInlineSubagentInput("#Architect plan"), { agentName: "architect", task: "plan" });
	});

	it("allows leading whitespace", () => {
		assert.deepEqual(parseInlineSubagentInput("  #architect plan"), { agentName: "architect", task: "plan" });
	});

	it("returns null when the message does not start with #agent", () => {
		assert.equal(parseInlineSubagentInput("review the plan"), null);
		assert.equal(parseInlineSubagentInput("the #architect review"), null);
		assert.equal(parseInlineSubagentInput("#"), null);
		assert.equal(parseInlineSubagentInput("#-architect"), null);
	});

	it("treats a run-on identifier as a single (possibly unknown) agent token", () => {
		assert.deepEqual(parseInlineSubagentInput("#architectreview"), {
			agentName: "architectreview",
			task: "",
		});
	});

	it("trims the task text", () => {
		assert.deepEqual(parseInlineSubagentInput("#architect   review the plan   "), {
			agentName: "architect",
			task: "review the plan",
		});
	});
});
