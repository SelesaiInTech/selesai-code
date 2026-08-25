import {
	accessSync,
	chmodSync,
	constants,
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	unlinkSync,
	writeFileSync,
} from "fs";
import { homedir } from "os";
import { basename, dirname, join, resolve, sep, win32 } from "path";
import { fileURLToPath } from "url";
import { spawnProcessSync } from "./utils/child-process.ts";
import { normalizePath } from "./utils/paths.ts";

// =============================================================================
// Package Detection
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Detect if we're running as a Bun compiled binary.
 * Bun binaries have import.meta.url containing "$bunfs", "~BUN", or "%7EBUN" (Bun's virtual filesystem path)
 */
export const isBunBinary =
	import.meta.url.includes("$bunfs") || import.meta.url.includes("~BUN") || import.meta.url.includes("%7EBUN");

/** Detect if Bun is the runtime (compiled binary or bun run) */
export const isBunRuntime = !!process.versions.bun;

// =============================================================================
// Install Method Detection
// =============================================================================

export type InstallMethod = "bun-binary" | "source" | "npm" | "pnpm" | "yarn" | "bun" | "unknown";

interface SelfUpdateCommandStep {
	command: string;
	args: string[];
	display: string;
}

export interface SelfUpdateCommand extends SelfUpdateCommandStep {
	steps?: SelfUpdateCommandStep[];
}

export type SelfUpdatePackageTarget = string | { packageName: string; installSpec?: string };

function normalizeSelfUpdatePackageTarget(target: SelfUpdatePackageTarget): {
	packageName: string;
	installSpec: string;
} {
	if (typeof target === "string") {
		return { packageName: target, installSpec: target };
	}
	return { packageName: target.packageName, installSpec: target.installSpec ?? target.packageName };
}

function makeSelfUpdateCommand(
	installStep: SelfUpdateCommandStep,
	uninstallStep?: SelfUpdateCommandStep,
): SelfUpdateCommand {
	if (!uninstallStep) return installStep;
	return {
		...installStep,
		display: `${uninstallStep.display} && ${installStep.display}`,
		steps: [uninstallStep, installStep],
	};
}

function makeSelfUpdateCommandStep(command: string, args: string[]): SelfUpdateCommandStep {
	return {
		command,
		args,
		display: [command, ...args].map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(" "),
	};
}

export function detectInstallMethod(): InstallMethod {
	if (isBunBinary) {
		return "bun-binary";
	}

	if (existsSync(join(getPackageDir(), ".git"))) {
		return "source";
	}

	const resolvedPath = `${__dirname}\0${process.execPath || ""}`.toLowerCase().replace(/\\/g, "/");

	if (resolvedPath.includes("/pnpm/") || resolvedPath.includes("/.pnpm/")) {
		return "pnpm";
	}
	if (resolvedPath.includes("/yarn/") || resolvedPath.includes("/.yarn/")) {
		return "yarn";
	}
	if (isBunRuntime || resolvedPath.includes("/install/global/node_modules/")) {
		return "bun";
	}
	if (resolvedPath.includes("/npm/") || resolvedPath.includes("/node_modules/")) {
		return "npm";
	}

	return "unknown";
}

function getInferredNpmInstall(): { root: string; prefix: string } | undefined {
	const packageDir = getPackageDir();
	const path = process.platform === "win32" || packageDir.includes("\\") ? win32 : { basename, dirname };
	const parent = path.dirname(packageDir);
	let root: string | undefined;
	if (path.basename(parent).startsWith("@") && path.basename(path.dirname(parent)) === "node_modules") {
		root = path.dirname(parent);
	} else if (path.basename(parent) === "node_modules") {
		root = parent;
	}
	if (!root) return undefined;
	const rootParent = path.dirname(root);
	if (path.basename(rootParent) === "lib") return { root, prefix: path.dirname(rootParent) };
	// Windows global npm prefixes use `<prefix>\\node_modules`, which is
	// indistinguishable from local project installs by path shape alone. Do not
	// infer unsupported Windows custom prefixes without `npm root -g` evidence.
	return undefined;
}

function getSelfUpdateCommandForMethod(
	method: InstallMethod,
	installedPackageName: string,
	updatePackageTarget: SelfUpdatePackageTarget = installedPackageName,
	npmCommand?: string[],
): SelfUpdateCommand | undefined {
	const target = normalizeSelfUpdatePackageTarget(updatePackageTarget);
	switch (method) {
		case "bun-binary":
			return undefined;
		case "source": {
			if (target.packageName !== installedPackageName) return undefined;
			const packageDir = getPackageDir();
			const steps = [
				makeSelfUpdateCommandStep("git", ["-C", packageDir, "pull", "--ff-only"]),
				makeSelfUpdateCommandStep("npm", ["--prefix", packageDir, "install"]),
				makeSelfUpdateCommandStep("npm", ["--prefix", packageDir, "run", "build"]),
			];
			return { ...steps[0], display: steps.map((step) => step.display).join(" && "), steps };
		}
		case "pnpm": {
			const match = readCommandOutput("pnpm", ["root", "-g"])
				? undefined
				: /^(.*[\\/]global[\\/][^\\/]+)[\\/]\.pnpm[\\/]/.exec(getPackageDir());
			const binDirArgs = match
				? [`--config.global-bin-dir=${process.env.PNPM_HOME || dirname(dirname(match[1]))}`]
				: [];
			return makeSelfUpdateCommand(
				makeSelfUpdateCommandStep("pnpm", [
					"install",
					"-g",
					"--ignore-scripts",
					"--config.minimumReleaseAge=0",
					...binDirArgs,
					target.installSpec,
				]),
				target.packageName === installedPackageName
					? undefined
					: makeSelfUpdateCommandStep("pnpm", ["remove", "-g", ...binDirArgs, installedPackageName]),
			);
		}
		case "yarn":
			return makeSelfUpdateCommand(
				makeSelfUpdateCommandStep("yarn", ["global", "add", "--ignore-scripts", target.installSpec]),
				target.packageName === installedPackageName
					? undefined
					: makeSelfUpdateCommandStep("yarn", ["global", "remove", installedPackageName]),
			);
		case "bun":
			return makeSelfUpdateCommand(
				makeSelfUpdateCommandStep("bun", [
					"install",
					"-g",
					"--ignore-scripts",
					"--minimum-release-age=0",
					target.installSpec,
				]),
				target.packageName === installedPackageName
					? undefined
					: makeSelfUpdateCommandStep("bun", ["uninstall", "-g", installedPackageName]),
			);
		case "npm": {
			const [command = "npm", ...npmArgs] = npmCommand ?? [];
			const inferred = npmCommand?.length ? undefined : getInferredNpmInstall();
			const prefixArgs = [...npmArgs, ...(inferred ? ["--prefix", inferred.prefix] : [])];
			const installStep = makeSelfUpdateCommandStep(command, [
				...prefixArgs,
				"install",
				"-g",
				"--ignore-scripts",
				"--min-release-age=0",
				target.installSpec,
			]);
			const uninstallStep =
				target.packageName === installedPackageName
					? undefined
					: makeSelfUpdateCommandStep(command, [...prefixArgs, "uninstall", "-g", installedPackageName]);
			return makeSelfUpdateCommand(installStep, uninstallStep);
		}
		case "unknown":
			return undefined;
	}
}

function readCommandOutput(
	command: string,
	args: string[],
	options: { requireSuccess?: boolean } = {},
): string | undefined {
	const result = spawnProcessSync(command, args, {
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (result.status === 0) return result.stdout.trim() || undefined;
	if (options.requireSuccess) {
		const reason = result.error?.message || result.stderr.trim() || `exit code ${result.status ?? "unknown"}`;
		throw new Error(`Failed to run ${[command, ...args].join(" ")}: ${reason}`);
	}
	return undefined;
}

function getGlobalPackageRoots(method: InstallMethod, _packageName: string, npmCommand?: string[]): string[] {
	switch (method) {
		case "npm": {
			const configured = !!npmCommand?.length;
			const [command = "npm", ...npmArgs] = npmCommand ?? [];
			if (configured && command === "bun") {
				const bunBin = readCommandOutput(command, [...npmArgs, "pm", "bin", "-g"], {
					requireSuccess: true,
				});
				const roots = [join(homedir(), ".bun", "install", "global", "node_modules")];
				if (bunBin) {
					roots.push(join(dirname(bunBin), "install", "global", "node_modules"));
				}
				return roots;
			}
			const root = readCommandOutput(command, [...npmArgs, "root", "-g"], {
				requireSuccess: configured,
			});
			const inferred = configured ? undefined : getInferredNpmInstall();
			return [root, inferred?.root].filter((x): x is string => !!x);
		}
		case "pnpm": {
			const root = readCommandOutput("pnpm", ["root", "-g"]);
			if (root) return [root, dirname(root)];
			const match = /^(.*[\\/]global[\\/][^\\/]+)[\\/]\.pnpm[\\/]/.exec(getPackageDir());
			return match ? [match[1]] : [];
		}
		case "yarn": {
			const dir = readCommandOutput("yarn", ["global", "dir"]);
			return dir ? [dir, join(dir, "node_modules")] : [];
		}
		case "bun": {
			const bunBin = readCommandOutput("bun", ["pm", "bin", "-g"]);
			const roots = [join(homedir(), ".bun", "install", "global", "node_modules")];
			if (bunBin) {
				roots.push(join(dirname(bunBin), "install", "global", "node_modules"));
			}
			return roots;
		}
		case "bun-binary":
		case "source":
		case "unknown":
			return [];
	}
}

function normalizeExistingPathForComparison(path: string, resolveSymlinks: boolean): string | undefined {
	const resolvedPath = resolve(path);
	if (!existsSync(resolvedPath)) {
		return undefined;
	}
	let normalizedPath = resolvedPath;
	if (resolveSymlinks) {
		try {
			normalizedPath = realpathSync(resolvedPath);
		} catch {
			return undefined;
		}
	}
	if (process.platform === "win32") {
		normalizedPath = normalizedPath.toLowerCase();
	}
	return normalizedPath;
}

function getPathComparisonCandidates(path: string): string[] {
	return Array.from(
		new Set(
			[normalizeExistingPathForComparison(path, false), normalizeExistingPathForComparison(path, true)].filter(
				(candidate): candidate is string => !!candidate,
			),
		),
	);
}

function getEntrypointPackageDir(): string | undefined {
	const entrypoint = process.argv[1];
	if (!entrypoint) return undefined;
	let dir = dirname(entrypoint);
	while (dir !== dirname(dir)) {
		if (existsSync(join(dir, "package.json"))) {
			return dir;
		}
		dir = dirname(dir);
	}
	return undefined;
}

function isSelfUpdatePathWritable(): boolean {
	const packageDir = getPackageDir();
	try {
		accessSync(packageDir, constants.W_OK);
		accessSync(dirname(packageDir), constants.W_OK);
		return true;
	} catch {
		return false;
	}
}

function isManagedByGlobalPackageManager(method: InstallMethod, packageName: string, npmCommand?: string[]): boolean {
	const packageDirs = [getPackageDir(), getEntrypointPackageDir()].filter((dir): dir is string => !!dir);
	const packageDirCandidates = packageDirs.flatMap((dir) => getPathComparisonCandidates(dir));
	return getGlobalPackageRoots(method, packageName, npmCommand).some((root) => {
		return getPathComparisonCandidates(root).some((normalizedRoot) => {
			const rootPrefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
			return packageDirCandidates.some((packageDir) => packageDir.startsWith(rootPrefix));
		});
	});
}

export function getSelfUpdateCommand(
	packageName: string,
	npmCommand?: string[],
	updatePackageTarget: SelfUpdatePackageTarget = packageName,
): SelfUpdateCommand | undefined {
	const method = detectInstallMethod();
	const command = getSelfUpdateCommandForMethod(method, packageName, updatePackageTarget, npmCommand);
	if (!command || !isSelfUpdatePathWritable()) {
		return undefined;
	}
	if (method !== "source" && !isManagedByGlobalPackageManager(method, packageName, npmCommand)) {
		return undefined;
	}
	return command;
}

export function getSelfUpdateUnavailableInstruction(
	packageName: string,
	npmCommand?: string[],
	updatePackageTarget: SelfUpdatePackageTarget = packageName,
): string {
	const method = detectInstallMethod();
	const target = normalizeSelfUpdatePackageTarget(updatePackageTarget);
	if (method === "bun-binary") {
		return `Download from: https://github.com/earendil-works/pi-mono/releases/latest`;
	}
	const command = getSelfUpdateCommandForMethod(method, packageName, target, npmCommand);
	if (command) {
		if (method === "source") {
			return isSelfUpdatePathWritable()
				? `Update the source checkout yourself with: ${command.display}`
				: `This source checkout is not writable. Update it yourself with: ${command.display}`;
		}
		if (isManagedByGlobalPackageManager(method, packageName, npmCommand) && !isSelfUpdatePathWritable()) {
			return `This installation is managed by a global ${method} install, but the install path is not writable. Update it yourself with: ${command.display}`;
		}
		return `This installation is not managed by a global ${method} install. Update it with the package manager, wrapper, or source checkout that provides it.`;
	}
	return `Update ${target.installSpec} using the package manager, wrapper, or source checkout that provides this installation.`;
}

export function getUpdateInstruction(packageName: string): string {
	const method = detectInstallMethod();
	const command = getSelfUpdateCommandForMethod(method, packageName);
	if (command) {
		return `Run: ${command.display}`;
	}
	return getSelfUpdateUnavailableInstruction(packageName);
}

// =============================================================================
// Package Asset Paths (shipped with executable)
// =============================================================================

/**
 * Get the base directory for resolving package assets (themes, package.json, README.md, CHANGELOG.md).
 * - For Bun binary: returns the directory containing the executable
 * - For Node.js (dist/): returns __dirname (the dist/ directory)
 * - For tsx (src/): returns parent directory (the package root)
 */
export function getPackageDir(): string {
	// Allow override via environment variable (useful for Nix/Guix where store paths tokenize poorly)
	const envDir = process.env.PI_PACKAGE_DIR;
	if (envDir) {
		return normalizePath(envDir);
	}

	if (isBunBinary) {
		// Bun binary: process.execPath points to the compiled executable
		return dirname(process.execPath);
	}
	// Node.js: walk up from __dirname until we find package.json
	let dir = __dirname;
	while (dir !== dirname(dir)) {
		if (existsSync(join(dir, "package.json"))) {
			return dir;
		}
		dir = dirname(dir);
	}
	// Fallback (shouldn't happen)
	return __dirname;
}

/**
 * Get path to built-in themes directory (shipped with package)
 * - For Bun binary: theme/ next to executable
 * - For Node.js (dist/): dist/modes/interactive/theme/
 * - For tsx (src/): src/modes/interactive/theme/
 */
export function getThemesDir(): string {
	if (isBunBinary) {
		return join(getPackageDir(), "theme");
	}
	// Theme is in modes/interactive/theme/ relative to src/ or dist/
	const packageDir = getPackageDir();
	const srcOrDist = existsSync(join(packageDir, "src")) ? "src" : "dist";
	return join(packageDir, srcOrDist, "modes", "interactive", "theme");
}

/**
 * Get path to HTML export template directory (shipped with package)
 * - For Bun binary: export-html/ next to executable
 * - For Node.js (dist/): dist/core/export-html/
 * - For tsx (src/): src/core/export-html/
 */
export function getExportTemplateDir(): string {
	if (isBunBinary) {
		return join(getPackageDir(), "export-html");
	}
	const packageDir = getPackageDir();
	const srcOrDist = existsSync(join(packageDir, "src")) ? "src" : "dist";
	return join(packageDir, srcOrDist, "core", "export-html");
}

/** Get path to package.json */
export function getPackageJsonPath(): string {
	return join(getPackageDir(), "package.json");
}

/** Get path to README.md */
export function getReadmePath(): string {
	return resolve(join(getPackageDir(), "README.md"));
}

/** Get path to docs directory */
export function getDocsPath(): string {
	return resolve(join(getPackageDir(), "docs"));
}

/** Get path to examples directory */
export function getExamplesPath(): string {
	return resolve(join(getPackageDir(), "examples"));
}

/** Get path to CHANGELOG.md */
export function getChangelogPath(): string {
	return resolve(join(getPackageDir(), "CHANGELOG.md"));
}

/**
 * Get path to built-in interactive assets directory.
 * - For Bun binary: assets/ next to executable
 * - For Node.js (dist/): dist/modes/interactive/assets/
 * - For tsx (src/): src/modes/interactive/assets/
 */
export function getInteractiveAssetsDir(): string {
	if (isBunBinary) {
		return join(getPackageDir(), "assets");
	}
	const packageDir = getPackageDir();
	const srcOrDist = existsSync(join(packageDir, "src")) ? "src" : "dist";
	return join(packageDir, srcOrDist, "modes", "interactive", "assets");
}

/**
 * Resolve a bundled subdirectory shipped with the package (defaults/extensions/themes).
 * - For Bun binary: <dir>/ next to executable
 * - For Node.js (dist/): dist/<dir>/
 * - For tsx (src/): src/<dir>/
 */
function getBundledSubdir(name: string): string {
	if (isBunBinary) {
		return join(getPackageDir(), name);
	}
	const packageDir = getPackageDir();
	const srcOrDist = existsSync(join(packageDir, "src")) ? "src" : "dist";
	return join(packageDir, srcOrDist, name);
}

/**
 * Get path to bundled default config directory (shipped with package).
 * Holds bundled defaults. settings.json is copied on first run; models.json is loaded directly.
 */
export function getBundledDefaultsDir(): string {
	return getBundledSubdir("defaults");
}

/**
 * Get path to bundled built-in extensions directory (shipped with package).
 * Loaded directly via additionalExtensionPaths at boot (not copied into the
 * user agent dir) — same hook as CLI --extension. .ts ships as-is (jiti loads it).
 * - For Bun binary: extensions/ next to executable
 * - For Node.js (dist/): dist/extensions/
 * - For tsx (src/): src/extensions/
 */
export function getBundledExtensionsDir(): string {
	return getBundledSubdir("extensions");
}

/**
 * Get path to bundled built-in themes directory (shipped with package).
 * Loaded directly via additionalThemePaths at boot.
 */
export function getBundledThemesDir(): string {
	return getBundledSubdir("themes");
}

/**
 * Get path to bundled built-in skills directory (shipped with package).
 * Loaded directly via additionalSkillPaths at boot.
 */
export function getBundledSkillsDir(): string {
	return getBundledSubdir("skills");
}

/** Get path to a bundled interactive asset */
export function getBundledInteractiveAssetPath(name: string): string {
	return join(getInteractiveAssetsDir(), name);
}

// =============================================================================
// App Config (from package.json piConfig)
// =============================================================================

interface PackageJson {
	name?: string;
	version?: string;
	piConfig?: {
		name?: string;
		configDir?: string;
	};
}

let pkg: PackageJson = {};
try {
	pkg = JSON.parse(readFileSync(getPackageJsonPath(), "utf-8")) as PackageJson;
} catch (e: unknown) {
	const err = e as NodeJS.ErrnoException;
	if (err.code !== "ENOENT") throw e;
}

const piConfigName: string | undefined = pkg.piConfig?.name;
export const PACKAGE_NAME: string = pkg.name || "@earendil-works/pi-coding-agent";
export const APP_NAME: string = piConfigName || "pi";
export const APP_TITLE: string = piConfigName ? APP_NAME : "π";
export const CONFIG_DIR_NAME: string = pkg.piConfig?.configDir || ".pi";
export const VERSION: string = pkg.version || "0.0.0";

// e.g., PI_CODING_AGENT_DIR or TAU_CODING_AGENT_DIR
export const ENV_AGENT_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`;
export const ENV_SESSION_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_SESSION_DIR`;

export function expandTildePath(path: string): string {
	return normalizePath(path);
}

const DEFAULT_SHARE_VIEWER_URL = "https://pi.dev/session/";

/** Get the share viewer URL for a gist ID */
export function getShareViewerUrl(gistId: string): string {
	const baseUrl = process.env.PI_SHARE_VIEWER_URL || DEFAULT_SHARE_VIEWER_URL;
	return `${baseUrl}#${gistId}`;
}

// =============================================================================
// User Config Paths (~/<configured-dir>/agent/*)
// =============================================================================

/** Get the agent config directory (e.g., ~/.selesai/agent/) */
export function getAgentDir(): string {
	const envDir = process.env[ENV_AGENT_DIR];
	if (envDir) {
		return expandTildePath(envDir);
	}
	return join(homedir(), CONFIG_DIR_NAME, "agent");
}

/** Get path to user's custom themes directory */
export function getCustomThemesDir(): string {
	return join(getAgentDir(), "themes");
}

/** Get path to models.json */
export function getModelsPath(): string {
	return join(getAgentDir(), "models.json");
}

/** Get path to auth.json */
export function getAuthPath(): string {
	return join(getAgentDir(), "auth.json");
}

/** Get path to settings.json */
export function getSettingsPath(): string {
	return join(getAgentDir(), "settings.json");
}

/** Get path to tools directory */
export function getToolsDir(): string {
	return join(getAgentDir(), "tools");
}

/** Get path to managed binaries directory (fd, rg) */
export function getBinDir(): string {
	return join(getAgentDir(), "bin");
}

/** Get path to prompt templates directory */
export function getPromptsDir(): string {
	return join(getAgentDir(), "prompts");
}

/** Get path to sessions directory */
export function getSessionsDir(): string {
	return join(getAgentDir(), "sessions");
}

/** Get path to debug log file */
export function getDebugLogPath(): string {
	return join(getAgentDir(), `${APP_NAME}-debug.log`);
}

/**
 * Marker file written once first-time onboarding completes. Decouples the
 * first-run dialog gate from settings.json existence so that bootstrapping a
 * bundled default settings.json does not suppress the dialog.
 */
export function getFirstRunMarkerPath(agentDir: string = getAgentDir()): string {
	return join(agentDir, ".firstRunComplete");
}

/**
 * Mark first-run onboarding as complete. Safe to call repeatedly.
 */
export function markFirstRunComplete(agentDir: string = getAgentDir()): void {
	mkdirSync(agentDir, { recursive: true, mode: 0o700 });
	writeFileSync(getFirstRunMarkerPath(agentDir), "1", { mode: 0o600 });
}

// =============================================================================
// Agent Dir Bootstrap (first-run seeding and settings migration)
// =============================================================================

/** Subdirectories created under the agent dir on first run. */
const AGENT_SUBDIRS = [
	"themes",
	"tools",
	"bin",
	"prompts",
	"sessions",
	"extensions",
	"skills",
] as const;

/**
 * Ensure the agent dir and standard subdirs exist (mode 0o700 for privacy).
 * Safe to call on every startup; no-op when dirs already exist.
 */
export function ensureAgentDir(agentDir: string = getAgentDir()): void {
	mkdirSync(agentDir, { recursive: true, mode: 0o700 });
	for (const sub of AGENT_SUBDIRS) {
		mkdirSync(join(agentDir, sub), { recursive: true, mode: 0o700 });
	}
}

/**
 * Seed a default config file from the bundled defaults dir if it does not yet
 * exist. Never overwrites an existing user file. Returns the destination path
 * when a seed was written, undefined when the file already existed or the
 * bundled source is missing.
 */
export function seedDefaultConfigFile(
	destPath: string,
	bundledName: string,
	bundledDefaultsDir: string = getBundledDefaultsDir(),
): string | undefined {
	if (existsSync(destPath)) return undefined;
	const source = join(bundledDefaultsDir, bundledName);
	if (!existsSync(source)) return undefined;
	mkdirSync(dirname(destPath), { recursive: true, mode: 0o700 });
	copyFileSync(source, destPath);
	try {
		chmodSync(destPath, 0o600);
	} catch {
		// chmod is best-effort (no-op on platforms that don't support it).
	}
	return destPath;
}

/**
 * Insert a top-level key into the root object of a JSON document without
 * touching any other bytes: the user's formatting, unknown keys, and trailing
 * whitespace survive verbatim. Returns the new document text, or undefined
 * when the root value is not a JSON object.
 */
function injectRootObjectKey(raw: string, key: string, value: unknown): string | undefined {
	let inString = false;
	let escaped = false;
	let depth = 0;
	let rootOpen = -1;
	let rootClose = -1;
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i]!;
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') {
			inString = true;
			continue;
		}
		if (ch === "{" || ch === "[") {
			if (depth === 0) rootOpen = i;
			depth++;
			continue;
		}
		if (ch === "}" || ch === "]") {
			depth--;
			if (depth < 0) return undefined;
			if (depth === 0 && ch === "}") {
				rootClose = i;
				break;
			}
		}
	}
	if (rootOpen === -1 || rootClose === -1 || raw[rootOpen] !== "{") return undefined;

	const keyJson = `${JSON.stringify(key)}: ${JSON.stringify(value)}`;
	let lastContentIndex = -1;
	for (let i = rootClose - 1; i > rootOpen; i--) {
		if (!/\s/.test(raw[i]!)) {
			lastContentIndex = i;
			break;
		}
	}
	if (lastContentIndex === -1) {
		// Empty root object: inject right after the opening brace.
		return `${raw.slice(0, rootOpen + 1)}${keyJson}${raw.slice(rootOpen + 1)}`;
	}
	// Append after the last content token, before the original whitespace run.
	return `${raw.slice(0, lastContentIndex + 1)}, ${keyJson}${raw.slice(lastContentIndex + 1)}`;
}

