// Batch-first interactive question tool.

import type { ExtensionAPI, KeybindingsManager, Theme } from "@selesai/code";
import {
	Container,
	type Component,
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	Spacer,
	Text,
	type TUI,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import { buildQuestionAnswers, prepareQuestions, saveDraftQuestion } from "./batch.ts";
import { BOX_BORDER_LEFT, BOX_BORDER_OVERHEAD, BOX_BORDER_RIGHT, DISABLED_SHORTCUT, QUESTION_VERSION } from "./constants.ts";
import { createSelectionResponse, createTextResponse, formatQuestionResponse, formatResponseSummary, oneLine, previewText, trimText } from "./helpers.ts";
import { QuestionList } from "./question-list.ts";
import { MultiSelect, SingleSelect } from "./selection-mode.ts";
import { QuestionParamsSchema } from "./schemas.ts";
import type {
	DraftQuestionState,
	PreparedQuestion,
	QuestionAnswer,
	QuestionMode,
	QuestionResponse,
	QuestionToolResult,
	RawQuestion,
} from "./types.ts";

class BoxBorderTop implements Component {
	constructor(
		private color: (value: string) => string,
		private title: string,
		private titleColor: (value: string) => string,
	) {}
	invalidate(): void {}
	render(width: number): string[] {
		const inner = Math.max(0, width - 2);
		const label = ` ${this.title} `;
		if (inner < label.length + 2) return [this.color(`╭${"─".repeat(inner)}╮`)];
		return [this.color("╭─") + this.titleColor(label) + this.color(`${"─".repeat(Math.max(0, inner - label.length - 1))}╮`)];
	}
}

class BoxBorderBottom implements Component {
	constructor(
		private color: (value: string) => string,
		private label: string,
		private labelColor: (value: string) => string,
	) {}
	invalidate(): void {}
	render(width: number): string[] {
		const inner = Math.max(0, width - 2);
		const label = ` ${this.label} `;
		if (inner < label.length + 2) return [this.color(`╰${"─".repeat(inner)}╯`)];
		return [this.color(`╰${"─".repeat(Math.max(0, inner - label.length - 1))}`) + this.labelColor(label) + this.color("─╯")];
	}
}

function editorTheme(theme: Theme): EditorTheme {
	return {
		borderColor: (value) => theme.fg("accent", value),
		// The question editor never renders an autocomplete list (no provider is
		// wired), so the selectList theme mapping is dead in this extension.
		/* v8 ignore start */
		selectList: {
			selectedPrefix: (value) => theme.fg("accent", value),
			selectedText: (value) => theme.fg("accent", value),
			description: (value) => theme.fg("muted", value),
			scrollInfo: (value) => theme.fg("dim", value),
			noMatch: (value) => theme.fg("warning", value),
		},
		/* v8 ignore stop */
	};
}

class QuestionComponent extends Container implements Component {
	private mode: QuestionMode;
	private selectionValues: string[] = [];
	private otherDraft = "";
	private list?: QuestionList;
	private editor?: Editor;
	private editorActive = true;
	private focusedState = false;
	private answerText = new Text("", 1, 0);
	private modeContainer = new Container();
	private helpText = new Text("", 1, 0);

	constructor(
		private question: PreparedQuestion,
		private tui: TUI,
		private theme: Theme,
		private keybindings: KeybindingsManager,
		private onCancel: () => void,
		private onCommit: () => void,
		initialResponse?: QuestionResponse,
	) {
		super();
		this.mode = question.type === "text" ? "text" : "select";
		this.addChild(new BoxBorderTop((value) => theme.fg("accent", value), "question", (value) => theme.fg("dim", theme.bold(value))));
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("text", theme.bold(question.question)), 1, 0));
		if (question.context) {
			this.addChild(new Spacer(1));
			this.addChild(new Text(`${theme.fg("accent", theme.bold("Context:"))}\n${theme.fg("dim", question.context)}`, 1, 0));
		}
		this.addChild(new Spacer(1));
		this.addChild(this.answerText);
		this.addChild(new Spacer(1));
		this.addChild(this.modeContainer);
		this.addChild(new Spacer(1));
		this.addChild(this.helpText);
		this.addChild(new Spacer(1));
		this.addChild(new BoxBorderBottom((value) => theme.fg("accent", value), `v${QUESTION_VERSION}`, (value) => theme.fg("dim", value)));
		this.restore(initialResponse);
		this.rebuildMode();
	}

	// Only the wizard-level focused state is read; the inner getter is kept for
	// API symmetry but never invoked.
	/* v8 ignore start */
	get focused(): boolean {
		return this.focusedState;
	}
	/* v8 ignore stop */
	set focused(value: boolean) {
		this.focusedState = value;
		if (this.editor) this.editor.focused = value && this.editorActive;
	}

	get isEditing(): boolean {
		return (this.mode === "text" || this.mode === "other") && this.editorActive;
	}

	override render(width: number): string[] {
		const innerWidth = Math.max(1, width - BOX_BORDER_OVERHEAD);
		const lines = super.render(innerWidth);
		const border = (value: string) => this.theme.fg("accent", value);
		return lines.map((line, index) => {
			if (index === 0) return new BoxBorderTop(border, "question", (value) => this.theme.fg("dim", this.theme.bold(value))).render(width)[0]!;
			if (index === lines.length - 1) return new BoxBorderBottom(border, `v${QUESTION_VERSION}`, (value) => this.theme.fg("dim", value)).render(width)[0]!;
			return `${border(BOX_BORDER_LEFT)}${truncateToWidth(line, innerWidth, "", true)}${border(BOX_BORDER_RIGHT)}`;
		});
	}

	override invalidate(): void {
		super.invalidate();
		this.updateAnswerText();
		this.updateHelp();
	}

	private restore(response?: QuestionResponse): void {
		if (!response) return;
		if (response.kind === "text") {
			this.mode = "text";
			this.ensureEditor().setText(response.text);
			return;
		}
		this.selectionValues = [...response.values];
		this.otherDraft = response.otherText ?? "";
		this.ensureList().restoreSelection(response.values);
		if (response.otherText) {
			this.mode = "other";
			this.ensureEditor().setText(response.otherText);
		}
	}

	private ensureList(): QuestionList {
		if (this.list) return this.list;
		const multi = this.question.type === "multiselect";
		const list = new QuestionList(
			this.question.options,
			multi ? MultiSelect : SingleSelect,
			this.question.allowOther,
			false,
			this.theme,
			this.keybindings,
			DISABLED_SHORTCUT,
		);
		list.onSubmit = (values) => {
			this.selectionValues = values;
			if (!multi) this.otherDraft = "";
			this.updateAnswerText();
			this.tui.requestRender();
			if (this.getResponse()) this.onCommit();
		};
		list.onEnterFreeform = () => this.showOther();
		list.onCancel = this.onCancel;
		this.list = list;
		return list;
	}

	private ensureEditor(): Editor {
		if (this.editor) return this.editor;
		const editor = new Editor(this.tui, editorTheme(this.theme));
		editor.onChange = () => {
			this.updateAnswerText();
			this.tui.requestRender();
		};
		editor.onSubmit = (text) => {
			editor.setText(text.trim());
			this.updateAnswerText();
			this.tui.requestRender();
			if (this.getResponse()) this.onCommit();
		};
		this.editor = editor;
		return editor;
	}

	private showOther(): void {
		this.mode = "other";
		this.editorActive = true;
		const editor = this.ensureEditor();
		editor.setText(this.otherDraft);
		this.rebuildMode();
	}

	private showSelect(): void {
		// showSelect is only invoked from other mode (the escape handler), so the
		// mode guard's false branch is unreachable through the public flow.
		/* v8 ignore next 1 */
		if (this.mode === "other") this.otherDraft = this.ensureEditor().getText();
		this.mode = "select";
		this.editorActive = false;
		this.rebuildMode();
	}

	private rebuildMode(): void {
		this.modeContainer.clear();
		if (this.mode === "select") {
			this.modeContainer.addChild(this.ensureList());
		} else {
			const editor = this.ensureEditor();
			// editorActive is always true in this branch: rebuildMode runs from the
			// constructor, showOther (sets editorActive = true), and showSelect
			// (which takes the select branch above).
			/* v8 ignore next 1 */
			editor.focused = this.focusedState && this.editorActive;
			this.modeContainer.addChild(new Text(this.theme.fg("accent", this.theme.bold(this.mode === "text" ? "Answer" : "Other answer")), 1, 0));
			this.modeContainer.addChild(new Spacer(1));
			this.modeContainer.addChild(editor);
		}
		this.updateAnswerText();
		this.updateHelp();
		this.invalidate();
		this.tui.requestRender();
	}

	private updateAnswerText(): void {
		const response = this.getResponse();
		this.answerText.setText(
			response
				? `${this.theme.fg("success", "Draft:")} ${this.theme.fg("text", oneLine(formatQuestionResponse(this.question, response), 160))}`
				: this.theme.fg("dim", "No answer yet"),
		);
	}

	private updateHelp(): void {
		if (this.mode === "select") {
			const multi = this.question.type === "multiselect";
			this.helpText.setText(
				this.theme.fg(
					"dim",
					multi
						? "↑↓ navigate • space toggle • enter save selection • Tab/→ next • Shift+Tab/← previous • esc cancel"
						: "type filter • ↑↓ navigate • enter save choice • Tab/→ next • Shift+Tab/← previous • esc cancel",
				),
			);
			return;
		}
		this.helpText.setText(
			this.theme.fg(
				"dim",
				`${this.keybindings.getKeys("tui.input.submit").join("/")} save • ${this.keybindings.getKeys("tui.input.newLine").join("/")} newline • Tab next • Shift+Tab previous • esc ${this.mode === "other" ? "choices" : "blur"}`,
			),
		);
	}

	getResponse(): QuestionResponse | null {
		if (this.question.type === "text") return createTextResponse(this.ensureEditor().getText());
		const values = this.question.type === "multiselect" ? this.ensureList().getCheckedValues() : this.selectionValues;
		const otherText = this.mode === "other" ? this.ensureEditor().getText() : this.otherDraft;
		return createSelectionResponse(this.question.type === "select" && trimText(otherText) ? [] : values, otherText);
	}

	handleInput(data: string): void {
		if (this.mode === "other" && matchesKey(data, Key.escape)) {
			this.showSelect();
			return;
		}
		if (this.mode === "text" && matchesKey(data, Key.escape) && this.editorActive) {
			this.editorActive = false;
			this.ensureEditor().focused = false;
			this.updateHelp();
			this.tui.requestRender();
			return;
		}
		if ((this.mode === "text" || this.mode === "other") && !this.editorActive) {
			if (matchesKey(data, Key.enter)) {
				this.editorActive = true;
				this.ensureEditor().focused = this.focusedState;
				this.tui.requestRender();
			}
			return;
		}
		if (this.mode === "text" || this.mode === "other") this.ensureEditor().handleInput(data);
		else this.ensureList().handleInput(data);
		this.tui.requestRender();
	}
}

