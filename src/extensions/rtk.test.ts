import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";

const { ensureToolMock } = vi.hoisted(() => ({ ensureToolMock: vi.fn() }));

vi.mock("@selesai/code", async (importOriginal) => ({
	...(await importOriginal<typeof import("@selesai/code")>()),
	ensureTool: ensureToolMock,
}));

import rtkExtension from "./rtk.ts";

// The fake-binary tests need a POSIX shell shim. Windows CI cannot spawn
// .cmd shims without a shell, and the real flow uses the managed rtk.exe
// there, so the shim tests are POSIX-only.
const posixOnly = describe.skipIf(process.platform === "win32");

function fakeRtkDir(version: string, gainExit: number): string {
	const dir = mkdtempSync(join(tmpdir(), "rtk-test-"));
	const binDir = join(dir, "bin");
	mkdirSync(binDir, { recursive: true });
	const bin = join(binDir, "rtk");
	writeFileSync(
		bin,
		`#!/usr/bin/env bash
case "$1" in
  --version) echo "rtk ${version}"; exit 0;;
  gain) echo "RTK Token Savings (Global Scope)"; exit ${gainExit};;
  rewrite) echo "rtk $2"; exit 3;;
  *) exit 0;;
esac
`,
		{ mode: 0o755 },
	);
	return dir;
}

function makePi() {
	const handlers = new Map<string, Function[]>();
	const pi = {
		exec: async (cmd: string, args: string[], opts?: { timeout?: number }) =>
			new Promise((resolve) => {
				execFile(cmd, args, { timeout: opts?.timeout }, (error, stdout, stderr) => {
					if (error) {
						// execFile reports non-zero exits as errors; keep the real exit code.
						const code =
							typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === "number"
								? ((error as any).code as number)
								: 1;
						resolve({ code, stdout: stdout ?? "", stderr: stderr ?? "", killed: false });
					} else {
						resolve({ code: 0, stdout: stdout ?? "", stderr: stderr ?? "", killed: false });
					}
				});
			}),
		on: (evt: string, h: Function) => {
			handlers.set(evt, [...(handlers.get(evt) ?? []), h]);
		},
	};
	return { pi: pi as any, handlers };
}

async function getToolCall(handlers: Map<string, Function[]>): Promise<Function> {
	await vi.waitFor(() => expect(handlers.has("tool_call")).toBe(true));
	return handlers.get("tool_call")![0]!;
}

let fakeDir: string;
let oldPath: string | undefined;

beforeAll(() => {
	fakeDir = fakeRtkDir("0.42.0", 0);
	oldPath = process.env.PATH;
	process.env.PATH = `${join(fakeDir, "bin")}${oldPath ? ":" + oldPath : ""}`;
});

beforeEach(() => {
	ensureToolMock.mockReset();
	ensureToolMock.mockResolvedValue("rtk");
});

afterEach(() => {
	vi.restoreAllMocks();
});

afterAll(() => {
	if (oldPath) process.env.PATH = oldPath;
	else delete process.env.PATH;
	rmSync(fakeDir, { recursive: true, force: true });
});

posixOnly("rtk extension", () => {
	it("registers a tool_call hook and rewrites compatible bash commands", async () => {
		const { pi, handlers } = makePi();
		rtkExtension(pi);

		const event: any = { type: "tool_call", toolName: "bash", toolCallId: "c1", input: { command: "git status" } };
		await (await getToolCall(handlers))(event, { signal: undefined });
		expect(event.input.command).toBe("rtk git status");
	});

	it("skips commands that already start with rtk", async () => {
		const { pi, handlers } = makePi();
		rtkExtension(pi);

		const event: any = { type: "tool_call", toolName: "bash", toolCallId: "c1", input: { command: "rtk git status" } };
		await (await getToolCall(handlers))(event, { signal: undefined });
		expect(event.input.command).toBe("rtk git status");
	});

	it("does not register a hook when rtk is disabled", () => {
		process.env.RTK_DISABLED = "1";
		try {
			const { pi, handlers } = makePi();
			rtkExtension(pi);
			expect(handlers.has("tool_call")).toBe(false);
			expect(ensureToolMock).not.toHaveBeenCalled();
		} finally {
			delete process.env.RTK_DISABLED;
		}
	});

	it("does not register a hook for a wrong rtk binary (gain fails)", async () => {
		const wrongDir = fakeRtkDir("0.40.0", 1);
		const previousPath = process.env.PATH;
		process.env.PATH = `${join(wrongDir, "bin")}${previousPath ? ":" + previousPath : ""}`;
		try {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const { pi, handlers } = makePi();
			rtkExtension(pi);
			await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining("rtk gain failed")));
			expect(handlers.has("tool_call")).toBe(false);
		} finally {
			if (previousPath) process.env.PATH = previousPath;
			rmSync(wrongDir, { recursive: true, force: true });
		}
	});
});
