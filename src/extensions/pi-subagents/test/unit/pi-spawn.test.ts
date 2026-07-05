import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import {
	getSelesaiSpawnCommand,
	resolveWindowsSelesaiCliScript,
	type SelesaiSpawnDeps,
} from "../../src/runs/shared/pi-spawn.ts";

function makeDeps(input: {
	platform?: NodeJS.Platform;
	execPath?: string;
	argv1?: string;
	existing?: string[];
	packageJsonPath?: string;
	packageJsonContent?: string;
	packageEntry?: string;
	env?: NodeJS.ProcessEnv;
}): SelesaiSpawnDeps {
	const existing = new Set(input.existing ?? []);
	const packageJsonPath = input.packageJsonPath;
	const packageJsonContent = input.packageJsonContent;
	return {
		platform: input.platform,
		execPath: input.execPath,
		argv1: input.argv1,
		existsSync: (filePath) => existing.has(filePath),
		readFileSync: (_filePath, _encoding) => {
			if (!packageJsonPath || !packageJsonContent) {
				throw new Error("package json not configured");
			}
			return packageJsonContent;
		},
		resolvePackageJson: packageJsonPath ? () => packageJsonPath : undefined,
		resolvePackageEntry: input.packageEntry
			? () => input.packageEntry!
			: undefined,
		env: input.env ?? {},
	};
}

