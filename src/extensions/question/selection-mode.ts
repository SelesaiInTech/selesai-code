// SelectionMode strategy — isolates single-vs-multi selection behavior.

import type { QuestionOption } from "./types.ts";

export interface QuestionListState {
	selectedIndex: number;
	checked: ReadonlySet<number>;
	options: QuestionOption[];
}

export interface SelectionMode {
	readonly multi: boolean;
	toggle(checked: Set<number>, index: number): void;
	buildResult(state: QuestionListState): string[];
	/** Returns whether to toggle (multi) or just select (single), and the new selectedIndex. */
	handleNumberKey(idx: number, count: number): { toggle: boolean; selectIndex: number };
}

export const SingleSelect: SelectionMode = {
	multi: false,
	toggle() {},
	buildResult(state) {
		const label = state.options[state.selectedIndex]?.label;
		return label ? [label] : [];
	},
	handleNumberKey(idx, count) {
		return { toggle: false, selectIndex: Math.min(idx, count - 1) };
	},
};

export const MultiSelect: SelectionMode = {
	multi: true,
	toggle(checked, index) {
		if (index < 0) return;
		if (checked.has(index)) checked.delete(index);
		else checked.add(index);
	},
	buildResult(state) {
		const selectedTitles = Array.from(state.checked)
			.sort((a, b) => a - b)
			.map((i) => state.options[i]?.label)
			.filter((t): t is string => !!t);
		const fallback = state.options[state.selectedIndex]?.label;
		return selectedTitles.length > 0 ? selectedTitles : fallback ? [fallback] : [];
	},
	handleNumberKey(idx, count) {
		return { toggle: true, selectIndex: Math.min(idx, count - 1) };
	},
};