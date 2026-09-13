import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEntry } from "@selesai/code";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	ABSENT_GRAPH,
	DEFAULT_MIN_COVERAGE,
	DEFAULT_RETRIEVAL_MODE,
	INITIAL_GRAFT_STATE,
	MODE_ENTRY_TYPE,
	readBranchMode,
	readGraftSettings,
	recoveryFor,
	reduceGraftState,
	statusDetail,
	statusText,
	isQueryable,
	isRetrievalMode,
	isSetupProblem,
	type GraftState,
} from "./state.ts";

const UNBUILT: GraftState = { name: "unbuilt", detail: "no graph yet" };
const FRESH: GraftState = { name: "fresh-structural", version: "0.18.0", deep: false };
const DEEP: GraftState = { name: "fresh-deep", version: "0.18.0", deep: true };

describe("reduceGraftState", () => {
	it("only claims a repository once root resolution says there is a Git working tree", () => {
		const notGit = reduceGraftState(INITIAL_GRAFT_STATE, { type: "resolved", gitRepo: false });
		expect(notGit.name).toBe("unsupported");
		expect(notGit.detail).toContain("Git");

		const git = reduceGraftState(INITIAL_GRAFT_STATE, { type: "resolved", gitRepo: true });
		expect(git.name).toBe("unavailable");
	});

	it("derives built/fresh/deep from what is actually on disk", () => {
		expect(reduceGraftState(gitState(), { type: "probe-ok", version: "0.18.0", graph: ABSENT_GRAPH })).toEqual({
			name: "unbuilt",
			version: "0.18.0",
			detail: expect.stringContaining("/graft build"),
		});
		expect(
			reduceGraftState(gitState(), { type: "probe-ok", version: "0.18.0", graph: { built: true, deep: false } }),
		).toEqual(FRESH);
		expect(
			reduceGraftState(gitState(), { type: "probe-ok", version: "0.18.0", graph: { built: true, deep: true } }),
		).toMatchObject({ name: "fresh-deep", deep: true });
	});

	it("records why the executable is unusable", () => {
		const missing = reduceGraftState(gitState(), { type: "probe-missing", detail: "spawn graft ENOENT" });
		expect(missing).toMatchObject({ name: "unavailable", detail: "spawn graft ENOENT" });

		const old = reduceGraftState(gitState(), {
			type: "probe-incompatible",
			version: "0.4.0",
			detail: "too old",
		});
		expect(old).toMatchObject({ name: "incompatible", version: "0.4.0" });
	});

	it("marks a graph stale only when there is a graph to go stale", () => {
		expect(reduceGraftState(FRESH, { type: "mutation-observed" }).name).toBe("changed");
		expect(reduceGraftState(DEEP, { type: "mutation-observed" }).name).toBe("changed");
		expect(reduceGraftState(UNBUILT, { type: "mutation-observed" }).name).toBe("unbuilt");
		expect(reduceGraftState({ name: "failed" }, { type: "mutation-observed" }).name).toBe("failed");
	});

	it("returns to fresh after a query, because Graft refreshes before answering", () => {
		const changed = reduceGraftState(FRESH, { type: "mutation-observed" });
		expect(changed.name).toBe("changed");
		expect(reduceGraftState(changed, { type: "query-succeeded", presence: { built: true, deep: false } })).toEqual(
			FRESH,
		);
		expect(reduceGraftState(changed, { type: "query-succeeded", presence: { built: true, deep: true } })).toMatchObject(
			{ name: "fresh-deep" },
		);
	});

	it("keeps a failed build distinct from an unbuilt repository", () => {
		const failed = reduceGraftState(UNBUILT, { type: "build-failed", detail: "exit 1" });
		expect(failed).toMatchObject({ name: "failed", detail: "exit 1" });
		expect(reduceGraftState({ name: "building", deep: true }, { type: "build-succeeded", deep: true, presence: { built: true, deep: true } })).toMatchObject({
			name: "fresh-deep",
		});
	});

	it("announces the build phase so the status line can show work in progress", () => {
		expect(reduceGraftState(FRESH, { type: "build-started", deep: true })).toMatchObject({
			name: "building",
			deep: true,
			version: "0.18.0",
		});
	});

	it("only shows a refresh phase for a graph that was actually stale", () => {
		const changed = reduceGraftState(FRESH, { type: "mutation-observed" });
		expect(reduceGraftState(changed, { type: "refresh-started" }).name).toBe("refreshing");
		expect(reduceGraftState(FRESH, { type: "refresh-started" }).name).toBe("fresh-structural");
	});

	it("resets to the initial state", () => {
		expect(reduceGraftState(FRESH, { type: "reset" })).toEqual(INITIAL_GRAFT_STATE);
	});
});

function gitState(): GraftState {
	return reduceGraftState(INITIAL_GRAFT_STATE, { type: "resolved", gitRepo: true });
}

/** A session entry with the fields `readBranchMode` reads, and the base fields above them. */
function customEntry(customType: string, data: unknown): SessionEntry {
	return {
		type: "custom",
		id: `entry-${customType}-${String((data as { mode?: string } | undefined)?.mode ?? "none")}`,
		parentId: null,
		timestamp: new Date(0).toISOString(),
		customType,
		data,
	} as SessionEntry;
}

