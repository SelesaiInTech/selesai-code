import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ponytailExtension from "../index.js";

function createPiHarness() {
	const events = new Map();
	const commands = new Map();
	const appendedEntries = [];
	const sentUserMessages = [];

	const pi = {
		on(eventName, handler) {
			events.set(eventName, handler);
		},
		registerCommand(name, options) {
			commands.set(name, options);
		},
		appendEntry(customType, data) {
			appendedEntries.push({ customType, data });
		},
		sendUserMessage(text, options) {
			sentUserMessages.push({ text, options });
		},
	};

	ponytailExtension(pi);
	return { events, commands, appendedEntries, sentUserMessages };
}

function createCommandContext(overrides = {}) {
	return {
		isIdle: () => true,
		sessionManager: { getEntries: () => [] },
		ui: { notify() {} },
		...overrides,
	};
}

function withTempConfig(fn) {
	const tempConfigHome = mkdtempSync(join(tmpdir(), "ponytail-test-"));
	const previousXdg = process.env.XDG_CONFIG_HOME;
	process.env.XDG_CONFIG_HOME = tempConfigHome;

	return Promise.resolve()
		.then(fn)
		.finally(() => {
			if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
			else process.env.XDG_CONFIG_HOME = previousXdg;
			rmSync(tempConfigHome, { recursive: true, force: true });
		});
}

