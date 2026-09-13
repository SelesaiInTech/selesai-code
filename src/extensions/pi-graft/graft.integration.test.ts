/**
 * Opt-in integration test against a real Graft CLI and a real Git fixture.
 *
 * The regular suite is deterministic and offline: it never installs anything and
 * never calls a provider. This file is the escape hatch that exercises the
 * adapter against the real executable, and it skips itself when no compatible
 * Graft CLI is on PATH — which is the state of ordinary CI.
 *
 * To run it for real: `npm install -g @nanonets/graft@^0.18` then
 *   npx vitest run src/extensions/pi-graft/graft.integration.test.ts
 *
 * A structural build is tree-sitter only: no model, no API key, no network. The
 * fixture never runs `graft init`, so the repository is left exactly as the test
 * created it.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	isCompatibleVersion,
	parseVersion,
	probeGraft,
	runGraft,
	type ExecLike,
	type GraftRun,
} from "./cli.ts";

/** Real-exec implementation of the same seam the extension uses via `pi.exec`. */
const realExec: ExecLike = async (command, args, options) => {
	const result = spawnSync(command, args, {
		cwd: options?.cwd,
		encoding: "utf-8",
		timeout: options?.timeout,
		env: { ...process.env, DO_NOT_TRACK: "1" },
	});
	return {
		code: result.status ?? 1,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? result.error?.message ?? "",
		killed: result.signal !== null,
	};
};

/** Synchronous probe so `describe.skipIf` can decide at collection time. */
function localGraftVersion(): string | undefined {
	try {
		const output = execFileSync("graft", ["--version"], { encoding: "utf-8", timeout: 5_000 });
		return parseVersion(output);
	} catch {
		return undefined;
	}
}

const localVersion = localGraftVersion();
const hasCompatibleGraft = localVersion !== undefined && isCompatibleVersion(localVersion);

describe("graft CLI compatibility", () => {
	it("decides from the CLI's own version output and never claims an unverified version", async () => {
		const probe = await probeGraft(realExec, process.cwd());
		if (probe.kind === "ok") {
			expect(probe.version).toBeDefined();
			expect(isCompatibleVersion(probe.version)).toBe(true);
		} else if (probe.kind === "incompatible") {
			expect(probe.version === undefined || !isCompatibleVersion(probe.version)).toBe(true);
		} else {
			expect(localVersion).toBeUndefined();
		}
	});
});

describe.skipIf(!hasCompatibleGraft)("real Graft on a real Git working tree", () => {
	let repo: string;
	const run = (op: Parameters<typeof runGraft>[2]): Promise<GraftRun> => runGraft(realExec, repo, op);

	beforeAll(() => {
		repo = mkdtempSync(join(tmpdir(), "graft-integration-"));
		mkdirSync(join(repo, "src"), { recursive: true });
		writeFileSync(
			join(repo, "src", "auth.ts"),
			[
				"export function verifyToken(token: string): boolean {",
				"  return token.length > 0;",
				"}",
				"",
			].join("\n"),
			"utf-8",
		);
		writeFileSync(
			join(repo, "src", "login.ts"),
			['import { verifyToken } from "./auth.js";', "", "export function login(token: string) {", "  return verifyToken(token);", "}", ""].join(
				"\n",
			),
			"utf-8",
		);
		writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "graft-fixture", type: "module" }), "utf-8");
		execFileSync("git", ["init", "-q"], { cwd: repo });
		execFileSync("git", ["add", "-A"], { cwd: repo });
		execFileSync(
			"git",
			["-c", "user.email=test@example.com", "-c", "user.name=Fixture", "commit", "-qm", "init"],
			{ cwd: repo },
		);
	});

	afterAll(() => {
		if (repo) rmSync(repo, { recursive: true, force: true });
	});

	it("builds a structural graph with no model and no key", async () => {
		const build = await run({ kind: "build", deep: false });
		expect(build.stderr + build.stdout).not.toContain("✗");
		expect(build.code).toBe(0);
		expect(existsSync(join(repo, "graft", ".graph", "wiring.json"))).toBe(true);
	}, 300_000);

	it("reports drift after an uncommitted edit, then answers from the working tree", async () => {
		const inSync = await run({ kind: "check-freshness" });
		expect(inSync.code).toBe(0);

		// Uncommitted, unstaged: exactly what a Graft query is supposed to see.
		writeFileSync(
			join(repo, "src", "auth.ts"),
			[
				"export function verifyToken(token: string): boolean {",
				"  return token.length > 0;",
				"}",
				"",
				"export function rotateSessionKey(key: string): string {",
				'  return key.split("").reverse().join("");',
				"}",
				"",
			].join("\n"),
			"utf-8",
		);

		const drifted = await run({ kind: "check-freshness" });
		expect(drifted.code).not.toBe(0);

		const answer = await run({ kind: "find-code", question: "rotateSessionKey", limit: 5 });
		expect(answer.code).toBe(0);
		expect(answer.stdout).toContain("src/auth.ts");
		expect(answer.stdout).toContain("rotateSessionKey");
	}, 300_000);

	it("traces who depends on a symbol without a model", async () => {
		const trace = await run({ kind: "trace-calls", symbol: "verifyToken", direction: "in" });
		expect(trace.code).toBe(0);
		expect(trace.stdout).toContain("src/login.ts");
	}, 120_000);
});
