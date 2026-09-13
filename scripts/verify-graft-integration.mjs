#!/usr/bin/env node
/**
 * Verify that the Graft integration is wired into Selesai.
 *
 * `loader` checks the bundled extension through Selesai's real loader.
 * `profiles` checks the automatic pi-graft → pi-subagents builtin augmentation
 * in source and packaged trees. It deliberately uses no agent-directory files.
 *
 * Requires `npm run build` first. `profiles` needs --experimental-strip-types
 * because it imports pi-subagents' TypeScript discovery and augmentation code.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];
const failures = [];
const fail = (message) => failures.push(message);
const EXTENSION_DIR = path.join(repoRoot, "src", "extensions", "pi-graft");
const MANIFEST = path.join(repoRoot, "src", "extensions", "package.json");
const EXPECTED_TOOLS = ["graft_check_freshness", "graft_file_api", "graft_find_all", "graft_find_code", "graft_repo_map", "graft_trace_calls"];
const EXPECTED_EVENTS = ["agent_end", "before_agent_start", "session_shutdown", "session_start", "tool_result", "turn_start"];
const GRAFT_AWARE_PROFILES = ["scout", "reviewer", "worker", "delegate", "oracle"];
const GRAFT_FREE_PROFILES = ["researcher"];

function checkManifest() {
	if (!existsSync(MANIFEST)) return fail(`missing ${path.relative(repoRoot, MANIFEST)}`);
	const entries = JSON.parse(readFileSync(MANIFEST, "utf-8"))?.pi?.extensions ?? [];
	const graftIndex = entries.indexOf("./pi-graft");
	const subagentsIndex = entries.indexOf("./pi-subagents");
	if (graftIndex < 0) fail('src/extensions/package.json "pi.extensions" does not list "./pi-graft"');
	if (subagentsIndex < 0 || graftIndex > subagentsIndex) fail("pi-graft must load before pi-subagents so it can answer the augmentation request");
}

function profileErrors(agent, provider, tools, resolvePiLaunchToolPlan) {
	const errors = [];
	if ((agent.subagentOnlyExtensions ?? []).length !== 1 || agent.subagentOnlyExtensions?.[0] !== provider || !existsSync(provider)) {
		errors.push(`automatic provider must be pi-graft/index.ts (got ${JSON.stringify(agent.subagentOnlyExtensions)})`);
	}
	const missing = EXPECTED_TOOLS.filter((tool) => !(agent.tools ?? []).includes(tool));
	if (missing.length > 0) errors.push(`allowlist is missing ${missing.join(", ")}, so that run works blind`);
	for (const tool of (agent.tools ?? []).filter((entry) => entry.startsWith("graft_"))) {
		if (!tools.has(tool)) errors.push(`allowlists "${tool}", which pi-graft does not register`);
	}
	const plan = resolvePiLaunchToolPlan({ tools: agent.tools, subagentOnlyExtensions: agent.subagentOnlyExtensions });
	if (!plan.extensionArgs.includes(provider)) errors.push("strict child tool plan omits the Graft provider");
	const unavailable = EXPECTED_TOOLS.filter((tool) => !plan.requiredChildTools.includes(tool));
	if (unavailable.length > 0) errors.push(`strict child tool plan omits ${unavailable.join(", ")}`);
	return errors;
}

async function runLoaderMode() {
	checkManifest();
	const loaderPath = path.join(repoRoot, "dist", "core", "extensions", "loader.js");
	if (!existsSync(loaderPath)) return fail("dist/core/extensions/loader.js is missing — run `npm run build` first");
	const { discoverAndLoadExtensions } = await import(loaderPath);
	const result = await discoverAndLoadExtensions([EXTENSION_DIR], repoRoot, path.join(os.tmpdir(), "graft-verify-agentdir"));
	for (const error of result.errors ?? []) fail(`loader reported: ${error.path}: ${error.error}`);
	const extension = (result.extensions ?? []).find((candidate) => candidate.path.includes("pi-graft"));
	if (!extension) return fail(`the loader did not produce an extension for ${path.relative(repoRoot, EXTENSION_DIR)}`);
	const tools = [...extension.tools.keys()].sort();
	const missingTools = EXPECTED_TOOLS.filter((name) => !tools.includes(name));
	if (missingTools.length > 0) fail(`the loaded extension does not register: ${missingTools.join(", ")}`);
	const events = [...extension.handlers.keys()].sort();
	const missingEvents = EXPECTED_EVENTS.filter((name) => !events.includes(name));
	if (missingEvents.length > 0) fail(`the loaded extension does not handle: ${missingEvents.join(", ")}`);
	if (!extension.commands.has("graft")) fail("the loaded extension does not register the /graft command");
	if (failures.length === 0) console.log(`extension load verification passed (${tools.length} tools, ${events.length} events, 1 command)`);
}

async function runProfilesMode() {
	checkManifest();
	await verifyTree("source", path.join(repoRoot, "src", "extensions", "pi-graft"), path.join(repoRoot, "src", "extensions", "pi-subagents"));
	await verifyTree("packaged", path.join(repoRoot, "dist", "extensions", "pi-graft"), path.join(repoRoot, "dist", "extensions", "pi-subagents"));
	if (failures.length === 0) console.log(`subagent augmentation verification passed (${GRAFT_AWARE_PROFILES.length} builtins, ${EXPECTED_TOOLS.length} tools)`);
}

async function verifyTree(label, graftDir, subagentsDir) {
	const home = mkdtempSync(path.join(os.tmpdir(), "graft-verify-home-"));
	const cwd = mkdtempSync(path.join(os.tmpdir(), "graft-verify-cwd-"));
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	const previousAgentDir = process.env.SELESAI_CODING_AGENT_DIR;
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	process.env.SELESAI_CODING_AGENT_DIR = path.join(home, "agent");
	try {
		const loaderPath = path.join(repoRoot, "dist", "core", "extensions", "loader.js");
		const eventBusPath = path.join(repoRoot, "dist", "core", "event-bus.js");
		if (!existsSync(loaderPath) || !existsSync(eventBusPath)) throw new Error("build output is missing — run npm run build first");
		const { discoverAndLoadExtensions } = await import(loaderPath);
		const { createEventBus } = await import(eventBusPath);
		const eventBus = createEventBus();
		const loaded = await discoverAndLoadExtensions([graftDir], cwd, path.join(home, "agent"), eventBus);
		for (const error of loaded.errors ?? []) fail(`${label}: loader reported: ${error.path}: ${error.error}`);
		const { requestBuiltinAgentAugmentations, applyBuiltinAgentAugmentations } = await import(pathToFileURL(path.join(subagentsDir, "src", "agents", "builtin-agent-augmentations.ts")).href);
		const { discoverAgentsAll } = await import(pathToFileURL(path.join(subagentsDir, "src", "agents", "agents.ts")).href);
		const { resolvePiLaunchToolPlan } = await import(pathToFileURL(path.join(subagentsDir, "src", "runs", "shared", "child-tool-plan.ts")).href);
		const augmentations = requestBuiltinAgentAugmentations({ events: eventBus });
		if (augmentations.length !== 1 || augmentations[0]?.id !== "pi-graft") fail(`${label}: pi-graft did not register one builtin augmentation`);
		const all = discoverAgentsAll(cwd);
		const agents = applyBuiltinAgentAugmentations(all.builtin, augmentations);
		const tools = new Set(EXPECTED_TOOLS);
		for (const name of GRAFT_AWARE_PROFILES) {
			const builtin = all.builtin.find((agent) => agent.name === name);
			const agent = agents.find((candidate) => candidate.name === name);
			if (!builtin || !agent) {
				fail(`${label}/${name}: pi-subagents builtin was not discovered`);
				continue;
			}
			if ((builtin.tools ?? []).some((tool) => tool.startsWith("graft_"))) fail(`${label}/${name}: builtin profile must stay Graft-free`);
			for (const error of profileErrors(agent, path.join(graftDir, "index.ts"), tools, resolvePiLaunchToolPlan)) fail(`${label}/${name}: ${error}`);
		}
		for (const name of GRAFT_FREE_PROFILES) {
			const agent = agents.find((candidate) => candidate.name === name);
			if (!agent) fail(`${label}: builtin agent "${name}" was not discovered`);
			if ((agent?.tools ?? []).some((tool) => tool.startsWith("graft_"))) fail(`${label}/${name}: carries code-context tools it has no use for`);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		fail(message.includes("Unknown file extension") || message.includes("strip-types")
			? "re-run with `node --experimental-strip-types` so pi-subagents TypeScript modules can be imported"
			: `${label}: automatic augmentation verification failed: ${message}`);
	} finally {
		if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
		if (previousUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousUserProfile;
		if (previousAgentDir === undefined) delete process.env.SELESAI_CODING_AGENT_DIR; else process.env.SELESAI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(home, { recursive: true, force: true });
		rmSync(cwd, { recursive: true, force: true });
	}
}

if (mode === "loader") await runLoaderMode();
else if (mode === "profiles") await runProfilesMode();
else {
	console.error("usage: node scripts/verify-graft-integration.mjs <loader|profiles>");
	process.exit(2);
}
if (failures.length > 0) {
	for (const message of failures) console.error(`✗ ${message}`);
	process.exit(1);
}