/**
 * Add bundled subagent defaults to an existing user settings file when that
 * top-level setting is absent. The file is modified with a minimal textual
 * insertion, so unrelated settings (including their formatting and unknown
 * keys) are preserved byte-for-byte. Invalid or non-object JSON, or a user
 * file that already configures `subagents`, is left untouched.
 */
export function seedMissingSubagentSettings(
	destPath: string,
	bundledDefaultsDir: string = getBundledDefaultsDir(),
): boolean {
	if (!existsSync(destPath)) return false;

	try {
		const raw = readFileSync(destPath, "utf-8");
		const settings = JSON.parse(raw) as unknown;
		const defaults = JSON.parse(readFileSync(join(bundledDefaultsDir, "settings.json"), "utf-8")) as unknown;
		if (
			typeof settings !== "object" ||
			settings === null ||
			Array.isArray(settings) ||
			Object.hasOwn(settings, "subagents") ||
			typeof defaults !== "object" ||
			defaults === null ||
			Array.isArray(defaults) ||
			!Object.hasOwn(defaults, "subagents")
		) {
			return false;
		}

		const injected = injectRootObjectKey(raw, "subagents", (defaults as Record<string, unknown>).subagents);
		if (injected === undefined) return false;
		writeFileSync(destPath, injected);
		return true;
	} catch {
		return false;
	}
}

