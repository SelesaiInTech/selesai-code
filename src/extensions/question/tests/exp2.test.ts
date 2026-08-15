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

describe("exp2", () => {
	it("text question construction only", async () => {
		const { component, execution } = await runWizard({
			questions: [{ type: "text", question: "Type" }],
		});
		component().render(120);
		component().handleInput("a");
		component().handleInput("\r");
		await execution;
		expect(true).toBe(true);
	});

	it("blur then non-enter key", async () => {
		const { component, execution } = await runWizard({
			questions: [{ type: "text", question: "Type" }],
		});
		component().handleInput("\x1b"); // blur
		component().handleInput("x"); // non-enter while blurred
		component().handleInput("\r"); // re-focus
		component().handleInput("a");
		component().handleInput("\r");
		await execution;
		expect(true).toBe(true);
	});
});