describe("ponytail extension", () => {
	it("registers Ponytail commands", () => {
		const { commands } = createPiHarness();

		expect([...commands.keys()].sort()).toEqual(["ponytail", "ponytail-audit", "ponytail-debt", "ponytail-gain", "ponytail-help", "ponytail-review"]);
	});

	it("/ponytail updates session mode and injects instructions", async () => withTempConfig(async () => {
		const { commands, events, appendedEntries } = createPiHarness();
		const ctx = createCommandContext();

		await events.get("session_start")({ reason: "startup" }, ctx);
		await commands.get("ponytail").handler("ultra", ctx);

		expect(appendedEntries.at(-1)).toEqual({
			customType: "ponytail-mode",
			data: { mode: "ultra" },
		});

		const result = await events.get("before_agent_start")({ systemPrompt: "BASE" }, ctx);
		expect(result.systemPrompt).toMatch(/^BASE\n\nPONYTAIL ULTRA:/);
	}));

	it("session_start restores latest persisted mode", async () => withTempConfig(async () => {
		const { events } = createPiHarness();
		const ctx = createCommandContext({
			sessionManager: {
				getEntries: () => [
					{ type: "custom", customType: "ponytail-mode", data: { mode: "lite" } },
				],
			},
		});

		await events.get("session_start")({ reason: "resume" }, ctx);
		const result = await events.get("before_agent_start")({ systemPrompt: "BASE" }, ctx);

		expect(result.systemPrompt).toMatch(/PONYTAIL LITE:/);
	}));

	it("review mode retains its independent skill prompt", async () => withTempConfig(async () => {
		const { events } = createPiHarness();
		const ctx = createCommandContext({
			sessionManager: {
				getEntries: () => [
					{ type: "custom", customType: "ponytail-mode", data: { mode: "review" } },
				],
			},
		});

		await events.get("session_start")({ reason: "resume" }, ctx);
		const result = await events.get("before_agent_start")({ systemPrompt: "BASE" }, ctx);

		expect(result.systemPrompt).toBe("BASE\n\nPONYTAIL MODE ACTIVE — level: review. Behavior defined by /ponytail-review skill.");
	}));

	it("skill alias commands delegate to Pi skill commands", async () => {
		const { commands, sentUserMessages } = createPiHarness();
		const ctx = createCommandContext();

		await commands.get("ponytail-review").handler("", ctx);
		await commands.get("ponytail-audit").handler("", ctx);
		await commands.get("ponytail-debt").handler("", ctx);
		await commands.get("ponytail-gain").handler("", ctx);
		await commands.get("ponytail-help").handler("", ctx);

		expect(sentUserMessages.map((entry) => entry.text)).toEqual([
			"/skill:ponytail-review",
			"/skill:ponytail-audit",
			"/skill:ponytail-debt",
			"/skill:ponytail-gain",
			"/skill:ponytail-help",
		]);
	});

	it("skill alias queues as follow-up when not idle", async () => {
		const { commands, sentUserMessages } = createPiHarness();
		const ctx = createCommandContext({ isIdle: () => false });

		await commands.get("ponytail-review").handler("", ctx);
		expect(sentUserMessages[0]).toEqual({ text: "/skill:ponytail-review", options: { deliverAs: "followUp" } });
	});

	it("normal mode disables persistent instructions", async () => withTempConfig(async () => {
		const { commands, events } = createPiHarness();
		const ctx = createCommandContext();

		await events.get("session_start")({ reason: "startup" }, ctx);
		await commands.get("ponytail").handler("ultra", ctx);
		await events.get("input")({ text: "normal mode", source: "interactive" }, ctx);

		const disabled = await events.get("before_agent_start")({ systemPrompt: "BASE" }, ctx);
		expect(disabled).toBeUndefined();
	}));

	it("a request mentioning normal mode stays active", async () => withTempConfig(async () => {
		const { commands, events } = createPiHarness();
		const ctx = createCommandContext();

		await events.get("session_start")({ reason: "startup" }, ctx);
		await commands.get("ponytail").handler("ultra", ctx);
		await events.get("input")({ text: "add a normal mode toggle next to dark mode", source: "interactive" }, ctx);

		const result = await events.get("before_agent_start")({ systemPrompt: "BASE" }, ctx);
		expect(result.systemPrompt).toMatch(/PONYTAIL ULTRA:/);
	}));

	it("never writes a Ponytail statusline", async () => withTempConfig(async () => {
		const { events } = createPiHarness();
		const statusWrites = [];
		const ctx = createCommandContext({
			ui: { notify() {}, setStatus: (key, text) => statusWrites.push({ key, text }) },
		});

		await events.get("session_start")({ reason: "startup" }, ctx);
		expect(events.has("agent_start")).toBe(false);
		expect(events.has("agent_end")).toBe(false);
		expect(statusWrites).toEqual([]);
	}));

	it("/ponytail status reports current and default modes", async () => withTempConfig(async () => {
		const { commands, events } = createPiHarness();
		const notifications = [];
		const ctx = createCommandContext({ ui: { notify: (msg, kind) => notifications.push({ msg, kind }) } });

		await events.get("session_start")({ reason: "startup" }, ctx);
		await commands.get("ponytail").handler("status", ctx);
		expect(notifications.at(-1).msg).toContain("Ponytail: current full • default full");
	}));

	it("/ponytail set-default persists the default mode", async () => withTempConfig(async () => {
		const { commands, events } = createPiHarness();
		const notifications = [];
		const ctx = createCommandContext({ ui: { notify: (msg, kind) => notifications.push({ msg, kind }) } });

		await events.get("session_start")({ reason: "startup" }, ctx);
		await commands.get("ponytail").handler("default lite", ctx);
		expect(notifications.at(-1).msg).toContain("Default Ponytail mode set to lite.");
	}));

	it("/ponytail set-default with env override reports the override", async () => withTempConfig(async () => {
		const previous = process.env.PONYTAIL_DEFAULT_MODE;
		process.env.PONYTAIL_DEFAULT_MODE = "ultra";
		try {
			const { commands, events } = createPiHarness();
			const notifications = [];
			const ctx = createCommandContext({ ui: { notify: (msg, kind) => notifications.push({ msg, kind }) } });

			await events.get("session_start")({ reason: "startup" }, ctx);
			await commands.get("ponytail").handler("default lite", ctx);
			expect(notifications.at(-1).msg).toContain("env override keeps default at ultra");
		} finally {
			if (previous === undefined) delete process.env.PONYTAIL_DEFAULT_MODE;
			else process.env.PONYTAIL_DEFAULT_MODE = previous;
		}
	}));

	it("/ponytail invalid mode warns", async () => withTempConfig(async () => {
		const { commands, events } = createPiHarness();
		const notifications = [];
		const ctx = createCommandContext({ ui: { notify: (msg, kind) => notifications.push({ msg, kind }) } });

		await events.get("session_start")({ reason: "startup" }, ctx);
		await commands.get("ponytail").handler("bogus", ctx);
		expect(notifications.at(-1).msg).toContain("Unknown or unsupported /ponytail mode.");
	}));

	it("input from extension source is ignored", async () => withTempConfig(async () => {
		const { commands, events } = createPiHarness();
		const ctx = createCommandContext();

		await events.get("session_start")({ reason: "startup" }, ctx);
		await commands.get("ponytail").handler("ultra", ctx);
		await events.get("input")({ text: "normal mode", source: "extension" }, ctx);

		const result = await events.get("before_agent_start")({ systemPrompt: "BASE" }, ctx);
		expect(result.systemPrompt).toMatch(/PONYTAIL ULTRA:/);
	}));

	it("setMode ignores invalid modes", async () => withTempConfig(async () => {
		const { commands, events, appendedEntries } = createPiHarness();
		const ctx = createCommandContext();

		await events.get("session_start")({ reason: "startup" }, ctx);
		await commands.get("ponytail").handler("bogus", ctx);
		expect(appendedEntries).toHaveLength(0);
	}));

	it("session_start uses getBranch when getEntries is missing", async () => withTempConfig(async () => {
		const { events } = createPiHarness();
		const ctx = createCommandContext({
			sessionManager: {
				getBranch: () => [
					{ type: "custom", customType: "ponytail-mode", data: { mode: "lite" } },
				],
			},
		});

		await events.get("session_start")({ reason: "resume" }, ctx);
		const result = await events.get("before_agent_start")({ systemPrompt: "BASE" }, ctx);
		expect(result.systemPrompt).toMatch(/PONYTAIL LITE:/);
	}));

	it("session_start tolerates a missing sessionManager", async () => withTempConfig(async () => {
		const { events } = createPiHarness();
		const ctx = createCommandContext({ sessionManager: undefined });

		await events.get("session_start")({ reason: "resume" }, ctx);
		const result = await events.get("before_agent_start")({ systemPrompt: "BASE" }, ctx);
		expect(result.systemPrompt).toMatch(/PONYTAIL MODE ACTIVE — level: full/);
	}));

	it("input handler tolerates missing text", async () => withTempConfig(async () => {
		const { commands, events } = createPiHarness();
		const ctx = createCommandContext();

		await events.get("session_start")({ reason: "startup" }, ctx);
		await commands.get("ponytail").handler("ultra", ctx);
		await events.get("input")({ source: "interactive" }, ctx);

		const result = await events.get("before_agent_start")({ systemPrompt: "BASE" }, ctx);
		expect(result.systemPrompt).toMatch(/PONYTAIL ULTRA:/);
	}));

	it("setMode notifies when ctx has a UI", async () => withTempConfig(async () => {
		const { commands, events } = createPiHarness();
		const notifications = [];
		const ctx = createCommandContext({ ui: { notify: (msg, kind) => notifications.push({ msg, kind }) } });

		await events.get("session_start")({ reason: "startup" }, ctx);
		await commands.get("ponytail").handler("lite", ctx);
		expect(notifications.some((n) => n.msg.includes("Ponytail mode set to lite."))).toBe(true);
	}));

	it("sendAlias with args sends the skill name plus args", async () => withTempConfig(async () => {
		const { commands, sentUserMessages } = createPiHarness();
		const ctx = createCommandContext();

		// The alias handlers hardcode empty args; exercise the follow-up path
		// through a non-idle context.
		const busyCtx = createCommandContext({ isIdle: () => false });
		await commands.get("ponytail-review").handler("", busyCtx);
		expect(sentUserMessages[0]).toEqual({ text: "/skill:ponytail-review", options: { deliverAs: "followUp" } });
	}));
});
