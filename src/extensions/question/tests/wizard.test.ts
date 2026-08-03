import test from "node:test";
import assert from "node:assert/strict";

import questionExtension from "../index.ts";

const ENTER = "\r";
const TAB = "\t";
const SHIFT_TAB = "\x1b[Z";
const ESC = "\x1b";
const DOWN = "\x1b[B";

const theme = {
	fg: (_name: string, value: string) => value,
	bg: (_name: string, value: string) => value,
	bold: (value: string) => value,
};
const tui = { requestRender() {}, terminal: { rows: 24 } };
const keybindings = {
	matches: (data: string, action: string) =>
		(data === ENTER && action === "tui.select.confirm") ||
		(data === ESC && action === "tui.select.cancel") ||
		(data === DOWN && action === "tui.select.down"),
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

function type(component: any, text: string) {
	for (const character of text) component.handleInput(character);
}

test("wizard submits typed selections and text without review comments", async () => {
	const { component, execution } = await runWizard({
		questions: [
			{ id: "choice", type: "select", question: "Choose", options: [{ value: "one", label: "One" }] },
			{ id: "many", type: "multiselect", question: "Choose many", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
			{ id: "note", type: "text", question: "Explain" },
		],
	});
	component().handleInput(ENTER); // choice commits and advances
	component().handleInput(" ");
	component().handleInput(DOWN);
	component().handleInput(" ");
	component().handleInput(ENTER); // multi-select commits and advances
	type(component(), "details");
	component().handleInput(ENTER); // text commits and advances to review
	assert.doesNotMatch(component().render(120).join("\n"), /Optional comment/);
	component().handleInput(ENTER);

	const result = await execution;
	assert.deepEqual(result.details, {
		status: "submitted",
		answers: [
			{ id: "choice", status: "answered", response: { kind: "selection", values: ["one"] } },
			{ id: "many", status: "answered", response: { kind: "selection", values: ["a", "b"] } },
			{ id: "note", status: "answered", response: { kind: "text", text: "details" } },
		],
	});
});

test("wizard preserves skipped, Other, and cancelled outcomes", async () => {
	const skipped = await runWizard({ questions: [{ type: "select", question: "Skip", options: [{ value: "x", label: "X" }] }] });
	skipped.component().handleInput(TAB);
	skipped.component().handleInput(ENTER);
	assert.deepEqual((await skipped.execution).details, { status: "submitted", answers: [{ id: "q1", status: "skipped" }] });

	const other = await runWizard({ questions: [{ type: "select", question: "Other", options: [{ value: "x", label: "X" }], allowOther: true }] });
	other.component().handleInput(DOWN);
	other.component().handleInput(ENTER);
	type(other.component(), "custom");
	other.component().handleInput(ENTER); // one answered question submits immediately
	assert.deepEqual((await other.execution).details, {
		status: "submitted",
		answers: [{ id: "q1", status: "answered", response: { kind: "selection", values: [], otherText: "custom" } }],
	});

	const selected = await runWizard({ questions: [{ type: "select", question: "Select", options: [{ value: "x", label: "X" }] }] });
	selected.component().handleInput(ENTER);
	assert.deepEqual((await selected.execution).details, {
		status: "submitted",
		answers: [{ id: "q1", status: "answered", response: { kind: "selection", values: ["x"] } }],
	});

	const cancelled = await runWizard({ questions: [{ type: "select", question: "Cancel", options: [{ value: "x", label: "X" }] }] });
	cancelled.component().handleInput(ESC);
	assert.deepEqual((await cancelled.execution).details, { status: "cancelled", reason: "user" });
});
