import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

type RawOption = string | { label: string; description?: string };
type QuestionAnswer = { answer: string; wasCustom: boolean; index?: number };

type QuestionDetails = {
	question: string;
	title?: string;
	options: string[];
	answer: string | null;
	wasCustom?: boolean;
	cancelled?: boolean;
};

type DisplayOption = { label: string; description?: string; custom?: boolean };

const QUESTION_STATUS_KEY = "question";
const BODY_VIEWPORT_LINES = 18;

const OptionSchema = Type.Union([
	Type.String({ description: "Option label" }),
	Type.Object({
		label: Type.String({ description: "Option label shown to the user" }),
		description: Type.Optional(Type.String({ description: "Optional help text shown under the option" })),
	}),
]);

const QuestionParams = Type.Object({
	question: Type.String({ description: "Question to ask the user before continuing" }),
	title: Type.Optional(Type.String({ description: "Short title for the question UI" })),
	options: Type.Optional(Type.Array(OptionSchema, { description: "Optional multiple-choice options. Each option may be a string or { label, description }." })),
	allowFreeform: Type.Optional(Type.Boolean({ description: "Allow a custom freeform answer. Defaults to true when no options are provided, false when options exist." })),
});

function normalizeOptions(options: RawOption[] | undefined): DisplayOption[] {
	return (options ?? [])
		.map((option) => (typeof option === "string" ? { label: option } : { label: option.label, description: option.description }))
		.filter((option) => option.label.trim().length > 0);
}

