// TUI protocol adapter — wraps ctx.ui into UIProtocol.

import type { ExtensionContext } from "@selesai/code";

import type { QuestionResponse } from "./types.ts";
import type { UIProtocol } from "./ui-protocol.ts";

export function createTUIProtocol(ctx: ExtensionContext): UIProtocol {
	return {
		hasUI: ctx.hasUI,
		theme: ctx.ui.theme,
		custom: (factory) => ctx.ui.custom(factory as any) as Promise<QuestionResponse | null | undefined>,
		select: (prompt, options, opts) => ctx.ui.select(prompt, options, opts),
		input: (prompt, placeholder, opts) => ctx.ui.input(prompt, placeholder, opts),
	};
}
