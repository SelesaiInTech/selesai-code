import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import {
	getPiSpawnCommand,
	resolvePiCliScript,
	type SelesaiSpawnDeps,
} from "../../src/runs/shared/pi-spawn.ts";
import { SELESAI_CODING_AGENT_PACKAGE_ROOT_ENV } from "../../src/shared/utils.ts";

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

describe("getPiSpawnCommand", () => {
	it("honors explicit SELESAI_SUBAGENT_SELESAI_BINARY override on any platform", () => {
		const args = ["--mode", "json", "Task: check output"];
		const result = getPiSpawnCommand(args, {
			platform: "win32",
			execPath: "/usr/local/bin/node",
			argv1: "/tmp/pi-entry.mjs",
			env: {
				SELESAI_SUBAGENT_SELESAI_BINARY: "/nix/store/pi-wrapper/bin/nhost-code-agent",
			},
			existsSync: () => true,
		});
		assert.deepEqual(result, {
			command: "/nix/store/pi-wrapper/bin/nhost-code-agent",
			args,
		});
	});

	it("ignores a blank SELESAI_SUBAGENT_SELESAI_BINARY override", () => {
		const args = ["--mode", "json", "Task: check output"];
		const result = getPiSpawnCommand(args, {
			platform: "darwin",
			argv1: "/missing/host.js",
			existsSync: () => false,
			resolvePackageJson: () => {
				throw new Error("Selesai package unavailable");
			},
			env: { SELESAI_SUBAGENT_SELESAI_BINARY: "   " },
		});
		assert.deepEqual(result, { command: "selesai", args });
	});

	for (const extension of ["js", "mjs", "cjs"] as const) {
		it(`runs a Windows ${extension} SELESAI_SUBAGENT_SELESAI_BINARY override through Node`, () => {
			const piBinary = `C:\\Program Files\\pi\\bin\\pi-cli.${extension}`;
			const args = ["--mode", "json", "Task: check output"];
			const result = getPiSpawnCommand(args, {
				platform: "win32",
				execPath: "C:\\Program Files\\nodejs\\node.exe",
				env: { SELESAI_SUBAGENT_SELESAI_BINARY: piBinary },
			});
			assert.deepEqual(result, {
				command: "C:\\Program Files\\nodejs\\node.exe",
				args: [piBinary, ...args],
			});
		});
	}

	it("keeps a JavaScript SELESAI_SUBAGENT_SELESAI_BINARY override direct on POSIX", () => {
		const piBinary = "/opt/pi/bin/pi-cli.mjs";
		const args = ["--mode", "json", "Task: check output"];
		const result = getPiSpawnCommand(args, {
			platform: "darwin",
			execPath: "/usr/local/bin/node",
			env: { SELESAI_SUBAGENT_SELESAI_BINARY: piBinary },
		});
		assert.deepEqual(result, { command: piBinary, args });
	});

	for (const [platform, execPath] of [
		["darwin", "/opt/selesai/selesai"],
		["linux", "/opt/selesai/selesai"],
		["win32", "C:\\Program Files\\Selesai\\selesai.exe"],
	] as const) {
		it(`uses the standalone Selesai executable directly on ${platform}`, () => {
			const packageJsonPath = "/opt/selesai-package/package.json";
			const cliPath = path.resolve(
				path.dirname(packageJsonPath),
				"dist/cli.js",
			);
			const deps = makeDeps({
				platform,
				execPath,
				argv1: "/missing/host.js",
				packageJsonPath,
				packageJsonContent: JSON.stringify({ name: "@selesai/code", bin: { selesai: "dist/cli.js" } }),

				existing: [packageJsonPath, cliPath],
			});
			const args = ["--mode", "json", "-p", "Task: review diff"];
			assert.deepEqual(getPiSpawnCommand(args, deps), {
				command: execPath,
				args,
			});
		});
	}

	for (const platform of ["darwin", "linux", "win32"] as const) {
		it(`uses node + argv1 on ${platform} when argv1 belongs to the Selesai package`, () => {
			const tempDir = fs.mkdtempSync(
				path.join(os.tmpdir(), "selesai-spawn-argv-entry-"),
			);
			try {
				const argv1 = path.join(tempDir, "dist", "cli.js");
				fs.mkdirSync(path.dirname(argv1), { recursive: true });
				fs.writeFileSync(argv1, "#!/usr/bin/env node\n");
				fs.writeFileSync(
					path.join(tempDir, "package.json"),
					JSON.stringify({ name: "@selesai/code" }),
				);
				const args = ["--mode", "json", 'Task: review "quotes" & pipes | too'];
				const result = getPiSpawnCommand(args, {
					platform,
					execPath: "/usr/local/bin/node",
					argv1,
					env: {},
				});
				assert.deepEqual(result, {
					command: "/usr/local/bin/node",
					args: [fs.realpathSync(argv1), ...args],
				});
			} finally {
				fs.rmSync(tempDir, { recursive: true, force: true });
			}
		});
	}

	it("uses node + package bin on POSIX when argv1 is not a verified Pi entry", () => {
		const packageJsonPath = "/opt/selesai/package.json";
		const cliPath = path.resolve(
			path.dirname(packageJsonPath),
			"dist/cli/index.js",
		);
		const deps = makeDeps({
			platform: "darwin",
			execPath: "/usr/local/bin/node",
			argv1: "/opt/selesai/subagent-runner.ts",
			packageJsonPath,
			packageJsonContent: JSON.stringify({ name: "@selesai/code", bin: { selesai: "dist/cli/index.js" } }),

			existing: [packageJsonPath, cliPath],
		});
		const args = ["-p", "Task: hello"];
		const result = getPiSpawnCommand(args, deps);
		assert.deepEqual(result, {
			command: "/usr/local/bin/node",
			args: [cliPath, ...args],
		});
	});

	it("fails closed until the Windows CLI script becomes available", () => {
		const packageJsonPath = "/opt/pi/package.json";
		const cliPath = path.resolve(
			path.dirname(packageJsonPath),
			"dist/cli/index.js",
		);
		let cliAvailable = false;
		const deps = makeDeps({
			platform: "win32",
			execPath: "C:\\Program Files\\nodejs\\node.exe",
			argv1: "/opt/pi-web/dist/server.js",
			packageJsonPath,
			packageJsonContent: JSON.stringify({ name: "@selesai/code", bin: { selesai: "dist/cli/index.js" } }),
			existing: [packageJsonPath],
		});
		deps.existsSync = (filePath) =>
			filePath === packageJsonPath || (cliAvailable && filePath === cliPath);
		const args = ["-p", "Task: hello"];

		assert.throws(
			() => getPiSpawnCommand(args, deps),
			/Could not resolve the Pi CLI on Windows/,
		);
		cliAvailable = true;
		assert.deepEqual(getPiSpawnCommand(args, deps), {
			command: "C:\\Program Files\\nodejs\\node.exe",
			args: [cliPath, ...args],
		});
	});

	it("resolves the Windows CLI from the forwarded package-root env for wrapper hosts", () => {
		const packageJsonPath = "/opt/pi/package.json";
		const cliPath = path.resolve(
			path.dirname(packageJsonPath),
			"dist/cli/index.js",
		);
		const args = ["-p", "Task: hello"];
		const result = getPiSpawnCommand(args, {
			platform: "win32",
			execPath: "C:\\Program Files\\nodejs\\node.exe",
			argv1: "/opt/pi-web/dist/server.js",
			env: { [SELESAI_CODING_AGENT_PACKAGE_ROOT_ENV]: "/opt/pi" },
			existsSync: (filePath) => filePath === packageJsonPath || filePath === cliPath,
			readFileSync: () => JSON.stringify({
				name: "@selesai/code",
				bin: { selesai: "dist/cli/index.js" },
			}),
		});

		assert.deepEqual(result, {
			command: "C:\\Program Files\\nodejs\\node.exe",
			args: [cliPath, ...args],
		});
	});

	it("skips an unverified forwarded package-root env before resolving a verified Pi package", () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-spawn-unverified-env-root-"),
		);
		try {
			const wrongRoot = path.join(tempDir, "not-selesai");
			const wrongCli = path.join(wrongRoot, "bin", "evil.js");
			const selesaiRoot = path.join(tempDir, "node_modules", "@selesai", "code");
			const selesaiEntry = path.join(selesaiRoot, "dist", "index.js");
			const selesaiCli = path.join(selesaiRoot, "dist", "cli.js");
			fs.mkdirSync(path.dirname(wrongCli), { recursive: true });
			fs.mkdirSync(path.dirname(selesaiCli), { recursive: true });
			fs.writeFileSync(wrongCli, "console.log('evil');\n");
			fs.writeFileSync(path.join(wrongRoot, "package.json"), JSON.stringify({ name: "not-selesai", bin: { selesai: "bin/evil.js" } }));
			fs.writeFileSync(selesaiEntry, "export {};\n");
			fs.writeFileSync(selesaiCli, "#!/usr/bin/env node\n");
			fs.writeFileSync(path.join(selesaiRoot, "package.json"), JSON.stringify({ name: "@selesai/code", bin: { selesai: "dist/cli.js" } }));

			const result = getPiSpawnCommand(["-p", "Task: hello"], {
				platform: "win32",
				execPath: "C:\\Program Files\\nodejs\\node.exe",
				argv1: "/opt/pi-web/dist/server.js",
				// The Selesai host repo root is itself named @selesai/code, so
				// resolvePiPackageRoot() would find it before the temp verified
				// package; pin the verified temp package to keep the test
				// deterministic while still exercising the unverified env root.
				piPackageRoot: selesaiRoot,
				env: { [SELESAI_CODING_AGENT_PACKAGE_ROOT_ENV]: wrongRoot },
				resolvePackageEntry: () => selesaiEntry,
			});

			assert.deepEqual(result, {
				command: "C:\\Program Files\\nodejs\\node.exe",
				args: [selesaiCli, "-p", "Task: hello"],
			});
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("falls back to plain selesai command on POSIX when CLI script cannot be resolved", () => {

		const args = ["--mode", "json", "Task: check output"];
		const result = getPiSpawnCommand(args, {
			platform: "darwin",
			argv1: "/missing/host.js",
			existsSync: () => false,
			resolvePackageJson: () => {
				throw new Error("Selesai package unavailable");
			},
			env: {},
		});
		assert.deepEqual(result, { command: "selesai", args });
	});

	it("ignores embedded host entry points and resolves the Selesai package bin on every platform", () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "selesai-spawn-embedded-host-"),
		);
		try {
			const hostRoot = path.join(tempDir, "pi-web");
			const hostEntry = path.join(hostRoot, "dist", "server.js");
			const hostPackageJson = path.join(hostRoot, "package.json");
			const selesaiRoot = path.join(
				tempDir,
				"node_modules",
				"@selesai",
				"code",
			);
			const selesaiCli = path.join(selesaiRoot, "dist", "cli.js");
			fs.mkdirSync(path.dirname(hostEntry), { recursive: true });
			fs.mkdirSync(path.dirname(selesaiCli), { recursive: true });
			fs.writeFileSync(hostEntry, "export {};\n");
			fs.writeFileSync(
				hostPackageJson,
				JSON.stringify({ name: "@jmfederico/pi-web" }),
			);
			fs.writeFileSync(selesaiCli, "#!/usr/bin/env node\n");
			fs.writeFileSync(
				path.join(selesaiRoot, "package.json"),
				JSON.stringify({
					name: "@selesai/code",
					bin: { selesai: "dist/cli.js" },
				}),
			);

			for (const platform of ["darwin", "linux", "win32"] as const) {
				const result = getPiSpawnCommand(["-p", "Task: hello"], {
					platform,
					execPath: "/usr/local/bin/node",
					argv1: hostEntry,
					resolvePackageJson: () => path.join(selesaiRoot, "package.json"),
					env: {},
				});
				assert.deepEqual(result, {
					command: "/usr/local/bin/node",
					args: [selesaiCli, "-p", "Task: hello"],
				});
			}

			fs.writeFileSync(hostPackageJson, "{");
			for (const platform of ["darwin", "linux", "win32"] as const) {
				const malformedHostResult = getPiSpawnCommand(["-p", "Task: hello"], {
					platform,
					execPath: "/usr/local/bin/node",
					argv1: hostEntry,
					resolvePackageJson: () => path.join(selesaiRoot, "package.json"),
					env: {},
				});
				assert.deepEqual(malformedHostResult, {
					command: "/usr/local/bin/node",
					args: [selesaiCli, "-p", "Task: hello"],
				});
			}
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("validates argv1 ownership against its canonical target", () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "selesai-spawn-canonical-entry-"),
		);
		try {
			const hostRoot = path.join(tempDir, "embedded-host");
			const hostEntry = path.join(hostRoot, "dist", "server.js");
			const selesaiRoot = path.join(tempDir, "node_modules", "@earendil", "pi-coding-agent");
			const disguisedEntry = path.join(selesaiRoot, "dist", "cli.js");
			const selesaiCli = path.join(selesaiRoot, "dist", "real-cli.js");
			fs.mkdirSync(path.dirname(hostEntry), { recursive: true });
			fs.mkdirSync(path.dirname(selesaiCli), { recursive: true });
			fs.writeFileSync(hostEntry, "export {};\n");
			fs.writeFileSync(path.join(hostRoot, "package.json"), JSON.stringify({ name: "embedded-host" }));
			fs.writeFileSync(selesaiCli, "#!/usr/bin/env node\n");
			fs.writeFileSync(path.join(selesaiRoot, "package.json"), JSON.stringify({
				name: "@selesai/code",
				bin: { selesai: "dist/real-cli.js" },
			}));

			const result = getPiSpawnCommand(["-p", "Task: hello"], {
				execPath: "/usr/local/bin/node",
				argv1: disguisedEntry,
				existsSync: (filePath) => filePath === disguisedEntry || fs.existsSync(filePath),
				realpathSync: (filePath) => filePath === disguisedEntry ? hostEntry : fs.realpathSync(filePath),
				resolvePackageJson: () => path.join(selesaiRoot, "package.json"),
				env: {},
			});
			assert.deepEqual(result, {
				command: "/usr/local/bin/node",
				args: [selesaiCli, "-p", "Task: hello"],
			});
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("resolves CLI script from package bin when argv1 is not runnable JS", () => {
		const packageJsonPath = "/opt/selesai/package.json";
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
			argv1: "/opt/selesai/subagent-runner.ts",
			packageJsonPath,
			packageJsonContent: JSON.stringify({ name: "@selesai/code", bin: { selesai: "dist/cli/index.js" } }),

			existing: [packageJsonPath, cliPath],
		});
		const result = getPiSpawnCommand(["-p", "Task: hello"], deps);
		assert.equal(result.command, "/usr/local/bin/node");
		assert.equal(result.args[0], cliPath);
	});


	it("walks from package main entry to resolve package bin", () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "selesai-spawn-package-root-"),
		);
		try {
			const packageRoot = path.join(tempDir, "embedded-host");
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
			const result = getPiSpawnCommand(["-p", "Task: hello"], {
				platform: "win32",
				execPath: "/usr/local/bin/node",
				argv1: "/opt/selesai/subagent-runner.ts",
				piPackageRoot: packageRoot,
				env: {},
			});
			assert.equal(result.command, "/usr/local/bin/node");
			assert.equal(result.args[0], cliPath);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});

