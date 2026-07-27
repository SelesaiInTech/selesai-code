import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@selesai/code";
import inlineSkillsExtension, { createInlineSkillAutocompleteProvider, expandInlineSkills } from "./inline-skills.ts";

const skill = (name: string, path: string, description = `${name} description`) => ({
	name: `skill:${name}`,
	description,
	source: "skill" as const,
	sourceInfo: { path },
});

function createPi(commands: ReturnType<typeof skill>[]) {
	return { getCommands: vi.fn(() => commands), on: vi.fn() } as unknown as ExtensionAPI;
}

describe("inline-skills", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("suggests skills after # anywhere in a line", async () => {
		const pi = createPi([skill("research", "/skills/research/SKILL.md"), skill("review", "/skills/review/SKILL.md")]);
		const base = {
			getSuggestions: vi.fn(async () => null),
			applyCompletion: vi.fn(),
		} as any;
		const provider = createInlineSkillAutocompleteProvider(pi, base);

		const suggestions = await provider.getSuggestions(["Draft #res"], 0, 10, {} as any);

		expect(provider.triggerCharacters).toEqual(["#"]);
		expect(suggestions).toEqual({
			prefix: "#res",
			items: [{ value: "#research", label: "#research", description: "research description" }],
		});
	});

	it("expands known inline skills and leaves unknown hashtags untouched", () => {
		const dir = mkdtempSync(join(tmpdir(), "inline-skills-"));
		tempDirs.push(dir);
		const file = join(dir, "SKILL.md");
		writeFileSync(file, "---\nname: research\ndescription: Research facts\n---\n\nUse primary sources.\n");
		const pi = createPi([skill("research", file)]);

		const text = expandInlineSkills("Plan first #research then write; keep #unknown and #research_note literal.", pi);

		expect(text).toContain("Plan first <skill name=\"research\"");
		expect(text).toContain("References are relative to " + dir);
		expect(text).toContain("Use primary sources.");
		expect(text).toContain("</skill> then write; keep #unknown and #research_note literal.");
	});

	it("registers autocomplete and transforms interactive input", () => {
		const dir = mkdtempSync(join(tmpdir(), "inline-skills-"));
		tempDirs.push(dir);
		const file = join(dir, "SKILL.md");
		writeFileSync(file, "---\ndescription: Research facts\n---\nUse primary sources.\n");
		const handlers = new Map<string, Function>();
		const pi = {
			getCommands: vi.fn(() => [skill("research", file)]),
			on: vi.fn((event: string, handler: Function) => handlers.set(event, handler)),
		} as unknown as ExtensionAPI;
		const addAutocompleteProvider = vi.fn();

		inlineSkillsExtension(pi);
		handlers.get("session_start")!({}, { ui: { addAutocompleteProvider } } as unknown as ExtensionContext);
		const result = handlers.get("input")!({ text: "Use #research now", source: "interactive" });

		expect(addAutocompleteProvider).toHaveBeenCalledOnce();
		expect(result).toMatchObject({ action: "transform", text: expect.stringContaining("<skill name=\"research\"") });
		expect(handlers.get("input")!({ text: "#research", source: "extension" })).toEqual({ action: "continue" });
	});
});
