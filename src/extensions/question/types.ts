// Shared type definitions for the question extension.

import type { KeybindingsManager } from "@selesai/code";

export type RawOption = string | { label: string; description?: string };

export interface QuestionOption {
	label: string;
	description?: string;
}

export type QuestionResponse =
	| { kind: "selection"; selections: string[]; comment?: string }
	| { kind: "freeform"; text: string };

export interface QuestionDetails {
	question: string;
	context?: string;
	options: QuestionOption[];
	response: QuestionResponse | null;
	cancelled: boolean;
}

export interface QuestionParams {
	question: string;
	context?: string;
	options?: RawOption[];
	allowMultiple?: boolean;
	allowFreeform?: boolean;
	allowComment?: boolean;
	commentToggleKey?: string | null;
	timeout?: number;
}

// ---------------------------------------------------------------------------
// Shortcut resolution
// ---------------------------------------------------------------------------

export type ResolvedShortcut =
	| { disabled: false; spec: string; matches: (data: string) => boolean }
	| { disabled: true; spec: null; matches: (data: string) => false };

export interface ResolvedShortcuts {
	commentToggle: ResolvedShortcut;
}

// ---------------------------------------------------------------------------
// Single-select row layout
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Question component
// ---------------------------------------------------------------------------

export type QuestionMode = "select" | "freeform" | "comment";

// ---------------------------------------------------------------------------
// UI protocol (port for TUI vs dialog/RPC)
// ---------------------------------------------------------------------------

export interface ResolvedQuestionParams {
	question: string;
	context: string | undefined;
	options: QuestionOption[];
	allowMultiple: boolean;
	allowFreeform: boolean;
	allowComment: boolean;
	shortcuts: ResolvedShortcuts;
	timeout: number | undefined;
}
