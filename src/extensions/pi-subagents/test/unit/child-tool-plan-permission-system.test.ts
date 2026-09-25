/**
 * Permission-system compatibility tests:
 * - <active_agent> tag injection into child system prompts
 * - Permission-system extension auto-detection
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { buildInProcessChildLaunch, type BuildInProcessChildLaunchInput } from "../../src/runs/shared/child-launch.ts";
import {
	CAPABILITY_GATEWAY_EXTENSION_PATH,
	resolvePermissionSystemExtension,
	resolvePiLaunchToolPlan,
} from "../../src/runs/shared/child-tool-plan.ts";

const originalEnv = {
	HOME: process.env.HOME,
	USERPROFILE: process.env.USERPROFILE,
	SELESAI_CODING_AGENT_DIR: process.env.SELESAI_CODING_AGENT_DIR,
	SELESAI_CAPABILITY_GATEWAY: process.env.SELESAI_CAPABILITY_GATEWAY,
};
const tempRoots: string[] = [];

function createFixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "child-tool-plan-perm-"));
	tempRoots.push(root);
	const home = path.join(root, "home");
	const agentDir = path.join(home, ".selesai", "agent");
	const projectDir = path.join(root, "project");
	fs.mkdirSync(agentDir, { recursive: true });
	fs.mkdirSync(projectDir, { recursive: true });
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	process.env.SELESAI_CODING_AGENT_DIR = agentDir;
	delete process.env.SELESAI_CAPABILITY_GATEWAY;
	process.chdir(projectDir);
	return { root, agentDir, projectDir };
}

afterEach(() => {
	for (const key of Object.keys(originalEnv)) {
		const value = originalEnv[key as keyof typeof originalEnv];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	for (const root of tempRoots) {
		try {
			fs.rmSync(root, { recursive: true, force: true });
		} catch {
			// best effort
		}
	}
	tempRoots.length = 0;
});

function childLaunch(overrides: Partial<BuildInProcessChildLaunchInput> = {}): BuildInProcessChildLaunchInput {
	return {
		host: "parent",
		cwd: process.cwd(),
		sessionEnabled: false,
		inheritProjectContext: false,
		inheritGlobalContext: false,
		inheritSkills: false,
		childAgentName: "worker",
		childIndex: 0,
		...overrides,
	};
}

/** The system prompt the child session receives (append mode by default). */
function childSystemPrompt(result: ReturnType<typeof buildInProcessChildLaunch>): string {
	const prompt = result.session.systemPrompt ?? result.session.appendSystemPrompt;
	assert.ok(prompt !== undefined, "expected a child system prompt");
	return prompt;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("resolvePermissionSystemExtension", () => {
	it("returns undefined when extension is not installed", () => {
		const { agentDir } = createFixture();
		process.env.SELESAI_CODING_AGENT_DIR = agentDir;
		const result = resolvePermissionSystemExtension();
		assert.equal(result, undefined);
	});

	it("throws when an installed extension dir has no package.json", () => {
		const { agentDir } = createFixture();
		const extDir = path.join(agentDir, "extensions", "pi-permission-system");
		const pkgPath = path.join(extDir, "package.json");
		fs.mkdirSync(extDir, { recursive: true });
		assert.throws(
			() => resolvePermissionSystemExtension(),
			new RegExp(`Permission-system package manifest is missing at ${escapeRegExp(pkgPath)}`),
		);
	});

	it("throws when package.json has no valid pi.extensions entry", () => {
		const { agentDir } = createFixture();
		process.env.SELESAI_CODING_AGENT_DIR = agentDir;
		const extDir = path.join(agentDir, "extensions", "pi-permission-system");
		const pkgPath = path.join(extDir, "package.json");
		fs.mkdirSync(extDir, { recursive: true });

		for (const value of [
			{ name: "test" },
			{ name: "test", pi: { extensions: "./src/index.ts" } },
			{ name: "test", pi: { extensions: [123] } },
		]) {
			fs.writeFileSync(pkgPath, JSON.stringify(value));
			assert.throws(
				() => resolvePermissionSystemExtension(),
				new RegExp(`Permission-system package manifest at ${escapeRegExp(pkgPath)}`),
			);
		}
	});

	it("throws when package.json is malformed", () => {
		const { agentDir } = createFixture();
		process.env.SELESAI_CODING_AGENT_DIR = agentDir;
		const extDir = path.join(agentDir, "extensions", "pi-permission-system");
		const pkgPath = path.join(extDir, "package.json");
		fs.mkdirSync(extDir, { recursive: true });
		fs.writeFileSync(pkgPath, "{ malformed");

		assert.throws(
			() => resolvePermissionSystemExtension(),
			new RegExp(`Cannot read permission-system package manifest at ${escapeRegExp(pkgPath)}`),
		);
	});

	it("throws when package.json cannot be read", () => {
		const { agentDir } = createFixture();
		process.env.SELESAI_CODING_AGENT_DIR = agentDir;
		const extDir = path.join(agentDir, "extensions", "pi-permission-system");
		const pkgPath = path.join(extDir, "package.json");
		fs.mkdirSync(pkgPath, { recursive: true });

		assert.throws(
			() => resolvePermissionSystemExtension(),
			new RegExp(`Cannot read permission-system package manifest at ${escapeRegExp(pkgPath)}`),
		);
	});

	it("throws with manifest context when package.json is not an object", () => {
		const { agentDir } = createFixture();
		process.env.SELESAI_CODING_AGENT_DIR = agentDir;
		const extDir = path.join(agentDir, "extensions", "pi-permission-system");
		const pkgPath = path.join(extDir, "package.json");
		fs.mkdirSync(extDir, { recursive: true });
		fs.writeFileSync(pkgPath, "null");

		assert.throws(
			() => resolvePermissionSystemExtension(),
			new RegExp(`Cannot read permission-system package manifest at ${escapeRegExp(pkgPath)}`),
		);
	});

	it("uses a valid fallback installation when the first candidate is malformed or missing a manifest", () => {
		for (const primarySetup of [
			(dir: string) => fs.writeFileSync(path.join(dir, "package.json"), "{ malformed"),
			() => undefined,
		]) {
			const { agentDir } = createFixture();
			const primaryDir = path.join(
				agentDir,
				"npm",
				"node_modules",
				"@gotgenes",
				"pi-permission-system",
			);
			const fallbackDir = path.join(agentDir, "extensions", "pi-permission-system");
			fs.mkdirSync(primaryDir, { recursive: true });
			primarySetup(primaryDir);
			fs.mkdirSync(path.join(fallbackDir, "src"), { recursive: true });
			fs.writeFileSync(
				path.join(fallbackDir, "package.json"),
				JSON.stringify({ name: "test", pi: { extensions: ["./src/index.ts"] } }),
			);
			fs.writeFileSync(
				path.join(fallbackDir, "src", "index.ts"),
				"export default () => {};",
			);

			const result = resolvePermissionSystemExtension();

			assert.equal(result, path.join(fallbackDir, "src", "index.ts"));
		}
	});

	it("returns extension path when fully installed", () => {
		const { agentDir } = createFixture();
		process.env.SELESAI_CODING_AGENT_DIR = agentDir;
		const extDir = path.join(agentDir, "extensions", "pi-permission-system");
		fs.mkdirSync(extDir, { recursive: true });
		fs.writeFileSync(
			path.join(extDir, "package.json"),
			JSON.stringify({ name: "test", pi: { extensions: ["./src/index.ts"] } }),
		);
		fs.mkdirSync(path.join(extDir, "src"), { recursive: true });
		fs.writeFileSync(
			path.join(extDir, "src", "index.ts"),
			"export default () => {};",
		);
		const result = resolvePermissionSystemExtension();
		assert.ok(result, "expected extension path");
		if (!result) return; // narrow for TS
		assert.ok(
			result.endsWith(path.join("pi-permission-system", "src", "index.ts")),
		);
	});

	it("throws when the configured entry file does not exist", () => {
		const { agentDir } = createFixture();
		process.env.SELESAI_CODING_AGENT_DIR = agentDir;
		const extDir = path.join(agentDir, "extensions", "pi-permission-system");
		const pkgPath = path.join(extDir, "package.json");
		fs.mkdirSync(extDir, { recursive: true });
		fs.writeFileSync(
			pkgPath,
			JSON.stringify({
				name: "test",
				pi: { extensions: ["./src/missing.ts"] },
			}),
		);

		assert.throws(
			() => resolvePermissionSystemExtension(),
			new RegExp(`Permission-system extension entry .* in ${escapeRegExp(pkgPath)} does not exist`),
		);
	});
});

describe("resolvePiLaunchToolPlan with permission system", () => {
	it("does not inject the permission system when no native permission rules are set", () => {
		const { agentDir } = createFixture();
		process.env.SELESAI_CODING_AGENT_DIR = agentDir;
		const extDir = path.join(agentDir, "extensions", "pi-permission-system");
		fs.mkdirSync(path.join(extDir, "src"), { recursive: true });
		fs.writeFileSync(
			path.join(extDir, "src", "index.ts"),
			"export default () => {};",
		);
		fs.writeFileSync(
			path.join(extDir, "package.json"),
			JSON.stringify({ name: "test", pi: { extensions: ["./src/index.ts"] } }),
		);

		const { session } = buildInProcessChildLaunch(childLaunch());
		assert.equal(
			session.extensionPaths.includes(path.join(extDir, "src", "index.ts")),
			false,
			"permission system extension should not be loaded without native rules",
		);
	});

	it("injects the permission system when explicit native permission rules are set", () => {
		const { agentDir } = createFixture();
		process.env.SELESAI_CODING_AGENT_DIR = agentDir;
		const extDir = path.join(agentDir, "extensions", "pi-permission-system");
		fs.mkdirSync(path.join(extDir, "src"), { recursive: true });
		fs.writeFileSync(
			path.join(extDir, "src", "index.ts"),
			"export default () => {};",
		);
		fs.writeFileSync(
			path.join(extDir, "package.json"),
			JSON.stringify({ name: "test", pi: { extensions: ["./src/index.ts"] } }),
		);

		const { session } = buildInProcessChildLaunch(childLaunch({ permissionRules: { write: "ask" } }));
		assert.ok(
			session.extensionPaths.includes(path.join(extDir, "src", "index.ts")),
			"permission system extension should be loaded when native rules are active",
		);
	});

	it("does NOT include permission system when not installed", () => {
		const { agentDir } = createFixture();
		process.env.SELESAI_CODING_AGENT_DIR = agentDir;

		const plan = resolvePiLaunchToolPlan({});
		const permExt = plan.runtimeExtensions.find((e) =>
			e.includes("pi-permission-system"),
		);
		assert.equal(permExt, undefined);
	});

	it("does NOT include permission system when denyExtensions is set", () => {
		const { agentDir } = createFixture();
		process.env.SELESAI_CODING_AGENT_DIR = agentDir;
		const extDir = path.join(
			agentDir,
			"npm",
			"node_modules",
			"@gotgenes",
			"pi-permission-system",
		);
		fs.mkdirSync(path.join(extDir, "src"), { recursive: true });
		fs.writeFileSync(
			path.join(extDir, "src", "index.ts"),
			"export default () => {};",
		);
		fs.writeFileSync(
			path.join(extDir, "package.json"),
			JSON.stringify({ name: "test", pi: { extensions: ["./src/index.ts"] } }),
		);

		const plan = resolvePiLaunchToolPlan({
			capabilityCeiling: {
				version: 1 as const,
				allowedTools: ["read"],
				denyExtensions: true,
				sources: ["test"],
			},
		});
		const permExt = plan.runtimeExtensions.find((e) =>
			e.includes("pi-permission-system"),
		);
		assert.equal(permExt, undefined);
	});
});

describe("child launch <active_agent> tag injection", () => {
	it("prepends <active_agent> tag when childAgentName is set", () => {
		const { agentDir } = createFixture();
		process.env.SELESAI_CODING_AGENT_DIR = agentDir;

		const promptContent = childSystemPrompt(buildInProcessChildLaunch(childLaunch({
			systemPrompt: "You are a helpful assistant.",
			childAgentName: "reviewer",
		})));
		assert.ok(
			promptContent.startsWith('<active_agent name="reviewer"/>'),
			`expected prompt to start with <active_agent> tag, got: ${promptContent.slice(0, 100)}`,
		);
		assert.ok(
			promptContent.includes("You are a helpful assistant."),
			"original prompt should be preserved after the tag",
		);
	});

	it("passes no system prompt when the agent has none", () => {
		const { agentDir } = createFixture();
		process.env.SELESAI_CODING_AGENT_DIR = agentDir;

		const { session } = buildInProcessChildLaunch(childLaunch({ childAgentName: "helper" }));
		assert.equal(session.systemPrompt, undefined);
		assert.equal(session.appendSystemPrompt, undefined);
	});

	it("replaces the system prompt in replace mode", () => {
		const { agentDir } = createFixture();
		process.env.SELESAI_CODING_AGENT_DIR = agentDir;

		const { session } = buildInProcessChildLaunch(childLaunch({ systemPrompt: "You are a helper.", systemPromptMode: "replace", childAgentName: "helper" }));
		assert.equal(session.systemPrompt, '<active_agent name="helper"/>\n\nYou are a helper.');
		assert.equal(session.appendSystemPrompt, undefined);
	});

	it("injects the tag even when systemPrompt is empty", () => {
		const { agentDir } = createFixture();
		process.env.SELESAI_CODING_AGENT_DIR = agentDir;

		const promptContent = childSystemPrompt(buildInProcessChildLaunch(childLaunch({ systemPrompt: "", childAgentName: "worker" })));
		assert.ok(promptContent.startsWith('<active_agent name="worker"/>'));
	});

	it("escapes XML metacharacters in agent name", () => {
		const { agentDir } = createFixture();
		process.env.SELESAI_CODING_AGENT_DIR = agentDir;

		const promptContent = childSystemPrompt(buildInProcessChildLaunch(childLaunch({
			systemPrompt: "System prompt here",
			childAgentName: 'my "special" agent',
		})));
		assert.ok(
			promptContent.startsWith('<active_agent name="my &quot;special&quot; agent"/>'),
			`expected escaped tag, got: ${promptContent.slice(0, 120)}`,
		);
	});

	it("runtimeExtensions include prompt runtime path (pre-existing behavior)", () => {
		const { agentDir } = createFixture();
		process.env.SELESAI_CODING_AGENT_DIR = agentDir;

		const plan = resolvePiLaunchToolPlan({});
		assert.ok(plan.runtimeExtensions.length >= 1);
		const hasPromptRuntime = plan.runtimeExtensions.some((e) =>
			e.endsWith("subagent-prompt-runtime.ts"),
		);
		assert.ok(
			hasPromptRuntime,
			"prompt runtime extension should always be included",
		);
	});
});

describe("capability gateway child runtime policy", () => {
	const gatewayTools = ["capability_catalog", "capability_discover", "capability_skill_show"];

	for (const host of ["parent", "runner"] as const) {
		it(`adds only gateway controls for extension-permitted ${host} children`, () => {
			const { agentDir } = createFixture();
			process.env.SELESAI_CODING_AGENT_DIR = agentDir;

			const launch = buildInProcessChildLaunch(childLaunch({ host, tools: ["read", "web_explore"] }));
			assert.equal(launch.toolPlan.capabilityGatewayEnabled, true);
			assert.ok(launch.session.extensionPaths.includes(CAPABILITY_GATEWAY_EXTENSION_PATH));
			assert.deepEqual(launch.session.tools, ["read", "web_explore", ...gatewayTools]);
			assert.ok(gatewayTools.every((tool) => launch.toolPlan.requiredChildTools.includes(tool)));
			if (host === "runner") {
				assert.equal(launch.session.ambientExtensions, true);
				assert.ok(launch.session.extensionPaths.includes(CAPABILITY_GATEWAY_EXTENSION_PATH));
			} else {
				assert.equal(launch.session.ambientExtensions, false);
				assert.equal(launch.session.processEnv, undefined);
			}
		});
	}

	it("keeps omitted tools unrestricted without synthesizing an explicit allowlist", () => {
		const { agentDir } = createFixture();
		process.env.SELESAI_CODING_AGENT_DIR = agentDir;
		const launch = buildInProcessChildLaunch(childLaunch({ host: "runner" }));
		assert.equal(launch.toolPlan.capabilityGatewayEnabled, true);
		assert.equal(launch.session.tools, undefined);
		assert.ok(launch.session.extensionPaths.includes(CAPABILITY_GATEWAY_EXTENSION_PATH));
	});

	for (const host of ["parent", "runner"] as const) {
		it(`skips gateway for ${host} children with an explicit empty tool set`, () => {
			const { agentDir } = createFixture();
			process.env.SELESAI_CODING_AGENT_DIR = agentDir;

			const launch = buildInProcessChildLaunch(childLaunch({ host, tools: [] }));
			assert.equal(launch.toolPlan.capabilityGatewayEnabled, false);
			assert.deepEqual(launch.session.tools, []);
			assert.ok(!launch.toolPlan.extensionArgs.includes(CAPABILITY_GATEWAY_EXTENSION_PATH));
			assert.ok(!launch.session.extensionPaths.includes(CAPABILITY_GATEWAY_EXTENSION_PATH));
		});
	}

	it("does not widen a capability ceiling and honors explicit extension policy", () => {
		const { agentDir, projectDir } = createFixture();
		process.env.SELESAI_CODING_AGENT_DIR = agentDir;
		const limited = resolvePiLaunchToolPlan({
			tools: ["read", "web_explore"],
			capabilityCeiling: { version: 1, allowedTools: ["read", "web_explore"], denyExtensions: false, sources: ["test"] },
		});
		assert.equal(limited.capabilityGatewayEnabled, false);
		assert.deepEqual(limited.effectiveToolAllowlist, ["read", "web_explore"]);
		assert.ok(!limited.extensionArgs.includes(CAPABILITY_GATEWAY_EXTENSION_PATH));

		const explicitBlock = resolvePiLaunchToolPlan({
			tools: ["read"],
			extensions: [path.join(projectDir, "other-extension.ts")],
		});
		assert.equal(explicitBlock.capabilityGatewayEnabled, false);
		assert.ok(!explicitBlock.extensionArgs.includes(CAPABILITY_GATEWAY_EXTENSION_PATH));

		const explicitOptIn = resolvePiLaunchToolPlan({
			tools: ["read"],
			extensions: [],
			subagentOnlyExtensions: [path.dirname(CAPABILITY_GATEWAY_EXTENSION_PATH)],
		});
		assert.equal(explicitOptIn.capabilityGatewayEnabled, true);
		assert.ok(explicitOptIn.extensionArgs.includes(path.dirname(CAPABILITY_GATEWAY_EXTENSION_PATH)));
		assert.ok(explicitOptIn.effectiveToolAllowlist.includes("capability_discover"));
	});

	for (const host of ["parent", "runner"] as const) {
		it(`does not load or authorize the gateway for ${host} children with denyExtensions`, () => {
			const { agentDir } = createFixture();
			process.env.SELESAI_CODING_AGENT_DIR = agentDir;

			const launch = buildInProcessChildLaunch(childLaunch({
				host,
				tools: ["read"],
				subagentOnlyExtensions: [CAPABILITY_GATEWAY_EXTENSION_PATH],
				capabilityCeiling: { version: 1, allowedTools: ["read"], denyExtensions: true, sources: ["test"] },
			}));
			assert.equal(launch.toolPlan.capabilityGatewayEnabled, false);
			assert.deepEqual(launch.session.tools, ["read"]);
			assert.ok(!launch.session.extensionPaths.includes(CAPABILITY_GATEWAY_EXTENSION_PATH));
			assert.ok(!launch.toolPlan.requiredChildTools.some((tool) => tool.startsWith("capability_")));
			if (host === "runner") {
				assert.equal(launch.session.ambientExtensions, false);
			}
		});
	}
});
