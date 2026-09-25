import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import {
	createAgentSession,
	createEventBus,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type AgentSession,
	type EventBus,
} from "@selesai/code";
import { allowNetwork } from "../../../test/test-network-env.ts";

const EXTENSIONS_DIR = fileURLToPath(new URL("../../", import.meta.url));
const GATEWAY_DIR = fileURLToPath(new URL(".", import.meta.url));
const GREP_APP_DIR = fileURLToPath(new URL("../grep-app", import.meta.url));
const GRAFT_DIR = fileURLToPath(new URL("../pi-graft", import.meta.url));
const INLINE_SKILLS_FILE = fileURLToPath(new URL("../inline-skills.ts", import.meta.url));

interface Harness {
	session: AgentSession;
	/** Everything the gateway emitted on its telemetry channel. */
	telemetry: Array<Record<string, unknown>>;
	dispose: () => Promise<void>;
}

interface HarnessOptions {
	enabled: boolean;
	withSkill?: boolean;
	extensions?: string[];
	/** Written to `capabilityGateway.routing.jev` in the session's settings.json. */
	jev?: Record<string, unknown>;
	/** Make the gateway's telemetry channel throw on every emit. */
	telemetryDown?: boolean;
	/** SDK-level child tool allowlist. */
	tools?: string[];
}

/** A bus that fails only on the gateway's own telemetry channel. */
function telemetryDownBus(): EventBus {
	const bus = createEventBus();
	return {
		emit: (channel, data) => {
			if (channel === "capability-gateway") throw new Error("telemetry channel down");
			bus.emit(channel, data);
		},
		on: bus.on,
	};
}

async function createGatewaySession(options: HarnessOptions): Promise<Harness> {
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

	if (options.jev) {
		writeFileSync(
			join(home, "settings.json"),
			JSON.stringify({ capabilityGateway: { routing: { jev: options.jev } } }),
		);
	}

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
	// Subscribe to the gateway's telemetry channel before the extension can emit.
	const eventBus = options.telemetryDown ? telemetryDownBus() : createEventBus();
	const telemetry: Array<Record<string, unknown>> = [];
	if (!options.telemetryDown) {
		eventBus.on("capability-gateway", (data) => {
			telemetry.push(data as Record<string, unknown>);
		});
	}
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: home,
		settingsManager,
		additionalExtensionPaths: extensionPaths,
		eventBus,
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
		...(options.tools !== undefined ? { tools: options.tools } : {}),
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

	return { session, telemetry, dispose };
}

