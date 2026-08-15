import { describe, expect, it } from "vitest";

import { MultiSelect, SingleSelect } from "../selection-mode.ts";

describe("selection-mode", () => {
	it("SingleSelect reports single mode and no-op toggle", () => {
		expect(SingleSelect.multi).toBe(false);
		const checked = new Set<number>([1]);
		SingleSelect.toggle(checked, 0);
		expect([...checked]).toEqual([1]);
	});

	it("SingleSelect buildResult returns the selected value", () => {
		const options = [{ value: "a", label: "A" }];
		expect(SingleSelect.buildResult({ selectedIndex: 0, checked: new Set(), options })).toEqual(["a"]);
		// Out-of-range index (or empty options) → no value → empty result.
		expect(SingleSelect.buildResult({ selectedIndex: 2, checked: new Set(), options })).toEqual([]);
		expect(SingleSelect.buildResult({ selectedIndex: 0, checked: new Set(), options: [] })).toEqual([]);
	});

	it("SingleSelect handleNumberKey clamps to the last option", () => {
		expect(SingleSelect.handleNumberKey(5, 3)).toEqual({ toggle: false, selectIndex: 2 });
		expect(SingleSelect.handleNumberKey(1, 3)).toEqual({ toggle: false, selectIndex: 1 });
	});

	it("MultiSelect toggle adds, removes, and ignores negative indexes", () => {
		expect(MultiSelect.multi).toBe(true);
		const checked = new Set<number>();
		MultiSelect.toggle(checked, 0);
		expect(checked.has(0)).toBe(true);
		MultiSelect.toggle(checked, 0);
		expect(checked.has(0)).toBe(false);
		MultiSelect.toggle(checked, -1);
		expect(checked.size).toBe(0);
	});

	it("MultiSelect buildResult sorts and filters missing options", () => {
		const options = [
			{ value: "a", label: "A" },
			{ value: "b", label: "B" },
		];
		const checked = new Set([1, 0]);
		expect(MultiSelect.buildResult({ selectedIndex: 0, checked, options })).toEqual(["a", "b"]);
		// Indexes pointing past the options array are filtered out.
		const sparse = new Set([0, 1, 2]);
		expect(MultiSelect.buildResult({ selectedIndex: 0, checked: sparse, options })).toEqual(["a", "b"]);
		expect(MultiSelect.buildResult({ selectedIndex: 0, checked: new Set(), options })).toEqual([]);
	});

	it("MultiSelect handleNumberKey clamps to the last option", () => {
		expect(MultiSelect.handleNumberKey(5, 3)).toEqual({ toggle: true, selectIndex: 2 });
		expect(MultiSelect.handleNumberKey(0, 3)).toEqual({ toggle: true, selectIndex: 0 });
	});
});