class ReviewComponent implements Component {
	private focusedState = false;

	constructor(
		private questions: PreparedQuestion[],
		private states: ReadonlyMap<string, DraftQuestionState>,
		private theme: Theme,
		private onBack: () => void,
		private onCancel: () => void,
		private onSubmit: () => void,
	) {}

	// Only the setter is used by the wizard; the getter is kept for the
	// Component contract but never read.
	/* v8 ignore start */
	get focused(): boolean {
		return this.focusedState;
	}
	/* v8 ignore stop */
	set focused(value: boolean) {
		this.focusedState = value;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const safeWidth = Math.max(12, width);
		const lines: string[] = [];
		for (const question of this.questions) {
			const state = this.states.get(question.id);
			// Every question present on the review page has a saved state (answered or
			// skipped); an absent state is unreachable through the wizard flow.
			/* v8 ignore next 1 */
			const status = state?.status ?? "unanswered";
			/* v8 ignore next 1 */
			const marker = status === "answered" ? this.theme.fg("success", "✓") : status === "skipped" ? this.theme.fg("warning", "−") : this.theme.fg("dim", "○");
			/* v8 ignore next 1 */
			lines.push(truncateToWidth(`${marker} ${this.theme.fg("accent", this.theme.bold(question.label))} · ${this.theme.fg(status === "answered" ? "success" : status === "skipped" ? "warning" : "dim", status)}`, safeWidth, ""));
			lines.push(...wrapTextWithAnsi(this.theme.fg("dim", question.question), safeWidth));
			if (state?.status === "answered" && state.response) {
				const preview = previewText(formatQuestionResponse(question, state.response));
				lines.push(...wrapTextWithAnsi(`${this.theme.fg("dim", "Answer:")} ${this.theme.fg("text", preview)}`, safeWidth));
			}
			lines.push("");
		}

		const bodyBudget = Math.max(7, (process.stdout.rows || 24) - 9);
		let body = lines;
		if (lines.length > bodyBudget) {
			body = lines.slice(-bodyBudget);
			body[0] = this.theme.fg("dim", "↑ earlier answers");
		}
		const submit = this.theme.bg("selectedBg", this.theme.fg("text", "  Submit  "));
		return [...body, truncateToWidth(submit, safeWidth, "")];
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.enter)) this.onSubmit();
		else if (matchesKey(data, Key.left)) this.onBack();
		else if (matchesKey(data, Key.escape)) this.onCancel();
	}
}

