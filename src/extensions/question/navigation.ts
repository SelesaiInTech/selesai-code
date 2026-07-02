// Vim-style navigation aliases (ctrl+j/k don't collide with fuzzy-search input).

import type { KeybindingsManager } from "@selesai/code";
import { matchesKey } from "@earendil-works/pi-tui";

import { VIM_DOWN, VIM_UP } from "./constants.ts";

export function matchesUp(data: string, keybindings: KeybindingsManager): boolean {
	return keybindings.matches(data, "tui.select.up") || matchesKey(data, VIM_UP);
}

export function matchesDown(data: string, keybindings: KeybindingsManager): boolean {
	return keybindings.matches(data, "tui.select.down") || matchesKey(data, VIM_DOWN);
}
