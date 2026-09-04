import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type AgentSession,
} from "@selesai/code";

const EXTENSIONS_DIR = fileURLToPath(new URL("../../", import.meta.url));
const GATEWAY_DIR = fileURLToPath(new URL(".", import.meta.url));
const GREP_APP_DIR = fileURLToPath(new URL("../grep-app", import.meta.url));

interface Harness {
	session: AgentSession;
	dispose: () => Promise<void>;
}

async function createGatewaySession(options: {
	enabled: boolean;
	withSkill?: boolean;
	extensions?: string[];
}): Promise<Harness> {
	const extensionPaths = options.extensions ?? [EXTENSIONS_DIR];
	const cwd = mkdtempSync(join(tmpdir(), "gw-cwd-"));
	const home = mkdtempSync(join(tmpdir(), "gw-home-"));
	const previousCwd = process.cwd();
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	const previousAgentDir = process.env.SELESAI_CODING_AGENT_DIR;
	const previousGateway = process.env.SELESAI_CAPABILITY_GATEWAY;

	process.chdir(cwd);
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	process.env.SELESAI_CODING_AGENT_DIR = home;
	if (options.enabled) delete process.env.SELESAI_CAPABILITY_GATEWAY;
	else process.env.SELESAI_CAPABILITY_GATEWAY = "0";

	if (options.withSkill) {
		mkdirSync(join(home, "skills", "research"), { recursive: true });
		writeFileSync(
			join(home, "skills", "research", "SKILL.md"),
			"---\nname: research\ndescription: Investigate a question against high-trust primary sources.\n---\nResearch instructions body.\n",
		);
	}

	const faux = fauxProvider({ provider: "faux-gw", models: [{ id: "gw", contextWindow: 200_000 }] });
	const modelRuntime = await ModelRuntime.create({
		authPath: join(home, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
	});
	modelRuntime.registerProvider(faux.provider.id, {
		name: faux.provider.name,
		api: faux.api,
		apiKey: "faux",
		streamSimple: faux.provider.streamSimple,
		models: [...faux.models],
	});
	await modelRuntime.refresh({ allowNetwork: false });
	const model = modelRuntime.getModel(faux.provider.id, "gw");
	if (!model) throw new Error("faux model not registered");

	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: home,
		settingsManager,
		additionalExtensionPaths: extensionPaths,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();

	const created = await createAgentSession({
		cwd,
		agentDir: home,
		model,
		modelRuntime,
		resourceLoader: loader,
		sessionManager: SessionManager.create(cwd, join(home, "sessions")),
		settingsManager,
	});
	const session = created.session;
	await session.bindExtensions({});

	const dispose = async () => {
		try {
			await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		} catch {}
		try {
			session.dispose();
		} catch {}
		process.chdir(previousCwd);
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = previousUserProfile;
		if (previousAgentDir === undefined) delete process.env.SELESAI_CODING_AGENT_DIR;
		else process.env.SELESAI_CODING_AGENT_DIR = previousAgentDir;
		if (previousGateway === undefined) delete process.env.SELESAI_CAPABILITY_GATEWAY;
		else process.env.SELESAI_CAPABILITY_GATEWAY = previousGateway;
		rmSync(cwd, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	};

	return { session, dispose };
}

const harnesses: Harness[] = [];
afterEach(async () => {
	for (const h of harnesses.splice(0)) await h.dispose();
});

describe("capability gateway integration", () => {
	it("keeps extension tools dormant and built-ins active when enabled", async () => {
		const h = await createGatewaySession({ enabled: true });
		harnesses.push(h);
		const active = h.session.getActiveToolNames();
		expect(active).toContain("read");
		expect(active).toContain("bash");
		expect(active).not.toContain("grep_app_search");
		expect(active).not.toContain("subagent");
		// Gateway's own tools stay active so the agent can discover.
		expect(active).toContain("capability_catalog");
	});

	it("keeps all-visible behavior when disabled (compatibility mode)", async () => {
		const h = await createGatewaySession({ enabled: false });
		harnesses.push(h);
		const active = h.session.getActiveToolNames();
		expect(active).toContain("read");
		expect(active).toContain("grep_app_search");
		expect(active).toContain("subagent");
	});

	it("replaces the eager skill index with the compact capability instruction", async () => {
		const h = await createGatewaySession({ enabled: true, withSkill: true });
		harnesses.push(h);
		const prompt = h.session.systemPrompt;
		expect(prompt).toContain("capability_catalog");
		expect(prompt).toContain("Never invent optional tool names");
		// The full skill list is gone from the default prompt: the research
		// skill name and body are absent, only the compact instruction remains.
		expect(prompt).not.toContain("Research instructions body.");
		const block = prompt.slice(prompt.indexOf("<available_skills>"), prompt.indexOf("</available_skills>"));
		expect(block).not.toContain("research");
		expect(block).toContain("capability-gateway");
	});

	it("activates a discovered tool for the run and resets after agent_settled", async () => {
		const h = await createGatewaySession({ enabled: true });
		harnesses.push(h);
		const baseline = h.session.getActiveToolNames();
		expect(baseline).not.toContain("grep_app_search");

		// capability_discover activates the native tool.
		const discover = h.session.getToolDefinition("capability_discover");
		expect(discover).toBeDefined();
		const result = await discover!.execute("call-1", { name: "grep_app_search" }, undefined, undefined, {} as never);
		expect(result.content[0]!.type).toBe("text");
		expect(String(result.content[0]!.text)).toContain("Activated");
		expect(h.session.getActiveToolNames()).toContain("grep_app_search");

		// agent_settled restores the baseline.
		await h.session.extensionRunner.emit({ type: "agent_settled" });
		expect(h.session.getActiveToolNames()).toEqual(baseline);
	});

	it("routes a high-confidence prompt to automatic activation", async () => {
		// Minimal extension set (gateway + grep-app) so no other extension's
		// before_agent_start handler interferes with the routing result.
		const h = await createGatewaySession({ enabled: true, extensions: [GATEWAY_DIR, GREP_APP_DIR] });
		harnesses.push(h);
		expect(h.session.getActiveToolNames()).not.toContain("grep_app_search");

		const runner = h.session.extensionRunner;
		const result = await runner.emitBeforeAgentStart(
			"search github code with grep_app_search",
			undefined,
			h.session.systemPrompt,
			{ cwd: process.cwd() } as never,
		);
		expect(result).toBeUndefined();
		expect(h.session.getActiveToolNames()).toContain("grep_app_search");
	});

	it("does not auto-load skills from fuzzy matching", async () => {
		const h = await createGatewaySession({
			enabled: true,
			withSkill: true,
			extensions: [GATEWAY_DIR, GREP_APP_DIR],
		});
		harnesses.push(h);
		const runner = h.session.extensionRunner;
		const result = await runner.emitBeforeAgentStart(
			"do research on this topic",
			undefined,
			h.session.systemPrompt,
			{ cwd: process.cwd() } as never,
		);
		// A recommendation message is injected, but the skill body is not loaded
		// into the prompt and the skill is not auto-activated.
		expect(result?.messages?.[0]?.content).toContain("research");
		expect(h.session.systemPrompt).not.toContain("Research instructions body.");
	});
});
