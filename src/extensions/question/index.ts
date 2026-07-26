// Question extension entry point.
// Owns: QuestionComponent (mode-switching + editor lifecycle + box borders),
// tool registration, execute() orchestration via UIProtocol.

import type { ExtensionAPI, KeybindingsManager, Theme } from "@selesai/code";
import {
	Container,
	type Component,
	Editor,
	type EditorTheme,
	Key,
	Markdown,
	matchesKey,
	Spacer,
	Text,
	type TUI,
	truncateToWidth,
} from "@earendil-works/pi-tui";

import { prepareBatchQuestions } from "./batch.ts";
import { BOX_BORDER_LEFT, BOX_BORDER_OVERHEAD, BOX_BORDER_RIGHT, QUESTION_VERSION } from "./constants.ts";
import { askBatchViaDialogs, DialogFallback } from "./dialog-adapter.ts";
import { createFreeformResponse, createSelectionResponse, formatOptionsForMessage, formatResponseSummary, getOptionsFormatError, normalizeOptions, oneLine, safeMarkdownTheme } from "./helpers.ts";
import { QuestionList } from "./question-list.ts";
import { MultiSelect, SingleSelect } from "./selection-mode.ts";
import { resolveShortcuts } from "./shortcuts.ts";
import { QuestionParamsSchema } from "./schemas.ts";
import type { BatchAnswer, BatchQuestionDetails, BatchedQuestion, QuestionDetails, QuestionMode, QuestionOption, QuestionResponse, RawOption, ResolvedShortcuts } from "./types.ts";
import { createTUIProtocol } from "./tui-adapter.ts";
import type { CustomFactory, UIProtocol } from "./ui-protocol.ts";

// ---------------------------------------------------------------------------
// Box borders (manual ANSI components, self-contained)
// ---------------------------------------------------------------------------

class BoxBorderTop implements Component {
	constructor(
		private color: (s: string) => string,
		private title?: string,
		private titleColor?: (s: string) => string,
	) {}
	invalidate(): void {}
	render(width: number): string[] {
		const inner = Math.max(0, width - 2);
		if (!this.title || inner < this.title.length + 4) {
			return [this.color(`╭${"─".repeat(inner)}╮`)];
		}
		const label = ` ${this.title} `;
		const remaining = inner - 1 - label.length;
		const titleStyle = this.titleColor ?? this.color;
		return [this.color("╭─") + titleStyle(label) + this.color("─".repeat(Math.max(0, remaining)) + "╮")];
	}
}

class BoxBorderBottom implements Component {
	constructor(
		private color: (s: string) => string,
		private label?: string,
		private labelColor?: (s: string) => string,
	) {}
	invalidate(): void {}
	render(width: number): string[] {
		const inner = Math.max(0, width - 2);
		if (!this.label || inner < this.label.length + 4) {
			return [this.color(`╰${"─".repeat(inner)}╯`)];
		}
		const tag = ` ${this.label} `;
		const leftDashes = inner - tag.length - 1;
		const style = this.labelColor ?? this.color;
		return [this.color("╰" + "─".repeat(Math.max(0, leftDashes))) + style(tag) + this.color("─╯")];
	}
}

function createEditorTheme(theme: Theme): EditorTheme {
	return {
		borderColor: (s) => theme.fg("accent", s),
		selectList: {
			selectedPrefix: (t) => theme.fg("accent", t),
			selectedText: (t) => theme.fg("accent", t),
			description: (t) => theme.fg("muted", t),
			scrollInfo: (t) => theme.fg("dim", t),
			noMatch: (t) => theme.fg("warning", t),
		},
	};
}

// ---------------------------------------------------------------------------
// Question component (Container-based layout)
// ---------------------------------------------------------------------------

class QuestionComponent extends Container implements Component {
	private mode: QuestionMode = "select";
	private pendingSelections: string[] = [];
	private freeformDraft = "";
	private commentDraft = "";

	private titleText: Text;
	private questionText: Text;
	private contextComponent?: Component;
	private modeContainer: Container;
	private helpText: Text;

	private list?: QuestionList;
	private editor?: Editor;

	private _focused = false;