describe("getPiSpawnCommand with piPackageRoot", () => {
	it("resolves CLI script via piPackageRoot when argv1 is not runnable", () => {
		const packageJsonPath = "/opt/selesai/package.json";
		const cliPath = path.resolve(
			path.dirname(packageJsonPath),
			"dist/cli/index.js",
		);
		const deps = makeDeps({
			platform: "win32",
			execPath: "/usr/local/bin/node",
			argv1: "/opt/selesai/subagent-runner.ts",
			packageJsonPath,
			packageJsonContent: JSON.stringify({ name: "@selesai/code", bin: { selesai: "dist/cli/index.js" } }),

			existing: [packageJsonPath, cliPath],
		});
		deps.piPackageRoot = "/opt/pi";
		const result = getPiSpawnCommand(["-p", "Task: hello"], deps);
		assert.equal(result.command, "/usr/local/bin/node");
		assert.equal(result.args[0], cliPath);
	});
});

describe("resolvePiCliScript", () => {
	it("supports package bin as string", () => {
		const packageJsonPath = "/opt/selesai/package.json";
		const cliPath = path.resolve(
			path.dirname(packageJsonPath),
			"dist/cli/index.mjs",
		);
		const deps = makeDeps({
			platform: "win32",
			argv1: "/opt/selesai/subagent-runner.ts",
			packageJsonPath,
			packageJsonContent: JSON.stringify({ name: "@selesai/code", bin: "dist/cli/index.mjs" }),
			existing: [packageJsonPath, cliPath],
		});
		assert.equal(resolvePiCliScript(deps), cliPath);
	});
});