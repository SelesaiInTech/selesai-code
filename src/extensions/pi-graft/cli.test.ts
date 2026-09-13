import { describe, expect, it, vi } from "vitest";
import {
	applyTelemetryDefault,
	askReferences,
	boundText,
	compareVersions,
	DEFAULT_FIND_LIMIT,
	GRAFT_INSTALL_SPEC,
	graftArgs,
	graftCommand,
	INSTALL_COMMAND,
	INSTALL_TIMEOUT_MS,
	installGraft,
	graftFailureMessage,
	isCompatibleVersion,
	MAX_GRAFT_VERSION_EXCLUSIVE,
	MIN_GRAFT_VERSION,
	parseAskJson,
	parsePointer,
	npmCommand,
	parseVersion,
	probeGraft,
	renderAsk,
	runGraft,
	TELEMETRY_ENV,
	type GraftOp,
	type GraftRun,
} from "./cli.ts";
import { FAILED, makePi, OK, type StubExecResult } from "./test-support.ts";

function execReturning(result: StubExecResult) {
	return { ...result };
}

describe("graftCommand", () => {
	it("invokes the executable directly off Windows", () => {
		const original = process.platform;
		if (original === "win32") return;
		expect(graftCommand(["ask", "hi"])).toEqual({ command: "graft", args: ["ask", "hi"] });
	});

	it("routes through cmd.exe on win32 so the .cmd shim can be spawned without a shell", () => {
		const original = process.platform;
		Object.defineProperty(process, "platform", { value: "win32" });
		try {
			expect(graftCommand(["build"])).toEqual({ command: "cmd", args: ["/c", "graft", "build"] });
		} finally {
			Object.defineProperty(process, "platform", { value: original });
		}
	});
});

describe("installGraft", () => {
	it("runs the compatible global npm install without a shell off Windows", async () => {
		const { pi } = makePi(async () => execReturning(OK));
		const run = await installGraft(pi.exec as never, "/repo");
		expect(GRAFT_INSTALL_SPEC).toBe("@nanonets/graft@^0.18");
		expect(INSTALL_COMMAND).toBe("npm install -g @nanonets/graft@^0.18");
		const [command, args, options] = pi.exec.mock.calls[0] as [string, string[], { cwd: string; timeout: number }];
		expect(command).toBe(process.platform === "win32" ? "cmd" : "npm");
		expect(args).toContain("install");
		expect(args).toContain(GRAFT_INSTALL_SPEC);
		expect(options).toMatchObject({ cwd: "/repo", timeout: INSTALL_TIMEOUT_MS });
		expect(run.code).toBe(0);
	});

	it("routes npm through cmd.exe on win32", () => {
		const original = process.platform;
		Object.defineProperty(process, "platform", { value: "win32" });
		try {
			expect(npmCommand(["install", "-g", GRAFT_INSTALL_SPEC])).toEqual({
				command: "cmd",
				args: ["/c", "npm", "install", "-g", GRAFT_INSTALL_SPEC],
			});
		} finally {
			Object.defineProperty(process, "platform", { value: original });
		}
	});

	it("normalizes install spawn failures", async () => {
		const { pi } = makePi(async () => {
			throw new Error("spawn npm ENOENT");
		});
		const run = await installGraft(pi.exec as never, "/repo");
		expect(run.code).toBe(1);
		expect(run.stderr).toContain("ENOENT");
	});
});

describe("version handling", () => {
	it("reads a semantic version out of arbitrary CLI output", () => {
		expect(parseVersion("0.18.0")).toBe("0.18.0");
		expect(parseVersion("graft v0.18.3\nlatest on npm: 0.19.0")).toBe("0.18.3");
		expect(parseVersion("0.18.0-beta.2")).toBe("0.18.0-beta.2");
		expect(parseVersion("no version here")).toBeUndefined();
	});

	it("compares numeric segments, ignoring suffixes", () => {
		expect(compareVersions("0.18.0", "0.18.0")).toBe(0);
		expect(compareVersions("0.17.9", "0.18.0")).toBeLessThan(0);
		expect(compareVersions("0.18.1-beta.1", "0.18.0")).toBeGreaterThan(0);
		expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
	});

	it("accepts the verified range and rejects the boundaries", () => {
		expect(isCompatibleVersion(MIN_GRAFT_VERSION)).toBe(true);
		expect(isCompatibleVersion("0.18.4")).toBe(true);
		expect(isCompatibleVersion("0.99.0")).toBe(true);
		expect(isCompatibleVersion("0.17.9")).toBe(false);
		expect(isCompatibleVersion(MAX_GRAFT_VERSION_EXCLUSIVE)).toBe(false);
		expect(isCompatibleVersion("1.2.0")).toBe(false);
	});
});

