import { describe, expect, it, vi } from "vitest";
import type { GraftOp, GraftRun } from "./cli.ts";
import type { GraftSettings, GraftState } from "./state.ts";
import { makeCtx, makePi } from "./test-support.ts";
import { registerGraftTools, renderAskResult, type GraftToolDetails, type GraftToolRuntime } from "./tools.ts";

const TOOL_NAMES = [
	"graft_find_code",
	"graft_file_api",
	"graft_trace_calls",
	"graft_find_all",
	"graft_repo_map",
	"graft_check_freshness",
];

const ASK_JSON = JSON.stringify({
	query: "where is auth verified",
	mode: "lexical",
	coverage: 0.7,
	hits: [
		{
			kind: "symbol",
			title: "verify · function",
			pointer: "src/auth.ts:L10-L20",
			snippet: "checks the token",
			code: "export function verify(token: string) {\n  return true;\n}",
		},
	],
	saved: { files: 1, baselineChars: 800 },
});

interface Harness {
	/** The runtime the tools were registered against. */
	runtime: GraftToolRuntime;
	/** The operation each tool call asked Graft to run. */
	run: ReturnType<typeof vi.fn>;
	/** Runs a registered tool by name against this harness's runtime. */
	exec: (
		name: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	) => Promise<{ text: string; details: GraftToolDetails }>;
	/** Results the runtime was told to treat as answered queries. */
	noted: GraftRun[];
}