describe("state predicates and rendering", () => {
	it("distinguishes states a query can answer from states it cannot", () => {
		expect(isQueryable(FRESH)).toBe(true);
		expect(isQueryable(DEEP)).toBe(true);
		expect(isQueryable({ name: "changed" })).toBe(true);
		expect(isQueryable(UNBUILT)).toBe(false);
		expect(isQueryable({ name: "unavailable" })).toBe(false);
		expect(isQueryable({ name: "incompatible" })).toBe(false);
		expect(isQueryable({ name: "unsupported" })).toBe(false);
	});

	it("separates setup problems from runtime failures", () => {
		expect(isSetupProblem({ name: "unavailable" })).toBe(true);
		expect(isSetupProblem({ name: "incompatible" })).toBe(true);
		expect(isSetupProblem({ name: "failed" })).toBe(false);
	});

	it("renders a compact status line with the version when it is known", () => {
		expect(statusText(FRESH)).toBe("graft: ● structural v0.18.0");
		expect(statusText(DEEP)).toBe("graft: ● deep v0.18.0");
		expect(statusText({ name: "unavailable" })).toBe("graft: ✕ no cli");
		expect(statusText({ name: "changed" })).toBe("graft: ◐ changed");
	});

	it("gives every broken state an actionable recovery step and healthy states none", () => {
		expect(recoveryFor({ name: "unavailable" })).toContain("/graft setup");
		expect(recoveryFor({ name: "incompatible" })).toContain("npm install -g @nanonets/graft");
		expect(recoveryFor({ name: "unbuilt" })).toContain("/graft build");
		expect(recoveryFor({ name: "unsupported" })).toContain("git init");
		expect(recoveryFor({ name: "failed" })).toContain("/graft doctor");
		expect(recoveryFor(FRESH)).toBeUndefined();
	});

	it("falls back to the state label when there is no detail", () => {
		expect(statusDetail({ name: "changed" })).toBe("◐ changed");
		expect(statusDetail({ name: "unbuilt", detail: "custom" })).toBe("custom");
	});
});

describe("retrieval mode", () => {
	it("accepts only the three documented strategies", () => {
		expect(isRetrievalMode("pull")).toBe(true);
		expect(isRetrievalMode("push")).toBe(true);
		expect(isRetrievalMode("hybrid")).toBe(true);
		expect(isRetrievalMode("auto")).toBe(false);
		expect(isRetrievalMode(undefined)).toBe(false);
	});

	it("defaults to push, the source-backed context mode", () => {
		expect(DEFAULT_RETRIEVAL_MODE).toBe("push");
	});

	it("restores the newest mode chosen on this branch, ignoring other custom entries", () => {
		const branch = [
			customEntry(MODE_ENTRY_TYPE, { mode: "hybrid" }),
			customEntry("graft-injection", { mode: "push" }),
			customEntry(MODE_ENTRY_TYPE, { mode: "push" }),
		];
		expect(readBranchMode(branch)).toBe("push");
		expect(readBranchMode([])).toBeUndefined();
		expect(readBranchMode([customEntry(MODE_ENTRY_TYPE, { mode: "auto" })])).toBeUndefined();
		expect(readBranchMode([customEntry(MODE_ENTRY_TYPE, undefined)])).toBeUndefined();
		expect(readBranchMode([customEntry("other", { mode: "push" })])).toBeUndefined();
		expect(readBranchMode([{ type: "message" } as never])).toBeUndefined();
	});
});

describe("readGraftSettings", () => {
	let root: string;
	let agentDir: string;
	let projectDir: string;

	beforeAll(() => {
		root = mkdtempSync(join(tmpdir(), "graft-settings-"));
		agentDir = join(root, "agent");
		projectDir = join(root, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(join(projectDir, ".selesai"), { recursive: true });
	});

	afterAll(() => rmSync(root, { recursive: true, force: true }));

	const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value), "utf-8");
	const read = (trusted: boolean, cwd = projectDir) => readGraftSettings({ cwd, trusted, agentDir });

	it("returns defaults when no settings file exists", () => {
		expect(read(false, join(root, "nowhere"))).toEqual({});
		expect(read(true, join(root, "nowhere"))).toEqual({});
	});

	it("ignores a malformed settings file instead of breaking a session", () => {
		const brokenDir = join(root, "broken");
		mkdirSync(join(brokenDir, ".selesai"), { recursive: true });
		writeFileSync(join(brokenDir, ".selesai", "settings.json"), "{ not json", "utf-8");
		expect(read(true, brokenDir)).toEqual({});
	});

	it("reads the global graft section", () => {
		write(join(agentDir, "settings.json"), { graft: { mode: "hybrid", minCoverage: 0.4, in: " packages/api " } });
		expect(read(false)).toEqual({ mode: "hybrid", minCoverage: 0.4, in: "packages/api" });
	});

	it("ignores project settings until the project is trusted", () => {
		write(join(projectDir, ".selesai", "settings.json"), { graft: { mode: "push" } });
		expect(read(false).mode).toBe("hybrid");
		expect(read(true).mode).toBe("push");
	});

	it("drops values that are not the documented shape", () => {
		write(join(agentDir, "settings.json"), {
			graft: {
				enabled: "yes",
				mode: "auto",
				telemetry: "maybe",
				minCoverage: 1.5,
				maxInjectionBytes: -1,
				maxResultBytes: 0,
				refreshDebounceSeconds: "60",
				in: "   ",
			},
		});
		expect(read(false)).toEqual({});
	});

	it("keeps a valid enabled flag and telemetry preference", () => {
		write(join(agentDir, "settings.json"), { graft: { enabled: false, telemetry: "inherit" } });
		expect(read(false)).toEqual({ enabled: false, telemetry: "inherit" });
	});

	it("defaults the injection gate to a value a real pack can clear", () => {
		expect(DEFAULT_MIN_COVERAGE).toBeGreaterThan(0);
		expect(DEFAULT_MIN_COVERAGE).toBeLessThan(1);
	});
});