class BatchQuestionComponent extends Container implements Component {
	private currentPage = 0;
	private states = new Map<string, DraftQuestionState>();
	private questionComponent?: QuestionComponent;
	private reviewComponent?: ReviewComponent;
	private focusedState = false;
	private header = new Text("", 1, 0);
	private content = new Container();
	private legend = new Text("", 1, 0);

	constructor(
		private questions: PreparedQuestion[],
		private tui: TUI,
		private theme: Theme,
		private keybindings: KeybindingsManager,
		private onDone: (result: QuestionToolResult) => void,
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
		if (this.reviewComponent) this.reviewComponent.focused = value;
	}

	override invalidate(): void {
		super.invalidate();
		this.updateChrome();
	}

	private get isReviewPage(): boolean {
		return this.currentPage === this.questions.length;
	}

	private cancel = (): void => this.onDone({ status: "cancelled", reason: "user" });

	private updateChrome(): void {
		if (this.isReviewPage) {
			const answered = [...this.states.values()].filter((state) => state.status === "answered").length;
			const skipped = [...this.states.values()].filter((state) => state.status === "skipped").length;
			this.header.setText(this.theme.fg("accent", this.theme.bold(`Review · ${answered} answered · ${skipped} skipped · ${this.questions.length - this.states.size} unanswered`)));
			this.legend.setText(this.theme.fg("dim", "Enter submit • ← edit answers • Esc cancel"));
			return;
		}
		const question = this.questions[this.currentPage]!;
		const status = this.states.get(question.id)?.status ?? "unanswered";
		this.header.setText(this.theme.fg("accent", this.theme.bold(`${question.label} · Question ${this.currentPage + 1} of ${this.questions.length} · ${status}`)));
		this.legend.setText(this.theme.fg("dim", "Tab/→ next • Shift+Tab/← previous • blank Next skips • answers commit only on final Submit"));
	}

