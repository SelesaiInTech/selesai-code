import { afterEach, describe, expect, it, vi } from "vitest";
import type { GraftInstallRun, GraftRun } from "./cli.ts";
import {
	buildEffects,
	DEEP_PROVIDER_HINT,
	DOCTOR_USAGE,
	formatDoctor,
	formatStatus,
	PROVIDER_ENV_NAMES,
	registerGraftCommands,
	type ArgumentCompletion,
	type DoctorInput,
	type GraftCommandRuntime,
} from "./commands.ts";
import { MODE_ENTRY_TYPE, type GraftState } from "./state.ts";
import { notified, makeCtx, makePi, type CtxStub } from "./test-support.ts";

const HEALTHY: GraftState = { name: "fresh-structural", version: "0.18.0" };

function installOf(overrides: Partial<GraftInstallRun> = {}): GraftInstallRun {
	return {
		argv: ["npm", "install", "-g", "@nanonets/graft@^0.18"],
		cwd: "/repo",
		code: 0,
		stdout: "",
		stderr: "",
		killed: false,
		cancelled: false,
		timedOut: false,
		...overrides,
	};
}

function runOf(overrides: Partial<GraftRun> = {}): GraftRun {
	return {
		op: { kind: "build", deep: false },
		argv: ["graft", "build"],
		cwd: "/repo",
		code: 0,
		stdout: "",
		stderr: "",
		killed: false,
		cancelled: false,
		timedOut: false,
		...overrides,
	};
}

interface RuntimeHarness {
	runtime: GraftCommandRuntime;
	recheck: ReturnType<typeof vi.fn>;
	installCli: ReturnType<typeof vi.fn>;
	runBuild: ReturnType<typeof vi.fn>;
	runRefresh: ReturnType<typeof vi.fn>;
	setMode: ReturnType<typeof vi.fn>;
}

function makeRuntime(
	overrides: Partial<{
		state: GraftState;
		postInstallState: GraftState;
		built: boolean;
		deep: boolean;
		mode: "pull" | "push" | "hybrid";
		settings: Record<string, unknown>;
		installResult: GraftInstallRun;
		buildResult: GraftRun;
		refreshResult: GraftRun | undefined;
		repoRoot: string | undefined;
		providerEnvNames: string[];
		telemetryDefaultApplied: boolean;
	}> = {},
): RuntimeHarness {
	let state = overrides.state ?? HEALTHY;
	const recheck = vi.fn(async () => {});
	const installCli = vi.fn(async () => {
		const result = overrides.installResult ?? installOf();
		if (result.code === 0 && !result.killed) state = overrides.postInstallState ?? { name: "unbuilt", version: "0.18.0" };
		return result;
	});
	const runBuild = vi.fn(async () => overrides.buildResult ?? runOf());
	const runRefresh = vi.fn(async () => ("refreshResult" in overrides ? overrides.refreshResult : runOf()));
	const setMode = vi.fn();
	const presence = { built: overrides.built ?? true, deep: overrides.deep ?? false };
	return {
		recheck,
		installCli,
		runBuild,
		runRefresh,
		setMode,
		runtime: {
			recheck,
			state: () => state,
			settings: () => overrides.settings ?? {},
			mode: () => overrides.mode ?? "pull",
			setMode,
			repoRoot: () => ("repoRoot" in overrides ? overrides.repoRoot : "/repo"),
			graphPresence: () => presence,
			installCli: installCli as never,
			runBuild: runBuild as never,
			runRefresh: runRefresh as never,
			providerEnvNames: () => overrides.providerEnvNames ?? [],
			telemetryDefaultApplied: () => overrides.telemetryDefaultApplied ?? true,
		},
	};
}

async function invoke(
	runtime: GraftCommandRuntime,
	args: string,
	ctx: CtxStub,
): Promise<{ pi: ReturnType<typeof makePi>["pi"]; entries: { customType: string; data: unknown }[] }> {
	const { pi, commands, entries } = makePi();
	registerGraftCommands(pi as never, runtime);
	const handler = commands.get("graft")!.handler as (args: string, ctx: unknown) => Promise<void>;
	await handler(args, ctx);
	return { pi, entries };
}

afterEach(() => vi.restoreAllMocks());

