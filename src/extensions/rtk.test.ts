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

import rtkExtension, { parseSemver } from "./rtk.ts";

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

	it("parseSemver returns null for non-version strings", () => {
		expect(parseSemver("no version here")).toBeNull();
		expect(parseSemver("")).toBeNull();
	});

	it("parseSemver parses X.Y.Z from arbitrary text", () => {
		expect(parseSemver("rtk 0.42.0")).toEqual([0, 42, 0]);
		expect(parseSemver("  v1.2.3 ")).toEqual([1, 2, 3]);
	});

	it("disables the extension when --version fails", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { pi, handlers } = makePi();
		ensureToolMock.mockResolvedValue("rtk");
		// Override exec so --version fails.
		pi.exec = vi.fn(async () => ({ code: 1, stdout: "", stderr: "not found", killed: false }));
		rtkExtension(pi);
		await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining("failed --version")));
		expect(handlers.has("tool_call")).toBe(false);
	});

	it("disables the extension when the version is unparseable", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { pi, handlers } = makePi();
		ensureToolMock.mockResolvedValue("rtk");
		pi.exec = vi.fn(async () => ({ code: 0, stdout: "garbage output", stderr: "", killed: false }));
		rtkExtension(pi);
		await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining("could not parse version")));
		expect(handlers.has("tool_call")).toBe(false);
	});

	it("disables the extension when the version output is empty", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { pi, handlers } = makePi();
		ensureToolMock.mockResolvedValue("rtk");
		pi.exec = vi.fn(async () => ({ code: 0, stdout: "   ", stderr: "", killed: false }));
		rtkExtension(pi);
		await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining("<empty output>")));
		expect(handlers.has("tool_call")).toBe(false);
	});

	it("disables the extension when the version is too old", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { pi, handlers } = makePi();
		ensureToolMock.mockResolvedValue("rtk");
		pi.exec = vi.fn(async () => ({ code: 0, stdout: "rtk 0.22.0", stderr: "", killed: false }));
		rtkExtension(pi);
		await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining("too old")));
		expect(handlers.has("tool_call")).toBe(false);
	});

	it("warns and skips when ensureTool fails", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		ensureToolMock.mockRejectedValue(new Error("download failed"));
		const { pi, handlers } = makePi();
		rtkExtension(pi);
		await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining("managed installation failed")));
		expect(handlers.has("tool_call")).toBe(false);
	});

	it("warns with the stringified error when ensureTool rejects a non-Error", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		ensureToolMock.mockRejectedValue("plain string failure");
		const { pi, handlers } = makePi();
		rtkExtension(pi);
		await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining("plain string failure")));
		expect(handlers.has("tool_call")).toBe(false);
	});

	it("warns and skips when ensureTool returns nothing", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		ensureToolMock.mockResolvedValue(undefined);
		const { pi, handlers } = makePi();
		rtkExtension(pi);
		await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining("unavailable")));
		expect(handlers.has("tool_call")).toBe(false);
	});

	it("warns and skips when probeRtk throws", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { pi, handlers } = makePi();
		ensureToolMock.mockResolvedValue("rtk");
		pi.exec = vi.fn(async () => {
			throw new Error("spawn ENOENT");
		});
		rtkExtension(pi);
		await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining("verification failed")));
		expect(handlers.has("tool_call")).toBe(false);
	});

	it("warns with the stringified error when probeRtk throws a non-Error", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { pi, handlers } = makePi();
		ensureToolMock.mockResolvedValue("rtk");
		pi.exec = vi.fn(async () => {
			throw "string failure";
		});
		rtkExtension(pi);
		await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining("string failure")));
		expect(handlers.has("tool_call")).toBe(false);
	});

	it("ignores non-bash tool calls and empty commands", async () => {
		const { pi, handlers } = makePi();
		rtkExtension(pi);
		const handler = await getToolCall(handlers);

		const nonBash: any = { type: "tool_call", toolName: "edit", toolCallId: "c1", input: { path: "a.ts" } };
		await handler(nonBash, { signal: undefined });
		expect(nonBash.input.path).toBe("a.ts");

		const nonString: any = { type: "tool_call", toolName: "bash", toolCallId: "c2", input: { command: 42 } };
		await handler(nonString, { signal: undefined });
		expect(nonString.input.command).toBe(42);

		const empty: any = { type: "tool_call", toolName: "bash", toolCallId: "c3", input: { command: "   " } };
		await handler(empty, { signal: undefined });
		expect(empty.input.command).toBe("   ");
	});

	it("passes through when RTK_DISABLED is set mid-run", async () => {
		const { pi, handlers } = makePi();
		rtkExtension(pi);
		const handler = await getToolCall(handlers);

		process.env.RTK_DISABLED = "1";
		try {
			const event: any = { type: "tool_call", toolName: "bash", toolCallId: "c1", input: { command: "git status" } };
			await handler(event, { signal: undefined });
			expect(event.input.command).toBe("git status");
		} finally {
			delete process.env.RTK_DISABLED;
		}
	});

	it("passes through when rewrite is killed or returns an unexpected code", async () => {
		const { pi, handlers } = makePi();
		rtkExtension(pi);
		const handler = await getToolCall(handlers);

		// The probe (--version + gain) already ran against the real fake binary,
		// so the mock's responses are consumed by the rewrite call only.
		// Killed rewrite.
		pi.exec = vi.fn().mockResolvedValueOnce({ code: 0, stdout: "", stderr: "", killed: true });
		const event1: any = { type: "tool_call", toolName: "bash", toolCallId: "c1", input: { command: "git status" } };
		await handler(event1, { signal: undefined });
		expect(event1.input.command).toBe("git status");

		// Unexpected exit code (2).
		pi.exec = vi.fn().mockResolvedValueOnce({ code: 2, stdout: "", stderr: "err", killed: false });
		const event2: any = { type: "tool_call", toolName: "bash", toolCallId: "c2", input: { command: "git status" } };
		await handler(event2, { signal: undefined });
		expect(event2.input.command).toBe("git status");
	});

	it("passes through when rewrite returns empty stdout", async () => {
		const { pi, handlers } = makePi();
		rtkExtension(pi);
		const handler = await getToolCall(handlers);

		pi.exec = vi.fn().mockResolvedValueOnce({ code: 0, stdout: "   ", stderr: "", killed: false });
		const event: any = { type: "tool_call", toolName: "bash", toolCallId: "c1", input: { command: "git status" } };
		await handler(event, { signal: undefined });
		expect(event.input.command).toBe("git status");
	});

	it("fails open when the tool_call handler throws", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { pi, handlers } = makePi();
		rtkExtension(pi);
		const handler = await getToolCall(handlers);

		pi.exec = vi.fn().mockRejectedValueOnce(new Error("boom"));
		const event: any = { type: "tool_call", toolName: "bash", toolCallId: "c1", input: { command: "git status" } };
		await handler(event, { signal: undefined });
		expect(event.input.command).toBe("git status");
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("unexpected error"), expect.any(Error));
	});
});