	private showPage(): void {
		this.content.clear();
		this.questionComponent = undefined;
		this.reviewComponent = undefined;
		if (this.isReviewPage) {
			this.reviewComponent = new ReviewComponent(
				this.questions,
				this.states,
				this.theme,
				() => {
					this.currentPage = this.questions.length - 1;
					this.showPage();
				},
				this.cancel,
				() => this.onDone({ status: "submitted", answers: buildQuestionAnswers(this.questions, this.states) }),
			);
			this.reviewComponent.focused = this.focusedState;
			this.content.addChild(this.reviewComponent);
		} else {
			const question = this.questions[this.currentPage]!;
			const state = this.states.get(question.id);
			this.questionComponent = new QuestionComponent(question, this.tui, this.theme, this.keybindings, this.cancel, this.commitCurrent, state?.response);
			this.questionComponent.focused = this.focusedState;
			this.content.addChild(this.questionComponent);
		}
		this.updateChrome();
		this.invalidate();
		this.tui.requestRender();
	}

	private saveCurrent(markBlankSkipped: boolean): void {
		// saveCurrent is only invoked from goNext/goPrevious/commitCurrent while
		// on a question page with a mounted question component.
		/* v8 ignore next 1 */
		if (this.isReviewPage || !this.questionComponent) return;
		const question = this.questions[this.currentPage]!;
		const response = this.questionComponent.getResponse();
		saveDraftQuestion(this.states, question.id, response, markBlankSkipped);
	}

