import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { BUILTIN_AGENT_NAMES } from "../../src/agents/agents.ts";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const README_PATH = path.join(packageRoot, "README.md");
const PROMPTING_AND_ROLES_PATH = path.join(packageRoot, "skills", "pi-subagents", "references", "prompting-and-roles.md");

const README_TABLE_HEADING = "## Builtin agents";
const PROMPTING_AND_ROLES_TABLE_HEADING = "## Builtin Agents";

/**
 * Extracts the first-column agent names from every table row under the given
 * markdown section heading. Skips the header row and the separator row.
 */
function tableFirstColumnNames(markdown: string, sectionHeading: string): string[] {
	const lines = markdown.split(/\r?\n/);
	const headingIndex = lines.findIndex((line) => line.trim() === sectionHeading);
	assert.ok(headingIndex >= 0, `missing section heading: ${sectionHeading}`);

	const names: string[] = [];
	for (let i = headingIndex + 1; i < lines.length; i++) {
		const line = lines[i]!.trim();
		if (line.startsWith("#")) break;
		if (!line.startsWith("|")) continue;

		const cells = line.split("|").map((cell) => cell.trim());
		const firstCell = (cells[1] ?? "").replaceAll("`", "").trim();
		if (firstCell === "Agent") continue;
		if (/^:?-+:?$/.test(firstCell)) continue;
		if (firstCell.length === 0) continue;
		names.push(firstCell);
	}
	return names;
}

function assertExactlyBuiltins(tablePath: string, heading: string, markdown: string): void {
	const names = tableFirstColumnNames(markdown, heading);

	assert.equal(names.length, BUILTIN_AGENT_NAMES.length, `${path.basename(tablePath)}: role table must contain exactly ${BUILTIN_AGENT_NAMES.length} builtin rows`);
	assert.equal(new Set(names).size, names.length, `${path.basename(tablePath)}: role table contains duplicate rows`);
	assert.deepEqual(
		[...names].sort(),
		[...BUILTIN_AGENT_NAMES].sort(),
		`${path.basename(tablePath)}: role table must list exactly ${BUILTIN_AGENT_NAMES.join(", ")} once each, with no aliases`,
	);
}

describe("builtin agent documentation role tables", () => {
	it("README lists exactly the canonical builtins once, with no duplicates or aliases", () => {
		const markdown = fs.readFileSync(README_PATH, "utf-8");
		assertExactlyBuiltins(README_PATH, README_TABLE_HEADING, markdown);
	});

	it("prompting-and-roles reference lists exactly the canonical builtins once, with no duplicates or aliases", () => {
		const markdown = fs.readFileSync(PROMPTING_AND_ROLES_PATH, "utf-8");
		assertExactlyBuiltins(PROMPTING_AND_ROLES_PATH, PROMPTING_AND_ROLES_TABLE_HEADING, markdown);
	});
});