function oneLine(value: unknown, max = 100): string {
	const text = String(value ?? "").replace(/\s+/g, " ").trim();
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function wrapPlain(value: unknown, width: number): string[] {
	const maxWidth = Math.max(1, width);
	const paragraphs = String(value ?? "").split(/\r?\n/);
	const lines: string[] = [];

	for (const paragraph of paragraphs) {
		const words = paragraph.trim().split(/\s+/).filter(Boolean);
		if (words.length === 0) {
			lines.push("");
			continue;
		}

		let current = "";
		for (const word of words) {
			if (!current) {
				current = word;
			} else if (visibleWidth(`${current} ${word}`) <= maxWidth) {
				current += ` ${word}`;
			} else {
				lines.push(...breakLongWord(current, maxWidth));
				current = word;
			}
		}
		if (current) lines.push(...breakLongWord(current, maxWidth));
	}

	return lines.length ? lines : [""];
}

function breakLongWord(word: string, width: number): string[] {
	if (visibleWidth(word) <= width) return [word];
	const out: string[] = [];
	let line = "";
	for (const char of word) {
		if (line && visibleWidth(line + char) > width) {
			out.push(line);
			line = char;
		} else {
			line += char;
		}
	}
	if (line) out.push(line);
	return out;
}

function isPageUp(data: string): boolean {
	return data === "\u001b[5~";
}

function isPageDown(data: string): boolean {
	return data === "\u001b[6~";
}

async function askQuestion(ctx: any, params: { question: string; title?: string; options?: RawOption[]; allowFreeform?: boolean }, signal?: AbortSignal) {
	const options = normalizeOptions(params.options);
	const allowFreeform = params.allowFreeform ?? options.length === 0;
	if (!allowFreeform && options.length === 0) throw new Error("Question options are empty and allowFreeform is false.");

	const choices: DisplayOption[] = [...options];
	if (allowFreeform) choices.push({ label: options.length ? "Type custom answer" : "Answer", custom: true });

	return ctx.ui.custom<QuestionAnswer | null>(
		(tui: any, theme: any, _keybindings: any, done: (value: QuestionAnswer | null) => void) => {
			let selected = 0;
			let editMode = allowFreeform && options.length === 0;
			let scrollOffset = 0;
			let scrollToSelection = true;
			let cachedLines: string[] | undefined;
			let settled = false;
			let removeAbortListener = () => {};

			function finish(value: QuestionAnswer | null) {
				if (settled) return;
				settled = true;
				removeAbortListener();
				done(value);
			}

			if (signal) {
				const abort = () => finish(null);
				if (signal.aborted) {
					finish(null);
				} else {
					signal.addEventListener("abort", abort, { once: true });
					removeAbortListener = () => signal.removeEventListener("abort", abort);
				}
			}

			const editorTheme: EditorTheme = {
				borderColor: (s) => theme.fg("accent", s),
				selectList: {
					selectedPrefix: (s) => theme.fg("accent", s),
					selectedText: (s) => theme.fg("accent", s),
					description: (s) => theme.fg("muted", s),
					scrollInfo: (s) => theme.fg("dim", s),
					noMatch: (s) => theme.fg("warning", s),
				},
			};
			const editor = new Editor(tui, editorTheme);

			editor.onSubmit = (value) => {
				const answer = value.trim();
				if (!answer) return refresh();
				finish({ answer, wasCustom: true });
			};

			function refresh() {
				cachedLines = undefined;
				tui.requestRender();
			}

			function startCustom() {
				editMode = true;
				editor.setText("");
				refresh();
			}

			function handleInput(data: string): void {
				if (isPageUp(data)) {
					scrollOffset = Math.max(0, scrollOffset - BODY_VIEWPORT_LINES);
					scrollToSelection = false;
					return refresh();
				}
				if (isPageDown(data)) {
					scrollOffset += BODY_VIEWPORT_LINES;
					scrollToSelection = false;
					return refresh();
				}

				if (editMode) {
					if (matchesKey(data, Key.escape)) {
						if (options.length === 0) return finish(null);
						editMode = false;
						editor.setText("");
						return refresh();
					}
					editor.handleInput(data);
					return refresh();
				}

				if (matchesKey(data, Key.escape)) return finish(null);
				if (matchesKey(data, Key.up) || data === "k") {
					selected = Math.max(0, selected - 1);
					scrollToSelection = true;
					return refresh();
				}
				if (matchesKey(data, Key.down) || data === "j") {
					selected = Math.min(choices.length - 1, selected + 1);
					scrollToSelection = true;
					return refresh();
				}

				const digit = data >= "1" && data <= "9" ? Number(data) - 1 : -1;
				if (digit >= 0 && digit < choices.length) {
					selected = digit;
					const choice = choices[selected];
					if (choice.custom) return startCustom();
					return finish({ answer: choice.label, wasCustom: false, index: selected + 1 });
				}

				if (matchesKey(data, Key.enter)) {
					const choice = choices[selected];
					if (!choice) return;
					if (choice.custom) return startCustom();
					return finish({ answer: choice.label, wasCustom: false, index: selected + 1 });
				}
			}

			function render(width: number): string[] {
				if (cachedLines) return cachedLines;
				const lines: string[] = [];
				const body: string[] = [];
				const optionLineStarts: number[] = [];
				const addLine = (target: string[], line = "") => target.push(truncateToWidth(line, width));
				const addBody = (line = "") => addLine(body, line);
				const title = params.title || "Question";

				addLine(lines, theme.fg("accent", `─ ${title} ${"─".repeat(Math.max(0, width - title.length - 3))}`));
				for (const line of wrapPlain(params.question, Math.max(10, width - 2))) {
					addBody(` ${theme.fg("text", line)}`);
				}
				addBody("");

				if (options.length > 0) {
					for (let i = 0; i < choices.length; i++) {
						const choice = choices[i];
						const active = i === selected;
						const prefix = active ? theme.fg("accent", "> ") : "  ";
						const label = choice.custom && editMode ? `${choice.label} ✎` : choice.label;
						optionLineStarts[i] = body.length;
						const optionColor = active ? "accent" : "text";
						const optionLines = wrapPlain(`${i + 1}. ${label}`, Math.max(10, width - 2));
						optionLines.forEach((optionLine, lineIndex) => {
							addBody((lineIndex === 0 ? prefix : "  ") + theme.fg(optionColor, optionLine));
						});
						if (choice.description) {
							for (const descLine of wrapPlain(choice.description, Math.max(10, width - 5))) {
								addBody(`     ${theme.fg("muted", descLine)}`);
							}
						}
					}
					addBody("");
				}

				const maxScroll = Math.max(0, body.length - BODY_VIEWPORT_LINES);
				if (scrollToSelection && optionLineStarts[selected] !== undefined) {
					const selectedLine = optionLineStarts[selected];
					if (selectedLine < scrollOffset) scrollOffset = selectedLine;
					if (selectedLine >= scrollOffset + BODY_VIEWPORT_LINES) scrollOffset = selectedLine - BODY_VIEWPORT_LINES + 1;
				}
				scrollOffset = Math.min(Math.max(0, scrollOffset), maxScroll);

				if (scrollOffset > 0) addLine(lines, theme.fg("dim", `↑ ${scrollOffset} line${scrollOffset === 1 ? "" : "s"} above`));
				for (const bodyLine of body.slice(scrollOffset, scrollOffset + BODY_VIEWPORT_LINES)) addLine(lines, bodyLine);
				if (scrollOffset < maxScroll) addLine(lines, theme.fg("dim", `↓ ${maxScroll - scrollOffset} more line${maxScroll - scrollOffset === 1 ? "" : "s"}`));

				if (editMode) {
					addLine(lines, theme.fg("muted", " Your answer:"));
					for (const line of editor.render(Math.max(20, width - 2))) addLine(lines, ` ${line}`);
					addLine(lines, "");
					addLine(lines, theme.fg("dim", options.length ? " Enter submit • Esc back • PgUp/PgDn scroll" : " Enter submit • Esc cancel • PgUp/PgDn scroll"));
				} else {
					addLine(lines, theme.fg("dim", " ↑↓/j/k move • PgUp/PgDn scroll • 1-9 pick • Enter select • Esc cancel"));
				}
				addLine(lines, theme.fg("accent", "─".repeat(width)));

				cachedLines = lines;
				return lines;
			}

			return { render, handleInput, invalidate: () => (cachedLines = undefined), dispose: removeAbortListener };
		},
		{
			overlay: true,
			overlayOptions: { anchor: "center", width: "80%", minWidth: 50, maxHeight: "80%", margin: 1 },
		},
	);
}

export default function questionExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "question",
		label: "Question",
		description: "Ask the user a question in the Pi UI and return the answer. Supports multiple-choice options and freeform answers.",
		promptSnippet: "Ask the user a question when required information is missing.",
		promptGuidelines: [
			"Use question only when you cannot proceed safely or accurately without user input.",
			"Ask concise questions. Prefer options when choices are known.",
			"Set allowFreeform=true when user may need to provide a custom answer.",
			"After the user answers, continue the task immediately using that answer; do not stop and ask the user to type continue unless the task is complete.",
			"Do not use question for information you can infer, inspect, or compute with other tools.",
		],
		parameters: QuestionParams,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const options = normalizeOptions(params.options as RawOption[] | undefined);
			const detailsBase = { question: params.question, title: params.title, options: options.map((o) => o.label) };

			if (signal?.aborted) throw new Error("Question cancelled");
			if (!ctx.hasUI) {
				throw new Error("Question tool requires interactive UI; ask user directly or run Pi with UI/RPC support.");
			}

			const title = params.title ? `${params.title}: ` : "";
			ctx.ui.setStatus(QUESTION_STATUS_KEY, ctx.ui.theme.fg("warning", `❓ waiting: ${oneLine(title + params.question, 48)}`));
			ctx.ui.notify(`❓ Question: ${oneLine(title + params.question, 140)}`, "info");

			try {
				const result = await askQuestion(ctx, params as { question: string; title?: string; options?: RawOption[]; allowFreeform?: boolean }, signal);
				if (signal?.aborted) throw new Error("Question cancelled");
				if (!result) {
					ctx.ui.setStatus(QUESTION_STATUS_KEY, ctx.ui.theme.fg("warning", "❓ question cancelled"));
					throw new Error("Question cancelled by user");
				}

				const prefix = result.wasCustom ? "User answered" : result.index ? `User selected ${result.index}` : "User selected";
				ctx.ui.setStatus(QUESTION_STATUS_KEY, ctx.ui.theme.fg("success", "✓ question answered"));
				return {
					content: [{ type: "text", text: `${prefix}: ${result.answer}` }],
					details: { ...detailsBase, answer: result.answer, wasCustom: result.wasCustom, cancelled: false } satisfies QuestionDetails,
				};
			} catch (error) {
				ctx.ui.setStatus(QUESTION_STATUS_KEY, ctx.ui.theme.fg("warning", "❓ question failed"));
				throw error;
			}
		},

		renderCall(args, theme) {
			const title = args.title ? `${args.title}: ` : "";
			const optionCount = Array.isArray(args.options) ? args.options.length : 0;
			const suffix = optionCount ? theme.fg("dim", ` · ${optionCount} option${optionCount === 1 ? "" : "s"}`) : theme.fg("dim", " · freeform");
			return new Text(`${theme.fg("warning", "❓ ")}${theme.fg("toolTitle", theme.bold("QUESTION"))} ${theme.fg("accent", oneLine(title + args.question, 120))}${suffix}`, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as QuestionDetails | undefined;
			if (details?.cancelled) return new Text(theme.fg("warning", "question cancelled"), 0, 0);
			if (details?.answer) return new Text(`${theme.fg("success", "✓ answer")} ${theme.fg("accent", oneLine(details.answer, 120))}`, 0, 0);
			const text = result.content?.find((part: any) => part?.type === "text")?.text ?? "";
			return new Text(text, 0, 0);
		},
	});
}