	private goNext(): void {
		this.saveCurrent(true);
		// goNext only runs on question pages, where currentPage is always below
		// questions.length; the guard is defensive.
		/* v8 ignore next 1 */
		if (this.currentPage < this.questions.length) this.currentPage++;
		this.showPage();
	}

	private commitCurrent = (): void => {
		this.saveCurrent(true);
		if (this.questions.length === 1) {
			this.onDone({ status: "submitted", answers: buildQuestionAnswers(this.questions, this.states) });
			return;
		}
		// commitCurrent only runs on question pages, where currentPage is always
		// below questions.length; the guard is defensive.
		/* v8 ignore next 1 */
		if (this.currentPage < this.questions.length) this.currentPage++;
		this.showPage();
	};

	private goPrevious(): void {
		this.saveCurrent(false);
		if (this.currentPage > 0) this.currentPage--;
		this.showPage();
	}

	handleInput(data: string): void {
		if (this.isReviewPage) {
			this.reviewComponent?.handleInput(data);
			return;
		}
		if (matchesKey(data, Key.tab) || (!this.questionComponent?.isEditing && matchesKey(data, Key.right))) {
			this.goNext();
			return;
		}
		if (matchesKey(data, Key.shift("tab")) || (!this.questionComponent?.isEditing && matchesKey(data, Key.left))) {
			this.goPrevious();
			return;
		}
		if (!this.questionComponent?.isEditing && matchesKey(data, Key.escape) && this.questions[this.currentPage]?.type === "text") {
			this.cancel();
			return;
		}
		this.questionComponent?.handleInput(data);
	}
}

function answerText(answer: QuestionAnswer): string {
	if (answer.status !== "answered") return answer.status;
	return formatResponseSummary(answer.response);
}

function rawQuestionLabel(question: RawQuestion | undefined, answer: QuestionAnswer): string {
	if (!question || answer.status !== "answered" || answer.response.kind === "text") return answerText(answer);
	const labels = answer.response.values.map((value) => question.options.find((option) => option.value === value)?.label ?? value);
	if (answer.response.otherText) labels.push(`Other: ${answer.response.otherText}`);
	return labels.join(", ");
}

