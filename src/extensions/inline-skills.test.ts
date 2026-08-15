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
		for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	it("suggests skills after $ anywhere in a line", async () => {
		const pi = createPi([skill("research", "/skills/research/SKILL.md"), skill("review", "/skills/review/SKILL.md")]);
		const base = { getSuggestions: vi.fn(async () => null), applyCompletion: vi.fn() } as any;
		const provider = createInlineSkillAutocompleteProvider(pi, base);

		expect(await provider.getSuggestions(["Draft $res"], 0, 10, {} as any)).toEqual({
			prefix: "$res",
			items: [{ value: "$research", label: "$research", description: "research description" }],
		});
	});

	it("suggests skills matching a later hyphenated segment", async () => {
		const pi = createPi([skill("batch-grill-me", "/skills/batch-grill-me/SKILL.md")]);
		const base = { getSuggestions: vi.fn(async () => null), applyCompletion: vi.fn() } as any;
		const provider = createInlineSkillAutocompleteProvider(pi, base);

		expect(await provider.getSuggestions(["$grill"], 0, 6, {} as any)).toEqual({
			prefix: "$grill",
			items: [{ value: "$batch-grill-me", label: "$batch-grill-me", description: "batch-grill-me description" }],
		});
	});

	it("prepends every referenced skill and preserves the original prompt", () => {
		const dir = mkdtempSync(join(tmpdir(), "inline-skills-"));
		tempDirs.push(dir);
		const research = join(dir, "research.md");
		const grill = join(dir, "grill.md");
		writeFileSync(research, "---\nname: research\ndescription: Research\n---\nResearch instructions.\n");
		writeFileSync(grill, "---\nname: batch-grill-me\ndescription: Grill\n---\nGrill instructions.\n");
		const pi = createPi([skill("research", research), skill("batch-grill-me", grill)]);
		const prompt = "Plan with $research and $batch-grill-me; keep $unknown.";

		const text = expandInlineSkills(prompt, pi);

		expect(text.match(/<skill name=/g)).toHaveLength(2);
		expect(text).toContain("Research instructions.");
		expect(text).toContain("Grill instructions.");
		expect(text).toContain("do not read its file again");
		expect(text.endsWith(prompt)).toBe(true);
	});

	it("deduplicates repeated skill references", () => {
		const dir = mkdtempSync(join(tmpdir(), "inline-skills-"));
		tempDirs.push(dir);
		const file = join(dir, "research.md");
		writeFileSync(file, "---\ndescription: Research\n---\nResearch instructions.\n");
		const text = expandInlineSkills("Use $research, then $research again", createPi([skill("research", file)]));

		expect(text.match(/<skill name=/g)).toHaveLength(1);
		expect(text.endsWith("Use $research, then $research again")).toBe(true);
	});

	it("falls back to the base provider instead of rejecting when getCommands throws", async () => {
		const pi = {
			getCommands: vi.fn(() => {
				throw new Error("getCommands failed");
			}),
			on: vi.fn(),
		} as unknown as ExtensionAPI;
		const base = { getSuggestions: vi.fn(async () => null), applyCompletion: vi.fn() } as any;
		const provider = createInlineSkillAutocompleteProvider(pi, base);

		await expect(provider.getSuggestions(["$res"], 0, 4, {} as any)).resolves.toBeNull();
		expect(base.getSuggestions).toHaveBeenCalled();
	});

	it("registers autocomplete and transforms interactive input", () => {
		const dir = mkdtempSync(join(tmpdir(), "inline-skills-"));
		tempDirs.push(dir);
		const file = join(dir, "research.md");
		writeFileSync(file, "---\ndescription: Research\n---\nResearch instructions.\n");
		const handlers = new Map<string, Function>();
		const pi = {
			getCommands: vi.fn(() => [skill("research", file)]),
			on: vi.fn((event: string, handler: Function) => handlers.set(event, handler)),
		} as unknown as ExtensionAPI;
		const addAutocompleteProvider = vi.fn();

		inlineSkillsExtension(pi);
		handlers.get("session_start")!({}, { ui: { addAutocompleteProvider } } as unknown as ExtensionContext);
		const result = handlers.get("input")!({ text: "Use $research now", source: "interactive" });

		expect(addAutocompleteProvider).toHaveBeenCalledOnce();
		expect(result).toMatchObject({ action: "transform", text: expect.stringMatching(/<skill[\s\S]*Use \$research now$/) });
		expect(handlers.get("input")!({ text: "$research", source: "extension" })).toEqual({ action: "continue" });
	});

	it("delegates applyCompletion and shouldTriggerFileCompletion to the base provider", async () => {
		const pi = createPi([skill("research", "/skills/research/SKILL.md")]);
		const base = {
			getSuggestions: vi.fn(async () => null),
			applyCompletion: vi.fn(() => "applied"),
			shouldTriggerFileCompletion: vi.fn(() => false),
		} as any;
		const provider = createInlineSkillAutocompleteProvider(pi, base);

		expect(provider.applyCompletion(["a"], 0, 1, {} as any, "$")).toBe("applied");
		expect(base.applyCompletion).toHaveBeenCalledWith(["a"], 0, 1, {}, "$");
		expect(provider.shouldTriggerFileCompletion(["a"], 0, 1)).toBe(false);
		expect(base.shouldTriggerFileCompletion).toHaveBeenCalledWith(["a"], 0, 1);
	});

	it("shouldTriggerFileCompletion defaults to true when the base provider lacks it", () => {
		const pi = createPi([skill("research", "/skills/research/SKILL.md")]);
		const base = { getSuggestions: vi.fn(async () => null), applyCompletion: vi.fn() } as any;
		const provider = createInlineSkillAutocompleteProvider(pi, base);

		expect(provider.shouldTriggerFileCompletion(["a"], 0, 1)).toBe(true);
	});

	it("falls back to the base provider when no $ token is present", async () => {
		const pi = createPi([skill("research", "/skills/research/SKILL.md")]);
		const base = { getSuggestions: vi.fn(async () => "base-result"), applyCompletion: vi.fn() } as any;
		const provider = createInlineSkillAutocompleteProvider(pi, base);

		expect(await provider.getSuggestions(["plain text"], 0, 5, {} as any)).toBe("base-result");
		expect(base.getSuggestions).toHaveBeenCalledWith(["plain text"], 0, 5, {});
	});

	it("handles a missing line and a bare $ token", async () => {
		const pi = createPi([skill("research", "/skills/research/SKILL.md")]);
		const base = { getSuggestions: vi.fn(async () => null), applyCompletion: vi.fn() } as any;
		const provider = createInlineSkillAutocompleteProvider(pi, base);

		// cursorLine beyond the array → lines[cursorLine] is undefined → "" slice.
		expect(await provider.getSuggestions([], 3, 0, {} as any)).toBeNull();
		// Bare "$" at end of line → empty token → all skills match (includes("")).
		const bare = await provider.getSuggestions(["draft $"], 0, 7, {} as any);
		expect(bare).toEqual({
			prefix: "$",
			items: [{ value: "$research", label: "$research", description: "research description" }],
		});
	});

	it("falls back to the base provider when no skills match the token", async () => {
		const pi = createPi([skill("research", "/skills/research/SKILL.md")]);
		const base = { getSuggestions: vi.fn(async () => "base-result"), applyCompletion: vi.fn() } as any;
		const provider = createInlineSkillAutocompleteProvider(pi, base);

		expect(await provider.getSuggestions(["$zzz"], 0, 4, {} as any)).toBe("base-result");
	});

	it("skips skills whose files fail to read", () => {
		const pi = createPi([skill("missing", "/nonexistent/SKILL.md")]);
		const text = expandInlineSkills("Use $missing now", pi);
		expect(text).toBe("Use $missing now");
	});

	it("session_start provider callback wraps the current provider", async () => {
		const dir = mkdtempSync(join(tmpdir(), "inline-skills-"));
		tempDirs.push(dir);
		const file = join(dir, "research.md");
		writeFileSync(file, "---\ndescription: Research\n---\nResearch instructions.\n");
		const handlers = new Map<string, Function>();
		const pi = {
			getCommands: vi.fn(() => [skill("research", file)]),
			on: vi.fn((event: string, handler: Function) => handlers.set(event, handler)),
		} as unknown as ExtensionAPI;
		let captured: any = null;
		inlineSkillsExtension(pi);
		handlers.get("session_start")!({}, { ui: { addAutocompleteProvider: (cb: any) => (captured = cb) } } as unknown as ExtensionContext);

		const base = { getSuggestions: vi.fn(async () => null), applyCompletion: vi.fn() } as any;
		const provider = captured(base);
		expect(await provider.getSuggestions(["$res"], 0, 4, {} as any)).toEqual({
			prefix: "$res",
			items: [{ value: "$research", label: "$research", description: "research description" }],
		});
	});

	it("input without skill tokens passes through unchanged", () => {
		const handlers = new Map<string, Function>();
		const pi = {
			getCommands: vi.fn(() => []),
			on: vi.fn((event: string, handler: Function) => handlers.set(event, handler)),
		} as unknown as ExtensionAPI;
		inlineSkillsExtension(pi);
		expect(handlers.get("input")!({ text: "plain text", source: "interactive" })).toEqual({ action: "continue" });
	});
});
