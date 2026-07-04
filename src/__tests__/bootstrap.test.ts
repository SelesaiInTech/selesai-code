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

	it("seeds bundled skills into user skill dir but skips existing", () => {
		mkdirSync(join(bundled, "skills", "grill-me"), { recursive: true });
		writeFileSync(join(bundled, "skills", "grill-me", "SKILL.md"), "---\ndescription: Grill\n---\n");

		const written = seedDefaultSkills(dir, join(bundled, "skills"));
		expect(written).toEqual([join(dir, "skills", "grill-me", "SKILL.md")]);
		expect(existsSync(join(dir, "skills", "grill-me", "SKILL.md"))).toBe(true);

		writeFileSync(join(dir, "skills", "grill-me", "SKILL.md"), "---\ndescription: User Grill\n---\n");
		expect(seedDefaultSkills(dir, join(bundled, "skills"))).toEqual([]);
		expect(readFileSync(join(dir, "skills", "grill-me", "SKILL.md"), "utf-8")).toBe(
			"---\ndescription: User Grill\n---\n",
		);
	});

	it("keeps user-edited skills that differ from bundled files", () => {
		mkdirSync(join(bundled, "skills", "grill-me"), { recursive: true });
		mkdirSync(join(dir, "skills", "grill-me"), { recursive: true });
		writeFileSync(join(bundled, "skills", "grill-me", "SKILL.md"), "---\ndescription: Grill\n---\n");
		writeFileSync(join(dir, "skills", "grill-me", "SKILL.md"), "---\ndescription: User Grill\n---\n");

		expect(seedDefaultSkills(dir, join(bundled, "skills"))).toEqual([]);
		expect(readFileSync(join(dir, "skills", "grill-me", "SKILL.md"), "utf-8")).toBe(
			"---\ndescription: User Grill\n---\n",
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
});
