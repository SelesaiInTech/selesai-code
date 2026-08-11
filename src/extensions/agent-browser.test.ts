import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import agentBrowserSetupExtension, {
	DECLINED_MARKER_NAME,
	ensureAgentBrowser,
	getDeclinedMarkerPath,
	INSTALL_COMMAND,
	isAgentBrowserInstalled,
	SKIP_ENV,
} from "./agent-browser.ts";

type ExecResult = { code: number; stdout: string; stderr: string; killed: boolean };

function makePi(execImpl?: (command: string, args: string[], opts?: { timeout?: number }) => Promise<ExecResult>) {
	const handlers = new Map<string, Function[]>();
	const commands = new Map<string, any>();
	const exec = vi.fn(
		execImpl ?? (async () => ({ code: 0, stdout: "", stderr: "", killed: false }) as ExecResult),
	);
	const pi = {
		exec,
		on: (evt: string, h: Function) => {
			handlers.set(evt, [...(handlers.get(evt) ?? []), h]);
		},
		registerCommand: (name: string, options: any) => {
			commands.set(name, options);
		},
	};
	return { pi: pi as any, handlers, commands, exec };
}

function makeCtx(overrides?: Partial<{ hasUI: boolean; confirmResult: boolean }>) {
	const ui = {
		confirm: vi.fn(async () => overrides?.confirmResult ?? true),
		notify: vi.fn(),
	};
	return { hasUI: overrides?.hasUI ?? true, ui } as any;
}

function getSessionStartHandler(handlers: Map<string, Function[]>): Function {
	const handler = handlers.get("session_start")?.[0];
	if (!handler) throw new Error("no session_start handler registered");
	return handler;
}

const ok: ExecResult = { code: 0, stdout: "", stderr: "", killed: false };
const fail: ExecResult = { code: 1, stdout: "", stderr: "command not found", killed: false };

let tmpDir: string;

beforeAll(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "agent-browser-test-"));
	process.env.SELESAI_CODING_AGENT_DIR = tmpDir;
	process.env.PI_CODING_AGENT_DIR = tmpDir;
});

afterEach(() => {
	vi.restoreAllMocks();
	// The decline marker persists in the shared temp agent dir; remove it so
	// later tests (no-UI, npm-failure) don't short-circuit on isDeclined().
	rmSync(getDeclinedMarkerPath(), { force: true });
});

