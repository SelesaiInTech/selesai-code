// Question extension entry point.
// Owns: QuestionComponent (mode-switching + editor lifecycle + box borders),
// tool registration, execute() orchestration via UIProtocol.

import type { ExtensionAPI, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import {
	Container,
	type Component,
	Editor,
	type EditorTheme,
	Key,
	Markdown,
	matchesKey,
	type OverlayHandle,
	Spacer,
	Text,
	type TUI,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import { BOX_BORDER_LEFT, BOX_BORDER_OVERHEAD, BOX_BORDER_RIGHT, OVERLAY_MAX_HEIGHT_RATIO, QUESTION_STATUS_KEY, QUESTION_VERSION } from "./constants.ts";
import { DialogFallback } from "./dialog-adapter.ts";
import { createFreeformResponse, createSelectionResponse, formatOptionsForMessage, formatResponseSummary, getOptionsFormatError, normalizeOptions, oneLine, safeMarkdownTheme } from "./helpers.ts";
import { QuestionList } from "./question-list.ts";
import { MultiSelect, SingleSelect } from "./selection-mode.ts";
import { resolveShortcuts } from "./shortcuts.ts";
import { QuestionParamsSchema } from "./schemas.ts";
import type { DisplayMode, QuestionDetails, QuestionMode, QuestionOption, QuestionResponse, RawOption, ResolvedShortcuts } from "./types.ts";
import { buildCustomUIOptions, createTUIProtocol } from "./tui-adapter.ts";
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
		private displayMode: DisplayMode,
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

		if (this.mode === "select" && !this.allowMultiple) {
			const overlayMaxHeight = Math.max(12, Math.floor(this.tui.terminal.rows * OVERLAY_MAX_HEIGHT_RATIO));
			const staticLines = this.countStaticLines(innerWidth);
			const availableOptionRows = Math.max(4, overlayMaxHeight - staticLines);
			this.ensureList().setMaxVisibleRows(availableOptionRows);
		}

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

	private countWrappedLines(text: string, width: number): number {
		return Math.max(1, wrapTextWithAnsi(text, Math.max(10, width - 2)).length);
	}

	private countStaticLines(width: number): number {
		const titleLines = 1;
		const questionLines = this.countWrappedLines(this.question, width);
		const contextLines = this.context ? 1 + this.countWrappedLines(this.context, width) : 0;
		const helpLines = 1;
		const borderLines = 2;
		const spacerLines = this.context ? 6 : 5;
		return borderLines + spacerLines + titleLines + questionLines + contextLines + helpLines;
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
		const overlayHint =
			this.displayMode === "overlay" && !this.shortcuts.overlayToggle.disabled
				? `${theme.fg("dim", this.shortcuts.overlayToggle.spec)}${theme.fg("muted", " hide")}`
				: null;
		const commentHint =
			this.allowComment && !this.shortcuts.commentToggle.disabled
				? `${theme.fg("dim", this.shortcuts.commentToggle.spec)}${theme.fg("muted", " toggle context")}`
				: null;

		if (this.mode === "freeform" || this.mode === "comment") {
			const hints = [
				`${theme.fg("dim", kb.getKeys("tui.input.submit").join("/"))}${theme.fg("muted", this.mode === "comment" ? " submit/skip" : " submit")}`,
				`${theme.fg("dim", kb.getKeys("tui.input.newLine").join("/"))}${theme.fg("muted", " newline")}`,
				`${theme.fg("dim", "esc")}${theme.fg("muted", " back")}`,
				overlayHint,
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
				overlayHint,
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
				overlayHint,
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
// Tool registration
// ---------------------------------------------------------------------------

export default function questionExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "question",
		label: "Question",
		description:
			"Ask the user a question in the Pi UI and return the answer. Supports multiple-choice options, multi-select, freeform answers, optional context, and an optional comment. Use when you need user input to proceed.",
		promptSnippet: "Ask the user a question when required information is missing.",
		promptGuidelines: [
			"Use question only when you cannot proceed safely or accurately without user input.",
			"Ask concise questions. Prefer options when choices are known.",
			"Set allowFreeform=true when user may need to provide a custom answer.",
			"Use allowMultiple=true when more than one option may apply.",
			"Pass a short summary via context when the question depends on prior findings.",
			"After the user answers, continue the task immediately using that answer; do not stop and ask the user to type continue unless the task is complete.",
			"Do not use question for information you can infer, inspect, or compute with other tools.",
		],
		// Block other tool calls in the same turn until the user answers, so the
		// model can't batch question with side-effecting tools and run them first.
		executionMode: "sequential",
		parameters: QuestionParamsSchema,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
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

			const envMode = process.env.PI_QUESTION_DISPLAY_MODE;
			const envDisplayMode: DisplayMode | undefined = envMode === "overlay" || envMode === "inline" ? envMode : undefined;
			const effectiveDisplayMode: DisplayMode = (params.displayMode as DisplayMode | undefined) ?? envDisplayMode ?? "overlay";

			const shortcuts: ResolvedShortcuts = resolveShortcuts(
				params.overlayToggleKey as string | null | undefined,
				process.env.PI_QUESTION_OVERLAY_TOGGLE_KEY,
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

			protocol.setStatus(
				QUESTION_STATUS_KEY,
				protocol.theme.fg("accent", `waiting: ${oneLine((normalizedContext ? `${normalizedContext}: ` : "") + rawQuestion, 48)}`),
			);

			// No options: pure freeform via dialog input.
			if (options.length === 0) {
				if (!allowFreeform) {
					protocol.setStatus(QUESTION_STATUS_KEY, protocol.theme.fg("error", "question failed"));
					return {
						content: [{ type: "text", text: "Question options are empty and allowFreeform is false." }],
						isError: true,
						details: { ...detailsBase, response: null, cancelled: true } satisfies QuestionDetails,
					};
				}
				try {
					const prompt = normalizedContext ? `${rawQuestion}\n\nContext:\n${normalizedContext}` : rawQuestion;
					const answer = await protocol.input(prompt, "Type your answer...", timeout ? { timeout } : undefined);
					const response = createFreeformResponse(answer);
					if (!response) {
						protocol.setStatus(QUESTION_STATUS_KEY, protocol.theme.fg("warning", "question cancelled"));
						return {
							content: [{ type: "text", text: "User cancelled the question" }],
							details: { ...detailsBase, response: null, cancelled: true } satisfies QuestionDetails,
						};
					}
					pi.events.emit("question:answered", { question: rawQuestion, context: normalizedContext, response });
					protocol.setStatus(QUESTION_STATUS_KEY, protocol.theme.fg("success", "question answered"));
					return {
						content: [{ type: "text", text: `User answered: ${formatResponseSummary(response)}` }],
						details: { ...detailsBase, response, cancelled: false } satisfies QuestionDetails,
					};
				} catch (error) {
					protocol.setStatus(QUESTION_STATUS_KEY, protocol.theme.fg("error", "question failed"));
					throw error;
				}
			}

			onUpdate?.({
				content: [{ type: "text", text: "Waiting for user input..." }],
				details: { ...detailsBase, response: null, cancelled: false } satisfies QuestionDetails,
			});

			let result: QuestionResponse | null;
			let overlayHandle: OverlayHandle | undefined;
			let removeOverlayInputListener: (() => void) | undefined;
			let hasAnnouncedHide = false;

			try {
				const customFactory: CustomFactory = (
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
						effectiveDisplayMode,
						tui,
						theme,
						keybindings,
						shortcuts,
						done,
					);
				};

				const overlayToggle = shortcuts.overlayToggle;
				if (
					effectiveDisplayMode === "overlay" &&
					!overlayToggle.disabled &&
					typeof protocol.onTerminalInput === "function"
				) {
					removeOverlayInputListener = protocol.onTerminalInput((data) => {
						if (!overlayToggle.matches(data) || !overlayHandle) return undefined;
						const nextHidden = !overlayHandle.isHidden();
						overlayHandle.setHidden(nextHidden);
						if (nextHidden && !hasAnnouncedHide) {
							hasAnnouncedHide = true;
							protocol.notify?.(`question hidden — press ${overlayToggle.spec} to reopen`, "info");
						}
						return { consume: true };
					});
				}

				const customResult = await protocol.custom(customFactory, buildCustomUIOptions(effectiveDisplayMode, (handle) => {
					overlayHandle = handle;
				}));

				if (customResult !== undefined) {
					result = customResult;
				} else {
					// RPC/headless: custom() returns undefined — degrade to dialog protocol.
					result = await DialogFallback.ask(
						{ question: rawQuestion, context: normalizedContext, options, allowMultiple, allowFreeform, allowComment, displayMode: effectiveDisplayMode, shortcuts, timeout },
						protocol,
					);
				}
			} catch (error) {
				const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
				protocol.setStatus(QUESTION_STATUS_KEY, protocol.theme.fg("error", "question failed"));
				return {
					content: [{ type: "text", text: `Question tool failed: ${message}` }],
					isError: true,
					details: { error: message } as unknown as QuestionDetails,
				};
			} finally {
				removeOverlayInputListener?.();
			}

			if (result === null) {
				protocol.setStatus(QUESTION_STATUS_KEY, protocol.theme.fg("warning", "question cancelled"));
				pi.events.emit("question:cancelled", { question: rawQuestion, context: normalizedContext, options });
				return {
					content: [{ type: "text", text: "User cancelled the question" }],
					details: { ...detailsBase, response: null, cancelled: true } satisfies QuestionDetails,
				};
			}

			protocol.setStatus(QUESTION_STATUS_KEY, protocol.theme.fg("success", "question answered"));
			pi.events.emit("question:answered", { question: rawQuestion, context: normalizedContext, response: result });
			return {
				content: [{ type: "text", text: `User answered: ${formatResponseSummary(result)}` }],
				details: { ...detailsBase, response: result, cancelled: false } satisfies QuestionDetails,
			};
		},

		renderCall(args, theme, _context) {
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
			const details = result.details as (QuestionDetails & { error?: string }) | undefined;

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

			if (!details || details.cancelled || !details.response) {
				return new Text(theme.fg("warning", "question cancelled"), 0, 0);
			}

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