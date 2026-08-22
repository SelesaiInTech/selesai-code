import { describe, expect, it } from "vitest";

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

describe("question wizard", () => {
	it("submits typed selections and text without review comments", async () => {
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
		expect(component().render(120).join("\n")).not.toMatch(/Optional comment/);
		component().handleInput(ENTER);

		const result = await execution;
		expect(result.details).toEqual({
			status: "submitted",
			answers: [
				{ id: "choice", status: "answered", response: { kind: "selection", values: ["one"] } },
				{ id: "many", status: "answered", response: { kind: "selection", values: ["a", "b"] } },
				{ id: "note", status: "answered", response: { kind: "text", text: "details" } },
			],
		});
	});

	it("preserves skipped, Other, and cancelled outcomes", async () => {
		const skipped = await runWizard({ questions: [{ type: "select", question: "Skip", options: [{ value: "x", label: "X" }] }] });
		skipped.component().handleInput(TAB);
		skipped.component().handleInput(ENTER);
		expect((await skipped.execution).details).toEqual({ status: "submitted", answers: [{ id: "q1", status: "skipped" }] });

		const other = await runWizard({ questions: [{ type: "select", question: "Other", options: [{ value: "x", label: "X" }], allowOther: true }] });
		other.component().handleInput(DOWN);
		other.component().handleInput(ENTER);
		type(other.component(), "custom");
		other.component().handleInput(ENTER); // one answered question submits immediately
		expect((await other.execution).details).toEqual({
			status: "submitted",
			answers: [{ id: "q1", status: "answered", response: { kind: "selection", values: [], otherText: "custom" } }],
		});

		const selected = await runWizard({ questions: [{ type: "select", question: "Select", options: [{ value: "x", label: "X" }] }] });
		selected.component().handleInput(ENTER);
		expect((await selected.execution).details).toEqual({
			status: "submitted",
			answers: [{ id: "q1", status: "answered", response: { kind: "selection", values: ["x"] } }],
		});

		const cancelled = await runWizard({ questions: [{ type: "select", question: "Cancel", options: [{ value: "x", label: "X" }] }] });
		cancelled.component().handleInput(ESC);
		expect((await cancelled.execution).details).toEqual({ status: "cancelled", reason: "user" });
	});

	it("navigates back to edit answers and re-submits", async () => {
		const { component, execution } = await runWizard({
			questions: [
				{ type: "select", question: "One", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
				{ type: "text", question: "Two" },
			],
		});
		component().handleInput(ENTER); // select "a", advance
		type(component(), "answer");
		component().handleInput(ENTER); // text commits, advance to review
		component().handleInput("\x1b[D"); // left = back to q2 (text)
		component().handleInput(ESC); // blur the text editor
		component().handleInput(SHIFT_TAB); // back to q1
		component().handleInput(DOWN); // move to "b"
		component().handleInput(ENTER); // commit "b", advance to q2
		component().handleInput(ENTER); // commit q2 text (restored "answer"), advance to review
		component().handleInput(ENTER); // submit

		const result = await execution;
		expect(result.details).toEqual({
			status: "submitted",
			answers: [
				{ id: "q1", status: "answered", response: { kind: "selection", values: ["b"] } },
				{ id: "q2", status: "answered", response: { kind: "text", text: "answer" } },
			],
		});
	});

	it("text question escape blurs, enter re-focuses, escape again cancels", async () => {
		const { component, execution } = await runWizard({
			questions: [{ type: "text", question: "Type" }],
		});
		component().handleInput(ESC); // blur editor
		component().handleInput(ENTER); // re-focus
		type(component(), "typed");
		component().handleInput(ENTER); // commit + submit (single question)
		const result = await execution;
		expect(result.details).toEqual({
			status: "submitted",
			answers: [{ id: "q1", status: "answered", response: { kind: "text", text: "typed" } }],
		});
	});

	it("cancels from a text question via escape when not editing", async () => {
		const { component, execution } = await runWizard({
			questions: [{ type: "text", question: "Type" }],
		});
		component().handleInput(ESC); // blur editor
		component().handleInput(ESC); // cancel
		expect((await execution).details).toEqual({ status: "cancelled", reason: "user" });
	});

	it("emits question:cancelled and question:submitted events", async () => {
		const emitted: string[] = [];
		let tool: any;
		let component: any;
		let done!: (value: unknown) => void;
		questionExtension({
			registerTool: (entry: unknown) => (tool = entry),
			events: { emit: (name: string) => emitted.push(name) },
		} as any);
		const execution = tool.execute("call", { questions: [{ type: "select", question: "Q", options: [{ value: "x", label: "X" }] }] }, undefined, undefined, {
			mode: "tui",
			ui: {
				custom: (factory: (...args: any[]) => unknown) => new Promise((resolve) => {
					done = resolve;
					component = factory(tui, theme, keybindings, done);
				}),
			},
		} as any);
		component.handleInput(ESC);
		await execution;
		expect(emitted).toEqual(["question:cancelled"]);

		const emitted2: string[] = [];
		let tool2: any;
		let component2: any;
		let done2!: (value: unknown) => void;
		questionExtension({
			registerTool: (entry: unknown) => (tool2 = entry),
			events: { emit: (name: string) => emitted2.push(name) },
		} as any);
		const execution2 = tool2.execute("call", { questions: [{ type: "select", question: "Q", options: [{ value: "x", label: "X" }] }] }, undefined, undefined, {
			mode: "tui",
			ui: {
				custom: (factory: (...args: any[]) => unknown) => new Promise((resolve) => {
					done2 = resolve;
					component2 = factory(tui, theme, keybindings, done2);
				}),
			},
		} as any);
		component2.handleInput(ENTER);
		await execution2;
		expect(emitted2).toEqual(["question:submitted"]);
	});

	it("uses extension UI requests in RPC mode", async () => {
		let tool: any;
		questionExtension({ registerTool: (entry: unknown) => (tool = entry), events: { emit() {} } } as any);
		const result = await tool.execute("call", { questions: [{ type: "select", question: "Choose", options: [{ value: "x", label: "X" }] }] }, undefined, undefined, {
			mode: "rpc",
			ui: { select: async () => "X" },
		} as any);
		expect(result.details).toEqual({ status: "submitted", answers: [{ id: "q1", status: "answered", response: { kind: "selection", values: ["x"] } }] });
	});

	it("preserves multiple RPC selections", async () => {
		let tool: any;
		questionExtension({ registerTool: (entry: unknown) => (tool = entry), events: { emit() {} } } as any);
		const result = await tool.execute("call", { questions: [{ type: "multiselect", question: "Choose many", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }] }, undefined, undefined, {
			mode: "rpc",
			ui: { multiselect: async () => ["A", "B"] },
		} as any);
		expect(result.details).toEqual({ status: "submitted", answers: [{ id: "q1", status: "answered", response: { kind: "selection", values: ["a", "b"] } }] });
	});

	it("rejects invalid params", async () => {
		let tool: any;
		questionExtension({ registerTool: (entry: unknown) => (tool = entry), events: { emit() {} } } as any);

		await expect(tool.execute("call", { questions: [] }, undefined, undefined, {
			mode: "tui",
		} as any)).rejects.toThrow("questions must contain at least one question.");
	});

	it("returns cancelled when the signal is already aborted", async () => {
		let tool: any;
		questionExtension({ registerTool: (entry: unknown) => (tool = entry), events: { emit() {} } } as any);
		const signal = { aborted: true, reason: new Error("cancelled") };
		const result = await tool.execute("call", { questions: [{ type: "select", question: "Q", options: [{ value: "x", label: "X" }] }] }, signal, undefined, {
			mode: "tui",
		} as any);
		expect(result.details).toEqual({ status: "cancelled", reason: "user" });
	});

	it("throws when the TUI custom factory returns no result", async () => {
		let tool: any;
		questionExtension({ registerTool: (entry: unknown) => (tool = entry), events: { emit() {} } } as any);
		await expect(tool.execute("call", { questions: [{ type: "select", question: "Q", options: [{ value: "x", label: "X" }] }] }, undefined, undefined, {
			mode: "tui",
			ui: { custom: async () => undefined },
		} as any)).rejects.toThrow("Question TUI did not return a result.");
	});

	it("renderCall and renderResult produce summary text", async () => {
		let tool: any;
		questionExtension({ registerTool: (entry: unknown) => (tool = entry), events: { emit() {} } } as any);

		const call = tool.renderCall({ questions: [{ id: "a", label: "Alpha", type: "select", question: "Q", options: [{ value: "x", label: "X" }] }] }, theme);
		expect(call.render(80).join("\n")).toContain("QUESTION");
		expect(call.render(80).join("\n")).toContain("Alpha");

		const result = {
			content: [{ type: "text", text: "waiting" }],
			details: {
				status: "submitted",
				answers: [
					{ id: "a", status: "answered", response: { kind: "selection", values: ["x"] } },
					{ id: "b", status: "skipped" },
					{ id: "c", status: "unanswered" },
				],
			},
		};
		const partial = tool.renderResult(result, { isPartial: true }, theme, {});
		expect(partial.render(80).join("\n")).toContain("waiting");

		const full = tool.renderResult(result, { isPartial: false, expanded: true }, theme, {
			args: { questions: [{ id: "a", label: "Alpha", type: "select", question: "Q", options: [{ value: "x", label: "X" }] }] },
		});
		const fullText = full.render(80).join("\n");
		expect(fullText).toContain("submitted");
		expect(fullText).toContain("1 answered");
		expect(fullText).toContain("X"); // option label from the expanded answer row

		const cancelled = tool.renderResult({ content: [], details: { status: "cancelled", reason: "user" } }, { isPartial: false }, theme, {});
		expect(cancelled.render(80).join("\n")).toContain("question cancelled");
	});

	it("renderResult expanded maps unknown ids to raw values", async () => {
		let tool: any;
		questionExtension({ registerTool: (entry: unknown) => (tool = entry), events: { emit() {} } } as any);
		const result = {
			content: [],
			details: {
				status: "submitted",
				answers: [
					{ id: "q1", status: "answered", response: { kind: "selection", values: ["x"] } },
				],
			},
		};
		const rendered = tool.renderResult(result, { isPartial: false, expanded: true }, theme, { args: { questions: [] } });
		expect(rendered.render(80).join("\n")).toContain("q1");
	});

	it("navigates with Tab/Shift+Tab and skips blank answers", async () => {
		const { component, execution } = await runWizard({
			questions: [
				{ type: "select", question: "One", options: [{ value: "a", label: "A" }] },
				{ type: "select", question: "Two", options: [{ value: "b", label: "B" }] },
			],
		});
		component().handleInput(TAB); // skip q1
		component().handleInput(ENTER); // answer q2
		component().handleInput("\x1b[D"); // left: back to q2 from review
		component().handleInput(SHIFT_TAB); // back to q1
		component().handleInput(ENTER); // answer q1
		component().handleInput(ENTER); // advance to review
		component().handleInput(ENTER); // submit
		const result = await execution;
		expect(result.details).toEqual({
			status: "submitted",
			answers: [
				{ id: "q1", status: "answered", response: { kind: "selection", values: ["a"] } },
				{ id: "q2", status: "answered", response: { kind: "selection", values: ["b"] } },
			],
		});
	});

	it("renders narrow borders and context text", async () => {
		const { component } = await runWizard({
			questions: [
				{ type: "select", question: "Q", context: "Some context", options: [{ value: "a", label: "A" }] },
			],
		});
		const lines = component().render(4);
		expect(lines.length).toBeGreaterThan(0);
		expect(lines.join("\n")).toContain("╭");
		expect(lines.join("\n")).toContain("╰");
	});

	it("restores a previous selection response with otherText", async () => {
		const { component, execution } = await runWizard({
			questions: [
				{ type: "select", question: "Q", options: [{ value: "a", label: "A" }], allowOther: true },
			],
		});
		// Answer with Other, then navigate back and verify the draft is restored.
		component().handleInput(DOWN); // to freeform
		component().handleInput(ENTER); // open other editor
		type(component(), "custom answer");
		component().handleInput(ENTER); // commit + submit (single question)
		const result = await execution;
		expect(result.details).toEqual({
			status: "submitted",
			answers: [{ id: "q1", status: "answered", response: { kind: "selection", values: [], otherText: "custom answer" } }],
		});
	});

	it("review page renders answered, skipped, and unanswered states", async () => {
		const { component, execution } = await runWizard({
			questions: [
				{ type: "select", question: "One", options: [{ value: "a", label: "A" }] },
				{ type: "select", question: "Two", options: [{ value: "b", label: "B" }] },
				{ type: "select", question: "Three", options: [{ value: "c", label: "C" }] },
			],
		});
		component().handleInput(ENTER); // answer q1
		component().handleInput(TAB); // skip q2
		component().handleInput(ENTER); // answer q3 → review
		const lines = component().render(120).join("\n");
		expect(lines).toContain("✓");
		expect(lines).toContain("−");
		expect(lines).toContain("Submit");
		component().handleInput(ENTER); // submit
		const result = await execution;
		expect(result.details.answers).toHaveLength(3);
	});

	it("review page truncates long answer lists", async () => {
		const questions = Array.from({ length: 30 }, (_, i) => ({
			type: "select" as const,
			question: `Question ${i}`,
			options: [{ value: `v${i}`, label: `V${i}` }],
		}));
		const { component, execution } = await runWizard({ questions });
		for (let i = 0; i < 30; i++) {
			component().handleInput(ENTER);
		}
		const lines = component().render(120).join("\n");
		expect(lines).toContain("↑ earlier answers");
		component().handleInput(ENTER); // submit
		const result = await execution;
		expect(result.details.answers).toHaveLength(30);
	});

	it("review page cancels on escape and goes back on left", async () => {
		const { component, execution } = await runWizard({
			questions: [
				{ type: "select", question: "One", options: [{ value: "a", label: "A" }] },
				{ type: "select", question: "Two", options: [{ value: "b", label: "B" }] },
			],
		});
		component().handleInput(ENTER);
		component().handleInput(ENTER); // → review
		component().handleInput(ESC); // cancel
		expect((await execution).details).toEqual({ status: "cancelled", reason: "user" });

		const w2 = await runWizard({
			questions: [
				{ type: "select", question: "One", options: [{ value: "a", label: "A" }] },
				{ type: "select", question: "Two", options: [{ value: "b", label: "B" }] },
			],
		});
		w2.component().handleInput(ENTER);
		w2.component().handleInput(ENTER); // → review
		w2.component().handleInput("\x1b[D"); // left → back to q2
		w2.component().handleInput(ENTER); // commit q2
		w2.component().handleInput(ENTER); // → review
		w2.component().handleInput(ENTER); // submit
		expect((await w2.execution).details.answers).toHaveLength(2);
	});

	it("focused setter propagates to the question component", async () => {
		const { component } = await runWizard({
			questions: [{ type: "select", question: "Q", options: [{ value: "a", label: "A" }] }],
		});
		component().focused = true;
		expect(component().focused).toBe(true);
	});

	it("onUpdate reports waiting for answers", async () => {
		let tool: any;
		let component: any;
		let done!: (value: unknown) => void;
		const updates: any[] = [];
		questionExtension({ registerTool: (entry: unknown) => (tool = entry), events: { emit() {} } } as any);
		const execution = tool.execute("call", { questions: [{ type: "select", question: "Q", options: [{ value: "a", label: "A" }] }] }, undefined, (u: any) => updates.push(u), {
			mode: "tui",
			ui: {
				custom: (factory: (...args: any[]) => unknown) => new Promise((resolve) => {
					done = resolve;
					component = factory(tui, theme, keybindings, done);
				}),
			},
		} as any);
		expect(updates).toHaveLength(1);
		expect(updates[0].content[0].text).toContain("Waiting for answers to 1 question");
		component.handleInput(ENTER);
		await execution;
	});

	it("signal abort during the wizard resolves cancelled", async () => {
		let tool: any;
		let component: any;
		let done!: (value: unknown) => void;
		const controller = new AbortController();
		questionExtension({ registerTool: (entry: unknown) => (tool = entry), events: { emit() {} } } as any);
		const execution = tool.execute("call", { questions: [{ type: "select", question: "Q", options: [{ value: "a", label: "A" }] }] }, controller.signal, undefined, {
			mode: "tui",
			ui: {
				custom: (factory: (...args: any[]) => unknown) => new Promise((resolve) => {
					done = resolve;
					component = factory(tui, theme, keybindings, done);
				}),
			},
		} as any);
		controller.abort();
		const result = await execution;
		expect(result.details).toEqual({ status: "cancelled", reason: "user" });
	});

	it("restores a text response draft when navigating back", async () => {
		const { component, execution } = await runWizard({
			questions: [
				{ type: "text", question: "One" },
				{ type: "select", question: "Two", options: [{ value: "b", label: "B" }] },
			],
		});
		type(component(), "draft answer");
		component().handleInput(ENTER); // commit q1
		component().handleInput(ENTER); // answer q2 → review
		component().handleInput("\x1b[D"); // left → back to q2
		component().handleInput(SHIFT_TAB); // back to q1
		// The text draft should be restored.
		component().handleInput(ENTER); // commit q1 (restored draft)
		component().handleInput(ENTER); // commit q2
		component().handleInput(ENTER); // submit
		const result = await execution;
		expect(result.details.answers[0]).toEqual({ id: "q1", status: "answered", response: { kind: "text", text: "draft answer" } });
	});

	it("restores a selection response with otherText when navigating back", async () => {
		const { component, execution } = await runWizard({
			questions: [
				{ type: "select", question: "One", options: [{ value: "a", label: "A" }], allowOther: true },
				{ type: "select", question: "Two", options: [{ value: "b", label: "B" }] },
			],
		});
		component().handleInput(DOWN); // to freeform
		component().handleInput(ENTER); // open other editor
		type(component(), "custom");
		component().handleInput(ENTER); // commit q1 → q2
		component().handleInput(ENTER); // answer q2 → review
		component().handleInput("\x1b[D"); // left → back to q2
		component().handleInput(SHIFT_TAB); // back to q1
		// The other draft should be restored in the editor.
		component().handleInput(ENTER); // commit q1 (restored other)
		component().handleInput(ENTER); // commit q2
		component().handleInput(ENTER); // submit
		const result = await execution;
		expect(result.details.answers[0]).toEqual({ id: "q1", status: "answered", response: { kind: "selection", values: [], otherText: "custom" } });
	});

	it("focused setter propagates to the review component", async () => {
		const { component } = await runWizard({
			questions: [
				{ type: "select", question: "One", options: [{ value: "a", label: "A" }] },
				{ type: "select", question: "Two", options: [{ value: "b", label: "B" }] },
			],
		});
		component().handleInput(ENTER);
		component().handleInput(ENTER); // → review
		component().focused = true;
		expect(component().focused).toBe(true);
	});

	it("renderResult expanded maps unknown ids to raw values", async () => {
		let tool: any;
		questionExtension({ registerTool: (entry: unknown) => (tool = entry), events: { emit() {} } } as any);
		const result = {
			content: [],
			details: {
				status: "submitted",
				answers: [
					{ id: "q1", status: "answered", response: { kind: "selection", values: ["x"] } },
				],
			},
		};
		const rendered = tool.renderResult(result, { isPartial: false, expanded: true }, theme, { args: { questions: [] } });
		expect(rendered.render(80).join("\n")).toContain("q1");
	});

	it("renderResult expanded maps known ids to labels and Other", async () => {
		let tool: any;
		questionExtension({ registerTool: (entry: unknown) => (tool = entry), events: { emit() {} } } as any);
		const result = {
			content: [],
			details: {
				status: "submitted",
				answers: [
					{ id: "a", status: "answered", response: { kind: "selection", values: ["x"], otherText: "extra" } },
					{ id: "b", status: "skipped" },
					{ id: "c", status: "unanswered" },
				],
			},
		};
		const rendered = tool.renderResult(result, { isPartial: false, expanded: true }, theme, {
			args: { questions: [{ id: "a", label: "Alpha", type: "select", question: "Q", options: [{ value: "x", label: "X" }] }] },
		});
		const text = rendered.render(80).join("\n");
		expect(text).toContain("X"); // option label mapped from the question
		expect(text).toContain("Other: extra");
		expect(text).toContain("skipped");
		expect(text).toContain("unanswered");
	});

	it("renderResult expanded maps unknown option values to raw values", async () => {
		let tool: any;
		questionExtension({ registerTool: (entry: unknown) => (tool = entry), events: { emit() {} } } as any);
		const result = {
			content: [],
			details: {
				status: "submitted",
				answers: [
					{ id: "a", status: "answered", response: { kind: "selection", values: ["unknown-value"] } },
				],
			},
		};
		const rendered = tool.renderResult(result, { isPartial: false, expanded: true }, theme, {
			args: { questions: [{ id: "a", label: "Alpha", type: "select", question: "Q", options: [{ value: "x", label: "X" }] }] },
		});
		expect(rendered.render(80).join("\n")).toContain("unknown-value");
	});

	it("renders wide borders with the full label", async () => {
		const { component } = await runWizard({
			questions: [
				{ type: "select", question: "Q", options: [{ value: "a", label: "A" }] },
			],
		});
		const lines = component().render(120).join("\n");
		expect(lines).toContain("╭─ question");
		expect(lines).toContain("v2");
	});

	it("renders the text editor theme when answering a text question", async () => {
		const { component, execution } = await runWizard({
			questions: [{ type: "text", question: "Type" }],
		});
		// Render the text editor to exercise editorTheme.
		component().render(120);
		type(component(), "answer");
		component().handleInput(ENTER);
		const result = await execution;
		expect(result.details.answers[0].response).toEqual({ kind: "text", text: "answer" });
	});

	it("escape from other mode returns to select and preserves the draft", async () => {
		const { component, execution } = await runWizard({
			questions: [
				{ type: "select", question: "One", options: [{ value: "a", label: "A" }], allowOther: true },
				{ type: "select", question: "Two", options: [{ value: "b", label: "B" }] },
			],
		});
		component().handleInput(DOWN); // to freeform
		component().handleInput(ENTER); // open other editor
		type(component(), "draft");
		component().handleInput(ESC); // escape back to select mode
		component().handleInput("\x0b"); // ctrl+k = vim up to the option row
		component().handleInput(ENTER); // commit q1 (selection)
		component().handleInput(ENTER); // answer q2 → review
		component().handleInput(ENTER); // submit
		const result = await execution;
		expect(result.details.answers[0]).toEqual({ id: "q1", status: "answered", response: { kind: "selection", values: ["a"] } });
	});

	it("reads the review component focused state", async () => {
		const { component } = await runWizard({
			questions: [
				{ type: "select", question: "One", options: [{ value: "a", label: "A" }] },
				{ type: "select", question: "Two", options: [{ value: "b", label: "B" }] },
			],
		});
		component().handleInput(ENTER);
		component().handleInput(ENTER); // → review
		component().focused = true;
		expect(component().focused).toBe(true);
	});

	it("reads the question component focused state", async () => {
		const { component } = await runWizard({
			questions: [{ type: "select", question: "Q", options: [{ value: "a", label: "A" }] }],
		});
		expect(component().focused).toBe(false);
		component().focused = true;
		expect(component().focused).toBe(true);
	});

	it("renderCall handles missing labels and ids", async () => {
		let tool: any;
		questionExtension({ registerTool: (entry: unknown) => (tool = entry), events: { emit() {} } } as any);

		const withId = tool.renderCall({ questions: [{ id: "q1", type: "select", question: "Q", options: [{ value: "a", label: "A" }] }] }, theme);
		expect(withId.render(80).join("\n")).toContain("q1");

		const withIndex = tool.renderCall({ questions: [{ type: "select", question: "Q", options: [{ value: "a", label: "A" }] }] }, theme);
		expect(withIndex.render(80).join("\n")).toContain("Q1");

		const noQuestions = tool.renderCall({}, theme);
		expect(noQuestions.render(80).join("\n")).toContain("0 questions");
	});

	it("renderResult partial with no text content falls back", async () => {
		let tool: any;
		questionExtension({ registerTool: (entry: unknown) => (tool = entry), events: { emit() {} } } as any);
		const rendered = tool.renderResult({ content: [] }, { isPartial: true }, theme, {});
		expect(rendered.render(80).join("\n")).toContain("Waiting for user input");
	});

	it("renderResult non-expanded omits answer details", async () => {
		let tool: any;
		questionExtension({ registerTool: (entry: unknown) => (tool = entry), events: { emit() {} } } as any);
		const result = {
			content: [],
			details: {
				status: "submitted",
				answers: [{ id: "a", status: "answered", response: { kind: "text", text: "x" } }],
			},
		};
		const rendered = tool.renderResult(result, { isPartial: false }, theme, {});
		expect(rendered.render(80).join("\n")).toContain("submitted");
	});

	it("renderResult expanded with text answers uses raw text", async () => {
		let tool: any;
		questionExtension({ registerTool: (entry: unknown) => (tool = entry), events: { emit() {} } } as any);
		const result = {
			content: [],
			details: {
				status: "submitted",
				answers: [{ id: "a", status: "answered", response: { kind: "text", text: "plain text" } }],
			},
		};
		const rendered = tool.renderResult(result, { isPartial: false, expanded: true }, theme, {
			args: { questions: [{ id: "a", label: "Alpha", type: "text", question: "Q" }] },
		});
		expect(rendered.render(80).join("\n")).toContain("plain text");
	});

	it("renderResult expanded with missing question falls back to raw answer", async () => {
		let tool: any;
		questionExtension({ registerTool: (entry: unknown) => (tool = entry), events: { emit() {} } } as any);
		const result = {
			content: [],
			details: {
				status: "submitted",
				answers: [{ id: "a", status: "answered", response: { kind: "selection", values: ["x"] } }],
			},
		};
		const rendered = tool.renderResult(result, { isPartial: false, expanded: true }, theme, { args: {} });
		expect(rendered.render(80).join("\n")).toContain("x");
	});

	it("renderResult expanded matches questions by generated ids", async () => {
		let tool: any;
		questionExtension({ registerTool: (entry: unknown) => (tool = entry), events: { emit() {} } } as any);
		const result = {
			content: [],
			details: {
				status: "submitted",
				answers: [{ id: "q1", status: "answered", response: { kind: "selection", values: ["x"] } }],
			},
		};
		const rendered = tool.renderResult(result, { isPartial: false, expanded: true }, theme, {
			args: { questions: [{ type: "select", question: "Q", options: [{ value: "x", label: "X" }] }] },
		});
		expect(rendered.render(80).join("\n")).toContain("X");
	});

	it("reads the question component focused getter", async () => {
		const { component } = await runWizard({
			questions: [{ type: "select", question: "Q", options: [{ value: "a", label: "A" }] }],
		});
		component().focused = true;
		expect(component().focused).toBe(true);
	});

	it("reads the review component focused getter", async () => {
		const { component } = await runWizard({
			questions: [
				{ type: "select", question: "One", options: [{ value: "a", label: "A" }] },
				{ type: "select", question: "Two", options: [{ value: "b", label: "B" }] },
			],
		});
		component().handleInput(ENTER);
		component().handleInput(ENTER); // → review
		component().focused = true;
		expect(component().focused).toBe(true);
	});

	it("renders the text editor to exercise the editor theme", async () => {
		const { component, execution } = await runWizard({
			questions: [{ type: "text", question: "Type" }],
		});
		// Render at a wide width so the editor renders and uses the theme.
		component().render(120);
		type(component(), "answer");
		component().handleInput(ENTER);
		const result = await execution;
		expect(result.details.answers[0].response).toEqual({ kind: "text", text: "answer" });
	});

	it("re-focuses a blurred text editor with enter", async () => {
		const { component, execution } = await runWizard({
			questions: [{ type: "text", question: "Type" }],
		});
		component().handleInput(ESC); // blur editor
		component().handleInput(ENTER); // re-focus
		type(component(), "typed");
		component().handleInput(ENTER); // commit + submit
		const result = await execution;
		expect(result.details.answers[0].response).toEqual({ kind: "text", text: "typed" });
	});

	it("saveCurrent is a no-op on the review page", async () => {
		const { component, execution } = await runWizard({
			questions: [
				{ type: "select", question: "One", options: [{ value: "a", label: "A" }] },
				{ type: "select", question: "Two", options: [{ value: "b", label: "B" }] },
			],
		});
		component().handleInput(ENTER);
		component().handleInput(ENTER); // → review
		// Tab on the review page does nothing (no crash).
		component().handleInput(TAB);
		component().handleInput(ENTER); // submit
		const result = await execution;
		expect(result.details.answers).toHaveLength(2);
	});

	it("goPrevious from the first question stays put", async () => {
		const { component, execution } = await runWizard({
			questions: [
				{ type: "select", question: "One", options: [{ value: "a", label: "A" }] },
				{ type: "select", question: "Two", options: [{ value: "b", label: "B" }] },
			],
		});
		component().handleInput(SHIFT_TAB); // back from q1 → stays on q1
		component().handleInput(ENTER); // answer q1
		component().handleInput(ENTER); // answer q2 → review
		component().handleInput(ENTER); // submit
		const result = await execution;
		expect(result.details.answers).toHaveLength(2);
	});

	it("commitCurrent from the last question advances to review", async () => {
		const { component, execution } = await runWizard({
			questions: [
				{ type: "select", question: "One", options: [{ value: "a", label: "A" }] },
				{ type: "select", question: "Two", options: [{ value: "b", label: "B" }] },
			],
		});
		component().handleInput(ENTER); // answer q1 → q2
		component().handleInput(ENTER); // answer q2 → review
		component().handleInput(ENTER); // submit
		const result = await execution;
		expect(result.details.answers).toHaveLength(2);
	});

	it("onUpdate reports waiting for multiple questions", async () => {
		let tool: any;
		let component: any;
		let done!: (value: unknown) => void;
		const updates: any[] = [];
		questionExtension({ registerTool: (entry: unknown) => (tool = entry), events: { emit() {} } } as any);
		const execution = tool.execute("call", {
			questions: [
				{ type: "select", question: "Q1", options: [{ value: "a", label: "A" }] },
				{ type: "select", question: "Q2", options: [{ value: "b", label: "B" }] },
			],
		}, undefined, (u: any) => updates.push(u), {
			mode: "tui",
			ui: {
				custom: (factory: (...args: any[]) => unknown) => new Promise((resolve) => {
					done = resolve;
					component = factory(tui, theme, keybindings, done);
				}),
			},
		} as any);
		expect(updates[0].content[0].text).toContain("Waiting for answers to 2 questions");
		component.handleInput(ENTER);
		component.handleInput(ENTER);
		component.handleInput(ENTER);
		await execution;
	});
});
