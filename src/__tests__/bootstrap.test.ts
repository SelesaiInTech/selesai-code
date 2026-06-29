import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	bootstrapAgentDir,
	ensureAgentDir,
	getFirstRunMarkerPath,
	markFirstRunComplete,
	seedDefaultAgents,
	seedDefaultConfigFile,
	seedDefaultExtensions,
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
		for (const sub of ["themes", "tools", "bin", "prompts", "sessions", "extensions", "skills", "agents"]) {
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

	it("first-run marker is written once and gates re-onboarding", () => {
		const marker = getFirstRunMarkerPath(dir);
		expect(existsSync(marker)).toBe(false);
		markFirstRunComplete(dir);
		expect(existsSync(marker)).toBe(true);
		// re-marking is idempotent
		expect(() => markFirstRunComplete(dir)).not.toThrow();
	});

	it("seedDefaultAgents copies bundled .md files but skips existing", () => {
		mkdirSync(join(bundled, "agents"), { recursive: true });
		writeFileSync(join(bundled, "agents", "architect.md"), "# architect");
		writeFileSync(join(bundled, "agents", "builder.md"), "# builder");
		// non-markdown files must be skipped
		writeFileSync(join(bundled, "agents", "notes.txt"), "ignore me");

		const written = seedDefaultAgents(dir, join(bundled, "agents"));
		expect(written).toHaveLength(2);
		expect(existsSync(join(dir, "agents", "architect.md"))).toBe(true);
		expect(existsSync(join(dir, "agents", "builder.md"))).toBe(true);
		expect(existsSync(join(dir, "agents", "notes.txt"))).toBe(false);

		// user edit survives a second seed
		writeFileSync(join(dir, "agents", "architect.md"), "# user override");
		const second = seedDefaultAgents(dir, join(bundled, "agents"));
		expect(second).toHaveLength(0);
		expect(readFileSync(join(dir, "agents", "architect.md"), "utf-8")).toBe("# user override");
	});

	it("seedDefaultAgents is a no-op when bundled dir is missing", () => {
		expect(seedDefaultAgents(dir, join(bundled, "agents"))).toEqual([]);
		expect(existsSync(join(dir, "agents"))).toBe(true);
	});

	it("does not seed bundled extensions into user extension dir", () => {
		mkdirSync(join(bundled, "extensions"), { recursive: true });
		writeFileSync(join(bundled, "extensions", "question.ts"), "export default {};");

		expect(seedDefaultExtensions(dir, join(bundled, "extensions"))).toEqual([]);
		expect(existsSync(join(dir, "extensions", "question.ts"))).toBe(false);
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