afterAll(() => {
	delete process.env.SELESAI_CODING_AGENT_DIR;
	delete process.env.PI_CODING_AGENT_DIR;
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("agent-browser setup extension", () => {
	it("registers a session_start hook and the setup-agent-browser command", async () => {
		const { pi, handlers, commands } = makePi();
		await agentBrowserSetupExtension(pi);
		expect(handlers.has("session_start")).toBe(true);
		expect(commands.has("setup-agent-browser")).toBe(true);
	});

	it("skips probing when the opt-out env var is set or session is not a startup", async () => {
		process.env[SKIP_ENV] = "1";
		try {
			const { pi, handlers, exec } = makePi();
			await agentBrowserSetupExtension(pi);
			await getSessionStartHandler(handlers)({ type: "session_start", reason: "startup" }, makeCtx());
			expect(exec).not.toHaveBeenCalled();
		} finally {
			delete process.env[SKIP_ENV];
		}

		const { pi, handlers, exec } = makePi();
		await agentBrowserSetupExtension(pi);
		await getSessionStartHandler(handlers)({ type: "session_start", reason: "reload" }, makeCtx());
		expect(exec).not.toHaveBeenCalled();
	});

	it("does not prompt when the CLI is already installed", async () => {
		const { pi, handlers, exec } = makePi();
		await agentBrowserSetupExtension(pi);
		const ctx = makeCtx();
		await getSessionStartHandler(handlers)({ type: "session_start", reason: "startup" }, ctx);

		expect(exec).toHaveBeenCalledTimes(1);
		const args = exec.mock.calls[0][1] as string[];
		expect(args.join(" ")).toContain("--version");
		expect(ctx.ui.confirm).not.toHaveBeenCalled();
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("already installed"), "info");
	});

	it("installs via npm when the user confirms, then provisions the browser", async () => {
		const execImpl = vi
			.fn()
			.mockResolvedValueOnce(fail) // probe: missing
			.mockResolvedValueOnce(ok) // npm i -g agent-browser
			.mockResolvedValueOnce(ok) // probe: now present
			.mockResolvedValueOnce(ok); // agent-browser install
		const { pi, handlers, exec } = makePi(execImpl as any);
		await agentBrowserSetupExtension(pi);
		const ctx = makeCtx();
		await getSessionStartHandler(handlers)({ type: "session_start", reason: "startup" }, ctx);

		expect(ctx.ui.confirm).toHaveBeenCalledWith(expect.stringContaining("Install agent-browser?"), expect.any(String));
		expect(exec).toHaveBeenCalledTimes(4);
		const calls = exec.mock.calls.map(([command, args]) => [command, ...(args as string[])].join(" "));
		expect(calls[0]).toContain("--version");
		expect(calls[1]).toContain("npm");
		expect(calls[1]).toContain("agent-browser");
		expect(calls[2]).toContain("--version");
		expect(calls[3]).toBe(`${process.platform === "win32" ? "cmd /c " : ""}agent-browser install`);
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("browser provisioned"), "info");
	});

	it("records a decline marker and notifies when the user says no", async () => {
		const execImpl = vi.fn().mockResolvedValue(fail);
		const { pi, handlers, exec } = makePi(execImpl as any);
		await agentBrowserSetupExtension(pi);
		const ctx = makeCtx({ confirmResult: false });
		await getSessionStartHandler(handlers)({ type: "session_start", reason: "startup" }, ctx);

		expect(exec).toHaveBeenCalledTimes(1); // probe only
		expect(existsSync(getDeclinedMarkerPath())).toBe(true);
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Skipped"), "info");
	});

	it("warns with install instructions when there is no UI", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const execImpl = vi.fn().mockResolvedValue(fail);
		const { pi, handlers } = makePi(execImpl as any);
		await agentBrowserSetupExtension(pi);
		const ctx = makeCtx({ hasUI: false });
		await getSessionStartHandler(handlers)({ type: "session_start", reason: "startup" }, ctx);

		expect(ctx.ui.confirm).not.toHaveBeenCalled();
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(INSTALL_COMMAND));
	});

	it("reports a failed npm install and skips browser provisioning", async () => {
		const execImpl = vi
			.fn()
			.mockResolvedValueOnce(fail) // probe
			.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "EACCES", killed: false }); // npm fails
		const { pi, handlers, exec } = makePi(execImpl as any);
		await agentBrowserSetupExtension(pi);
		const ctx = makeCtx();
		await getSessionStartHandler(handlers)({ type: "session_start", reason: "startup" }, ctx);

		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("failed"), "error");
		expect(exec).toHaveBeenCalledTimes(2);
		expect(exec.mock.calls.some((c) => (c[1] as string[]).join(" ").endsWith("agent-browser install"))).toBe(false);
	});

	it("isAgentBrowserInstalled reports the probe result", async () => {
		const { pi, exec } = makePi(async () => ok);
		expect(await isAgentBrowserInstalled(pi)).toBe(true);
		expect(exec).toHaveBeenCalledTimes(1);

		const { pi: pi2, exec: exec2 } = makePi(async () => fail);
		expect(await isAgentBrowserInstalled(pi2)).toBe(false);
		expect(exec2).toHaveBeenCalledTimes(1);
	});

	it("setup-agent-browser command re-runs the flow", async () => {
		const { pi, commands } = makePi(async () => ok);
		await agentBrowserSetupExtension(pi);
		const command = commands.get("setup-agent-browser");
		expect(command).toBeDefined();
		const ctx = makeCtx();
		await command.handler("", ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("already installed"), "info");
	});

	it("declined marker path lives in the agent dir", () => {
		expect(getDeclinedMarkerPath()).toBe(join(tmpDir, DECLINED_MARKER_NAME));
	});
});
