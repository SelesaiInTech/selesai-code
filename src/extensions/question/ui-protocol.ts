// UIProtocol port — abstracts TUI vs dialog/RPC transport.

import type { KeybindingsManager } from "@selesai/code";
import type { Theme, TUI } from "@earendil-works/pi-tui";

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

export interface UIProtocol {
	readonly hasUI: boolean;
	readonly theme: Theme;
	custom(factory: CustomFactory): Promise<QuestionResponse | null | undefined>;
	select(prompt: string, options: string[], opts?: { timeout?: number }): Promise<string | undefined>;
	input(prompt: string, placeholder?: string, opts?: { timeout?: number }): Promise<string | undefined>;
}

export interface FallbackProtocol {
	ask(params: ResolvedQuestionParams, protocol: UIProtocol): Promise<QuestionResponse | null>;
}