describe("probeGraft", () => {
	it("accepts a supported version and reports it", async () => {
		const { pi } = makePi(async () => execReturning({ ...OK, stdout: "0.18.0\n" }));
		const probe = await probeGraft(pi.exec as never, "/repo");
		expect(probe).toMatchObject({ kind: "ok", version: "0.18.0" });
		if (probe.kind === "ok") expect(probe.argv.at(-1)).toBe("--version");
	});

	it("reports a missing executable when the spawn throws", async () => {
		const { pi } = makePi(async () => {
			throw new Error("spawn graft ENOENT");
		});
		const probe = await probeGraft(pi.exec as never, "/repo");
		expect(probe.kind).toBe("missing");
		if (probe.kind === "missing") expect(probe.detail).toContain("ENOENT");
	});

	it("reports a missing executable when the probe is killed", async () => {
		const { pi } = makePi(async () => execReturning({ ...OK, killed: true }));
		const probe = await probeGraft(pi.exec as never, "/repo");
		expect(probe.kind).toBe("missing");
	});

	it("refuses to accept an out-of-range version", async () => {
		const { pi } = makePi(async () => execReturning({ ...OK, stdout: "0.4.0\n" }));
		const probe = await probeGraft(pi.exec as never, "/repo");
		expect(probe.kind).toBe("incompatible");
		if (probe.kind === "incompatible") {
			expect(probe.version).toBe("0.4.0");
			expect(probe.detail).toContain(MIN_GRAFT_VERSION);
		}
	});

	it("treats an unreadable version as incompatible rather than assuming compatibility", async () => {
		const { pi } = makePi(async () => execReturning({ ...OK, stdout: "graft (unknown build)\n" }));
		const probe = await probeGraft(pi.exec as never, "/repo");
		expect(probe.kind).toBe("incompatible");
		if (probe.kind === "incompatible") expect(probe.version).toBeUndefined();
	});
});

describe("graftArgs", () => {
	it("maps every read-only operation to its documented CLI invocation", () => {
		const cases: [GraftOp, string[]][] = [
			[{ kind: "find-code", question: "how does auth work" }, ["ask", "how does auth work", "--source", "--json"]],
			[
				{ kind: "find-code", question: "auth", limit: 3, in: "packages/api" },
				["ask", "auth", "--source", "--json", "-n", "3", "--in", "packages/api"],
			],
			[{ kind: "file-api", path: "src/app.ts" }, ["skeleton", "src/app.ts"]],
			[{ kind: "trace-calls", symbol: "build", direction: "in" }, ["callers", "build"]],
			[
				{ kind: "trace-calls", symbol: "build", direction: "out", depth: 3 },
				["callers", "build", "--direction", "out", "-d", "3"],
			],
			[
				{ kind: "find-all", pattern: "TODO", ignoreCase: true, fixed: true, in: "src" },
				["grep", "TODO", "-i", "--fixed", "--in", "src"],
			],
			[{ kind: "repo-map", maxDirs: 12 }, ["map", "--max-dirs", "12"]],
			[{ kind: "check-freshness" }, ["check", "--json"]],
			[{ kind: "build", deep: false }, ["build"]],
			[{ kind: "build", deep: true }, ["build", "--deep"]],
		];
		for (const [op, expected] of cases) expect(graftArgs(op)).toEqual(expected);
	});

	it("keeps the default depth implicit so the CLI's own default applies", () => {
		expect(graftArgs({ kind: "trace-calls", symbol: "x", direction: "in", depth: 1 })).toEqual(["callers", "x"]);
	});

	it("passes hostile input as one verbatim argv entry, never as shell text", () => {
		const question = 'rm -rf / && echo "pwned"; `whoami`';
		// The whole string survives as exactly one argv element: there is no shell to
		// reinterpret the metacharacters, and nothing splices it into another argument.
		expect(graftArgs({ kind: "find-code", question })).toEqual(["ask", question, "--source", "--json"]);

		const hostilePattern = '"; rm -rf $HOME; "';
		expect(graftArgs({ kind: "find-all", pattern: hostilePattern })).toEqual(["grep", hostilePattern]);

		expect(graftArgs({ kind: "file-api", path: "src/with space/and;rm.ts" })).toEqual([
			"skeleton",
			"src/with space/and;rm.ts",
		]);
	});
});