describe("getSelesaiSpawnCommand", () => {
	it("honors explicit SELESAI_SUBAGENT_PI_BINARY override on any platform", () => {
		const args = ["--mode", "json", "Task: check output"];
		const result = getSelesaiSpawnCommand(args, {
			platform: "win32",
			execPath: "/usr/local/bin/node",
			argv1: "/tmp/pi-entry.mjs",
			env: {
				SELESAI_SUBAGENT_PI_BINARY: "/nix/store/pi-wrapper/bin/nhost-code-agent",
			},
			existsSync: () => true,
		});
		assert.deepEqual(result, {
			command: "/nix/store/pi-wrapper/bin/nhost-code-agent",
			args,
		});
	});

	it("ignores a blank SELESAI_SUBAGENT_PI_BINARY override", () => {
		const args = ["--mode", "json", "Task: check output"];
		const result = getSelesaiSpawnCommand(args, {
			platform: "darwin",
			env: { SELESAI_SUBAGENT_PI_BINARY: "   " },
		});
		assert.deepEqual(result, { command: "selesai", args });
	});

	it("uses plain pi on non-Windows even when argv1 is a runnable JS file", () => {
		const argv1 = "/tmp/pi-entry.mjs";
		const deps = makeDeps({
			platform: "darwin",
			execPath: "/usr/local/bin/node",
			argv1,
			existing: [argv1],
		});
		const args = ["--mode", "json", "Task: check output"];
		const result = getSelesaiSpawnCommand(args, deps);
		assert.deepEqual(result, { command: "selesai", args });
	});

	it("uses plain pi on non-Windows even when the CLI script can be resolved from package bin", () => {
		const packageJsonPath = "/opt/pi/package.json";
		const cliPath = path.resolve(
			path.dirname(packageJsonPath),
			"dist/cli/index.js",
		);
		const deps = makeDeps({
			platform: "darwin",
			execPath: "/usr/local/bin/node",
			argv1: "/opt/pi/subagent-runner.ts",
			packageJsonPath,
			packageJsonContent: JSON.stringify({ bin: { selesai: "dist/cli/index.js" } }),
			existing: [packageJsonPath, cliPath],
		});
		const args = ["-p", "Task: hello"];
		const result = getSelesaiSpawnCommand(args, deps);
		assert.deepEqual(result, { command: "selesai", args });
	});

	it("falls back to plain pi command on non-Windows when CLI script cannot be resolved", () => {
		const args = ["--mode", "json", "Task: check output"];
		const result = getSelesaiSpawnCommand(args, { platform: "darwin", env: {} });
		assert.deepEqual(result, { command: "selesai", args });
	});

	it("uses node + argv1 script on Windows when argv1 is runnable JS", () => {
		const argv1 = "/tmp/pi-entry.mjs";
		const deps = makeDeps({
			platform: "win32",
			execPath: "/usr/local/bin/node",
			argv1,
			existing: [argv1],
		});
		const args = [
			"--mode",
			"json",
			'Task: Read C:/dev/file.md and review "quotes" & pipes | too',
		];
		const result = getSelesaiSpawnCommand(args, deps);
		assert.equal(result.command, "/usr/local/bin/node");
		assert.equal(result.args[0], argv1);
		assert.equal(result.args[3], args[2]);
	});

	it("resolves CLI script from package bin when argv1 is not runnable JS", () => {
		const packageJsonPath = "/opt/pi/package.json";
		// Compute expected path the same way the production code does:
		// path.resolve(path.dirname(packageJsonPath), binPath) — which on Windows
		// prepends the current drive letter to POSIX absolute paths.
		const cliPath = path.resolve(
			path.dirname(packageJsonPath),
			"dist/cli/index.js",
		);
		const deps = makeDeps({
			platform: "win32",
			execPath: "/usr/local/bin/node",
			argv1: "/opt/pi/subagent-runner.ts",
			packageJsonPath,
			packageJsonContent: JSON.stringify({ bin: { selesai: "dist/cli/index.js" } }),
			existing: [packageJsonPath, cliPath],
		});
		const result = getSelesaiSpawnCommand(["-p", "Task: hello"], deps);
		assert.equal(result.command, "/usr/local/bin/node");
		assert.equal(result.args[0], cliPath);
	});

	it("falls back to pi when Windows CLI script cannot be resolved", () => {
		const deps = makeDeps({
			platform: "win32",
			argv1: "/opt/pi/subagent-runner.ts",
			existing: [],
		});
		const args = ["-p", "Task: hello"];
		const result = getSelesaiSpawnCommand(args, deps);
		assert.deepEqual(result, { command: "selesai", args });
	});

	it("walks from package main entry to resolve package bin", () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-spawn-package-root-"),
		);
		try {
			const packageRoot = path.join(
				tempDir,
				"node_modules",
				"@selesai",
				"code",
			);
			const entry = path.join(packageRoot, "dist", "index.js");
			const cliPath = path.join(packageRoot, "dist", "cli", "index.js");
			fs.mkdirSync(path.dirname(entry), { recursive: true });
			fs.mkdirSync(path.dirname(cliPath), { recursive: true });
			fs.writeFileSync(entry, "export {};\n");
			fs.writeFileSync(cliPath, "#!/usr/bin/env node\n");
			fs.writeFileSync(
				path.join(packageRoot, "package.json"),
				JSON.stringify({
					name: "@selesai/code",
					bin: { selesai: "dist/cli/index.js" },
				}),
			);
			const result = getSelesaiSpawnCommand(["-p", "Task: hello"], {
				platform: "win32",
				execPath: "/usr/local/bin/node",
				argv1: "/opt/pi/subagent-runner.ts",
				resolvePackageEntry: () => entry,
				env: {},
			});
			assert.equal(result.command, "/usr/local/bin/node");
			assert.equal(result.args[0], cliPath);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});

describe("getSelesaiSpawnCommand with piPackageRoot", () => {
	it("resolves CLI script via piPackageRoot when argv1 is not runnable", () => {
		const packageJsonPath = "/opt/pi/package.json";
		const cliPath = path.resolve(
			path.dirname(packageJsonPath),
			"dist/cli/index.js",
		);
		const deps = makeDeps({
			platform: "win32",
			execPath: "/usr/local/bin/node",
			argv1: "/opt/pi/subagent-runner.ts",
			packageJsonPath,
			packageJsonContent: JSON.stringify({ bin: { selesai: "dist/cli/index.js" } }),
			existing: [packageJsonPath, cliPath],
		});
		deps.piPackageRoot = "/opt/pi";
		const result = getSelesaiSpawnCommand(["-p", "Task: hello"], deps);
		assert.equal(result.command, "/usr/local/bin/node");
		assert.equal(result.args[0], cliPath);
	});
});

describe("resolveWindowsSelesaiCliScript", () => {
	it("supports package bin as string", () => {
		const packageJsonPath = "/opt/pi/package.json";
		const cliPath = path.resolve(
			path.dirname(packageJsonPath),
			"dist/cli/index.mjs",
		);
		const deps = makeDeps({
			platform: "win32",
			argv1: "/opt/pi/subagent-runner.ts",
			packageJsonPath,
			packageJsonContent: JSON.stringify({ bin: "dist/cli/index.mjs" }),
			existing: [packageJsonPath, cliPath],
		});
		assert.equal(resolveWindowsSelesaiCliScript(deps), cliPath);
	});
});