export default function questionExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "question",
		label: "Question",
		description:
			"Ask one or more typed questions in a terminal wizard. Supports select, multiselect, text, stable option values, Other answers, and partial atomic submission.",
		promptSnippet: "Ask the user one or more typed questions when a decision is required.",
		promptGuidelines: [
			"Use question only for decisions the user must make; inspect facts yourself.",
			"Send one questions array containing independent decisions that can be answered together.",
			"Use stable option values separate from human-readable labels.",
			"Use text questions only when known choices cannot represent the answer.",
			"After question returns, continue immediately using submitted answers; skipped and unanswered are distinct states.",
		],
		executionMode: "sequential",
		parameters: QuestionParamsSchema,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const prepared = prepareQuestions(params.questions);
			if ("error" in prepared) throw new Error(prepared.error);
			if (ctx.mode !== "tui") throw new Error("Question requires terminal TUI mode.");
			if (signal?.aborted) return { content: [{ type: "text", text: "Question cancelled" }], details: { status: "cancelled", reason: "user" } satisfies QuestionToolResult };

			onUpdate?.({ content: [{ type: "text", text: `Waiting for answers to ${prepared.questions.length} question${prepared.questions.length === 1 ? "" : "s"}...` }] });
			const result = await ctx.ui.custom<QuestionToolResult>((tui, theme, keybindings, done) => {
				if (signal) signal.addEventListener("abort", () => done({ status: "cancelled", reason: "user" }), { once: true });
				return new BatchQuestionComponent(prepared.questions, tui, theme, keybindings, done);
			});
			if (!result) throw new Error("Question TUI did not return a result.");

			if (result.status === "cancelled") {
				pi.events.emit("question:cancelled", { reason: result.reason });
				return { content: [{ type: "text", text: "User cancelled the question batch" }], details: result };
			}
			pi.events.emit("question:submitted", { answers: result.answers });
			return {
				content: [{ type: "text", text: JSON.stringify(result) }],
				details: result,
			};
		},

		renderCall(args, theme) {
			const questions = Array.isArray(args.questions) ? (args.questions as RawQuestion[]) : [];
			const labels = questions.map((question, index) => question.label || question.id || `Q${index + 1}`).join(", ");
			return new Text(
				`${theme.fg("toolTitle", theme.bold("QUESTION"))} ${theme.fg("accent", theme.bold(`${questions.length} question${questions.length === 1 ? "" : "s"}`))}${labels ? theme.fg("dim", ` · ${oneLine(labels, 100)}`) : ""}`,
				0,
				0,
			);
		},

		renderResult(result, options, theme, context) {
			if (options.isPartial) {
				const text = result.content.find((part: { type?: string }) => part.type === "text") as { text?: string } | undefined;
				return new Text(theme.fg("muted", text?.text ?? "Waiting for user input..."), 0, 0);
			}
			const details = result.details as QuestionToolResult | undefined;
			if (!details || details.status === "cancelled") return new Text(theme.fg("warning", "question cancelled"), 0, 0);
			const answered = details.answers.filter((answer) => answer.status === "answered").length;
			const skipped = details.answers.filter((answer) => answer.status === "skipped").length;
			const unanswered = details.answers.length - answered - skipped;
			let text = `${theme.fg("success", "submitted")} ${theme.fg("dim", `· ${answered} answered · ${skipped} skipped · ${unanswered} unanswered`)}`;
			if (options.expanded) {
				const questions = (((context as { args?: { questions?: RawQuestion[] } }).args?.questions ?? []) as RawQuestion[]);
				for (const answer of details.answers) {
					const question = questions.find((candidate, index) => (candidate.id?.trim() || `q${index + 1}`) === answer.id);
					const marker = answer.status === "answered" ? theme.fg("success", "✓") : answer.status === "skipped" ? theme.fg("warning", "−") : theme.fg("dim", "○");
					text += `\n${marker} ${theme.fg("accent", answer.id)}: ${theme.fg(answer.status === "answered" ? "text" : "dim", oneLine(rawQuestionLabel(question, answer), 200))}`;
				}
			}
			return new Text(text, 0, 0);
		},
	});
}
