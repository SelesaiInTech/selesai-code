import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	bootstrapAgentDir,
	ensureAgentDir,
	getFirstRunMarkerPath,
	markFirstRunComplete,
	seedDefaultConfigFile,
	seedDefaultExtensions,
	seedDefaultThemes,
	seedMissingSubagentSettings,
	seedDefaultSkills,
} from "../config.js";

describe("agent dir bootstrap", () => {
	let dir: string;
	let bundled: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "selesai-bootstrap-"));
		bundled = mkdtempSync(join(tmpdir(), "selesai-bundled-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
		rmSync(bundled, { recursive: true, force: true });
	});

	it("ensureAgentDir creates all subdirs and is idempotent", () => {
		ensureAgentDir(dir);
		ensureAgentDir(dir); // no throw on re-run
		for (const sub of ["themes", "tools", "bin", "prompts", "sessions", "extensions", "skills"]) {
			expect(existsSync(join(dir, sub))).toBe(true);
		}
	});

	it("seeds settings.json from bundled defaults but never overwrites", () => {
		writeFileSync(join(bundled, "settings.json"), '{"theme":"x"}');
		const dest = join(dir, "settings.json");
		expect(seedDefaultConfigFile(dest, "settings.json", bundled)).toBe(dest);
		expect(JSON.parse(readFileSync(dest, "utf-8")).theme).toBe("x");
		// user edit must survive a second bootstrap
		writeFileSync(dest, '{"theme":"user"}');
		expect(seedDefaultConfigFile(dest, "settings.json", bundled)).toBeUndefined();
		expect(JSON.parse(readFileSync(dest, "utf-8")).theme).toBe("user");
	});

	it("adds bundled subagent settings to existing user settings without overwriting them", () => {
		writeFileSync(
			join(bundled, "settings.json"),
			JSON.stringify({ subagents: { defaultModel: "bundled", agentOverrides: { builder: { model: "fast" } } } }),
		);
		const dest = join(dir, "settings.json");
		writeFileSync(dest, JSON.stringify({ theme: "user" }));

		expect(seedMissingSubagentSettings(dest, bundled)).toBe(true);
		expect(JSON.parse(readFileSync(dest, "utf-8"))).toEqual({
			theme: "user",
			subagents: { defaultModel: "bundled", agentOverrides: { builder: { model: "fast" } } },
		});
	});

	it("preserves configured subagent settings", () => {
		writeFileSync(join(bundled, "settings.json"), JSON.stringify({ subagents: { defaultModel: "bundled" } }));
		const dest = join(dir, "settings.json");
		writeFileSync(dest, JSON.stringify({ subagents: { defaultModel: "user" } }));

		expect(seedMissingSubagentSettings(dest, bundled)).toBe(false);
		expect(JSON.parse(readFileSync(dest, "utf-8"))).toEqual({ subagents: { defaultModel: "user" } });
	});

	it("supplies missing subagent defaults without reformatting unrelated user settings", () => {
		writeFileSync(join(bundled, "settings.json"), JSON.stringify({ subagents: { defaultModel: "bundled" } }));
		const dest = join(dir, "settings.json");
		const userRaw = '{\n  "theme": "user",\n  "customPlugin": { "enabled": true },\n  "unknownFutureKey": [1, 2, 3]\n}';
		writeFileSync(dest, userRaw);

		expect(seedMissingSubagentSettings(dest, bundled)).toBe(true);
		expect(readFileSync(dest, "utf-8")).toBe(
			'{\n  "theme": "user",\n  "customPlugin": { "enabled": true },\n  "unknownFutureKey": [1, 2, 3], "subagents": {"defaultModel":"bundled"}\n}',
		);
		// every original user byte survives verbatim; only the new key was added
		expect(JSON.parse(readFileSync(dest, "utf-8"))).toEqual({
			theme: "user",
			customPlugin: { enabled: true },
			unknownFutureKey: [1, 2, 3],
			subagents: { defaultModel: "bundled" },
		});
	});

	it("leaves invalid user settings untouched", () => {
		writeFileSync(join(bundled, "settings.json"), JSON.stringify({ subagents: { defaultModel: "bundled" } }));
		const dest = join(dir, "settings.json");
		const brokenRaw = '{\n  "theme": "user",\n';
		writeFileSync(dest, brokenRaw);

		expect(seedMissingSubagentSettings(dest, bundled)).toBe(false);
		expect(readFileSync(dest, "utf-8")).toBe(brokenRaw);
	});

	it("bootstrapAgentDir is a safe no-op when bundled dirs are empty", () => {
		expect(() => bootstrapAgentDir(dir)).not.toThrow();
		// re-run still clean
		expect(() => bootstrapAgentDir(dir)).not.toThrow();
	});

	it("does not copy models.json into the user agent dir", () => {
		bootstrapAgentDir(dir);
		expect(existsSync(join(dir, "models.json"))).toBe(false);
	});

	it("first-run marker is written once and gates re-onboarding", () => {
		const marker = getFirstRunMarkerPath(dir);
		expect(existsSync(marker)).toBe(false);
		markFirstRunComplete(dir);
		expect(existsSync(marker)).toBe(true);
		// re-marking is idempotent
		expect(() => markFirstRunComplete(dir)).not.toThrow();
	});

	it("does not seed bundled extensions into user extension dir", () => {
		mkdirSync(join(bundled, "extensions"), { recursive: true });
		writeFileSync(join(bundled, "extensions", "question.ts"), "export default {};");

		expect(seedDefaultExtensions(dir, join(bundled, "extensions"))).toEqual([]);
		expect(existsSync(join(dir, "extensions", "question.ts"))).toBe(false);
	});

	it("seeds bundled skills into user skill dir, overwriting existing copies", () => {
		mkdirSync(join(bundled, "skills", "grill-me"), { recursive: true });
		writeFileSync(join(bundled, "skills", "grill-me", "SKILL.md"), "---\ndescription: Grill\n---\n");

		const written = seedDefaultSkills(dir, join(bundled, "skills"));
		expect(written).toEqual([join(dir, "skills", "grill-me", "SKILL.md")]);
		expect(existsSync(join(dir, "skills", "grill-me", "SKILL.md"))).toBe(true);

		// an existing (possibly stale/edited) user copy is replaced by the bundled file
		writeFileSync(join(dir, "skills", "grill-me", "SKILL.md"), "---\ndescription: User Grill\n---\n");
		expect(seedDefaultSkills(dir, join(bundled, "skills"))).toEqual([join(dir, "skills", "grill-me", "SKILL.md")]);
		expect(readFileSync(join(dir, "skills", "grill-me", "SKILL.md"), "utf-8")).toBe(
			"---\ndescription: Grill\n---\n",
		);
	});

	it("replaces a stale user skill with the bundled authoritative copy", () => {
		mkdirSync(join(bundled, "skills", "pi-subagents"), { recursive: true });
		mkdirSync(join(dir, "skills", "pi-subagents"), { recursive: true });
		writeFileSync(join(bundled, "skills", "pi-subagents", "SKILL.md"), "---\ndescription: Delegate\n---\n");
		writeFileSync(join(dir, "skills", "pi-subagents", "SKILL.md"), "---\ndescription: Old stale copy\n---\n");

		expect(seedDefaultSkills(dir, join(bundled, "skills"))).toEqual([join(dir, "skills", "pi-subagents", "SKILL.md")]);
		expect(readFileSync(join(dir, "skills", "pi-subagents", "SKILL.md"), "utf-8")).toBe(
			"---\ndescription: Delegate\n---\n",
		);
	});

	it("installs new bundled skills while leaving user-only skills untouched", () => {
		mkdirSync(join(bundled, "skills", "pi-subagents"), { recursive: true });
		mkdirSync(join(dir, "skills", "user-custom"), { recursive: true });
		writeFileSync(join(bundled, "skills", "pi-subagents", "SKILL.md"), "---\ndescription: Delegate\n---\n");
		writeFileSync(join(dir, "skills", "user-custom", "SKILL.md"), "---\ndescription: Custom\n---\n");

		const written = seedDefaultSkills(dir, join(bundled, "skills"));
		expect(written).toEqual([join(dir, "skills", "pi-subagents", "SKILL.md")]);
		expect(readFileSync(join(dir, "skills", "user-custom", "SKILL.md"), "utf-8")).toBe(
			"---\ndescription: Custom\n---\n",
		);
		expect(readFileSync(join(dir, "skills", "pi-subagents", "SKILL.md"), "utf-8")).toBe(
			"---\ndescription: Delegate\n---\n",
		);
	});

	it("removes older seeded extensions only when identical to bundled files", () => {
		mkdirSync(join(bundled, "extensions"), { recursive: true });
		mkdirSync(join(dir, "extensions"), { recursive: true });
		writeFileSync(join(bundled, "extensions", "question.ts"), "export default {};");
		writeFileSync(join(dir, "extensions", "question.ts"), "export default {};");
		writeFileSync(join(dir, "extensions", "custom.ts"), "export default 'custom';");

		expect(seedDefaultExtensions(dir, join(bundled, "extensions"))).toEqual([]);
		expect(existsSync(join(dir, "extensions", "question.ts"))).toBe(false);
		expect(existsSync(join(dir, "extensions", "custom.ts"))).toBe(true);
	});

	it("keeps user-edited extensions that differ from bundled files", () => {
		mkdirSync(join(bundled, "extensions"), { recursive: true });
		mkdirSync(join(dir, "extensions"), { recursive: true });
		writeFileSync(join(bundled, "extensions", "question.ts"), "export default {};");
		writeFileSync(join(dir, "extensions", "question.ts"), "export default 'user';");

		expect(seedDefaultExtensions(dir, join(bundled, "extensions"))).toEqual([]);
		expect(readFileSync(join(dir, "extensions", "question.ts"), "utf-8")).toBe("export default 'user';");
	});

	it("removes older seeded themes only when identical to bundled files", () => {
		mkdirSync(join(bundled, "themes"), { recursive: true });
		mkdirSync(join(dir, "themes"), { recursive: true });
		writeFileSync(join(bundled, "themes", "nord.json"), "{}");
		writeFileSync(join(dir, "themes", "nord.json"), "{}");
		writeFileSync(join(dir, "themes", "custom.json"), "{}");

		expect(seedDefaultThemes(dir, join(bundled, "themes"))).toEqual([join(dir, "themes", "nord.json")]);
		expect(existsSync(join(dir, "themes", "nord.json"))).toBe(false);
		expect(existsSync(join(dir, "themes", "custom.json"))).toBe(true);
	});

	it("keeps user-edited themes that differ from bundled files", () => {
		mkdirSync(join(bundled, "themes"), { recursive: true });
		mkdirSync(join(dir, "themes"), { recursive: true });
		writeFileSync(join(bundled, "themes", "nord.json"), "{}");
		writeFileSync(join(dir, "themes", "nord.json"), "\"user\"");

		expect(seedDefaultThemes(dir, join(bundled, "themes"))).toEqual([]);
		expect(readFileSync(join(dir, "themes", "nord.json"), "utf-8")).toBe("\"user\"");
	});
});
