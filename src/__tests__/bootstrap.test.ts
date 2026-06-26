import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	bootstrapAgentDir,
	ensureAgentDir,
	getFirstRunMarkerPath,
	markFirstRunComplete,
	seedBundledExtensions,
	seedDefaultConfigFile,
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

	it("seeds bundled extensions without clobbering existing ones", () => {
		const extDir = join(bundled, "ext-a");
		mkdirSync(extDir, { recursive: true });
		writeFileSync(join(extDir, "index.ts"), "bundled");
		const seeded = seedBundledExtensions(dir, bundled);
		expect(seeded).toHaveLength(1);
		expect(readFileSync(join(dir, "extensions", "ext-a", "index.ts"), "utf-8")).toBe("bundled");
		// second run: nothing re-seeded
		expect(seedBundledExtensions(dir, bundled)).toHaveLength(0);
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
});
