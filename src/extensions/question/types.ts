// Shared type definitions for the question extension.

import type { KeybindingsManager } from "@selesai/code";

export interface RawQuestionOption {
	value: string;
	label: string;
	description?: string;
}

export interface QuestionOption {
	value: string;
	label: string;
	description?: string;
}

interface RawQuestionBase {
	id?: string;
	label?: string;
	question: string;
	context?: string;
}

export interface RawSelectQuestion extends RawQuestionBase {
	type: "select";
	options: RawQuestionOption[];
	allowOther?: boolean;
}

export interface RawMultiSelectQuestion extends RawQuestionBase {
	type: "multiselect";
	options: RawQuestionOption[];
	allowOther?: boolean;
}

export interface RawTextQuestion extends RawQuestionBase {
	type: "text";
}

export type RawQuestion = RawSelectQuestion | RawMultiSelectQuestion | RawTextQuestion;

export interface PreparedQuestionBase {
	id: string;
	label: string;
	question: string;
	context?: string;
}

export interface PreparedSelectQuestion extends PreparedQuestionBase {
	type: "select";
	options: QuestionOption[];
	allowOther: boolean;
}

export interface PreparedMultiSelectQuestion extends PreparedQuestionBase {
	type: "multiselect";
	options: QuestionOption[];
	allowOther: boolean;
}

export interface PreparedTextQuestion extends PreparedQuestionBase {
	type: "text";
	options: [];
	allowOther: false;
}

export type PreparedQuestion = PreparedSelectQuestion | PreparedMultiSelectQuestion | PreparedTextQuestion;

export type QuestionResponse =
	| { kind: "selection"; values: string[]; otherText?: string }
	| { kind: "text"; text: string };

export type QuestionAnswer =
	| { id: string; status: "answered"; response: QuestionResponse }
	| { id: string; status: "skipped" | "unanswered" };

export type QuestionToolResult =
	| { status: "submitted"; answers: QuestionAnswer[] }
	| { status: "cancelled"; reason: "user" };

export interface DraftQuestionState {
	status: "answered" | "skipped";
	response?: QuestionResponse;
}

// ---------------------------------------------------------------------------
// Legacy list internals.
// ---------------------------------------------------------------------------

export type ResolvedShortcut =
	| { disabled: false; spec: string; matches: (data: string) => boolean }
	| { disabled: true; spec: null; matches: (data: string) => false };

export interface ResolvedShortcuts {
	commentToggle: ResolvedShortcut;
}

export interface AnnotatedRow {
	line: string;
	selected: boolean;
}

export interface ItemBlock {
	itemIndex: number;
	lines: string[];
}

export type ListItem =
	| { type: "option"; option: QuestionOption }
	| { type: "comment-toggle"; option: QuestionOption }
	| { type: "freeform"; option: QuestionOption };

export interface RenderRowsParams {
	options: QuestionOption[];
	selectedIndex: number;
	width: number;
	allowFreeform: boolean;
	allowComment?: boolean;
	commentEnabled?: boolean;
	maxRows?: number;
	hideDescriptions?: boolean;
}

export type QuestionMode = "select" | "other" | "text";

export interface CustomFactoryResult {
	handleInput(data: string): void;
	render(width: number): string[];
	focused: boolean;
}

export type QuestionKeybindings = KeybindingsManager;
