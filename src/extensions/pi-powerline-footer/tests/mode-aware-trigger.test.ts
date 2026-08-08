import { describe, expect, it } from "vitest";
import { Editor } from "@earendil-works/pi-tui";
import { createInlineSkillAutocompleteProvider } from "../../../extensions/inline-skills.ts";
import { createInlineSubagentAutocompleteProvider } from "../../../extensions/pi-subagents/src/slash/inline-subagents.ts";
import { ModeAwareAutocompleteProvider, BashAutocompleteProvider, OneOffBashAutocompleteProvider } from "../bash-mode/completion.ts";

const fakeTui = { requestRender() {}, terminal: { rows: 50 } } as never;
const pi = {
	getCommands: () => [
		{ name: "skill:grill-me", description: "Grill", source: "skill", sourceInfo: { path: "C:/x/grill.md" } },
		{ name: "skill:research", description: "Research", source: "skill", sourceInfo: { path: "C:/x/research.md" } },
	],
	on: () => {},
} as never;

const baseProvider: any = {
	triggerCharacters: [],
	async getSuggestions() {
		return null;
	},
	applyCompletion(lines: string[], cursorLine: number, cursorCol: number) {
		return { lines, cursorLine, cursorCol };
	},
	shouldTriggerFileCompletion() {
		return true;
	},
};

const popupValues = (e: Editor) =>
	(e as any).autocompleteState ? ((e as any).autocompleteList?.items ?? []).map((i: any) => i.value) : null;

async function typeInto(e: Editor, text: string) {
	for (const ch of text) {
		(e as any).insertCharacter(ch);
		await (e as any).autocompleteRequestTask;
		await new Promise((r) => setTimeout(r, 80));
	}
}

function buildChain() {
	let provider: any = baseProvider;
	for (const wrap of [
		(c: any) => createInlineSkillAutocompleteProvider(pi, c),
		(c: any) => createInlineSubagentAutocompleteProvider({ baseCwd: process.cwd() }, c),
	]) {
		provider = wrap(provider);
	}
	provider.triggerCharacters = [...new Set(["$", "#"])];
	return provider;
}

describe("powerline ModeAware wrapper must forward trigger characters", () => {
	it("keeps $ after wrapping and shows skills for the user's three inputs", async () => {
		const chain = buildChain();
		// powerline: editor.installAutocompleteProvider(new ModeAware(chain, bash, oneOffBash))
		const wrapped = new ModeAwareAutocompleteProvider(chain, new BashAutocompleteProvider(), new OneOffBashAutocompleteProvider(), () => false);

		const e = new Editor(fakeTui as any, { borderColor: "x" } as any);
		e.setAutocompleteProvider(wrapped as any);
		console.log("triggerChars after wrap:", (e as any).autocompleteTriggerCharacters);
		expect((e as any).autocompleteTriggerCharacters).toContain("$");

		await typeInto(e, "$gril");
		console.log("'$gril' ->", JSON.stringify(popupValues(e)));
		expect(popupValues(e) ?? []).toContain("$grill-me");

		const e2 = new Editor(fakeTui as any, { borderColor: "x" } as any);
		e2.setAutocompleteProvider(wrapped as any);
		await typeInto(e2, "asdf $gril");
		console.log("'asdf $gril' ->", JSON.stringify(popupValues(e2)));
		expect(popupValues(e2) ?? []).toContain("$grill-me");

		const e3 = new Editor(fakeTui as any, { borderColor: "x" } as any);
		e3.setAutocompleteProvider(wrapped as any);
		await typeInto(e3, "asdf #builder $gril");
		console.log("'asdf #builder $gril' ->", JSON.stringify(popupValues(e3)));
		expect(popupValues(e3) ?? []).toContain("$grill-me");
	});
});
