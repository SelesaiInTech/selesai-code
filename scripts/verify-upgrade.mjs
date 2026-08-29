#!/usr/bin/env node
/**
 * Focused verification for the Selesai -> pi v0.84.4 port.
 * Imports the built dist output and checks the ported behaviors that do not need a live agent.
 * Run from the repo root after `npm run build`.
 */
import { readFileSync, mkdtempSync, writeFileSync, readFileSync as read } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let failed = 0;
function check(name, fn) {
	try {
		fn();
		console.log(`ok - ${name}`);
	} catch (err) {
		failed++;
		console.error(`FAIL - ${name}: ${err instanceof Error ? err.message : err}`);
	}
}

function assert(cond, message) {
	if (!cond) throw new Error(message);
}

async function main() {
	const { loadEntriesFromFile } = await import(pathToFileURL(join(process.cwd(), "dist/core/session-manager.js")));
	const { getSummarizationFailure } = await import(
		pathToFileURL(join(process.cwd(), "dist/core/compaction/compaction.js"))
	);
	const { AgentSession } = await import(pathToFileURL(join(process.cwd(), "dist/core/agent-session.js")));
	const { createLlamaProvider } = await import(pathToFileURL(join(process.cwd(), "dist/core/llama/provider.js")));

	// 1. Session repair: JSONL without trailing newline is repaired and fully parsed.
	check("session repair (no trailing newline)", () => {
		const dir = mkdtempSync(join(tmpdir(), "selesai-verify-"));
		const file = join(dir, "session.jsonl");
		const header = JSON.stringify({ type: "session", id: "s1", cwd: "/tmp", timestamp: 1 });
		const e1 = JSON.stringify({ type: "message", id: "m1", role: "user", content: [{ type: "text", text: "hi" }], timestamp: 2 });
		const e2 = JSON.stringify({ type: "message", id: "m2", role: "assistant", content: [{ type: "text", text: "yo" }], timestamp: 3 });
		writeFileSync(file, `${header}\n${e1}\n${e2}`);
		const entries = loadEntriesFromFile(file);
		assert(entries.length === 3, `expected 3 entries, got ${entries.length}`);
		assert(entries.every((entry) => entry !== null), "one or more entries failed to parse");
		assert(read(file, "utf8").endsWith("\n"), "file was not repaired with a trailing newline");
	});

	// 2. Compaction: length stops are surfaced as failures, errors carry the message.
	check("compaction failure detection", () => {
		const length = getSummarizationFailure({ stopReason: "length" }, "Summarization");
		assert(length !== undefined && length.includes("incomplete"), "length stop should be a failure");
		const error = getSummarizationFailure({ stopReason: "error", errorMessage: "boom" }, "Summarization");
		assert(error !== undefined && error.includes("boom"), "error stop should carry the message");
		const clean = getSummarizationFailure({ stopReason: "end" }, "Summarization");
		assert(clean === undefined, "end stop should not be a failure");
	});

	// 3. Custom message ordering: queued context-only messages flush at turn end, not mid-turn.
	check("custom message flush", () => {
		const session = Object.create(AgentSession.prototype);
		session._pendingCustomMessages = [];
		session.agent = { state: { messages: [] } };
		const persisted = [];
		session.sessionManager = { appendCustomMessageEntry: (...args) => persisted.push(args) };
		session._emit = () => {};
		const msg = { role: "custom", customType: "x", content: [{ type: "text", text: "c" }], display: "d", details: undefined, timestamp: 1 };
		session._appendCustomMessage(msg);
		assert(session.agent.state.messages.length === 1 && persisted.length === 1, "append should update state and session");
		session._pendingCustomMessages = [msg];
		session._flushPendingCustomMessages();
		assert(session.agent.state.messages.length === 2, "flush should append queued messages");
		assert(session._pendingCustomMessages.length === 0, "flush should clear the queue");
	});

	// 4. Llama autoload: unloaded presets are selectable only when router autoload is on.
	check("llama router autoload filtering", () => {
		const mk = (id, value, failed = false, source = "preset") => ({
			id,
			status: { value, failed },
			source,
			meta: { n_ctx: 4096 },
			architecture: { input_modalities: ["text"] },
		});
		const ctl = createLlamaProvider();
		ctl.setCatalog(
			[mk("loaded", "loaded"), mk("unloaded-preset", "unloaded"), mk("unloaded-custom", "unloaded", false, "custom"), mk("failed", "unloaded", true)],
			"http://127.0.0.1:8080",
			{ routerAutoload: true },
		);
		const ids = ctl.provider.getModels().map((model) => model.id);
		assert(ids.includes("loaded") && ids.includes("unloaded-preset"), "loaded and unloaded presets should be selectable");
		assert(!ids.includes("unloaded-custom") && !ids.includes("failed"), "non-preset/failed unloaded models should be excluded");
	});

	// 5. Source markers for ports that need a live agent/terminal to exercise.
	const sources = {
		"src/core/extensions/runner.ts": ["wrapUIPromptContext", "withUIPrompt", "multiselect:"],
		"src/modes/rpc/rpc-types.ts": ["clear_queue"],
		"src/modes/rpc/rpc-mode.ts": ['case "clear_queue"'],
		"src/modes/rpc/rpc-client.ts": ["async clearQueue"],
		"src/core/settings-manager.ts": ["getTerminalCapabilityOverrides", "getFullscreenCopyOnSelect"],
		"src/modes/interactive/interactive-mode.ts": ["setCapabilityOverrides", "fullscreenCopyOnSelect", "handleCopyCommand"],
		"src/utils/shell.ts": ["System32", "taskkill.exe"],
		"src/index.ts": ["detectSupportedImageMimeTypeFromFile"],
		"src/core/agent-session.ts": ["_pendingCustomMessages", "_compactBeforeNextAssistantResponse", "_addPersistedDefaultToNonEmptyScope"],
	};
	for (const [file, markers] of Object.entries(sources)) {
		check(`source markers in ${file}`, () => {
			const text = readFileSync(join(process.cwd(), file), "utf8");
			for (const marker of markers) {
				assert(text.includes(marker), `missing ${JSON.stringify(marker)}`);
			}
		});
	}

	if (failed > 0) {
		console.error(`${failed} check(s) failed`);
		process.exit(1);
	}
	console.log("UPGRADE_OK");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