describe("formatDoctor", () => {
	const base: DoctorInput = {
		repoRoot: "/repo",
		gitRepo: true,
		state: HEALTHY,
		presence: { built: true, deep: false },
		mode: "pull",
		settings: {},
		telemetryDefault: true,
		providerEnv: [],
	};

	it("reports repository, executable, graph, state, mode, telemetry and provider boundary", () => {
		const text = formatDoctor(base);
		expect(text).toContain("/repo (git ✓)");
		expect(text).toContain("graft 0.18.0");
		expect(text).toContain("structural only");
		expect(text).toContain("fresh-structural");
		expect(text).toContain("nothing is injected");
		expect(text).toContain("DO_NOT_TRACK=1 set by this extension");
		expect(text).toContain("deep builds would need Graft's own provider configuration");
		expect(text).toContain("graft deep adds provider-backed summaries");
	});

	it("shows only which provider variables are set, never their values", () => {
		const text = formatDoctor({ ...base, providerEnv: ["GRAFT_PROVIDER", "GRAFT_MODEL"] });
		expect(text).toContain("GRAFT_PROVIDER, GRAFT_MODEL set");
		expect(text).toContain("values never read or copied");
	});

	it("reports whether this session actually applied the telemetry default", () => {
		expect(formatDoctor({ ...base, telemetryDefault: false })).toContain("left to your environment");
	});

	it("gives a recovery step for each broken state", () => {
		expect(formatDoctor({ ...base, state: { name: "unavailable" }, presence: { built: false, deep: false } })).toContain(
			"npm install -g @nanonets/graft",
		);
		expect(formatDoctor({ ...base, state: { name: "unbuilt" }, presence: { built: false, deep: false } })).toContain(
			"/graft build",
		);
	});

	it("says plainly when there is nothing to fix", () => {
		expect(formatDoctor({ ...base, state: { name: "fresh-deep" }, presence: { built: true, deep: true } })).toContain(
			"nothing to fix",
		);
	});

	it("describes an untrusted or ungit directory honestly", () => {
		const text = formatDoctor({ ...base, repoRoot: undefined, gitRepo: false, state: { name: "unsupported" } });
		expect(text).toContain("unresolved");
		expect(text).toContain("git init");
	});
});

describe("formatStatus", () => {
	it("reports the state, strategy and graph quality on three lines", () => {
		const text = formatStatus({
			repoRoot: "/repo",
			gitRepo: true,
			state: HEALTHY,
			presence: { built: true, deep: false },
			mode: "hybrid",
			settings: {},
			telemetryDefault: true,
			providerEnv: [],
		});
		expect(text.split("\n")).toHaveLength(4);
		expect(text).toContain("graft: ● structural v0.18.0");
		expect(text).toContain("hybrid");
		expect(text).toContain("root: /repo");
	});
});

describe("buildEffects", () => {
	it("names every local file a structural build can touch and never the agent-wiring command", () => {
		const text = buildEffects(false);
		expect(text).toContain("./graft/");
		expect(text).toContain(".gitignore");
		expect(text).toContain(".graft/config.json");
		expect(text).not.toContain("GRAFT_API_KEY");
	});

	it("states the provider boundary and the cache for a deep build", () => {
		const text = buildEffects(true);
		expect(text).toContain("GRAFT_PROVIDER");
		expect(text).toContain("Graft's own environment");
		expect(text).toContain("caches those summaries under graft/");
	});
});

describe("the /graft command surface", () => {
	it("registers one command with argument completions covering every subcommand and mode", () => {
		const { pi, commands } = makePi();
		registerGraftCommands(pi as never, makeRuntime().runtime);
		const command = commands.get("graft")!;
		expect(command).toBeDefined();
		const completer = command.getArgumentCompletions as (prefix: string) => ArgumentCompletion[];
		const values = completer("").map((item) => item.value);
		for (const sub of ["status", "doctor", "setup", "build", "deep", "refresh", "mode", "help"]) {
			expect(values).toContain(sub);
		}
		expect(values).toContain("mode hybrid");
		expect(completer("d").map((item) => item.value)).toEqual(["doctor", "deep"]);
		expect(completer("zzz")).toBeNull();
		expect(pi).toBeDefined();
	});

	it("defaults to status and re-resolves the environment first", async () => {
		const harness = makeRuntime();
		const ctx = makeCtx();
		await invoke(harness.runtime, "", ctx);
		expect(harness.recheck).toHaveBeenCalledTimes(1);
		expect(notified(ctx)).toContain("graft: ● structural");
	});

	it("prints usage for help and rejects an unknown subcommand without side effects", async () => {
		const harness = makeRuntime();
		const help = makeCtx();
		await invoke(harness.runtime, "help", help);
		expect(notified(help)).toContain("status          current availability");

		const unknown = makeCtx();
		await invoke(harness.runtime, "frobnicate", unknown);
		expect(notified(unknown)).toContain('Unknown command "frobnicate"');
		expect(harness.runBuild).not.toHaveBeenCalled();
	});
});

describe("/graft doctor", () => {
	it("reports health and surfaces the recovery step a second time", async () => {
		const harness = makeRuntime({ state: { name: "unavailable", detail: "not found" }, built: false });
		const ctx = makeCtx();
		await invoke(harness.runtime, "doctor", ctx);
		expect(notified(ctx)).toContain("Graft doctor");
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("npm install -g @nanonets/graft"), "warning");
	});

	it("does not warn when the graph is healthy, and points at the deep build instead", async () => {
		const harness = makeRuntime();
		const ctx = makeCtx();
		await invoke(harness.runtime, "doctor", ctx);
		expect(notified(ctx)).toContain("structural context is active");
		expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
	});
});

