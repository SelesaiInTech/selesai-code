// Shortcut resolution for the optional-comment toggle key.

import { matchesKey } from "@earendil-works/pi-tui";

import { DEFAULT_COMMENT_TOGGLE_KEY, DISABLED_SHORTCUT, SHORTCUT_DISABLE_VALUES } from "./constants.ts";
import type { ResolvedShortcut, ResolvedShortcuts } from "./types.ts";

export function normalizeShortcutSpec(value: string | null | undefined): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null) return null;
	const trimmed = value.trim().toLowerCase();
	if (SHORTCUT_DISABLE_VALUES.has(trimmed)) return null;
	return trimmed;
}

export function isValidShortcutSpec(spec: string): boolean {
	if (!spec) return false;
	if (!/^[a-z0-9+_\-!@#$%^&*()|~`'":;,./<>?[\]{}=\\]+$/i.test(spec)) return false;
	if (spec.startsWith("+") || spec.endsWith("+")) return false;
	if (spec.includes("++")) return false;
	return true;
}

export function buildShortcut(spec: string): ResolvedShortcut {
	return { disabled: false, spec, matches: (data: string) => matchesKey(data, spec as any) };
}

export function resolveShortcut(
	paramValue: string | null | undefined,
	envValue: string | undefined,
	defaultSpec: string,
): ResolvedShortcut {
	for (const raw of [paramValue, envValue, defaultSpec]) {
		const normalized = normalizeShortcutSpec(raw);
		if (normalized === undefined) continue;
		if (normalized === null) return DISABLED_SHORTCUT;
		if (isValidShortcutSpec(normalized)) return buildShortcut(normalized);
	}
	return DISABLED_SHORTCUT;
}

export function resolveShortcuts(commentToggleKey: string | null | undefined, commentEnv: string | undefined): ResolvedShortcuts {
	return { commentToggle: resolveShortcut(commentToggleKey, commentEnv, DEFAULT_COMMENT_TOGGLE_KEY) };
}
