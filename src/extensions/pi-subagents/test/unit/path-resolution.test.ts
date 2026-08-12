import { describe, test, before, after } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { discoverAgents } from "../../src/agents/agents.ts";
import { resolveSkillPath, clearSkillCache } from "../../src/agents/skills.ts";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-path-resolution-"));
const cwdDir = path.join(tmpDir, "cwd");
const homeDir = path.join(tmpDir, "home");
const userAgentsDir = path.join(homeDir, ".agents");
const userAgentsCanary = path.join(userAgentsDir, ".data-loss-canary");
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalAgentDir = process.env.SELESAI_CODING_AGENT_DIR;

function restoreEnv(name: "HOME" | "USERPROFILE" | "SELESAI_CODING_AGENT_DIR", value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

before(() => {
	fs.mkdirSync(cwdDir, { recursive: true });
	fs.mkdirSync(path.join(userAgentsDir, "skills"), { recursive: true });
	fs.writeFileSync(userAgentsCanary, "preserve me");
	process.env.HOME = homeDir;
	process.env.USERPROFILE = homeDir;
	assert.equal(os.homedir(), homeDir);
	process.env.SELESAI_CODING_AGENT_DIR = path.join(homeDir, ".selesai", "agent");
});

after(() => {
	try {
		assert.equal(fs.readFileSync(userAgentsCanary, "utf-8"), "preserve me");
	} finally {
		restoreEnv("HOME", originalHome);
		restoreEnv("USERPROFILE", originalUserProfile);
		restoreEnv("SELESAI_CODING_AGENT_DIR", originalAgentDir);
		clearSkillCache();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
});

describe("Path resolution for .agents and ~/.agents", () => {
	test("should resolve skills in .agents/skills", () => {
		const skillsDir = path.join(cwdDir, ".agents", "skills");
		fs.mkdirSync(skillsDir, { recursive: true });
		fs.writeFileSync(path.join(skillsDir, "test-skill-1.md"), "---\nname: test-skill-1\ndescription: test desc\n---\nSkill content");

		clearSkillCache();
		const resolved = resolveSkillPath("test-skill-1", cwdDir);
		assert.ok(resolved);
		assert.strictEqual(resolved?.path, path.join(skillsDir, "test-skill-1.md"));
	});

	test("should resolve skills in ~/.agents/skills", () => {
		const userSkillsDir = path.join(userAgentsDir, "skills");
		fs.mkdirSync(userSkillsDir, { recursive: true });
		fs.writeFileSync(path.join(userSkillsDir, "test-skill-2.md"), "---\nname: test-skill-2\ndescription: test desc\n---\nSkill content");

		clearSkillCache();
		const resolved = resolveSkillPath("test-skill-2", cwdDir);
		assert.ok(resolved);
		assert.strictEqual(resolved?.path, path.join(userSkillsDir, "test-skill-2.md"));
	});

	test("should resolve project agents from both .agents and .selesai/agents", () => {
		const legacyDir = path.join(cwdDir, ".agents");
		const agentsDir = path.join(cwdDir, ".selesai", "agents");
		fs.mkdirSync(path.join(cwdDir, ".agents", "skills"), { recursive: true });
		fs.mkdirSync(legacyDir, { recursive: true });
		fs.mkdirSync(agentsDir, { recursive: true });
		fs.writeFileSync(
			path.join(legacyDir, "test-agent-legacy.md"),
			"---\nname: test-agent-legacy\ndescription: Legacy agent\n---\nLegacy content"
		);
		fs.writeFileSync(
			path.join(agentsDir, "test-agent-1.md"),
			"---\nname: test-agent-1\ndescription: Test agent\n---\nAgent content"
		);

		const result = discoverAgents(cwdDir, "project");
		const legacyAgent = result.agents.find((a) => a.name === "test-agent-legacy");
		const agent = result.agents.find((a) => a.name === "test-agent-1");
		assert.ok(legacyAgent);
		assert.strictEqual(legacyAgent?.filePath, path.join(legacyDir, "test-agent-legacy.md"));
		assert.ok(agent);
		assert.strictEqual(agent?.filePath, path.join(agentsDir, "test-agent-1.md"));
	});

	test("should resolve agents in ~/.agents", () => {
		fs.writeFileSync(
			path.join(userAgentsDir, "test-agent-2.md"),
			"---\nname: test-agent-2\ndescription: Test agent\n---\nAgent content"
		);

		const result = discoverAgents(cwdDir, "user");
		const agent = result.agents.find((a) => a.name === "test-agent-2");
		assert.ok(agent);
		assert.strictEqual(agent?.filePath, path.join(userAgentsDir, "test-agent-2.md"));
	});
});
