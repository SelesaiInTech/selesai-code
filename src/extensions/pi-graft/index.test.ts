import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import graftExtension, { bashLooksMutating, detectGraphPresence, GRAFT_EXTENSION_PATH, isMutatingResult } from "./index.ts";
import { makePi } from "./test-support.ts";

describe("extension registration", () => {
	it("registers all six read-only tools, the command, and the lifecycle handlers it needs", () => {
		const { pi, tools, commands, handlers } = makePi();
		graftExtension(pi as never);

		expect([...tools.keys()].sort()).toEqual([
			"graft_check_freshness",
			"graft_file_api",
			"graft_find_all",
			"graft_find_code",
			"graft_repo_map",
			"graft_trace_calls",
		]);
		expect([...commands.keys()]).toEqual(["graft"]);
		expect([...handlers.keys()].sort()).toEqual([
			"agent_end",
			"before_agent_start",
			"session_shutdown",
			"session_start",
			"tool_result",
			"turn_start",
		]);
	});

	it("starts no process and touches no file from the factory", () => {
		const { pi, exec } = makePi();
		graftExtension(pi as never);
		expect(exec).not.toHaveBeenCalled();
	});

	it("automatically contributes Graft tools to pi-subagents' code-facing builtins", async () => {
		const harness = makePi();
		graftExtension(harness.pi as never);
		const modulePath = ["..", "pi-subagents", "src", "agents", "builtin-agent-augmentations.ts"].join("/");
		const { requestBuiltinAgentAugmentations } = await import(modulePath);

		expect(requestBuiltinAgentAugmentations(harness.pi as never)).toEqual([{
			id: "pi-graft",
			agentNames: ["scout", "reviewer", "worker", "delegate", "oracle"],
			addTools: [
				"graft_check_freshness", "graft_file_api", "graft_find_all",
				"graft_find_code", "graft_repo_map", "graft_trace_calls",
			],
			subagentOnlyExtensions: [GRAFT_EXTENSION_PATH],
		}]);
	});

	it("registers no capability that could mutate the repository or another agent's config", () => {
		const { pi, tools, commands } = makePi();
		graftExtension(pi as never);
		const surface = [...tools.keys(), ...commands.keys()].join(" ");
		for (const forbidden of ["init", "uninstall", "upgrade", "install", "viz", "mcp"]) {
			expect(surface).not.toContain(forbidden);
		}
	});
});

describe("detectGraphPresence", () => {
	let root: string;

	beforeAll(() => {
		root = mkdtempSync(join(tmpdir(), "graft-presence-"));
	});

	afterAll(() => rmSync(root, { recursive: true, force: true }));

	function makeRepo(name: string, files: Record<string, string>): string {
		const dir = join(root, name);
		for (const [path, content] of Object.entries(files)) {
			mkdirSync(join(dir, path, ".."), { recursive: true });
			writeFileSync(join(dir, path), content, "utf-8");
		}
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	it("reports no graph for a repository that has never been built", () => {
		const dir = makeRepo("bare", { "src/a.ts": "" });
		expect(detectGraphPresence(dir)).toEqual({ built: false, deep: false });
	});

	it("recognizes a structural graph from its wiring index", () => {
		const dir = makeRepo("structural", { "graft/.graph/wiring.json": "{}" });
		expect(detectGraphPresence(dir)).toEqual({ built: true, deep: false });
	});

	it("treats the markdown index as evidence of a build, not of the deep tier", () => {
		const dir = makeRepo("indexed", { "graft/INDEX.md": "# Index" });
		expect(detectGraphPresence(dir)).toEqual({ built: true, deep: false });
	});

	it("recognizes the provider-backed tier by the concept nodes it adds", () => {
		const dir = makeRepo("deep", { "graft/.graph/wiring.json": "{}", "graft/auth.md": "# Auth" });
		expect(detectGraphPresence(dir)).toEqual({ built: true, deep: true });

		const shallow = makeRepo("shallow", { "graft/.graph/wiring.json": "{}", "graft/INDEX.md": "# Index" });
		// INDEX.md is the index, not a concept node.
		expect(detectGraphPresence(shallow)).toEqual({ built: true, deep: false });
	});

	it("answers without throwing on an unreadable graph directory", () => {
		expect(detectGraphPresence(join(root, "does-not-exist"))).toEqual({ built: false, deep: false });
		expect(detectGraphPresence("")).toEqual({ built: false, deep: false });
	});
});

describe("bashLooksMutating", () => {
	it("recognizes commands that certainly change the working tree", () => {
		const mutating = [
			"rm -rf dist",
			"mv a b",
			"mkdir -p out",
			"echo hi > file.txt",
			"echo hi >> file.txt",
			"sed -i '' 's/a/b/' src/a.ts",
			"git checkout -b feature",
			"git commit -m x",
			"npm install left-pad",
			"pip install requests",
			"ls && rm b",
		];
		for (const command of mutating) expect(bashLooksMutating(command), command).toBe(true);
	});

	it("leaves read-only inspection alone", () => {
		const readOnly = [
			"ls -la",
			"cat src/a.ts",
			"git status",
			"git diff HEAD",
			"git log --oneline",
			"grep -rn foo src",
			"node --test",
			"echo hello",
			"npm test",
			"graft build",
		];
		for (const command of readOnly) expect(bashLooksMutating(command), command).toBe(false);
	});
});

describe("isMutatingResult", () => {
	it("counts successful edits and writes", () => {
		expect(isMutatingResult({ toolName: "edit", input: {} })).toBe(true);
		expect(isMutatingResult({ toolName: "write", input: {} })).toBe(true);
	});

	it("counts only clearly mutating bash commands", () => {
		expect(isMutatingResult({ toolName: "bash", input: { command: "rm -rf dist" } })).toBe(true);
		expect(isMutatingResult({ toolName: "bash", input: { command: "git status" } })).toBe(false);
		expect(isMutatingResult({ toolName: "bash", input: {} })).toBe(false);
		expect(isMutatingResult({ toolName: "bash", input: { command: 42 } })).toBe(false);
	});

	it("ignores read-only built-ins", () => {
		for (const toolName of ["read", "grep", "find", "ls", "graft_find_code"]) {
			expect(isMutatingResult({ toolName, input: {} }), toolName).toBe(false);
		}
	});
});