	constructor(
		private question: string,
		private context: string | undefined,
		private options: QuestionOption[],
		private allowMultiple: boolean,
		private allowFreeform: boolean,
		private allowComment: boolean,
		private tui: TUI,
		private theme: Theme,
		private keybindings: KeybindingsManager,
		private shortcuts: ResolvedShortcuts,
		private onDone: (result: QuestionResponse | null) => void,
	) {
		super();

		this.addChild(
			new BoxBorderTop(
				(s: string) => theme.fg("accent", s),
				"question",
				(s: string) => theme.fg("dim", theme.bold(s)),
			),
		);
		this.addChild(new Spacer(1));

		this.titleText = new Text("", 1, 0);
		this.addChild(this.titleText);
		this.addChild(new Spacer(1));

		this.questionText = new Text("", 1, 0);
		this.addChild(this.questionText);

		if (this.context) {
			this.addChild(new Spacer(1));
			const mdTheme = safeMarkdownTheme();
			if (mdTheme) {
				this.contextComponent = new Markdown(`**Context:**\n${this.context}`, 1, 0, mdTheme);
			} else {
				this.contextComponent = new Text(`${theme.fg("accent", theme.bold("Context:"))}\n${theme.fg("dim", this.context)}`, 1, 0);
			}
			this.addChild(this.contextComponent);
		}

		this.addChild(new Spacer(1));

		this.modeContainer = new Container();
		this.addChild(this.modeContainer);

		this.addChild(new Spacer(1));
		this.helpText = new Text("", 1, 0);
		this.addChild(this.helpText);

		this.addChild(new Spacer(1));
		this.addChild(new BoxBorderBottom((s: string) => theme.fg("accent", s), `v${QUESTION_VERSION}`, (s: string) => theme.fg("dim", s)));

		this.updateStaticText();
		this.showSelectMode();
	}

	get focused(): boolean {
		return this._focused;
	}

	get isEditing(): boolean {
		return this.mode === "freeform" || this.mode === "comment";
	}
	set focused(value: boolean) {
		this._focused = value;
		if (this.editor && (this.mode === "freeform" || this.mode === "comment")) {
			(this.editor as any).focused = value;
		}
	}

	override invalidate(): void {
		super.invalidate();
		this.updateStaticText();
		this.updateHelpText();
	}

	override render(width: number): string[] {
		const innerWidth = Math.max(1, width - BOX_BORDER_OVERHEAD);
		const rawLines = super.render(innerWidth);
		const borderColor = (s: string) => this.theme.fg("accent", s);
		const titleColor = (s: string) => this.theme.fg("dim", this.theme.bold(s));
		return rawLines.map((line, index) => {
			if (index === 0) return new BoxBorderTop(borderColor, "question", titleColor).render(width)[0];
			if (index === rawLines.length - 1)
				return new BoxBorderBottom(borderColor, `v${QUESTION_VERSION}`, (s: string) => this.theme.fg("dim", s)).render(width)[0];
			const padded = truncateToWidth(line, innerWidth, "", true);
			return `${borderColor(BOX_BORDER_LEFT)}${padded}${borderColor(BOX_BORDER_RIGHT)}`;
		});
	}

	private updateStaticText(): void {
		const theme = this.theme;
		const title = this.mode === "comment" ? "Optional comment" : "Question";
		this.titleText.setText(theme.fg("accent", theme.bold(title)));
		this.questionText.setText(theme.fg("text", theme.bold(this.question)));
		if (this.contextComponent && this.context) {
			const mdTheme = safeMarkdownTheme();
			if (mdTheme && this.contextComponent instanceof Markdown) {
				(this.contextComponent as Markdown).setText(`**Context:**\n${this.context}`);
			} else {
				(this.contextComponent as Text).setText(`${theme.fg("accent", theme.bold("Context:"))}\n${theme.fg("dim", this.context)}`);
			}
		}
	}

