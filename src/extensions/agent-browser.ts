/**
 * agent-browser setup extension.
 *
 * The bundled `agent-browser` skill needs the `agent-browser` CLI (npm package)
 * installed (`npm i -g agent-browser && agent-browser install`). This extension
 * makes sure the user installs it when it is missing:
 *
 * - On the first startup where the CLI is not on PATH, ask the user to install
 *   it globally via npm and run the documented install steps when they agree.
 * - Declining records a marker in the agent dir so we don't nag on every
 *   startup; the `/setup-agent-browser` command re-runs the flow any time.
 * - With no UI (headless/CI), fall back to a console warning with the install
 *   command, mirroring the rtk extension's fail-open behavior.
 *
 * Mirrors src/extensions/rtk.ts (probe, opt-out env var, fail-open warning)
 * and src/extensions/web-agent-onboarding.ts (confirm -> act -> marker).
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@selesai/code";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, SessionStartEvent } from "@selesai/code";

const PROBE_TIMEOUT_MS = 2_000;
const INSTALL_TIMEOUT_MS = 180_000; // `npm i -g` can be slow on a cold cache
const BROWSER_INSTALL_TIMEOUT_MS = 600_000; // `agent-browser install` provisions a browser

/** Set to "1" to skip the automated setup prompt (the skill still works if installed). */
export const SKIP_ENV = "SELESAI_SKIP_AGENT_BROWSER_SETUP";
export const DECLINED_MARKER_NAME = ".agentBrowserSetupDeclined";

export const INSTALL_COMMAND = "npm i -g agent-browser && agent-browser install";

// `pi.exec` spawns without a shell, so on Windows npm/agent-browser are .cmd
// shims that must be launched through cmd.exe.
function cliCommand(args: string[]): { command: string; args: string[] } {
	if (process.platform === "win32") {
		return { command: "cmd", args: ["/c", ...args] };
	}
	return { command: args[0]!, args: args.slice(1) };
}

export function getDeclinedMarkerPath(agentDir: string = getAgentDir()): string {
	return join(agentDir, DECLINED_MARKER_NAME);
}

function isDeclined(agentDir: string = getAgentDir()): boolean {
	return existsSync(getDeclinedMarkerPath(agentDir));
}

function markDeclined(agentDir: string = getAgentDir()): void {
	const markerPath = getDeclinedMarkerPath(agentDir);
	mkdirSync(dirname(markerPath), { recursive: true });
	writeFileSync(markerPath, "1", "utf-8");
}

function notify(ctx: ExtensionContext, message: string, type?: "info" | "warning" | "error"): void {
	if (ctx.hasUI) ctx.ui.notify(message, type);
}

/** True when the `agent-browser` CLI is on PATH and answers `--version`. */
export async function isAgentBrowserInstalled(pi: ExtensionAPI): Promise<boolean> {
	const { command, args } = cliCommand(["agent-browser", "--version"]);
	try {
		const result = await pi.exec(command, args, { timeout: PROBE_TIMEOUT_MS });
		return !result.killed && result.code === 0;
	} catch {
		return false;
	}
}

/** Run `npm i -g agent-browser`; returns an error message or null on success. */
async function runNpmInstall(pi: ExtensionAPI): Promise<string | null> {
	const { command, args } = cliCommand(["npm", "i", "-g", "agent-browser"]);
	const result = await pi.exec(command, args, { timeout: INSTALL_TIMEOUT_MS });
	if (result.killed) return "npm install timed out";
	if (result.code !== 0) {
		return (result.stderr || result.stdout || `exit status ${result.code}`).trim() || "npm install failed";
	}
	return null;
}

/** Best-effort `agent-browser install` (provisions the browser). Non-fatal. */
async function provisionBrowser(pi: ExtensionAPI): Promise<boolean> {
	const { command, args } = cliCommand(["agent-browser", "install"]);
	try {
		const result = await pi.exec(command, args, { timeout: BROWSER_INSTALL_TIMEOUT_MS });
		return !result.killed && result.code === 0;
	} catch {
		return false;
	}
}

/**
 * Probe for the CLI; when missing, ask the user to install it via npm and run
 * the documented install steps if they agree. Returns whether the CLI is
 * available afterwards.
 */
export async function ensureAgentBrowser(pi: ExtensionAPI, ctx: ExtensionContext): Promise<boolean> {
	if (await isAgentBrowserInstalled(pi)) {
		notify(ctx, "agent-browser CLI is already installed.", "info");
		return true;
	}

	// No dialog UI (headless/CI): warn with the install command, like rtk does.
	if (!ctx.hasUI) {
		console.warn(`[agent-browser] CLI not found; install with: ${INSTALL_COMMAND}`);
		return false;
	}

	const wantsInstall = await ctx.ui.confirm(
		"Install agent-browser?",
		`The agent-browser skill needs the agent-browser CLI. Install it globally via npm?\n\n${INSTALL_COMMAND}`,
	);
	if (!wantsInstall) {
		markDeclined();
		ctx.ui.notify(`Skipped. Run /setup-agent-browser later or install manually: ${INSTALL_COMMAND}`, "info");
		return false;
	}

	ctx.ui.notify("Installing agent-browser via npm…", "info");
	const error = await runNpmInstall(pi);
	if (error) {
		ctx.ui.notify(`agent-browser install failed: ${error}`, "error");
		ctx.ui.notify(`Install manually: ${INSTALL_COMMAND}`, "warning");
		return false;
	}

	if (!(await isAgentBrowserInstalled(pi))) {
		ctx.ui.notify("npm reported success, but agent-browser is still not on PATH.", "warning");
		ctx.ui.notify(`Try running: ${INSTALL_COMMAND}`, "info");
		return false;
	}

	if (await provisionBrowser(pi)) {
		ctx.ui.notify("agent-browser installed and browser provisioned.", "info");
	} else {
		ctx.ui.notify("agent-browser installed. Run `agent-browser install` to provision the browser.", "info");
	}
	return true;
}

export default function agentBrowserSetupExtension(pi: ExtensionAPI): void {
	pi.on("session_start", async (event: SessionStartEvent, ctx: ExtensionContext) => {
		if (event.reason !== "startup") return;
		if (process.env[SKIP_ENV] === "1") return;
		if (isDeclined()) return;
		await ensureAgentBrowser(pi, ctx);
	});

	// Manual re-run; also the escape hatch after a decline.
	pi.registerCommand("setup-agent-browser", {
		description: "Install the agent-browser CLI (npm) if missing, or re-check",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			await ensureAgentBrowser(pi, ctx);
		},
	});
}
