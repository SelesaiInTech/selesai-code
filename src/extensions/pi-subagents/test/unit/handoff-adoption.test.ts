import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it } from "node:test";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("handoff workflow carry-over", () => {
	it("adopts the previous session's active async workflows and tells the agent", () => {
		const script = String.raw`
			import os from "node:os";
			import path from "node:path";
			import fs from "node:fs";
			import { DIRS } from "./src/shared/types.ts";
			import registerSubagentExtension from "./index.ts";
			const handlers = new Map();
			const events = { listeners: new Map(), on(name, handler) { this.listeners.set(name, handler); return () => this.listeners.delete(name); }, emit(name, payload) { this.listeners.get(name)?.(payload); } };
			const sent = [];
			const widgets = [];
			const pi = new Proxy({
				events,
				on(name, handler) { handlers.set(name, handler); },
				registerTool() {}, registerCommand() {}, registerShortcut() {}, registerMessageRenderer() {},
				sendMessage(message, options) { sent.push({ message, options }); }, getSessionName() { return undefined; },
			}, { get(target, prop) { return prop in target ? target[prop] : () => undefined; } });

			const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "selesai-handoff-"));
			const oldSession = path.join(tmp, "old-session.jsonl");
			const newSession = path.join(tmp, "new-session.jsonl");
			fs.writeFileSync(oldSession, JSON.stringify({ type: "session", version: 1, id: "old-session", timestamp: new Date().toISOString(), cwd: process.cwd() }) + "\n");
			fs.writeFileSync(newSession, JSON.stringify({ type: "session", version: 1, id: "new-session", timestamp: new Date().toISOString(), cwd: process.cwd(), parentSession: oldSession }) + "\n");

			// One active async workflow owned by the previous session.
			const runId = "adopted-workflow-run";
			const asyncDir = path.join(DIRS.async, runId);
			fs.mkdirSync(asyncDir, { recursive: true });
			fs.writeFileSync(path.join(asyncDir, "status.json"), JSON.stringify({
				runId,
				state: "running",
				sessionId: oldSession,
				mode: "workflow",
				workflowKey: "task",
				agent: "builder",
				startedAt: Date.now(),
				steps: [{ agent: "builder", status: "running", phase: "build-1", description: "Implement the carry-over plan" }],
			}));
			fs.mkdirSync(path.join(DIRS.async, ".active-runs"), { recursive: true });
			fs.writeFileSync(path.join(DIRS.async, ".active-runs", runId), "");

			// A result file for an old-session run written during the switch window.
			const resultRunId = "adopted-completed-run";
			const resultPath = path.join(DIRS.results, resultRunId + ".json");
			fs.mkdirSync(DIRS.results, { recursive: true });
			fs.writeFileSync(resultPath, JSON.stringify({ runId: resultRunId, sessionId: oldSession, agent: "explorer", summary: "done", success: true }));

			const ctx = { cwd: process.cwd(), hasUI: true, ui: { setWidget(key, value) { widgets.push([key, value]); }, requestRender() {}, onTerminalInput() { return () => {}; }, getEditorText() { return ""; }, notify() {}, theme: { fg(_name, text) { return text; }, bg(_name, text) { return text; }, bold(text) { return text; } } }, sessionManager: { getSessionId() { return "new-session"; }, getSessionFile() { return newSession; }, getHeader() { return { parentSession: oldSession }; }, getEntries() { return []; } }, modelRegistry: { getAvailable() { return []; } } };

			registerSubagentExtension(pi);
			handlers.get("session_start")({ reason: "new", previousSessionFile: oldSession }, ctx);
			sent.length = 0;

			// No handoff notice until a turn settles.
			if (sent.length !== 0) throw new Error("handoff notice sent before the first settled turn");

			handlers.get("agent_settled")();
			const handoff = sent.filter((entry) => entry.message?.customType === "subagent-handoff-resume");
			if (handoff.length !== 1) throw new Error(JSON.stringify(sent.map((entry) => entry.message)));
			if (handoff[0].options?.triggerTurn !== true) throw new Error("handoff notice did not trigger a turn");
			if (typeof handoff[0].message?.content !== "string" || !handoff[0].message.content.includes(runId) || !handoff[0].message.content.includes("carried over")) {
				throw new Error("handoff notice lacks the adopted workflow: " + JSON.stringify(handoff[0].message));
			}

			// Only once per adoption.
			handlers.get("agent_settled")();
			if (sent.filter((entry) => entry.message?.customType === "subagent-handoff-resume").length !== 1) throw new Error("handoff notice repeated");

			// Compaction resume message now lists the live workflows.
			handlers.get("session_before_compact")({ reason: "threshold", signal: new AbortController().signal });
			handlers.get("session_compact")({ reason: "threshold" });
			const compaction = sent.filter((entry) => entry.message?.customType === "subagent-compaction-resume");
			if (compaction.length !== 1) throw new Error("compaction resume missing: " + JSON.stringify(sent.map((entry) => entry.message?.customType)));
			if (typeof compaction[0].message?.content !== "string" || !compaction[0].message.content.includes(runId)) {
				throw new Error("compaction resume lacks the workflow manifest: " + JSON.stringify(compaction[0].message));
			}

			// Adopted old-session result gets delivered and cleaned up (batched
			// notification debounces, so poll with a generous bound).
			let delivered = false;
			for (let attempt = 0; attempt < 40 && !delivered; attempt++) {
				await new Promise((resolve) => setTimeout(resolve, 250));
				delivered = !fs.existsSync(resultPath);
			}
			if (!delivered) throw new Error("adopted result file was not delivered");

			await handlers.get("session_shutdown")();
		`;
		const env = { ...process.env };
		delete env.SELESAI_SUBAGENT_CHILD;
		execFileSync(process.execPath, ["--experimental-strip-types", "--import", "./test/support/register-loader.mjs", "--input-type=module", "--eval", script], { cwd: projectRoot, env, stdio: "pipe" });
		assert.ok(true);
	});
});