const harnesses: Harness[] = [];
afterEach(async () => {
	for (const h of harnesses.splice(0)) await h.dispose();
	vi.unstubAllGlobals();
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

	it("keeps all Graft tools active for hybrid context and precise follow-ups", async () => {
		const h = await createGatewaySession({ enabled: true, extensions: [GATEWAY_DIR, GRAFT_DIR] });
		harnesses.push(h);
		const active = h.session.getActiveToolNames();
		for (const name of [
			"graft_check_freshness",
			"graft_file_api",
			"graft_find_all",
			"graft_find_code",
			"graft_repo_map",
			"graft_trace_calls",
		]) expect(active).toContain(name);
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

	it("returns a uniquely routed natural-language catalog match", async () => {
		const h = await createGatewaySession({ enabled: true, extensions: [GATEWAY_DIR, GREP_APP_DIR] });
		harnesses.push(h);
		const catalog = h.session.getToolDefinition("capability_catalog");
		expect(catalog).toBeDefined();

		const result = await catalog!.execute(
			"call-1",
			{ query: "search GitHub code with grep_app_search" },
			undefined,
			undefined,
			{} as never,
		);
		expect(result.content[0]!.type).toBe("text");
		expect(String(result.content[0]!.text)).toContain("grep_app_search");
		expect(result.details).toMatchObject({ count: 1 });
	});

	it("renders the query and kind in the tool call line", async () => {
		const h = await createGatewaySession({ enabled: true });
		harnesses.push(h);
		const catalog = h.session.getToolDefinition("capability_catalog");
		const theme = { fg: (_name: string, text: string) => text, bold: (text: string) => text } as never;
		const draw = (args: unknown) =>
			(catalog!.renderCall!(args as never, theme, {} as never) as { render(width: number): string[] }).render(120).join("\n");

		expect(draw({ query: "ponytail-debt", kind: "skill" })).toContain('"ponytail-debt"');
		expect(draw({ query: "ponytail-debt", kind: "skill" })).toContain("skill");
		expect(draw({})).toContain("(all)");
	});

	it("limits child discovery and activation to the SDK-filtered tool registry", async () => {
		const h = await createGatewaySession({
			enabled: true,
			extensions: [GATEWAY_DIR, GREP_APP_DIR],
			tools: ["capability_catalog", "capability_discover", "grep_app_search"],
		});
		harnesses.push(h);
		const registeredNames = h.session.getAllTools().map((tool) => tool.name);
		expect(registeredNames).toContain("grep_app_search");
		expect(registeredNames).not.toContain("grep_app_fetch");

		const catalog = h.session.getToolDefinition("capability_catalog");
		const catalogResult = await catalog!.execute("call-catalog", { query: "grep_app" }, undefined, undefined, {} as never);
		expect(String(catalogResult.content[0]!.text)).toContain("grep_app_search");
		expect(String(catalogResult.content[0]!.text)).not.toContain("grep_app_fetch");

		const discover = h.session.getToolDefinition("capability_discover");
		const allowed = await discover!.execute("call-allowed", { name: "grep_app_search" }, undefined, undefined, {} as never);
		expect(String(allowed.content[0]!.text)).toContain("Activated");
		expect(h.session.getActiveToolNames()).toContain("grep_app_search");

		const denied = await discover!.execute("call-denied", { name: "grep_app_fetch" }, undefined, undefined, {} as never);
		expect(String(denied.content[0]!.text)).not.toContain("Activated");
		expect(h.session.getActiveToolNames()).not.toContain("grep_app_fetch");
	});

	it("exposes no gateway controls to an explicitly empty child tool allowlist", async () => {
		const h = await createGatewaySession({ enabled: true, extensions: [GATEWAY_DIR], tools: [] });
		harnesses.push(h);
		expect(h.session.getAllTools().map((tool) => tool.name)).not.toContain("capability_catalog");
		expect(h.session.getActiveToolNames()).not.toContain("capability_discover");
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
		expect(result.messages).toEqual([]);
		expect(h.session.getActiveToolNames()).toContain("grep_app_search");
	});

	it("does not inject fuzzy skill recommendations", async () => {
		const h = await createGatewaySession({
			enabled: true,
			withSkill: true,
			extensions: [GATEWAY_DIR, GREP_APP_DIR],
		});
		harnesses.push(h);
		const result = await h.session.extensionRunner.emitBeforeAgentStart(
			"do research on this topic",
			undefined,
			h.session.systemPrompt,
			{ cwd: process.cwd() } as never,
		);
		expect(result.messages).toEqual([]);
		expect(h.session.systemPrompt).not.toContain("Research instructions body.");
	});

	it("does not inject catalog hints for ambiguous tool matches", async () => {
		const h = await createGatewaySession({ enabled: true, extensions: [GATEWAY_DIR, GREP_APP_DIR] });
		harnesses.push(h);
		const result = await h.session.extensionRunner.emitBeforeAgentStart(
			"grep app",
			undefined,
			h.session.systemPrompt,
			{ cwd: process.cwd() } as never,
		);
		expect(result.messages).toEqual([]);
	});

	it("does not recommend capability_skill_show for an inline-loaded $skill", async () => {
		const h = await createGatewaySession({
			enabled: true,
			withSkill: true,
			extensions: [GATEWAY_DIR, GREP_APP_DIR, INLINE_SKILLS_FILE],
		});
		harnesses.push(h);
		const runner = h.session.extensionRunner;
		const input = await runner.emitInput("Use $research now", undefined, "interactive", undefined);
		expect(input.action).toBe("transform");
		if (input.action !== "transform") throw new Error("inline skill was not expanded");
		expect(input.text).toContain("Research instructions body.");

		const result = await runner.emitBeforeAgentStart(
			input.text,
			undefined,
			h.session.systemPrompt,
			{ cwd: process.cwd() } as never,
		);
		expect(result.messages).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Jev-assisted routing (opt-in): capabilityGateway.routing.jev.
// ---------------------------------------------------------------------------

describe("capability gateway Jev routing", () => {
	// "...github..." only weakly suggests both grep-app tools: the deterministic router returns a
	// two-candidate hint, which is the only Jev trigger.
	const HINT_PROMPT = "look at this github repo";
	// No tool name, alias, or summary token matches: the router has no lexical signal and Jev
	// must never be consulted.
	const NO_SIGNAL_PROMPT = "continue where we left off last time";

	const jevSettings = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
		enabled: true,
		provider: "faux-gw",
		baseUrl: "http://jev.test/v1",
		minConfidence: 0.5,
		timeoutMs: 2_000,
		...overrides,
	});

	function jevSseResponse(choice: string, confidence: number): Response {
		const body = JSON.stringify({ answers: { capability: { choice, confidence } } });
		const chunk = (delta: unknown, finish: string | null) =>
			`data: ${JSON.stringify({
				id: "1",
				object: "chat.completion.chunk",
				created: 0,
				model: "jev-1.13",
				choices: [{ index: 0, delta, finish_reason: finish }],
			})}\n\n`;
		return new Response(chunk({ role: "assistant", content: body }, null) + chunk({}, "stop") + "data: [DONE]\n\n", {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});
	}

	function stubJev(choice: string, confidence = 0.95): { requests: string[]; fetchMock: ReturnType<typeof vi.fn> } {
		const requests: string[] = [];
		const fetchMock = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
			requests.push(typeof init?.body === "string" ? init.body : "");
			return jevSseResponse(choice, confidence);
		});
		vi.stubGlobal("fetch", fetchMock);
		return { requests, fetchMock };
	}

	async function route(h: Harness, prompt: string): Promise<void> {
		const result = await h.session.extensionRunner.emitBeforeAgentStart(
			prompt,
			undefined,
			h.session.systemPrompt,
			{ cwd: process.cwd() } as never,
		);
		expect(result.messages).toEqual([]);
	}

	function routeEvents(h: Harness): Array<Record<string, unknown>> {
		return h.telemetry.filter((event) => event.event === "route");
	}

	// Telemetry may carry route metadata and canonical tool names, never prompt
	// text, conversation turns, credentials, raw Jev output, or tool arguments.
	const TELEMETRY_KEYS = new Set([
		"event",
		"source",
		"outcome",
		"reason",
		"tool",
		"confidence",
		"candidates",
		"durationMs",
		"baselineCount",
		"dormantCount",
		"activeCount",
		"activated",
		"used",
		"results",
		"skill",
	]);

	it("activates the tool Jev selects for the run, then restores the baseline", async () => {
		allowNetwork();
		const { requests } = stubJev("grep_app_search", 0.91);
		const h = await createGatewaySession({
			enabled: true,
			extensions: [GATEWAY_DIR, GREP_APP_DIR, GRAFT_DIR],
			jev: jevSettings(),
		});
		harnesses.push(h);
		const baseline = h.session.getActiveToolNames();
		expect(baseline).not.toContain("grep_app_search");

		await route(h, HINT_PROMPT);

		expect(h.session.getActiveToolNames()).toContain("grep_app_search");
		// Built-ins and always-active code-context tools stay active.
		for (const name of ["read", "bash", "capability_catalog", "graft_find_code"]) {
			expect(h.session.getActiveToolNames()).toContain(name);
		}
		expect(routeEvents(h)).toContainEqual(
			expect.objectContaining({ source: "jev", outcome: "attempt", candidates: 2 }),
		);
		expect(routeEvents(h)).toContainEqual(
			expect.objectContaining({
				source: "jev",
				outcome: "activated",
				tool: "grep_app_search",
				confidence: "high",
				candidates: 2,
				durationMs: expect.any(Number),
			}),
		);
		expect(requests).toHaveLength(1);

		// The activation was temporary: settlement restores the baseline set.
		await h.session.extensionRunner.emit({ type: "agent_settled" });
		expect(h.session.getActiveToolNames()).toEqual(baseline);
		expect(h.telemetry).toContainEqual(
			expect.objectContaining({ event: "reset", activated: 1, used: 0 }),
		);
	});

	it("exposes the selected schema for the same turn and keeps the other hinted candidate dormant", async () => {
		allowNetwork();
		stubJev("grep_app_search", 0.9);
		const h = await createGatewaySession({
			enabled: true,
			extensions: [GATEWAY_DIR, GREP_APP_DIR],
			jev: jevSettings(),
		});
		harnesses.push(h);

		await route(h, HINT_PROMPT);

		// The live loadout is what the resulting turn uses, and the selected tool's
		// schema is registered for it.
		expect(h.session.getActiveToolNames()).toContain("grep_app_search");
		const definition = h.session.getToolDefinition("grep_app_search");
		expect(definition).toBeDefined();
		expect(definition?.parameters).toBeDefined();
		// The other hinted candidate (and every nonselected tool) stays dormant.
		expect(h.session.getActiveToolNames()).not.toContain("grep_app_fetch");
	});

	it("does not call Jev without a lexical tool signal or for a skill-only match", async () => {
		allowNetwork();
		const { fetchMock } = stubJev("grep_app_search");
		const h = await createGatewaySession({
			enabled: true,
			withSkill: true,
			extensions: [GATEWAY_DIR, GREP_APP_DIR],
			jev: jevSettings(),
		});
		harnesses.push(h);

		await route(h, NO_SIGNAL_PROMPT);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(routeEvents(h)).toEqual([]);
		expect(h.session.getActiveToolNames()).not.toContain("grep_app_search");

		// A unique skill match is a recommendation, never a Jev auto-selection.
		await route(h, "do research on this topic");
		expect(fetchMock).not.toHaveBeenCalled();
		expect(routeEvents(h)).toEqual([]);
		expect(h.session.getActiveToolNames()).not.toContain("research");
	});

	it("does not call Jev when the deterministic router already activated a tool", async () => {
		allowNetwork();
		const deterministic = stubJev("grep_app_search");
		const h = await createGatewaySession({
			enabled: true,
			extensions: [GATEWAY_DIR, GREP_APP_DIR],
			jev: jevSettings(),
		});
		harnesses.push(h);

		await route(h, "search github code with grep_app_search");
		expect(h.session.getActiveToolNames()).toContain("grep_app_search");
		expect(deterministic.fetchMock).not.toHaveBeenCalled();
		expect(routeEvents(h)).toContainEqual(
			expect.objectContaining({ source: "deterministic", outcome: "activated", tool: "grep_app_search" }),
		);
	});

	it("leaves routing deterministic when the Jev route is not configured", async () => {
		allowNetwork();
		const disabled = stubJev("grep_app_search");
		const h = await createGatewaySession({ enabled: true, extensions: [GATEWAY_DIR, GREP_APP_DIR] });
		harnesses.push(h);

		await route(h, HINT_PROMPT);

		expect(disabled.fetchMock).not.toHaveBeenCalled();
		expect(h.session.getActiveToolNames()).not.toContain("grep_app_search");
		expect(routeEvents(h)).toEqual([]);
	});

	it("offers Jev only the current prompt and the hinted candidates, never the full catalog", async () => {
		allowNetwork();
		const { requests } = stubJev("none", 1);
		const h = await createGatewaySession({
			enabled: true,
			withSkill: true,
			extensions: [GATEWAY_DIR, GREP_APP_DIR, GRAFT_DIR],
			jev: jevSettings(),
		});
		harnesses.push(h);

		await route(h, HINT_PROMPT);

		const sent = JSON.parse(requests[0]!) as { messages: Array<{ content: string }> };
		const payload = JSON.parse(sent.messages[0]!.content) as {
			state: { conversation: unknown[]; system_prompt?: string };
			questions: Record<string, { criteria: Record<string, string> }>;
		};
		const criteria = Object.keys(payload.questions.capability!.criteria);
		expect(criteria).toEqual(["none", "grep_app_search", "grep_app_fetch"]);
		// Built-ins, gateway tools, always-active Graft tools, and skills are not selectable.
		for (const name of ["read", "capability_catalog", "capability_skill_show", "graft_find_code", "research"]) {
			expect(criteria).not.toContain(name);
		}
		// Only the current prompt travels; never conversation history or a system prompt.
		expect(payload.state.conversation).toEqual([{ role: "user", text: HINT_PROMPT }]);
		expect(payload.state.system_prompt).toBeUndefined();
	});

	it("abstains on `none` and stays non-blocking when Jev is unavailable", async () => {
		allowNetwork();
		const { requests } = stubJev("none", 1);
		const h = await createGatewaySession({
			enabled: true,
			extensions: [GATEWAY_DIR, GREP_APP_DIR],
			jev: jevSettings(),
		});
		harnesses.push(h);

		await route(h, HINT_PROMPT);
		expect(h.session.getActiveToolNames()).not.toContain("grep_app_search");
		expect(routeEvents(h)).toContainEqual(
			expect.objectContaining({ source: "jev", outcome: "abstained", reason: "none", candidates: 2 }),
		);
		expect(requests).toHaveLength(1);

		// A provider outage is an ordinary fallback: nothing activates, and the
		// telemetry reports the route without recording any content.
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("connection reset");
			}),
		);
		await route(h, HINT_PROMPT);
		expect(h.session.getActiveToolNames()).not.toContain("grep_app_search");
		expect(routeEvents(h)).toContainEqual(
			expect.objectContaining({ source: "jev", outcome: "unavailable", reason: "transport" }),
		);

		const serialized = JSON.stringify(h.telemetry);
		expect(serialized).not.toContain(HINT_PROMPT);
		expect(serialized).not.toContain(NO_SIGNAL_PROMPT);
		expect(serialized).not.toContain("answers");
		expect(serialized).not.toContain("faux");
		for (const event of h.telemetry) {
			for (const key of Object.keys(event)) expect(TELEMETRY_KEYS.has(key)).toBe(true);
		}
	});

	it("is invisible without a Jev provider template or subscription", async () => {
		allowNetwork();
		const { fetchMock } = stubJev("grep_app_search");
		const h = await createGatewaySession({
			enabled: true,
			extensions: [GATEWAY_DIR, GREP_APP_DIR],
			jev: jevSettings({ provider: "no-such-provider", baseUrl: undefined }),
		});
		harnesses.push(h);

		await route(h, HINT_PROMPT);

		expect(fetchMock).not.toHaveBeenCalled();
		expect(h.session.getActiveToolNames()).not.toContain("grep_app_search");
		expect(routeEvents(h)).toContainEqual(
			expect.objectContaining({ source: "jev", outcome: "unavailable", reason: "no-template" }),
		);
	});

	it("records whether an activated tool was actually used, then resets", async () => {
		allowNetwork();
		stubJev("grep_app_search", 0.9);
		const h = await createGatewaySession({
			enabled: true,
			extensions: [GATEWAY_DIR, GREP_APP_DIR],
			jev: jevSettings(),
		});
		harnesses.push(h);

		await route(h, HINT_PROMPT);
		expect(h.session.getActiveToolNames()).toContain("grep_app_search");

		// An unrelated tool produces no use telemetry.
		await h.session.extensionRunner.emit({
			type: "tool_execution_start",
			toolCallId: "t0",
			toolName: "read",
			args: {},
		});
		expect(h.telemetry.filter((event) => event.event === "use")).toEqual([]);

		// The selected tool is called (twice): one use event per activation.
		for (const toolCallId of ["t1", "t2"]) {
			await h.session.extensionRunner.emit({
				type: "tool_execution_start",
				toolCallId,
				toolName: "grep_app_search",
				args: {},
			});
		}
		const uses = h.telemetry.filter((event) => event.event === "use");
		expect(uses).toEqual([{ event: "use", tool: "grep_app_search", source: "jev" }]);

		await h.session.extensionRunner.emit({ type: "agent_settled" });
		expect(h.telemetry).toContainEqual(
			expect.objectContaining({ event: "reset", activated: 1, used: 1 }),
		);
	});

	it("completes the run when telemetry cannot be emitted", async () => {
		allowNetwork();
		stubJev("grep_app_search", 0.95);
		const h = await createGatewaySession({
			enabled: true,
			extensions: [GATEWAY_DIR, GREP_APP_DIR],
			jev: jevSettings(),
			telemetryDown: true,
		});
		harnesses.push(h);

		await route(h, HINT_PROMPT);

		expect(h.telemetry).toEqual([]);
		expect(h.session.getActiveToolNames()).toContain("grep_app_search");
	});
});