function makeHarness(
	options: { result?: Partial<GraftRun>; settings?: GraftSettings; state?: GraftState } = {},
): Harness {
	const base: GraftRun = {
		op: { kind: "repo-map" },
		argv: ["graft", "map"],
		cwd: "/repo",
		code: 0,
		stdout: "",
		stderr: "",
		killed: false,
		cancelled: false,
		timedOut: false,
		...options.result,
	};
	const run = vi.fn(async (_ctx: unknown, op: GraftOp) => ({ ...base, op }));
	const noted: GraftRun[] = [];
	const runtime: GraftToolRuntime = {
		run: run as never,
		settings: () => options.settings ?? {},
		state: () => options.state ?? { name: "fresh-structural", version: "0.18.0" },
		noteQuery: ((_ctx: unknown, result: GraftRun) => {
			noted.push(result);
		}) as never,
	};

	const exec = async (
		name: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<{ text: string; details: GraftToolDetails }> => {
		const { pi, tools } = makePi();
		registerGraftTools(pi as never, runtime);
		const definition = tools.get(name);
		if (!definition) throw new Error(`${name} was not registered`);
		const result = (await (definition.execute as (...args: unknown[]) => Promise<unknown>)(
			"call-1",
			params,
			signal,
			undefined,
			makeCtx(),
		)) as { content: { text: string }[]; details: GraftToolDetails };
		return { text: result.content[0]!.text, details: result.details };
	};

	return { runtime, run, exec, noted };
}

describe("graft tool registration", () => {
	it("registers exactly the six read-only semantic tools", () => {
		const { pi, tools } = makePi();
		registerGraftTools(pi as never, makeHarness().runtime);
		expect([...tools.keys()].sort()).toEqual([...TOOL_NAMES].sort());
	});

	it("gives every tool a label, description and parameter schema", () => {
		const { pi, tools } = makePi();
		registerGraftTools(pi as never, makeHarness().runtime);
		for (const name of TOOL_NAMES) {
			const tool = tools.get(name)!;
			expect(tool.description).toBeTruthy();
			expect(tool.parameters).toBeTruthy();
			expect(tool.label).toContain("Graft");
		}
	});

	it("tells the model that Graft output is derived and must be verified against source", () => {
		const { pi, tools } = makePi();
		registerGraftTools(pi as never, makeHarness().runtime);
		const guidelines = tools.get("graft_find_code")!.promptGuidelines as string[];
		expect(guidelines.join("\n")).toContain("verify");
		expect(tools.get("graft_find_code")!.description).toContain("derived");
	});
});

describe("graft_find_code", () => {
	it("asks Graft the model's question with source inlining and structured output", async () => {
		const harness = makeHarness({ result: { stdout: ASK_JSON } });
		const { text, details } = await harness.exec("graft_find_code", { question: "where is auth verified" });

		expect(harness.run).toHaveBeenCalledTimes(1);
		expect(harness.run.mock.calls[0]![1]).toEqual({
			kind: "find-code",
			question: "where is auth verified",
			limit: undefined,
			in: undefined,
		});
		expect(text).toContain("src/auth.ts:L10-L20");
		expect(text).toContain("export function verify");
		expect(details.references).toEqual([{ path: "src/auth.ts", span: "L10-L20" }]);
		expect(details.coverage).toBe(0.7);
		expect(details.saved).toEqual({ files: 1, baselineChars: 800 });
		expect(details.operation).toBe("find-code");
		expect(details.graphState).toBe("fresh-structural");
		expect(harness.noted).toHaveLength(1);
	});

	it("applies the project's scope setting when the model does not name one", async () => {
		const harness = makeHarness({ result: { stdout: ASK_JSON }, settings: { in: "packages/api" } });
		await harness.exec("graft_find_code", { question: "auth" });
		expect(harness.run.mock.calls[0]![1]).toMatchObject({ in: "packages/api" });
	});

	it("falls back to the CLI's own text when its JSON is not the shape we know", async () => {
		const harness = makeHarness({
			result: { stdout: "verify · function — src/auth.ts:L10-L20\n  checks the token" },
		});
		const { text, details } = await harness.exec("graft_find_code", { question: "auth" });
		expect(text).toContain("src/auth.ts:L10-L20");
		expect(details.references).toEqual([]);
	});

	it("keeps command diagnostics out of the model-facing text", async () => {
		const harness = makeHarness({
			result: { stdout: ASK_JSON, stderr: "[graft] rebuilt from src/ (2 files changed)" },
		});
		const { text, details } = await harness.exec("graft_find_code", { question: "auth" });
		expect(text).not.toContain("rebuilt from");
		expect(details.stderr).toContain("rebuilt from");
	});

	it("bounds the result and reports the truncation and the recovery path", async () => {
		const harness = makeHarness({
			result: {
				stdout: JSON.stringify({ hits: [{ pointer: "src/a.ts", title: "big", code: "x".repeat(200_000) }] }),
			},
		});
		const { text, details } = await harness.exec("graft_find_code", { question: "auth" });
		expect(details.truncated).toBe(true);
		expect(text).toContain("[graft] output truncated");
		expect(Buffer.byteLength(text, "utf-8")).toBeLessThan(48 * 1024);
	});

	it("fails the tool call with the command's own diagnostic when Graft errors", async () => {
		const harness = makeHarness({ result: { code: 1, stderr: "✗ no graft/ index here" } });
		await expect(harness.exec("graft_find_code", { question: "auth" })).rejects.toThrow(/no graft\/ index here/);
		expect(harness.noted).toHaveLength(0);
	});

	it("fails the tool call when the model cancels the turn", async () => {
		const harness = makeHarness({ result: { cancelled: true } });
		await expect(harness.exec("graft_find_code", { question: "auth" })).rejects.toThrow(/cancelled/);
	});

	it("reports a timeout as a timeout rather than as a generic failure", async () => {
		const harness = makeHarness({ result: { code: 1, killed: true, timedOut: true } });
		await expect(harness.exec("graft_find_code", { question: "auth" })).rejects.toThrow(/timed out/);
	});
});

describe("the remaining read-only tools", () => {
	it("maps graft_file_api to a signatures-only view of one file", async () => {
		const harness = makeHarness({ result: { stdout: "src/app.ts\n  fn run(): void" } });
		const { text, details } = await harness.exec("graft_file_api", { path: "src/app.ts" });
		expect(harness.run.mock.calls[0]![1]).toEqual({ kind: "file-api", path: "src/app.ts" });
		expect(text).toContain("fn run(): void");
		expect(details.references).toEqual([]);
	});

	it("says so plainly when a file has no indexed signatures", async () => {
		const harness = makeHarness({ result: { stdout: "  " } });
		const { text } = await harness.exec("graft_file_api", { path: "src/missing.ts" });
		expect(text).toContain("No indexed signatures for src/missing.ts");
	});

	it("defaults graft_trace_calls to the caller direction and forwards direction and depth", async () => {
		const harness = makeHarness({ result: { stdout: "login · function · src/login.ts:L1-L4 · 2 in-edges" } });
		await harness.exec("graft_trace_calls", { symbol: "verify" });
		expect(harness.run.mock.calls[0]![1]).toEqual({
			kind: "trace-calls",
			symbol: "verify",
			direction: "in",
			depth: undefined,
		});

		await harness.exec("graft_trace_calls", { symbol: "verify", direction: "out", depth: 4 });
		expect(harness.run.mock.calls[1]![1]).toEqual({
			kind: "trace-calls",
			symbol: "verify",
			direction: "out",
			depth: 4,
		});
	});

	it("names the direction it searched when a trace found nothing", async () => {
		const outgoing = makeHarness({ result: { stdout: "   " } });
		const { text } = await outgoing.exec("graft_trace_calls", { symbol: "orphan", direction: "out" });
		expect(text).toContain("No indexed callees for orphan");
	});

	it("passes graft_find_all flags through and reports an empty search as an answer", async () => {
		const harness = makeHarness({ result: { stdout: "" } });
		const { text } = await harness.exec("graft_find_all", {
			pattern: "NEEDLE",
			ignore_case: true,
			fixed: true,
			in: "src",
		});
		expect(harness.run.mock.calls[0]![1]).toEqual({
			kind: "find-all",
			pattern: "NEEDLE",
			ignoreCase: true,
			fixed: true,
			in: "src",
		});
		expect(text).toContain("No matches for NEEDLE");
	});

	it("maps graft_repo_map to the token-budgeted orientation view", async () => {
		const harness = makeHarness({ result: { stdout: "repo map — 113 files · 687 symbols" } });
		const { text } = await harness.exec("graft_repo_map", { max_dirs: 8 });
		expect(harness.run.mock.calls[0]![1]).toEqual({ kind: "repo-map", maxDirs: 8 });
		expect(text).toContain("113 files");
	});

	it("says so when the repository map came back empty", async () => {
		const harness = makeHarness({ result: { stdout: "" } });
		const { text } = await harness.exec("graft_repo_map", {});
		expect(text).toContain("empty repository map");
	});
});

describe("graft_check_freshness", () => {
	it("treats a non-zero exit as the drift answer rather than a tool failure", async () => {
		const harness = makeHarness({ result: { code: 1, stdout: '{"stale":["src/a.ts"]}' } });
		const { text, details } = await harness.exec("graft_check_freshness", {});
		expect(text).toContain("has drifted");
		expect(text).toContain("/graft build");
		expect(details.exitCode).toBe(1);
	});

	it("reports an in-sync graph on exit zero", async () => {
		const harness = makeHarness({ result: { code: 0, stdout: '{"stale":[]}' } });
		const { text } = await harness.exec("graft_check_freshness", {});
		expect(text).toContain("in sync with the working tree");
	});

	it("does not mark the graph fresh, because check never refreshes", async () => {
		const harness = makeHarness({ result: { code: 0 } });
		await harness.exec("graft_check_freshness", {});
		expect(harness.noted).toHaveLength(0);
	});

	it("still fails on cancellation", async () => {
		const harness = makeHarness({ result: { cancelled: true } });
		await expect(harness.exec("graft_check_freshness", {})).rejects.toThrow(/cancelled/);
	});
});

describe("renderAskResult", () => {
	it("returns an explicit empty answer rather than blank text", () => {
		const run: GraftRun = {
			op: { kind: "find-code", question: "x" },
			argv: ["graft", "ask", "x"],
			cwd: "/repo",
			code: 0,
			stdout: "",
			stderr: "",
			killed: false,
			cancelled: false,
			timedOut: false,
		};
		expect(renderAskResult(run, { maxBytes: 4096, maxLines: 50 }).text).toBe("Graft returned no matching context.");
	});
});

describe("read-only guarantee", () => {
	it("never asks Graft to build or configure anything", async () => {
		const harness = makeHarness();
		const params: Record<string, Record<string, unknown>> = {
			graft_find_code: { question: "anything" },
			graft_file_api: { path: "src/a.ts" },
			graft_trace_calls: { symbol: "x" },
			graft_find_all: { pattern: "x" },
			graft_repo_map: {},
			graft_check_freshness: {},
		};
		for (const name of TOOL_NAMES) await harness.exec(name, params[name]!);

		const kinds = harness.run.mock.calls.map((call) => (call[1] as GraftOp).kind);
		expect(kinds).toEqual(["find-code", "file-api", "trace-calls", "find-all", "repo-map", "check-freshness"]);
		expect(kinds).not.toContain("build");
	});
});