	private updateHelpText(): void {
		const theme = this.theme;
		const kb = this.keybindings;
		const commentHint =
			this.allowComment && !this.shortcuts.commentToggle.disabled
				? `${theme.fg("dim", this.shortcuts.commentToggle.spec)}${theme.fg("muted", " toggle context")}`
				: null;

		if (this.mode === "freeform" || this.mode === "comment") {
			const hints = [
				`${theme.fg("dim", kb.getKeys("tui.input.submit").join("/"))}${theme.fg("muted", this.mode === "comment" ? " submit/skip" : " submit")}`,
				`${theme.fg("dim", kb.getKeys("tui.input.newLine").join("/"))}${theme.fg("muted", " newline")}`,
				`${theme.fg("dim", "esc")}${theme.fg("muted", " back")}`,
			]
				.filter((h): h is string => !!h)
				.join(" • ");
			this.helpText.setText(theme.fg("dim", hints));
			return;
		}

		if (this.allowMultiple) {
			const hints = [
				`${theme.fg("dim", "↑↓")}${theme.fg("muted", " navigate")}`,
				`${theme.fg("dim", "space")}${theme.fg("muted", " toggle")}`,
				commentHint,
				`${theme.fg("dim", kb.getKeys("tui.select.confirm").join("/"))}${theme.fg("muted", " submit")}`,
				`${theme.fg("dim", kb.getKeys("tui.select.cancel").join("/"))}${theme.fg("muted", " cancel")}`,
			]
				.filter((h): h is string => !!h)
				.join(" • ");
			this.helpText.setText(theme.fg("dim", hints));
		} else {
			const hints = [
				`${theme.fg("dim", "type")}${theme.fg("muted", " filter")}`,
				`${theme.fg("dim", kb.getKeys("tui.editor.deleteCharBackward").join("/"))}${theme.fg("muted", " erase")}`,
				`${theme.fg("dim", "↑↓")}${theme.fg("muted", " navigate")}`,
				commentHint,
				`${theme.fg("dim", kb.getKeys("tui.select.confirm").join("/"))}${theme.fg("muted", " select")}`,
				`${theme.fg("dim", "esc")}${theme.fg("muted", " clear/cancel")}`,
			]
				.filter((h): h is string => !!h)
				.join(" • ");
			this.helpText.setText(theme.fg("dim", hints));
		}
	}

	private ensureList(): QuestionList {
		if (this.list) return this.list;
		const list = new QuestionList(
			this.options,
			this.allowMultiple ? MultiSelect : SingleSelect,
			this.allowFreeform,
			this.allowComment,
			this.theme,
			this.keybindings,
			this.shortcuts.commentToggle,
		);
		list.onSubmit = (selections, commentEnabled) => this.handleSelectionSubmit(selections, commentEnabled);
		list.onCancel = () => this.onDone(null);
		list.onEnterFreeform = () => this.showFreeformMode();
		this.list = list;
		return list;
	}

	private ensureEditor(): Editor {
		if (this.editor) return this.editor;
		const editor = new Editor(this.tui, createEditorTheme(this.theme));
		editor.onSubmit = (text: string) => this.handleEditorSubmit(text);
		this.editor = editor;
		return editor;
	}

	private handleSelectionSubmit(selections: string[], wantsComment: boolean): void {
		if (this.allowComment && wantsComment) {
			this.pendingSelections = selections;
			this.commentDraft = "";
			this.showCommentMode();
			return;
		}
		this.onDone(createSelectionResponse(selections) ?? null);
	}

	private handleEditorSubmit(text: string): void {
		if (this.mode === "freeform") {
			const r = createFreeformResponse(text);
			this.onDone(r ?? null);
			return;
		}
		if (this.mode === "comment") {
			this.commentDraft = text;
			this.onDone(createSelectionResponse(this.pendingSelections, text) ?? null);
		}
	}

	private showSelectMode(): void {
		this.mode = "select";
		this.pendingSelections = [];
		this.modeContainer.clear();
		this.modeContainer.addChild(this.ensureList());
		this.updateHelpText();
		this.invalidate();
		this.tui.requestRender();
	}

	private showFreeformMode(): void {
		this.mode = "freeform";
		this.modeContainer.clear();
		const editor = this.ensureEditor();
		(editor as any).setText?.(this.freeformDraft);
		(editor as any).focused = this._focused;
		this.modeContainer.addChild(new Text(this.theme.fg("accent", this.theme.bold("Custom response")), 1, 0));
		this.modeContainer.addChild(new Spacer(1));
		this.modeContainer.addChild(editor);
		this.updateHelpText();
		this.invalidate();
		this.tui.requestRender();
	}

