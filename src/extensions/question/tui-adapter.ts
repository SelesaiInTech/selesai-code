// TUI protocol adapter — wraps ctx.ui into UIProtocol.

import type { ExtensionContext } from "@selesai/code";
import type { OverlayHandle } from "@earendil-works/pi-tui";

import { OVERLAY_MIN_WIDTH, OVERLAY_OVERLAY_MAX_HEIGHT, OVERLAY_WIDTH } from "./constants.ts";
import type { DisplayMode, QuestionResponse } from "./types.ts";
import type { CustomUIOptions, UIProtocol } from "./ui-protocol.ts";

export function buildCustomUIOptions(
	displayMode: DisplayMode,
	onHandle?: (handle: OverlayHandle) => void,
): CustomUIOptions | undefined {
	if (displayMode === "inline") return undefined;
	return {
		overlay: true,
		overlayOptions: { anchor: "center", width: OVERLAY_WIDTH, minWidth: OVERLAY_MIN_WIDTH, maxHeight: OVERLAY_OVERLAY_MAX_HEIGHT, margin: 1 },
		...(onHandle ? { onHandle } : {}),
	};
}

export function createTUIProtocol(ctx: ExtensionContext): UIProtocol {
	return {
		hasUI: ctx.hasUI,
		theme: ctx.ui.theme,
		custom: (factory, options) => ctx.ui.custom(factory as any, options as any) as Promise<QuestionResponse | null | undefined>,
		select: (prompt, options, opts) => ctx.ui.select(prompt, options, opts),
		input: (prompt, placeholder, opts) => ctx.ui.input(prompt, placeholder, opts),
		onTerminalInput: typeof ctx.ui.onTerminalInput === "function" ? ctx.ui.onTerminalInput.bind(ctx.ui) : undefined,
		setStatus: (key, text) => ctx.ui.setStatus(key, text),
		notify: (msg, level) => ctx.ui.notify(msg, level),
	};
}
