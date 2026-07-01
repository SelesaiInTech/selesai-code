// UIProtocol port — abstracts TUI vs dialog/RPC transport.

import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { OverlayHandle, Theme, TUI } from "@earendil-works/pi-tui";

import type { QuestionResponse, ResolvedQuestionParams } from "./types.ts";

export interface CustomFactoryResult {
	handleInput(data: string): void;
	render(width: number): string[];
	focused: boolean;
}

export type CustomFactory = (
	tui: TUI,
	theme: Theme,
	keybindings: KeybindingsManager,
	done: (result: QuestionResponse | null) => void,
) => CustomFactoryResult;

export interface CustomUIOptions {
	overlay?: boolean;
	overlayOptions?: {
		anchor: string;
		width: string;
		minWidth: number;
		maxHeight: string;
		margin: number;
	};
	onHandle?: (handle: OverlayHandle) => void;
}

export interface UIProtocol {
	readonly hasUI: boolean;
	readonly theme: Theme;
	custom(factory: CustomFactory, options?: CustomUIOptions): Promise<QuestionResponse | null | undefined>;
	select(prompt: string, options: string[], opts?: { timeout?: number }): Promise<string | undefined>;
	input(prompt: string, placeholder?: string, opts?: { timeout?: number }): Promise<string | undefined>;
	onTerminalInput?(handler: (data: string) => { consume: boolean } | void): () => void;
	setStatus(key: string, text: string): void;
	notify(message: string, level: "info" | "warning" | "error"): void;
}

export interface FallbackProtocol {
	ask(params: ResolvedQuestionParams, protocol: UIProtocol): Promise<QuestionResponse | null>;
}