	private showCommentMode(): void {
		this.mode = "comment";
		this.modeContainer.clear();
		const editor = this.ensureEditor();
		(editor as any).setText?.(this.commentDraft);
		(editor as any).focused = this._focused;
		const label = this.pendingSelections.length === 1 ? "Selected option:" : "Selected options:";
		this.modeContainer.addChild(new Text(this.theme.fg("accent", this.theme.bold(label)), 1, 0));
		this.modeContainer.addChild(new Text(this.theme.fg("text", this.pendingSelections.join(", ")), 1, 0));
		this.modeContainer.addChild(new Spacer(1));
		this.modeContainer.addChild(editor);
		this.updateHelpText();
		this.invalidate();
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		if (this.mode === "freeform" || this.mode === "comment") {
			if (matchesKey(data, Key.escape)) {
				this.showSelectMode();
				return;
			}
			if (this.keybindings.matches(data, "tui.select.cancel")) {
				this.onDone(null);
				return;
			}
			this.ensureEditor().handleInput(data);
			this.tui.requestRender();
			return;
		}
		this.ensureList().handleInput(data);
		this.tui.requestRender();
	}
}

// ---------------------------------------------------------------------------
// Batched-question component
// ---------------------------------------------------------------------------

class BatchQuestionComponent extends Container implements Component {
	private currentPage = 0;
	private readonly answers = new Map<string, QuestionResponse>();
	private questionComponent?: QuestionComponent;
	private focusedState = false;
	private header = new Text("", 1, 0);
	private content = new Container();
	private legend = new Text("", 1, 0);

	constructor(
		private questions: BatchedQuestion[],
		private tui: TUI,
		private theme: Theme,
		private keybindings: KeybindingsManager,
		private onDone: (answers: BatchAnswer[] | null) => void,
	) {
		super();
		this.addChild(this.header);
		this.addChild(new Spacer(1));
		this.addChild(this.content);
		this.addChild(new Spacer(1));
		this.addChild(this.legend);
		this.showPage();
	}

	get focused(): boolean {
		return this.focusedState;
	}
	set focused(value: boolean) {
		this.focusedState = value;
		if (this.questionComponent) this.questionComponent.focused = value;
	}

	override invalidate(): void {
		super.invalidate();
		this.updateChrome();
	}

	private get isReviewPage(): boolean {
		return this.currentPage === this.questions.length;
	}

	private allAnswered(): boolean {
		return this.questions.every((question) => this.answers.has(question.id));
	}

	private updateChrome(): void {
		const answered = this.answers.size;
		if (this.isReviewPage) {
			this.header.setText(this.theme.fg("accent", this.theme.bold(`Review answers · ${answered}/${this.questions.length} answered`)));
			this.legend.setText(
				this.theme.fg(
					"dim",
					this.allAnswered()
						? "Shift+Tab/← previous • Enter submit all answers • Esc cancel"
						: "Shift+Tab/← previous • Answer every question before submitting • Esc cancel",
				),
			);
			return;
		}
		const question = this.questions[this.currentPage];
		this.header.setText(
			this.theme.fg(
				"accent",
				this.theme.bold(`${question.label} · ${this.currentPage + 1}/${this.questions.length}${this.answers.has(question.id) ? " · answered" : ""}`),
			),
		);
		this.legend.setText(this.theme.fg("dim", "Tab next • Shift+Tab previous • ←→ navigate outside text entry • Answers save when selected"));
	}

	private showPage(): void {
		this.content.clear();
		this.questionComponent = undefined;
		this.updateChrome();

		if (this.isReviewPage) {
			this.content.addChild(new Text(this.theme.fg("accent", this.theme.bold("Ready to submit")), 1, 0));
			this.content.addChild(new Spacer(1));
			for (const question of this.questions) {
				const response = this.answers.get(question.id);
				const marker = response ? this.theme.fg("success", "✓") : this.theme.fg("warning", "○");
				const answer = response ? formatResponseSummary(response) : "Unanswered";
				this.content.addChild(new Text(`${marker} ${this.theme.fg("accent", question.label)} ${this.theme.fg("dim", "—")} ${this.theme.fg(response ? "text" : "warning", answer)}`, 1, 0));
			}
		} else {
			const question = this.questions[this.currentPage];
			this.questionComponent = new QuestionComponent(
				question.question,
				question.context,
				question.options,
				question.allowMultiple,
				question.allowFreeform,
				question.allowComment,
				this.tui,
				this.theme,
				this.keybindings,
				question.shortcuts,
				(response) => this.saveAnswer(question, response),
			);
			this.questionComponent.focused = this.focusedState;
			this.content.addChild(this.questionComponent);
		}
		this.invalidate();
		this.tui.requestRender();
	}

	private saveAnswer(question: BatchedQuestion, response: QuestionResponse | null): void {
		if (response === null) {
			this.onDone(null);
			return;
		}
		this.answers.set(question.id, response);
		this.goNext();
	}

