import { describe, expect, it } from "vitest";
import { QuestionList } from "../question-list.ts";
import { SingleSelect } from "../selection-mode.ts";
import type { KeybindingsManager, Theme } from "@selesai/code";
import type { ResolvedShortcut } from "../types.ts";

const fakeTheme = { fg: (_n: string, s: string) => s, bold: (s: string) => s } as unknown as Theme;
const fakeKeybindings = (actions: string[] = []): KeybindingsManager =>
	({ matches: (_d: string, a: string) => actions.includes(a), getKeys: () => [] }) as unknown as KeybindingsManager;
const disabledShortcut: ResolvedShortcut = { disabled: true, spec: null, matches: ((_d: string) => false) as (d: string) => false };

describe("ig3", () => {
	it("confirm option", () => {
		const list = new QuestionList([{ value: "a", label: "A" }], SingleSelect, false, false, fakeTheme, fakeKeybindings(["tui.select.confirm"]), disabledShortcut);
		let submitted = false;
		list.onSubmit = () => (submitted = true);
		list.handleInput("\r");
		expect(submitted).toBe(true);
	});
});
