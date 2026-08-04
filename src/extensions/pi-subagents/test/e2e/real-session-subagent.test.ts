/**
 * Real Pi-session end-to-end test for the subagent extension.
 *
 * Spawns an actual child `pi` subprocess (a repo-local child CLI that runs a
 * real `AgentSession` backed by a faux provider) and exercises the extension's
 * real foreground execution path: the parent session calls the `subagent` tool,
 * the tool spawns the child, the child streams jsonl events, the extension's
 * real stdout parser extracts the result, and the marker flows back as a tool
 * result that the parent relays. No real API keys are used.
 *
 * Skips gracefully when the pi runtime packages are not importable.
 */

import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { tryImport } from "../support/helpers.ts";
import type { RealSessionRun } from "../support/real-session-runner.ts";

const piCodingAgent = await tryImport<unknown>("@selesai/code");
const piAi = await tryImport<unknown>("@earendil-works/pi-ai");
const available = Boolean(piCodingAgent && piAi);

const CHILD_MARKER = "CHILD_REAL_SESSION_OK";

/**
 * Reference-first tool results: completion content carries "Output saved to:
 * <path> (…)". Read the durable file to inspect the full child output.
 */
function readSavedOutput(text: string): string {
	const rest = text.split("Output saved to: ")[1];
	assert.ok(rest, `expected a saved-output reference in: ${text.slice(0, 160)}`);
	const outputPath = rest.split(" (")[0]!;
	return fs.readFileSync(outputPath, "utf-8");
}
// Env vars the runner must clear so a parent that was itself spawned as a
// subagent child can still launch fresh children. The values are deliberately
// bogus sentinels (nonexistent paths) so a leaked value would break spawning.
const BOGUS_EXTRA_DIRS = path.join(os.tmpdir(), "nonexistent-pi-subagents-e2e-extra-dirs");
const BOGUS_PI_BINARY = path.join(os.tmpdir(), "nonexistent-pi-binary-e2e");
const BOGUS_PI_PACKAGE_ROOT = path.join(os.tmpdir(), "nonexistent-pi-coding-agent-package-root-e2e");
const ISOLATED_ENV_KEYS = [
	"SELESAI_SUBAGENT_CHILD",
	"SELESAI_SUBAGENT_FANOUT_CHILD",
	"SELESAI_SUBAGENT_DEPTH",
	"SELESAI_SUBAGENT_MAX_DEPTH",
	"SELESAI_SUBAGENT_EXTRA_AGENT_DIRS",
	"SELESAI_SUBAGENT_PARENT_SESSION",
	"SELESAI_SUBAGENT_PI_BINARY",
	"SELESAI_SUBAGENTS_SELESAI_CODING_AGENT_PACKAGE_ROOT",
] as const;