describe("runGraft", () => {
	it("runs in the resolved repository root and reports the full argv", async () => {
		const { pi } = makePi(async () => execReturning({ ...OK, stdout: "ok" }));
		const run = await runGraft(pi.exec as never, "/repo/root", { kind: "repo-map" });
		expect(pi.exec).toHaveBeenCalledTimes(1);
		const [command, args, options] = pi.exec.mock.calls[0] as [string, string[], { cwd: string; timeout: number }];
		expect(command).toBe(process.platform === "win32" ? "cmd" : "graft");
		expect(args).toContain("map");
		expect(options.cwd).toBe("/repo/root");
		expect(options.timeout).toBe(60_000);
		expect(run.cwd).toBe("/repo/root");
		expect(run.argv.at(-1)).toBe("map");
	});

	it("uses the long build timeout for builds", async () => {
		const { pi } = makePi(async () => execReturning(OK));
		await runGraft(pi.exec as never, "/repo", { kind: "build", deep: true });
		const [, , options] = pi.exec.mock.calls[0] as [string, string[], { timeout: number }];
		expect(options.timeout).toBe(1_800_000);
	});

	it("distinguishes a caller abort from a timeout", async () => {
		const { pi } = makePi(async () => execReturning({ ...OK, killed: true }));
		const controller = new AbortController();
		controller.abort();
		const cancelled = await runGraft(pi.exec as never, "/repo", { kind: "repo-map" }, { signal: controller.signal });
		expect(cancelled.cancelled).toBe(true);
		expect(cancelled.timedOut).toBe(false);

		const noSignal = await runGraft(pi.exec as never, "/repo", { kind: "repo-map" });
		expect(noSignal.timedOut).toBe(true);
		expect(noSignal.cancelled).toBe(false);
	});

	it("normalizes a spawn failure into a failed run instead of throwing", async () => {
		const { pi } = makePi(async () => {
			throw new Error("spawn graft ENOENT");
		});
		const run = await runGraft(pi.exec as never, "/repo", { kind: "repo-map" });
		expect(run.code).toBe(1);
		expect(run.stderr).toContain("ENOENT");
	});
});

describe("graftFailureMessage", () => {
	const base: GraftRun = {
		op: { kind: "repo-map" },
		argv: ["graft", "map"],
		cwd: "/repo",
		code: 1,
		stdout: "",
		stderr: "",
		killed: false,
		cancelled: false,
		timedOut: false,
	};

	it("names the command and its exit status, taking the first stderr line", () => {
		expect(graftFailureMessage({ ...base, stderr: "boom\ndetails" })).toBe("graft map failed (exit 1): boom");
	});

	it("falls back to stdout when stderr is empty", () => {
		expect(graftFailureMessage({ ...base, stdout: "✗ no graft/ here" })).toContain("no graft/ here");
	});

	it("reports cancellation and timeouts distinctly", () => {
		expect(graftFailureMessage({ ...base, cancelled: true })).toContain("cancelled");
		expect(graftFailureMessage({ ...base, timedOut: true })).toContain("timed out");
	});
});

