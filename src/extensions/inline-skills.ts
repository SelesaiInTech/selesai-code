import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { stripFrontmatter, type ExtensionAPI, type SlashCommandInfo } from "@selesai/code";
import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";

type SkillCommand = SlashCommandInfo & { source: "skill" };

const INLINE_SKILL_TOKEN = /(^|[^a-z0-9_-])\$([a-z0-9]+(?:-[a-z0-9]+)*)(?![a-z0-9_-])/gi;

function getSkillCommands(pi: ExtensionAPI): SkillCommand[] {
	return pi
		.getCommands()
		.filter(
			(command): command is SkillCommand =>
				command.source === "skill" && command.name.startsWith("skill:"),
		);
}

function getSkillName(command: SkillCommand): string {
	return command.name.slice("skill:".length);
}

function getInlineSkillToken(textBeforeCursor: string): string | undefined {
	const match = textBeforeCursor.match(/(?:^|[^a-z0-9_-])\$([a-z0-9-]*)$/i);
	return match ? match[1] ?? "" : undefined;
}

export function createInlineSkillAutocompleteProvider(pi: ExtensionAPI, current: AutocompleteProvider): AutocompleteProvider {
	return {
		triggerCharacters: ["$"],
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			const token = getInlineSkillToken((lines[cursorLine] ?? "").slice(0, cursorCol));
			if (token === undefined) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			let items: AutocompleteItem[];
			try {
				items = getSkillCommands(pi)
					.filter((command) => getSkillName(command).includes(token.toLowerCase()))
					.map((command) => ({
						value: `$${getSkillName(command)}`,
						label: `$${getSkillName(command)}`,
						description: command.description,
					}));
			} catch {
				// Never let a getCommands failure reject the editor's shared autocomplete
				// request chain (a single rejection permanently disables all autocomplete).
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			return items.length > 0 ? { prefix: `$${token}`, items } : current.getSuggestions(lines, cursorLine, cursorCol, options);
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
		},
		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

export function expandInlineSkills(text: string, pi: ExtensionAPI): string {
	const skills = new Map(getSkillCommands(pi).map((command) => [getSkillName(command), command]));
	const selected: SkillCommand[] = [];
	const seen = new Set<string>();

	for (const match of text.matchAll(INLINE_SKILL_TOKEN)) {
		const command = skills.get(match[2].toLowerCase());
		if (!command || seen.has(command.name)) continue;
		seen.add(command.name);
		selected.push(command);
	}

	const blocks = selected.flatMap((command) => {
		try {
			const body = stripFrontmatter(readFileSync(command.sourceInfo.path, "utf-8")).trim();
			const location = command.sourceInfo.path;
			return [`<skill name="${getSkillName(command)}" location="${location}">\nReferences are relative to ${dirname(location)}.\n\n${body}\n</skill>`];
		} catch {
			return [];
		}
	});

	return blocks.length > 0 ? `${blocks.join("\n\n")}\n\n${text}` : text;
}

export default function inlineSkillsExtension(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.addAutocompleteProvider((current) => createInlineSkillAutocompleteProvider(pi, current));
	});

	pi.on("input", (event) => {
		if (event.source === "extension") return { action: "continue" };

		const text = expandInlineSkills(event.text, pi);
		return text === event.text ? { action: "continue" } : { action: "transform", text };
	});
}
