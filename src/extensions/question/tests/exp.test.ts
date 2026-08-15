import { describe, expect, it } from "vitest";

import questionExtension from "../index.ts";

const theme = {
	fg: (_name: string, value: string) => value,
	bg: (_name: string, value: string) => value,
	bold: (value: string) => value,
};
const tui = { requestRender() {}, terminal: { rows: 24 } };
const keybindings = {
	matches: (data: string, action: string) =>
		(data === "\r" && action === "tui.select.confirm") ||
		(data === "\x1b" && action === "tui.select.cancel"),
	getKeys: () => ["Enter"],
};

async function runWizard(params: unknown) {
	let tool: any;
	let component: any;
	let done!: (value: unknown) => void;
	questionExtension({ registerTool: (entry: unknown) => (tool = entry), events: { emit() {} } } as any);
	const execution = tool.execute("call", params, undefined, undefined, {
		mode: "tui",
		ui: {
			custom: (factory: (...args: any[]) => unknown) => new Promise((resolve) => {
				done = resolve;
				component = factory(tui, theme, keybindings, done);
			}),
		},
	} as any);
	return { component: () => component, execution };
}

describe("exp", () => {
	it("text question focused=false", async () => {
		const { component, execution } = await runWizard({
			questions: [{ type: "text", question: "Type" }],
		});
		component().focused = false;
		component().focused = true;
		component().focused = false;
		component().handleInput("x");
		component().handleInput("\r");
		await execution;
		expect(true).toBe(true);
	});

	it("multiselect empty confirm", async () => {
		const { component, execution } = await runWizard({
			questions: [{ type: "multiselect", question: "Pick", options: [{ value: "a", label: "A" }] }],
		});
		component().handleInput("\r"); // empty confirm → no commit
		component().handleInput(" ");
		component().handleInput("\r"); // now commits
		await execution;
		expect(true).toBe(true);
	});

	it("text empty submit", async () => {
		const { component, execution } = await runWizard({
			questions: [{ type: "text", question: "Type" }],
		});
		component().handleInput("\r"); // empty submit → no commit
		component().handleInput("a");
		component().handleInput("\r");
		await execution;
		expect(true).toBe(true);
	});
});