/**
 * Recursively copy a bundled directory tree into the user's agent dir,
 * overwriting any existing file so the bundled copy stays authoritative.
 * Used to seed/sync bundled skills and themes. User-only files (not present in
 * the bundled tree) are left untouched. Returns the list of destination paths
 * that were written.
 */
function seedBundledDir(
	destDir: string,
	bundledDir: string,
): string[] {
	if (!existsSync(bundledDir)) return [];
	mkdirSync(destDir, { recursive: true, mode: 0o700 });
	const written: string[] = [];
	const stack: Array<{ src: string; dst: string }> = [{ src: bundledDir, dst: destDir }];
	while (stack.length > 0) {
		const { src, dst } = stack.pop()!;
		mkdirSync(dst, { recursive: true, mode: 0o700 });
		for (const entry of readdirSync(src, { withFileTypes: true })) {
			if (entry.name === ".DS_Store" || entry.name === "node_modules") continue;
			const srcPath = join(src, entry.name);
			const dstPath = join(dst, entry.name);
			if (entry.isDirectory()) {
				mkdirSync(dstPath, { recursive: true, mode: 0o700 });
				stack.push({ src: srcPath, dst: dstPath });
			} else if (entry.isFile() || entry.isSymbolicLink()) {
				copyFileSync(srcPath, dstPath);
				try {
					chmodSync(dstPath, 0o600);
				} catch {
					// best-effort
				}
				written.push(dstPath);
			}
		}
	}
	return written;
}

