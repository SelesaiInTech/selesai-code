import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const SELESAI_PACKAGE = "@selesai/code";

export function findSelesaiPackageRootFromEntry(entryPoint: string): string | undefined {
	let dir = path.dirname(entryPoint);
	while (dir !== path.dirname(dir)) {
		const packageJsonPath = path.join(dir, "package.json");
		if (fs.existsSync(packageJsonPath)) {
			const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as { name?: unknown };
			if (pkg.name === SELESAI_PACKAGE) return dir;
		}
		dir = path.dirname(dir);
	}
	return undefined;
}

export function resolveInstalledSelesaiPackageRoot(): string | undefined {
	return findSelesaiPackageRootFromEntry(fileURLToPath(import.meta.resolve(SELESAI_PACKAGE)));
}

export function resolveSelesaiPackageRoot(): string | undefined {
	try {
		const entry = process.argv[1];
		return entry ? findSelesaiPackageRootFromEntry(fs.realpathSync(entry)) : undefined;
	} catch {
		// process.argv[1] probing is best-effort; callers can fall back to PATH/package resolution.
		return undefined;
	}
}

export interface SelesaiSpawnDeps {
	platform?: NodeJS.Platform;
	execPath?: string;
	argv1?: string;
	existsSync?: (filePath: string) => boolean;
	readFileSync?: (filePath: string, encoding: "utf-8") => string;
	resolvePackageJson?: () => string;
	resolvePackageEntry?: () => string;
	piPackageRoot?: string;
}

interface SelesaiSpawnCommand {
	command: string;
	args: string[];
}

function isRunnableNodeScript(filePath: string, existsSync: (filePath: string) => boolean): boolean {
	if (!existsSync(filePath)) return false;
	return /\.(?:mjs|cjs|js)$/i.test(filePath);
}

function normalizePath(filePath: string): string {
	return path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
}

export function resolveWindowsSelesaiCliScript(deps: SelesaiSpawnDeps = {}): string | undefined {
	const existsSync = deps.existsSync ?? fs.existsSync;
	const readFileSync = deps.readFileSync ?? ((filePath, encoding) => fs.readFileSync(filePath, encoding));
	const argv1 = deps.argv1 ?? process.argv[1];

	if (argv1) {
		const argvPath = normalizePath(argv1);
		// Resolve symlinks before checking the extension: a renamed fork like
		// "selesai" is typically a symlink to dist/cli.js, so the raw argv1 has
		// no .js extension and would otherwise fail the runnable-script check.
		let resolved = argvPath;
		try {
			resolved = fs.realpathSync(argvPath);
		} catch {
			// realpath is best-effort; fall back to the raw path.
		}
		if (isRunnableNodeScript(resolved, existsSync)) {
			return resolved;
		}
		if (isRunnableNodeScript(argvPath, existsSync)) {
			return argvPath;
		}
	}

	try {
		const resolvePackageJson = deps.resolvePackageJson ?? (() => {
			const root = deps.piPackageRoot ?? resolveSelesaiPackageRoot();
			if (root) return path.join(root, "package.json");
			const packageRoot = deps.resolvePackageEntry
				? findSelesaiPackageRootFromEntry(deps.resolvePackageEntry())
				: resolveInstalledSelesaiPackageRoot();
			if (!packageRoot) throw new Error(`Could not resolve ${SELESAI_PACKAGE} package root`);
			return path.join(packageRoot, "package.json");
		});
		const packageJsonPath = resolvePackageJson();
		const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
			bin?: string | Record<string, string>;
		};
		const binField = packageJson.bin;
		const binPath = typeof binField === "string"
			? binField
			: binField?.selesai ?? Object.values(binField ?? {})[0];
		if (!binPath) return undefined;
		const candidate = path.resolve(path.dirname(packageJsonPath), binPath);
		if (isRunnableNodeScript(candidate, existsSync)) {
			return candidate;
		}
	} catch {
		// Windows CLI resolution is optional; falling back to `selesai` lets PATH handle execution.
		return undefined;
	}

	return undefined;
}

export function getSelesaiSpawnCommand(args: string[], deps: SelesaiSpawnDeps = {}): SelesaiSpawnCommand {
	// On all platforms, prefer the running CLI script (process.argv[1]) so a
	// renamed fork like "selesai" spawns its own binary instead of the upstream
	// "selesai" from PATH (which has a different agent dir / providers / auth).
	const selesaiCliPath = resolveWindowsSelesaiCliScript(deps);
	if (selesaiCliPath) {
		return {
			command: deps.execPath ?? process.execPath,
			args: [selesaiCliPath, ...args],
		};
	}

	// Fall back to the upstream binary name only if the CLI script could not be
	// resolved. "selesai" is the default for selesai installs.
	return { command: "selesai", args };
}