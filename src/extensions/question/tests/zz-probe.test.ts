import { describe, expect, it } from "vitest";
import questionExtension from "../index.ts";

const theme = { fg: (_n: string, s: string) => s, bg: (_n: string, s: string) => s, bold: (s: string) => s };
const tui = { requestRender() {}, terminal: { rows: 24 } };
const keybindings = { matches: () => false, getKeys: () => ["Enter"] };

async function runWizard(params: unknown) {
	let tool: any;
	let component: any;
	let done!: (value: unknown) => void;
	questionExtension({ registerTool: (entry: unknown) => (tool = entry), events: { emit() {} } } as any);
	const execution = tool.execute("call", params, undefined, undefined, {
		mode: "tui",
		ui: { custom: (factory: (...args: any[]) => unknown) => new Promise((resolve) => { done = resolve; component = factory(tui, theme, keybindings, done); }) },
	} as any);
	return { component: () => component, execution };
}

describe("probe", () => {
	it("text question focused false", async () => {
		const { component, execution } = await runWizard({ questions: [{ type: "text", question: "Type" }] });
		component().focused = false;
		component().handleInput("a");
		component().handleInput("\r");
		await execution;
		expect(true).toBe(true);
	});
});