function removeIdenticalBundledFiles(destDir: string, bundledDir: string): string[] {
	if (!existsSync(destDir) || !existsSync(bundledDir)) return [];
	const removed: string[] = [];
	const stack: Array<{ src: string; dst: string }> = [{ src: bundledDir, dst: destDir }];
	while (stack.length > 0) {
		const { src, dst } = stack.pop()!;
		if (!existsSync(dst)) continue;
		for (const entry of readdirSync(src, { withFileTypes: true })) {
			if (entry.name === ".DS_Store" || entry.name === "node_modules") continue;
			const srcPath = join(src, entry.name);
			const dstPath = join(dst, entry.name);
			if (entry.isDirectory()) {
				stack.push({ src: srcPath, dst: dstPath });
			} else if (existsSync(dstPath) && readFileSync(srcPath).equals(readFileSync(dstPath))) {
				unlinkSync(dstPath);
				removed.push(dstPath);
			}
		}
	}
	return removed;
}

/**
 * Bundled extensions load directly from the installed package. Do not copy them
 * into the user's agent dir, otherwise startup discovers both copies and tool
 * registration conflicts with itself.
 * Remove files copied by older releases only when they are byte-identical to
 * bundled files, so user-edited extensions survive.
 */
export function seedDefaultExtensions(
	agentDir: string,
	bundledExtensionsDir: string = getBundledExtensionsDir(),
): string[] {
	removeIdenticalBundledFiles(join(agentDir, "extensions"), bundledExtensionsDir);
	return [];
}

