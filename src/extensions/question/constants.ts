// All constants for the question extension.

import { Key } from "@earendil-works/pi-tui";
import type { ResolvedShortcut } from "./types.ts";

export const QUESTION_STATUS_KEY = "question";
export const QUESTION_VERSION = "1";

export const OVERLAY_MAX_HEIGHT_RATIO = 0.85;
export const OVERLAY_WIDTH: `${number}%` = "92%";
export const OVERLAY_OVERLAY_MAX_HEIGHT: `${number}%` = "85%";
export const OVERLAY_MIN_WIDTH = 40;

export const SPLIT_PANE_MIN_WIDTH = 84;
export const SPLIT_PANE_LEFT_MIN_WIDTH = 32;
export const SPLIT_PANE_RIGHT_MIN_WIDTH = 28;
export const SPLIT_PANE_SEPARATOR = " │ ";

export const FREEFORM_LABEL = "Type custom answer — enter a custom response";
export const COMMENT_TOGGLE_LABEL = "Add extra context after selection";

export const DEFAULT_OVERLAY_TOGGLE_KEY = "alt+o";
export const DEFAULT_COMMENT_TOGGLE_KEY = "ctrl+g";

export const BOX_BORDER_LEFT = "│ ";
export const BOX_BORDER_RIGHT = " │";
export const BOX_BORDER_OVERHEAD = BOX_BORDER_LEFT.length + BOX_BORDER_RIGHT.length;

export const SHORTCUT_DISABLE_VALUES = new Set(["off", "none", "disabled", ""]);

export const DISABLED_SHORTCUT: ResolvedShortcut = {
	disabled: true,
	spec: null,
	matches: ((_data: string) => false) as (data: string) => false,
};

export const VIM_UP = Key.ctrl("k");
export const VIM_DOWN = Key.ctrl("j");