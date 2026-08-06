import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it } from "node:test";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("async compaction resume", () => {
	it("continues an interactive parent after compaction while async work is active", () => {
		const script = String.raw`
			import os from "node:os";
			import path from "node:path";
			import registerSubagentExtension from "./index.ts";
			const handlers = new Map();
			const events = { listeners: new Map(), on(name, handler) { this.listeners.set(name, handler); return () => this.listeners.delete(name); }, emit(name, payload) { this.listeners.get(name)?.(payload); } };
			const sent = [];
			const pi = new Proxy({
				events,
				on(name, handler) { handlers.set(name, handler); },
				registerTool() {}, registerCommand() {}, registerShortcut() {}, registerMessageRenderer() {},
				sendMessage(message, options) { sent.push({ message, options }); }, getSessionName() { return undefined; },
			}, { get(target, prop) { return prop in target ? target[prop] : () => undefined; } });
			const ctx = { cwd: process.cwd(), hasUI: true, ui: { setWidget() {}, requestRender() {}, theme: { fg(_name, text) { return text; }, bg(_name, text) { return text; }, bold(text) { return text; } } }, sessionManager: { getSessionId() { return "compact-session"; }, getSessionFile() { return null; }, getEntries() { return []; } }, modelRegistry: { getAvailable() { return []; } } };
			registerSubagentExtension(pi);
			handlers.get("session_start")({}, ctx);
			sent.length = 0;
			events.emit("subagent:async-started", { id: "running", pid: 1, sessionId: "compact-session", mode: "single", agent: "builder", asyncDir: path.join(os.tmpdir(), "pi-compaction-test-running") });
			handlers.get("session_compact")();
			if (sent.length !== 1 || sent[0].options?.triggerTurn !== true || sent[0].message?.customType !== "subagent-compaction-resume") throw new Error(JSON.stringify(sent));
			sent.length = 0;
			events.emit("subagent:async-complete", { id: "running", sessionId: "compact-session", agent: "builder", success: true, summary: "done" });
			handlers.get("session_compact")();
			if (sent.some((entry) => entry.message?.customType === "subagent-compaction-resume")) throw new Error("resumed without active work");
		`;
		const env = { ...process.env };
		delete env.SELESAI_SUBAGENT_CHILD;
		execFileSync(process.execPath, ["--experimental-strip-types", "--import", "./test/support/register-loader.mjs", "--input-type=module", "--eval", script], { cwd: projectRoot, env, stdio: "pipe" });
		assert.ok(true);
	});
});
