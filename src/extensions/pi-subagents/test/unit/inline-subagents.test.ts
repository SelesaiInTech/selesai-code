import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseInlineSubagentInput } from "../../src/slash/inline-subagents.ts";

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