/**
 * Seed bundled built-in skills into the user's agent dir/skills.
 * The bundled copy is authoritative: existing user copies are overwritten so a
 * stale installed copy never shadows the shipped skill. User-only skills (not
 * present in the bundled tree) are left untouched. Returns the list of
 * destination paths that were written.
 */
export function seedDefaultSkills(
	agentDir: string,
	bundledSkillsDir: string = getBundledSkillsDir(),
): string[] {
	return seedBundledDir(join(agentDir, "skills"), bundledSkillsDir);
}

/**
 * Seed bundled built-in themes into the user's agent dir/themes.
 * Skips existing files (user edits survive). Never overwrites.
 * Returns the list of destination paths that were written.
 */
export function seedDefaultThemes(
	agentDir: string,
	bundledThemesDir: string = getBundledThemesDir(),
): string[] {
	return seedBundledDir(join(agentDir, "themes"), bundledThemesDir);
}

/**
 * Run bootstrap for the agent dir: ensure directories, seed a missing
 * settings.json, and add missing bundled subagent defaults. Idempotent — safe
 * on every startup.
 * Bundled models load package-locally; copying them would expose internal
 * providers as user config. Bundled extensions also stay package-local.
 */
export function bootstrapAgentDir(agentDir: string = getAgentDir()): void {
	ensureAgentDir(agentDir);
	const settingsPath = join(agentDir, "settings.json");
	seedDefaultConfigFile(settingsPath, "settings.json");
	seedMissingSubagentSettings(settingsPath);
	seedDefaultExtensions(agentDir);
	seedDefaultSkills(agentDir);
	seedDefaultThemes(agentDir);
}