	private goNext(): void {
		if (this.currentPage < this.questions.length) this.currentPage++;
		this.showPage();
	}

	private goPrevious(): void {
		if (this.currentPage > 0) this.currentPage--;
		this.showPage();
	}

	handleInput(data: string): void {
		if (this.isReviewPage) {
			if (matchesKey(data, Key.enter) && this.allAnswered()) {
				this.onDone(this.questions.map((question) => ({ id: question.id, question: question.question, response: this.answers.get(question.id)! })));
				return;
			}
			if (matchesKey(data, Key.escape) || this.keybindings.matches(data, "tui.select.cancel")) {
				this.onDone(null);
				return;
			}
			if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) this.goPrevious();
			return;
		}

		if (matchesKey(data, Key.tab)) {
			this.goNext();
			return;
		}
		if (matchesKey(data, Key.shift("tab"))) {
			this.goPrevious();
			return;
		}
		if (!this.questionComponent?.isEditing) {
			if (matchesKey(data, Key.right)) {
				this.goNext();
				return;
			}
			if (matchesKey(data, Key.left)) {
				this.goPrevious();
				return;
			}
		}
		this.questionComponent?.handleInput(data);
	}
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export default function questionExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "question",
		label: "Question",
		description:
			"Ask the user one question or a paged batch through the Pi UI and return the answer(s). Supports multiple-choice options, multi-select, freeform answers, optional context, comments, and a final batch review/submit page. Use when you need user input to proceed.",
		promptSnippet: "Ask the user a question when required information is missing.",
		promptGuidelines: [
			"Use question only when you cannot proceed safely or accurately without user input.",
			"Ask concise questions. Prefer options when choices are known.",
			"Set allowFreeform=true when user may need to provide a custom answer.",
			"Use allowMultiple=true when more than one option may apply.",
			"Pass a short summary via context when the question depends on prior findings.",
			"After the user answers, continue the task immediately using that answer; do not stop and ask the user to type continue unless the task is complete.",
			"Do not use question for information you can infer, inspect, or compute with other tools.",
			"For independent related decisions, send one question call with a questions array. The user can use Tab/Shift+Tab or Left/Right to revisit pages, then presses Enter on the review page to submit all answers.",
		],
		// Block other tool calls in the same turn until the user answers, so the
		// model can't batch question with side-effecting tools and run them first.
		executionMode: "sequential",
		parameters: QuestionParamsSchema,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (Array.isArray(params.questions)) {
				const prepared = prepareBatchQuestions(params.questions);
				if ("error" in prepared) {
					return { content: [{ type: "text", text: prepared.error }], isError: true, details: { questions: [], answers: [], cancelled: true } satisfies BatchQuestionDetails };
				}
				const questions = prepared.questions;
				const detailsBase = {
					questions: questions.map(({ id, label, question, context, options }) => ({ id, label, question, context, options })),
				};
				if (signal?.aborted) {
					return { content: [{ type: "text", text: "Question batch cancelled" }], details: { ...detailsBase, answers: [], cancelled: true } satisfies BatchQuestionDetails };
				}

				const protocol = createTUIProtocol(ctx);
				if (!protocol.hasUI) {
					return {
						content: [{ type: "text", text: "Question batch requires interactive mode." }],
						isError: true,
						details: { ...detailsBase, answers: [], cancelled: true } satisfies BatchQuestionDetails,
					};
				}
				onUpdate?.({ content: [{ type: "text", text: "Waiting for answers to question batch..." }], details: { ...detailsBase, answers: [], cancelled: false } satisfies BatchQuestionDetails });

				let answers: BatchAnswer[] | null | undefined;
				try {
					const customFactory: CustomFactory<BatchAnswer[] | null> = (tui, theme, keybindings, done) => {
						if (signal) signal.addEventListener("abort", () => done(null), { once: true });
						const timeout = params.timeout as number | undefined;
						if (timeout && timeout > 0) setTimeout(() => done(null), timeout);
						return new BatchQuestionComponent(questions, tui, theme, keybindings, done);
					};
					answers = await protocol.custom(customFactory);
					if (answers === undefined) answers = await askBatchViaDialogs(questions, protocol, params.timeout as number | undefined);
				} catch (error) {
					const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
					return { content: [{ type: "text", text: `Question batch failed: ${message}` }], isError: true, details: { ...detailsBase, answers: [], cancelled: true } satisfies BatchQuestionDetails };
				}

				if (!answers) {
					return { content: [{ type: "text", text: "User cancelled the question batch" }], details: { ...detailsBase, answers: [], cancelled: true } satisfies BatchQuestionDetails };
				}
				return {
					content: [{ type: "text", text: answers.map((answer) => `${answer.id}: ${formatResponseSummary(answer.response)}`).join("\n") }],
					details: { ...detailsBase, answers, cancelled: false } satisfies BatchQuestionDetails,
				};
			}

			if (signal?.aborted) {
				return {
					content: [{ type: "text", text: "Question cancelled" }],
					details: { question: params.question, options: [], response: null, cancelled: true } satisfies QuestionDetails,
				};
			}

			const rawQuestion = params.question as string;
			// `title` is a deprecated alias for context; merge if only title is given.
			const rawContext = (params.context as string | undefined)?.trim() || (params.title as string | undefined)?.trim() || undefined;
			const allowMultiple = params.allowMultiple ?? false;
			const allowFreeform = params.allowFreeform ?? !((params.options ?? []).length > 0);
			const allowComment = params.allowComment ?? false;
			const timeout = params.timeout as number | undefined;

			const shortcuts: ResolvedShortcuts = resolveShortcuts(
				params.commentToggleKey as string | null | undefined,
				process.env.PI_QUESTION_COMMENT_TOGGLE_KEY,
			);

			const optionsFormatError = getOptionsFormatError(params.options as RawOption[] | undefined);
			if (optionsFormatError) {
				return {
					content: [{ type: "text", text: optionsFormatError }],
					isError: true,
					details: { question: rawQuestion, context: rawContext, options: [], response: null, cancelled: true } satisfies QuestionDetails,
				};
			}

			const options = normalizeOptions(params.options as RawOption[] | undefined);
			const normalizedContext = rawContext || undefined;
			const detailsBase = { question: rawQuestion, context: normalizedContext, options };

			const protocol: UIProtocol = createTUIProtocol(ctx);

			if (!protocol.hasUI) {
				const optionText = options.length > 0 ? `\n\nOptions:\n${formatOptionsForMessage(options)}` : "";
				const freeformHint = allowFreeform ? "\n\nYou can also answer freely." : "";
				const commentHint = allowComment ? "\n\nAfter choosing, you may add an optional comment." : "";
				const contextText = normalizedContext ? `\n\nContext:\n${normalizedContext}` : "";
				return {
					content: [
						{ type: "text", text: `Question requires interactive mode. Please answer:\n\n${rawQuestion}${contextText}${optionText}${freeformHint}${commentHint}` },
					],
					isError: true,
					details: { ...detailsBase, response: null, cancelled: true } satisfies QuestionDetails,
				};
			}

			if (options.length === 0 && !allowFreeform) {
				return {
					content: [{ type: "text", text: "Question options are empty and allowFreeform is false." }],
					isError: true,
					details: { ...detailsBase, response: null, cancelled: true } satisfies QuestionDetails,
				};
			}

			onUpdate?.({
				content: [{ type: "text", text: "Waiting for user input..." }],
				details: { ...detailsBase, response: null, cancelled: false } satisfies QuestionDetails,
			});

			let result: QuestionResponse | null;

			try {
				const customFactory: CustomFactory<QuestionResponse | null> = (
					tui: TUI,
					theme: Theme,
					keybindings: KeybindingsManager,
					done: (result: QuestionResponse | null) => void,
				) => {
					if (signal) {
						const onAbort = () => done(null);
						signal.addEventListener("abort", onAbort, { once: true });
					}
					if (timeout && timeout > 0) setTimeout(() => done(null), timeout);

					return new QuestionComponent(
						rawQuestion,
						normalizedContext,
						options,
						allowMultiple,
						allowFreeform,
						allowComment,
						tui,
						theme,
						keybindings,
						shortcuts,
						done,
					);
				};

				const customResult = await protocol.custom(customFactory);

				if (customResult !== undefined) {
					result = customResult;
				} else {
					// RPC/headless: custom() returns undefined — degrade to dialog protocol.
					result = await DialogFallback.ask(
						{ question: rawQuestion, context: normalizedContext, options, allowMultiple, allowFreeform, allowComment, shortcuts, timeout },
						protocol,
					);
				}
			} catch (error) {
				const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
				return {
					content: [{ type: "text", text: `Question tool failed: ${message}` }],
					isError: true,
					details: { error: message } as unknown as QuestionDetails,
				};
			}

			if (result === null) {
				pi.events.emit("question:cancelled", { question: rawQuestion, context: normalizedContext, options });
				return {
					content: [{ type: "text", text: "User cancelled the question" }],
					details: { ...detailsBase, response: null, cancelled: true } satisfies QuestionDetails,
				};
			}

			pi.events.emit("question:answered", { question: rawQuestion, context: normalizedContext, response: result });
			return {
				content: [{ type: "text", text: `User answered: ${formatResponseSummary(result)}` }],
				details: { ...detailsBase, response: result, cancelled: false } satisfies QuestionDetails,
			};
		},

		renderCall(args, theme, _context) {
			const batch = Array.isArray(args.questions) ? args.questions : undefined;
			if (batch) {
				const labels = batch.map((item: { label?: string; id?: string }, index: number) => item.label || item.id || `Q${index + 1}`).join(", ");
				return new Text(
					`${theme.fg("toolTitle", theme.bold("QUESTION"))} ${theme.fg("accent", theme.bold(`${batch.length} question${batch.length === 1 ? "" : "s"}`))}${labels ? theme.fg("dim", ` · ${oneLine(labels, 100)}`) : ""}`,
					0,
					0,
				);
			}
			const question = (args.question as string) || "";
			const rawOptions = Array.isArray(args.options) ? args.options : [];
			const title = args.context ? `${args.context}: ` : args.title ? `${args.title}: ` : "";
			const optionCount = rawOptions.length;
			const flags: string[] = [];
			if (args.allowMultiple) flags.push("multi");
			if (args.allowComment) flags.push("comment");
			const suffix = optionCount
				? theme.fg("dim", ` · ${optionCount} option${optionCount === 1 ? "" : "s"}${flags.length ? ` · ${flags.join("/")}` : ""}`)
				: theme.fg("dim", ` · freeform${flags.length ? ` · ${flags.join("/")}` : ""}`);
			return new Text(
				`${theme.fg("toolTitle", theme.bold("QUESTION"))} ${theme.fg("accent", theme.bold(oneLine(title + question, 120)))}${suffix}`,
				0,
				0,
			);
		},

		renderResult(result, options, theme, _context) {
			const details = result.details as (QuestionDetails | BatchQuestionDetails) & { error?: string } | undefined;

			if (details?.error) return new Text(theme.fg("error", details.error), 0, 0);

			if (options.isPartial) {
				const waitingText =
					result.content
						?.filter((part: { type?: string; text?: string }) => part?.type === "text")
						.map((part: { text?: string }) => part.text ?? "")
						.join("\n")
						.trim() || "Waiting for user input...";
				return new Text(theme.fg("muted", waitingText), 0, 0);
			}

			if (!details || details.cancelled) return new Text(theme.fg("warning", "question cancelled"), 0, 0);

			if ("answers" in details) {
				return new Text(details.answers.map((answer) => `${theme.fg("success", "✓")} ${theme.fg("accent", answer.id)}: ${theme.fg("text", oneLine(formatResponseSummary(answer.response), 120))}`).join("\n"), 0, 0);
			}
			if (!details.response) return new Text(theme.fg("warning", "question cancelled"), 0, 0);

			const response = details.response;
			let text = theme.fg("success", theme.bold("answered: "));
			text += theme.fg("accent", theme.bold(oneLine(formatResponseSummary(response), 120)));

			if (options.expanded && details.question) {
				text += `\n${theme.fg("dim", `Q: ${oneLine(details.question, 200)}`)}`;
				if (details.context) text += `\n${theme.fg("dim", oneLine(details.context, 200))}`;
				if (response.kind === "selection" && details.options.length > 0) {
					const selected = new Set(response.selections);
					text += `\n${theme.fg("dim", "Options:")}`;
					for (const opt of details.options) {
						const desc = opt.description ? ` — ${opt.description}` : "";
						const marker = selected.has(opt.label) ? theme.fg("success", "●") : theme.fg("dim", "○");
						text += `\n  ${marker} ${theme.fg("dim", opt.label)}${theme.fg("dim", desc)}`;
					}
					if (response.comment) text += `\n${theme.fg("dim", "Comment:")} ${theme.fg("dim", response.comment)}`;
				}
			}
			return new Text(text, 0, 0);
		},
	});
}