describe("boundText", () => {
	it("passes short output through untouched", () => {
		const bounded = boundText("one\ntwo");
		expect(bounded).toEqual({ text: "one\ntwo", truncated: false, truncatedBy: null, totalBytes: 7 });
	});

	it("truncates by lines and says how to see the rest", () => {
		const bounded = boundText(Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n"), { maxLines: 10 });
		expect(bounded.truncated).toBe(true);
		expect(bounded.truncatedBy).toBe("lines");
		expect(bounded.text).toContain("line 0");
		expect(bounded.text).not.toContain("line 20");
		expect(bounded.text).toContain("[graft] output truncated (10 of 50 lines)");
	});

	it("truncates by bytes and reports the byte ceiling", () => {
		const bounded = boundText("x".repeat(500), { maxBytes: 100, maxLines: 100 });
		expect(bounded.truncated).toBe(true);
		expect(bounded.truncatedBy).toBe("bytes");
		expect(bounded.text).toContain("of 500 bytes");
	});
});

describe("parseAskJson", () => {
	const valid = JSON.stringify({
		query: "auth",
		mode: "lexical",
		hits: [
			{ kind: "symbol", title: "verify · function", pointer: "src/auth.ts:L10-L20", snippet: "checks", score: 3, code: "x" },
			{ kind: "concept", title: "Auth", pointer: "src/auth.ts", related: ["a"], score: 1 },
		],
		coverage: 0.6,
		coverageStrong: 0.5,
		saved: { files: 2, baselineChars: 4000 },
		rules: [{ text: "always verify" }],
	});

	it("reads the documented hit shape", () => {
		const payload = parseAskJson(valid);
		expect(payload?.mode).toBe("lexical");
		expect(payload?.coverage).toBe(0.6);
		expect(payload?.saved).toEqual({ files: 2, baselineChars: 4000 });
		expect(payload?.hits).toHaveLength(2);
		expect(payload?.hits[0]).toMatchObject({ pointer: "src/auth.ts:L10-L20", code: "x" });
		expect(payload?.rules).toEqual([{ id: undefined, text: "always verify" }]);
	});

	it("returns undefined for anything it cannot trust", () => {
		expect(parseAskJson("not json")).toBeUndefined();
		expect(parseAskJson("[]")).toBeUndefined();
		expect(parseAskJson(JSON.stringify({ query: "x" }))).toBeUndefined();
	});

	it("skips malformed hits instead of failing the whole parse", () => {
		const payload = parseAskJson(JSON.stringify({ hits: [{ title: "no pointer" }, { pointer: "src/a.ts" }, 7] }));
		expect(payload?.hits).toHaveLength(1);
		expect(payload?.hits[0]?.title).toBe("src/a.ts");
	});

	it("drops a malformed saved block rather than surfacing wrong numbers", () => {
		expect(parseAskJson(JSON.stringify({ hits: [], saved: { files: "two" } }))?.saved).toBeUndefined();
	});
});

describe("parsePointer", () => {
	it("splits a file:span pointer", () => {
		expect(parsePointer("src/a.ts:L1-L9")).toEqual({ path: "src/a.ts", span: "L1-L9" });
		expect(parsePointer("src/a.ts:12")).toEqual({ path: "src/a.ts:12" });
		expect(parsePointer("src/a.ts")).toEqual({ path: "src/a.ts" });
	});
});

describe("renderAsk", () => {
	it("renders a compact ranked pack with pointers, snippets, source and receipts", () => {
		const payload = parseAskJson(
			JSON.stringify({
				mode: "lexical",
				note: "ranked by relevance",
				hits: [
					{ kind: "symbol", title: "verify · function", pointer: "src/auth.ts:L10-L20", snippet: "checks the token", code: "return true;" },
					{ kind: "caller", title: "login", pointer: "src/login.ts:L1-L4", snippet: "", relation: "calls" },
				],
				saved: { files: 2, baselineChars: 4000 },
				rules: [{ text: "always verify" }],
			}),
		)!;
		const text = renderAsk(payload);
		expect(text).toContain("graft ask (lexical) — 2 hit(s)");
		expect(text).toContain("1. verify · function — src/auth.ts:L10-L20");
		expect(text).toContain("return true;");
		expect(text).toContain("2. login (calls) — src/login.ts:L1-L4");
		expect(text).toContain("governing rules:");
		expect(text).toContain("reading them instead would cost ~1000 tokens");
		expect(askReferences(payload)).toEqual([
			{ path: "src/auth.ts", span: "L10-L20" },
			{ path: "src/login.ts", span: "L1-L4" },
		]);
	});

	it("labels a scoped hit with its sub-project", () => {
		const payload = parseAskJson(JSON.stringify({ hits: [{ pointer: "src/a.ts", scope: "packages/api" }] }))!;
		expect(renderAsk(payload)).toContain("packages/api/src/a.ts");
	});
});

describe("applyTelemetryDefault", () => {
	it("sets DO_NOT_TRACK and restores the prior absence on session shutdown", () => {
		const env: NodeJS.ProcessEnv = {};
		const handle = applyTelemetryDefault(env);
		expect(env[TELEMETRY_ENV]).toBe("1");
		handle.restore();
		expect(env[TELEMETRY_ENV]).toBeUndefined();
	});

	it("leaves an explicit user preference alone", () => {
		const env: NodeJS.ProcessEnv = { [TELEMETRY_ENV]: "0" };
		const handle = applyTelemetryDefault(env);
		expect(env[TELEMETRY_ENV]).toBe("0");
		handle.restore();
		expect(env[TELEMETRY_ENV]).toBe("0");
	});
});

describe("modest defaults", () => {
	it("keeps the ask limit aligned with the CLI default", () => {
		expect(DEFAULT_FIND_LIMIT).toBe(8);
	});

	it("never calls the executable through a shell", async () => {
		const { pi } = makePi(async () => execReturning(FAILED));
		await runGraft(pi.exec as never, "/repo", { kind: "find-all", pattern: "a|b" });
		const [command] = pi.exec.mock.calls[0] as [string];
		expect(["graft", "cmd"]).toContain(command);
		expect(vi.isMockFunction(pi.exec)).toBe(true);
	});
});