describe("real Pi-session subagent E2E", { skip: !available ? "pi runtime packages not available" : undefined }, () => {
	let run: RealSessionRun | undefined;

	afterEach(async () => {
		await run?.dispose();
		run = undefined;
	});

	it("loads requested extension tools in direct and chain children and diagnoses missing providers", async () => {
		const { runRealSubagentSession, subagentCall, subagentToolResults } = await import("../support/real-session-runner.ts");
		const extensionAgent = `---
name: extension-worker
description: Uses a child-only fixture tool
tools: read, fixture_search
subagentOnlyExtensions: ./fixture-extension.ts
completionGuard: false
---
Use the available tools.`;
		const missingAgent = `---
name: missing-extension-worker
description: Requests an extension tool without loading its provider
tools: read, missing_search
completionGuard: false
---
Use the available tools.`;
		const fixtureExtension = `export default function (pi) {
	pi.registerTool({
		name: "fixture_search",
		label: "Fixture Search",
		description: "Search the E2E fixture.",
		parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
		async execute() { return { content: [{ type: "text", text: "fixture result" }] }; },
	});
}`;

		run = await runRealSubagentSession({
			prompt: "Run the direct, chain, and missing-provider child checks.",
			childText: CHILD_MARKER,
			reportChildTools: true,
			projectFiles: {
				".selesai/agents/extension-worker.md": extensionAgent,
				".selesai/agents/missing-extension-worker.md": missingAgent,
				"fixture-extension.ts": fixtureExtension,
			},
			respond(context) {
				const resultCount = (context.messages as Array<{ role?: string; toolName?: string }>).filter((message) => message.role === "toolResult" && message.toolName === "subagent").length;
				if (resultCount === 0) {
					return subagentCall({ agent: "extension-worker", task: "Report active tools.", context: "fresh", agentScope: "project" }, "call-direct-extension");
				}
				if (resultCount === 1) {
					return subagentCall({ chain: [{ agent: "extension-worker", task: "Report active tools." }], async: false, clarify: false, agentScope: "project" }, "call-chain-extension");
				}
				if (resultCount === 2) {
					return subagentCall({
						chain: [{
							agent: "extension-worker",
							task: "Submit the required structured marker.",
							outputSchema: {
								type: "object",
								properties: { marker: { type: "string" } },
								required: ["marker"],
								additionalProperties: false,
							},
						}],
						async: false,
						clarify: false,
						agentScope: "project",
					}, "call-structured-output");
				}
				if (resultCount === 3) {
					return subagentCall({ agent: "missing-extension-worker", task: "Report active tools.", context: "fresh", agentScope: "project" }, "call-missing-extension");
				}
				return "Child tool checks complete.";
			},
			timeoutMs: 60_000,
		});

		const results = subagentToolResults(run.parentSession);
		const toolMessages = run.parentSession.messages.filter((message) => message.role === "toolResult" && (message as { toolName?: string }).toolName === "subagent");
		const chainDetails = JSON.stringify((toolMessages[1] as { details?: unknown } | undefined)?.details);
		const structuredDetails = JSON.stringify((toolMessages[2] as { details?: unknown } | undefined)?.details);
		assert.equal(results.length, 4);
		const directOutput = readSavedOutput(results[0] ?? "");
		assert.match(directOutput, /ACTIVE_TOOLS:[^\n]*fixture_search/);
		assert.match(directOutput, /ACTIVE_TOOLS:[^\n]*read/);
		const chainFirstChild = (toolMessages[1] as { details?: { results?: Array<{ savedOutputPath?: string }> } } | undefined)?.details?.results?.[0];
		assert.ok(chainFirstChild?.savedOutputPath, "chain details should carry the saved output path");
		const chainOutput = fs.readFileSync(chainFirstChild.savedOutputPath, "utf-8");
		assert.match(chainOutput, /ACTIVE_TOOLS:[^\n]*fixture_search/);
		assert.match(chainOutput, /ACTIVE_TOOLS:[^\n]*read/);
		assert.match(structuredDetails, /STRUCTURED_OUTPUT_OK/);
		assert.match(results[3] ?? "", /requested unavailable child tools: missing_search/);
		assert.match(results[3] ?? "", /subagentOnlyExtensions/);
	});

	it("accepts child tools registered by async before_agent_start hooks", async () => {
		const { runRealSubagentSession, subagentCall, subagentToolResults } = await import("../support/real-session-runner.ts");
		const asyncExtensionAgent = `---
name: async-extension-worker
description: Uses a child-only tool registered from before_agent_start
tools: read, fixture_async_search
subagentOnlyExtensions: ./fixture-async-extension.ts
completionGuard: false
---
Report active tools.`;
		const fixtureAsyncExtension = `export default function (pi) {
	pi.on("before_agent_start", async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
		pi.registerTool({
			name: "fixture_async_search",
			label: "Fixture Async Search",
			description: "Search the async E2E fixture.",
			parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
			async execute() { return { content: [{ type: "text", text: "async fixture result" }] }; },
		});
	});
}`;

		run = await runRealSubagentSession({
			prompt: "Run the async child tool check.",
			childText: CHILD_MARKER,
			reportChildTools: true,
			projectFiles: {
				".selesai/agents/async-extension-worker.md": asyncExtensionAgent,
				"fixture-async-extension.ts": fixtureAsyncExtension,
			},
			respond(context) {
				const resultCount = (context.messages as Array<{ role?: string; toolName?: string }>).filter((message) => message.role === "toolResult" && message.toolName === "subagent").length;
				if (resultCount > 0) return "Async child tool check complete.";
				return subagentCall({ agent: "async-extension-worker", task: "Report active tools.", context: "fresh", agentScope: "project" }, "call-async-extension");
			},
			timeoutMs: 60_000,
		});

		const results = subagentToolResults(run.parentSession);
		assert.equal(results.length, 1);
		const asyncOutput = readSavedOutput(results[0] ?? "");
		assert.match(asyncOutput, /ACTIVE_TOOLS:[^\n]*fixture_async_search/);
		assert.doesNotMatch(results[0] ?? "", /requested unavailable child tools/);
	});

	it("boots the extension in a real parent session and delivers a faux child result", async () => {
		const { routeParentThroughSubagent, runRealSubagentSession, subagentToolResults } = await import("../support/real-session-runner.ts");

		const previousEnv = new Map(ISOLATED_ENV_KEYS.map((key) => [key, process.env[key]]));
		process.env.SELESAI_SUBAGENT_CHILD = "1";
		process.env.SELESAI_SUBAGENT_FANOUT_CHILD = "1";
		process.env.SELESAI_SUBAGENT_DEPTH = "1";
		process.env.SELESAI_SUBAGENT_MAX_DEPTH = "1";
		process.env.SELESAI_SUBAGENT_EXTRA_AGENT_DIRS = BOGUS_EXTRA_DIRS;
		process.env.SELESAI_SUBAGENT_PARENT_SESSION = "polluted-parent";
		process.env.SELESAI_SUBAGENT_PI_BINARY = BOGUS_PI_BINARY;
		process.env.SELESAI_SUBAGENTS_SELESAI_CODING_AGENT_PACKAGE_ROOT = BOGUS_PI_PACKAGE_ROOT;

		try {
			run = await runRealSubagentSession({
				prompt: "Delegate to a builder and report its exact result.",
				childText: CHILD_MARKER,
				respond: routeParentThroughSubagent({
					childMarker: CHILD_MARKER,
					subagentArgs: {
						agent: "builder",
						task: "Return the marker from the faux child provider.",
						context: "fresh",
						agentScope: "project",
					},
				}),
			});

			const toolResults = subagentToolResults(run.parentSession);
			assert.equal(toolResults.length, 1);
			assert.match(readSavedOutput(toolResults[0]!), new RegExp(CHILD_MARKER));
			assert.match(run.responseText, new RegExp(CHILD_MARKER));
			assert.doesNotMatch(run.responseText, /CHILD_MISSING/);
			assert.ok(run.modelCalls >= 2, `expected parent tool-call and final turns, got ${run.modelCalls}`);
		} finally {
			await run?.dispose();
			run = undefined;
			for (const [key, value] of previousEnv) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	});

	function latestSubagentToolResultText(messages: Array<{ role?: string; toolName?: string; content?: unknown }>): string | undefined {
		for (let i = messages.length - 1; i >= 0; i--) {
			const message = messages[i]!;
			if (message.role === "toolResult" && message.toolName === "subagent") {
				return Array.isArray(message.content)
					? message.content
						.map((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "text"
							? String((part as { text?: unknown }).text ?? "")
							: "")
						.join("")
					: "";
			}
		}
		return undefined;
	}

	it("lists then delegates to a non-bundled discovered writer in a broad-mutation request", async () => {
		const { runRealSubagentSession, subagentCall, subagentToolResults } = await import("../support/real-session-runner.ts");
		const writerAgent = `---
name: fixture-writer
description: Scoped mutation-capable fixture writer
aliases: fw
tools: read, grep, find, ls, bash, edit, write
acceptanceRole: writer
defaultContext: fork
completionGuard: false
---
Implement the scoped fixture change and return the marker.`;

		run = await runRealSubagentSession({
			prompt: "Implement the fixture change across the codebase.",
			childText: CHILD_MARKER,
			projectFiles: {
				".selesai/agents/fixture-writer.md": writerAgent,
			},
			respond(context) {
				const messages = context.messages as Array<{ role?: string; toolName?: string; content?: unknown; details?: unknown }>;
				const subagentResults = messages.filter((message) => message.role === "toolResult" && message.toolName === "subagent");
				if (subagentResults.length === 0) {
					return subagentCall({ action: "list", agentScope: "project" }, "call-list-writer");
				}
				if (subagentResults.length === 1) {
					const listText = latestSubagentToolResultText(messages) ?? "";
					assert.match(
						listText,
						/- fixture-writer \(project, context: fork, role: writer, aliases: fw, tools: read, grep, find, ls, bash, edit, write\)/,
						"catalog must expose the custom writer with its runtime metadata",
					);
					const listedDetails = JSON.stringify(subagentResults.at(-1)?.details ?? {});
					assert.match(listedDetails, /"catalog"/);
					assert.match(listedDetails, /"fixture-writer"/);
					assert.match(listedDetails, /"acceptanceRole":"writer"/);
					return subagentCall(
						{ agent: "fixture-writer", task: "Implement the change and return the marker.", context: "fresh", agentScope: "project" },
						"call-fixture-writer",
					);
				}
				return "Broad mutation work complete.";
			},
			timeoutMs: 60_000,
		});

		const results = subagentToolResults(run.parentSession);
		assert.equal(results.length, 2);
		assert.match(results[0] ?? "", /fixture-writer \(project, context: fork, role: writer/);
		assert.match(readSavedOutput(results[1] ?? ""), new RegExp(CHILD_MARKER));
	});

	it("keeps tiny targeted reads local without a subagent call", async () => {
		const { runRealSubagentSession, subagentToolResults } = await import("../support/real-session-runner.ts");
		run = await runRealSubagentSession({
			prompt: "What does the README say about subagents?",
			childText: CHILD_MARKER,
			projectFiles: {
				"README.md": "Subagents are delegated workers.",
			},
			respond() {
				return "The README says: Subagents are delegated workers.";
			},
			timeoutMs: 60_000,
		});

		const results = subagentToolResults(run.parentSession);
		assert.equal(results.length, 0);
		assert.match(run.responseText, /Subagents are delegated workers/);
		assert.ok(run.modelCalls >= 1, `expected at least one parent turn, got ${run.modelCalls}`);
	});
});
