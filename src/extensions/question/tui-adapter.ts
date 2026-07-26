// TUI protocol adapter — wraps ctx.ui into UIProtocol.

import type { ExtensionContext } from "@selesai/code";

import type { CustomFactory, UIProtocol } from "./ui-protocol.ts";

export function createTUIProtocol(ctx: ExtensionContext): UIProtocol {
	return {
		hasUI: ctx.hasUI,
		theme: ctx.ui.theme,
		custom: <T>(factory: CustomFactory<T>) => ctx.ui.custom(factory as any) as Promise<T | undefined>,
		select: (prompt, options, opts) => ctx.ui.select(prompt, options, opts),
		input: (prompt, placeholder, opts) => ctx.ui.input(prompt, placeholder, opts),
	};
}
