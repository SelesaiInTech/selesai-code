import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DefaultPackageManager, extensionEntryName } from "./package-manager.js";
import { SettingsManager } from "./settings-manager.js";

describe("extensionEntryName", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "selesai-ext-root-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("normalizes loose script extension ids to match directory extension ids", () => {
		expect(extensionEntryName(join(root, "question.ts"), root)).toBe("question");
		expect(extensionEntryName(join(root, "question.js"), root)).toBe("question");
		expect(extensionEntryName(join(root, "question", "index.ts"), root)).toBe("question");
	});
});

describe("auto-discovered skills are opt-in by default", () => {
	let root: string;
	const SKILL_BODY =
		"---\nname: {name}\ndescription: A test skill.\n---\n\n# {name}\n";

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "selesai-skill-root-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	function makeSkill(agentDir: string, name: string): void {
		const dir = join(agentDir, "skills", name);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "SKILL.md"), SKILL_BODY.replaceAll("{name}", name));
	}

	it("defaults auto-discovered user skills to disabled (opt-in)", async () => {
		makeSkill(root, "alpha");
		makeSkill(root, "beta");
		const settingsManager = SettingsManager.inMemory({});
		const pm = new DefaultPackageManager({ cwd: root, agentDir: root, settingsManager });
		const resolved = await pm.resolve();

		const localSkills = resolved.skills.filter((s) => s.path.startsWith(root));
		expect(localSkills.length).toBe(2);
		expect(localSkills.every((s) => s.enabled === false)).toBe(true);
	});

	it("enables a user skill when it is force-included via a + pattern", async () => {
		makeSkill(root, "alpha");
		makeSkill(root, "beta");
		const settingsManager = SettingsManager.inMemory({
			skills: ["+skills/alpha/SKILL.md"],
		});
		const pm = new DefaultPackageManager({ cwd: root, agentDir: root, settingsManager });
		const resolved = await pm.resolve();

		const alpha = resolved.skills.find((s) => s.path.startsWith(root) && s.path.endsWith("alpha/SKILL.md"));
		const beta = resolved.skills.find((s) => s.path.startsWith(root) && s.path.endsWith("beta/SKILL.md"));
		expect(alpha?.enabled).toBe(true);
		expect(beta?.enabled).toBe(false);
	});
});