describe("mutation-capable commands", () => {
	it("refuses to build without a dialog UI and prints the exact manual command", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		for (const subcommand of ["build", "setup", "deep"]) {
			const harness = makeRuntime();
			const ctx = makeCtx({ hasUI: false });
			await invoke(harness.runtime, subcommand, ctx);
			expect(ctx.ui.confirm, subcommand).not.toHaveBeenCalled();
			expect(harness.runBuild, subcommand).not.toHaveBeenCalled();
			expect(warn.mock.calls.flat().join("\n"), subcommand).toContain("graft build");
		}

		{
			// The deep variant is covered too, so no path reaches the provider
			// without an interactive confirmation.
			const harness = makeRuntime();
			await invoke(harness.runtime, "build --deep", makeCtx({ hasUI: false }));
			expect(harness.runBuild).not.toHaveBeenCalled();
			expect(warn.mock.calls.flat().join("\n")).toContain("graft build --deep");
		}
	});

	it("installs a missing CLI, rechecks it, then asks only before building", async () => {
		const harness = makeRuntime({ state: { name: "unavailable", detail: "ENOENT" }, built: false });
		const ctx = makeCtx();
		await invoke(harness.runtime, "setup", ctx);

		expect(harness.installCli).toHaveBeenCalledWith(ctx);
		expect(harness.recheck).toHaveBeenCalledTimes(3);
		expect(ctx.ui.confirm).toHaveBeenCalledTimes(1);
		expect(ctx.ui.confirm.mock.calls[0]![0]).toBe("Set up Graft for this repository?");
		expect(harness.runBuild).toHaveBeenCalledWith(false, ctx);
	});

	it("does not build when installing the missing CLI fails", async () => {
		const harness = makeRuntime({
			state: { name: "unavailable", detail: "ENOENT" },
			installResult: installOf({ code: 1, stderr: "npm access denied" }),
		});
		const ctx = makeCtx();
		await invoke(harness.runtime, "build", ctx);

		expect(harness.installCli).toHaveBeenCalledWith(ctx);
		expect(harness.runBuild).not.toHaveBeenCalled();
		expect(notified(ctx)).toContain("npm access denied");
	});

	it("installs without a UI but still refuses the repository build", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const harness = makeRuntime({ state: { name: "unavailable", detail: "ENOENT" } });
		const ctx = makeCtx({ hasUI: false });
		await invoke(harness.runtime, "setup", ctx);

		expect(ctx.ui.confirm).not.toHaveBeenCalled();
		expect(harness.installCli).toHaveBeenCalledWith(ctx);
		expect(harness.runBuild).not.toHaveBeenCalled();
		expect(warn.mock.calls.flat().join("\n")).toContain("this command changes the repository");
	});

	it("does nothing when the user declines", async () => {
		const harness = makeRuntime();
		const ctx = makeCtx({ confirm: false });
		await invoke(harness.runtime, "build", ctx);
		expect(harness.runBuild).not.toHaveBeenCalled();
		expect(notified(ctx)).toContain("Cancelled. Nothing was written.");
	});

	it("explains the local effects, including that Graft's own init is never run, then builds", async () => {
		const harness = makeRuntime();
		const ctx = makeCtx();
		await invoke(harness.runtime, "build", ctx);

		expect(ctx.ui.confirm).toHaveBeenCalledTimes(1);
		const [, message] = ctx.ui.confirm.mock.calls[0] as [string, string];
		expect(message).toContain("./graft/");
		expect(message).toContain(".gitignore");
		expect(message).toContain("init");
		expect(message).toContain("never run");
		expect(harness.runBuild).toHaveBeenCalledWith(false, ctx);
		expect(notified(ctx)).toContain("Done.");
	});

	it("does not run a deep build when the structural build was confirmed", async () => {
		const harness = makeRuntime();
		await invoke(harness.runtime, "build", makeCtx());
		expect(harness.runBuild).toHaveBeenCalledWith(false, expect.anything());
	});

	it("gives `build --deep` the same provider consent as `/graft deep`", async () => {
		const harness = makeRuntime();
		const viaBuild = makeCtx();
		await invoke(harness.runtime, "build --deep", viaBuild);
		const viaDeep = makeCtx();
		await invoke(harness.runtime, "deep", viaDeep);

		const [, buildMessage] = viaBuild.ui.confirm.mock.calls[0] as [string, string];
		const [deepTitle, deepMessage] = viaDeep.ui.confirm.mock.calls[0] as [string, string];
		expect(viaBuild.ui.confirm.mock.calls[0]![0]).toBe(deepTitle);
		expect(buildMessage).toBe(deepMessage);
		expect(buildMessage).toContain("leaves this machine");
		expect(harness.runBuild).toHaveBeenNthCalledWith(1, true, viaBuild);
		expect(harness.runBuild).toHaveBeenNthCalledWith(2, true, viaDeep);
	});

	it("treats setup as the structural build", async () => {
		const harness = makeRuntime();
		await invoke(harness.runtime, "setup", makeCtx());
		expect(harness.runBuild).toHaveBeenCalledWith(false, expect.anything());
	});

	it("shows the provider boundary before a deep build and only sends source off-machine after consent", async () => {
		const harness = makeRuntime();
		const ctx = makeCtx();
		await invoke(harness.runtime, "deep", ctx);

		const [title, message] = ctx.ui.confirm.mock.calls[0] as [string, string];
		expect(title).toContain("provider-backed");
		expect(message).toContain("leaves this machine");
		expect(message).toContain("does not read, copy, or forward");
		expect(harness.runBuild).toHaveBeenCalledWith(true, ctx);
	});

	it("reports a degraded deep build as a warning with the command's own explanation", async () => {
		const harness = makeRuntime({
			buildResult: runOf({ code: 1, stderr: "✗ the deep pass did not complete\n  meaning coverage: 3/10" }),
		});
		const ctx = makeCtx();
		await invoke(harness.runtime, "deep", ctx);
		expect(notified(ctx)).toContain("meaning coverage: 3/10");
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("failed"), "warning");
	});

	it("reports a structural build failure as an error", async () => {
		const harness = makeRuntime({
			buildResult: runOf({ code: 1, stderr: "boom" }),
			state: { name: "failed", detail: "boom" },
		});
		const ctx = makeCtx();
		await invoke(harness.runtime, "build", ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("boom"), "error");
	});
});

describe("/graft refresh", () => {
	it("never creates a graph that does not exist", async () => {
		const harness = makeRuntime({ built: false });
		const ctx = makeCtx();
		await invoke(harness.runtime, "refresh", ctx);
		expect(harness.runRefresh).not.toHaveBeenCalled();
		expect(notified(ctx)).toContain("No graft/ here yet");
	});

	it("re-indexes an existing graph without another consent prompt", async () => {
		const harness = makeRuntime();
		const ctx = makeCtx();
		await invoke(harness.runtime, "refresh", ctx);
		expect(ctx.ui.confirm).not.toHaveBeenCalled();
		expect(harness.runRefresh).toHaveBeenCalledTimes(1);
		expect(notified(ctx)).toContain("Done.");
	});

	it("says nothing needed refreshing when the runtime reports no work", async () => {
		const harness = makeRuntime({ refreshResult: undefined });
		const ctx = makeCtx();
		await invoke(harness.runtime, "refresh", ctx);
		expect(notified(ctx)).toContain("Nothing to refresh");
	});
});

describe("/graft mode", () => {
	it("shows the current strategy and the usage when asked without an argument", async () => {
		const harness = makeRuntime({ mode: "hybrid" });
		const ctx = makeCtx();
		await invoke(harness.runtime, "mode", ctx);
		expect(notified(ctx)).toContain("hybrid —");
		expect(notified(ctx)).toContain("/graft <command>");
		expect(harness.setMode).not.toHaveBeenCalled();
	});

	it("sets the strategy and records it as a session entry so resume and fork keep it", async () => {
		const harness = makeRuntime();
		const ctx = makeCtx();
		const { entries } = await invoke(harness.runtime, "mode push", ctx);
		expect(harness.setMode).toHaveBeenCalledWith("push", ctx);
		expect(entries).toContainEqual({ customType: MODE_ENTRY_TYPE, data: { mode: "push" } });
		expect(notified(ctx)).toContain("push —");
	});

	it("rejects an unknown strategy without changing anything", async () => {
		const harness = makeRuntime();
		const ctx = makeCtx();
		const { entries } = await invoke(harness.runtime, "mode turbo", ctx);
		expect(harness.setMode).not.toHaveBeenCalled();
		expect(entries).toHaveLength(0);
		expect(notified(ctx)).toContain('Unknown mode "turbo"');
		expect(notified(ctx)).toContain("pull, push, hybrid");
	});
});

describe("runtime contract", () => {
	it("asks the runtime for provider variable names but never for values", async () => {
		const harness = makeRuntime({ providerEnvNames: ["GRAFT_API_KEY"] });
		const ctx = makeCtx();
		await invoke(harness.runtime, "status", ctx);
		expect(PROVIDER_ENV_NAMES).toContain("GRAFT_API_KEY");
		expect(DEEP_PROVIDER_HINT).toContain("never forwards Selesai credentials");
		expect(DOCTOR_USAGE).toContain("mode [pull|push|hybrid]");
	});
});
