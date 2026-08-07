import { createHash } from "node:crypto";
import chalk from "chalk";
import { type SpawnSyncReturns, spawnSync } from "child_process";
import { chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "fs";
import { arch, platform } from "os";
import { join } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { APP_NAME, getBinDir } from "../config.ts";

const TOOLS_DIR = getBinDir();
const NETWORK_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

function isOfflineModeEnabled(): boolean {
	const value = process.env.PI_OFFLINE;
	if (!value) return false;
	return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

export type ManagedTool = "fd" | "rg" | "rtk";

interface ToolConfig {
	name: string;
	repo: string; // GitHub repo (e.g., "sharkdp/fd")
	binaryName: string; // Name of the binary inside the archive
	systemBinaryNames?: string[]; // Alternative system command names to try before downloading
	tagPrefix: string; // Prefix for tags (e.g., "v" for v1.0.0, "" for 1.0.0)
	pinnedVersion?: string;
	checksumAssetName?: string;
	getAssetName: (version: string, plat: string, architecture: string) => string | null;
	/** Verify an existing binary (managed dir or system PATH) before reusing it. */
	verify?: (binaryPath: string) => boolean;
}

const TOOLS: Record<ManagedTool, ToolConfig> = {
	fd: {
		name: "fd",
		repo: "sharkdp/fd",
		binaryName: "fd",
		systemBinaryNames: ["fd", "fdfind"],
		tagPrefix: "v",
		getAssetName: (version, plat, architecture) => {
			if (plat === "darwin") {
				const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
				return `fd-v${version}-${archStr}-apple-darwin.tar.gz`;
			} else if (plat === "linux") {
				const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
				return `fd-v${version}-${archStr}-unknown-linux-gnu.tar.gz`;
			} else if (plat === "win32") {
				const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
				return `fd-v${version}-${archStr}-pc-windows-msvc.zip`;
			}
			return null;
		},
	},
	rg: {
		name: "ripgrep",
		repo: "BurntSushi/ripgrep",
		binaryName: "rg",
		tagPrefix: "",
		getAssetName: (version, plat, architecture) => {
			if (plat === "darwin") {
				const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
				return `ripgrep-${version}-${archStr}-apple-darwin.tar.gz`;
			} else if (plat === "linux") {
				if (architecture === "arm64") {
					return `ripgrep-${version}-aarch64-unknown-linux-gnu.tar.gz`;
				}
				return `ripgrep-${version}-x86_64-unknown-linux-musl.tar.gz`;
			} else if (plat === "win32") {
				const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
				return `ripgrep-${version}-${archStr}-pc-windows-msvc.zip`;
			}
			return null;
		},
	},
	rtk: {
		name: "rtk",
		repo: "rtk-ai/rtk",
		binaryName: "rtk",
		systemBinaryNames: ["rtk"],
		tagPrefix: "v",
		pinnedVersion: "0.42.4",
		checksumAssetName: "checksums.txt",
		getAssetName: (version, plat, architecture) => {
			if (plat === "darwin") {
				const archStr = architecture === "arm64" ? "aarch64" : architecture === "x64" ? "x86_64" : null;
				return archStr ? `rtk-${archStr}-apple-darwin.tar.gz` : null;
			}
			if (plat === "linux") {
				if (architecture === "arm64") return `rtk-aarch64-unknown-linux-gnu.tar.gz`;
				if (architecture === "x64") return `rtk-x86_64-unknown-linux-musl.tar.gz`;
				return null;
			}
			if (plat === "win32" && architecture === "x64") return `rtk-x86_64-pc-windows-msvc.zip`;
			return null;
		},
		// Rust Type Kit uses the same command name. Accept only rtk-ai/rtk
		// (0.23.0+ because `rtk rewrite` was introduced then, and `rtk gain`
		// is the upstream Token Killer identity check).
		verify: (path) => {
			const versionResult = spawnSync(path, ["--version"], { stdio: "pipe" });
			if (versionResult.error || versionResult.status !== 0) return false;
			const m = versionResult.stdout?.toString().match(/(\d+)\.(\d+)\.(\d+)/);
			if (!m) return false;
			const major = parseInt(m[1], 10);
			const minor = parseInt(m[2], 10);
			if (major === 0 && minor < 23) return false;
			const gainResult = spawnSync(path, ["gain"], { stdio: "pipe" });
			return !gainResult.error && gainResult.status === 0;
		},
	},
};

// Check if a command exists in PATH by trying to run it
function commandExists(cmd: string): boolean {
	try {
		const result = spawnSync(cmd, ["--version"], { stdio: "pipe" });
		// Check for ENOENT error (command not found)
		return result.error === undefined || result.error === null;
	} catch {
		return false;
	}
}

// Get the path to a tool (system-wide or in our tools dir)
export function getToolPath(tool: ManagedTool): string | null {
	const config = TOOLS[tool];
	if (!config) return null;

	// Check our tools directory first
	const localPath = join(TOOLS_DIR, config.binaryName + (platform() === "win32" ? ".exe" : ""));
	if (existsSync(localPath)) {
		return localPath;
	}

	// Check system PATH - if found, just return the command name (it's in PATH)
	const systemBinaryNames = config.systemBinaryNames ?? [config.binaryName];
	for (const systemBinaryName of systemBinaryNames) {
		if (commandExists(systemBinaryName)) {
			return systemBinaryName;
		}
	}

	return null;
}

// Fetch latest release version from GitHub
async function getLatestVersion(repo: string): Promise<string> {
	const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
		headers: { "User-Agent": `${APP_NAME}-coding-agent` },
		signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
	});

	if (!response.ok) {
		throw new Error(`GitHub API error: ${response.status}`);
	}

	const data = (await response.json()) as { tag_name: string };
	return data.tag_name.replace(/^v/, "");
}

// Download a file from URL
async function downloadFile(url: string, dest: string): Promise<void> {
	const response = await fetch(url, {
		signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
	});

	if (!response.ok) {
		throw new Error(`Failed to download: ${response.status}`);
	}

	if (!response.body) {
		throw new Error("No response body");
	}

	const fileStream = createWriteStream(dest);
	await pipeline(Readable.fromWeb(response.body as any), fileStream);
}

async function downloadText(url: string): Promise<string> {
	const response = await fetch(url, {
		signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`Failed to download: ${response.status}`);
	return response.text();
}

function verifySha256(filePath: string, checksums: string, assetName: string): void {
	const checksumLine = checksums
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => {
			const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
			return match?.[2].trim() === assetName;
		});
	const expected = checksumLine?.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/)?.[1];
	if (!expected) throw new Error(`Checksum for ${assetName} was not found in the release checksums.`);

	const actual = createHash("sha256").update(readFileSync(filePath)).digest("hex");
	if (actual.toLowerCase() !== expected.toLowerCase()) {
		throw new Error(`Checksum mismatch for ${assetName}.`);
	}
}

function findBinaryRecursively(rootDir: string, binaryFileName: string): string | null {
	const stack: string[] = [rootDir];

	while (stack.length > 0) {
		const currentDir = stack.pop();
		if (!currentDir) continue;

		const entries = readdirSync(currentDir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = join(currentDir, entry.name);
			if (entry.isFile() && entry.name === binaryFileName) {
				return fullPath;
			}
			if (entry.isDirectory()) {
				stack.push(fullPath);
			}
		}
	}

	return null;
}

function formatSpawnFailure(result: SpawnSyncReturns<Buffer>): string {
	if (result.error?.message) {
		return result.error.message;
	}
	const stderr = result.stderr?.toString().trim();
	if (stderr) {
		return stderr;
	}
	const stdout = result.stdout?.toString().trim();
	if (stdout) {
		return stdout;
	}
	return `exit status ${result.status ?? "unknown"}`;
}

function runExtractionCommand(command: string, args: string[]): string | null {
	const result = spawnSync(command, args, { stdio: "pipe" });
	if (!result.error && result.status === 0) {
		return null;
	}
	return `${command}: ${formatSpawnFailure(result)}`;
}

function extractTarGzArchive(archivePath: string, extractDir: string, assetName: string): void {
	const failure = runExtractionCommand("tar", ["xzf", archivePath, "-C", extractDir]);
	if (failure) {
		throw new Error(`Failed to extract ${assetName}: ${failure}`);
	}
}

function getWindowsTarCommand(): string {
	const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
	if (systemRoot) {
		const systemTar = join(systemRoot, "System32", "tar.exe");
		if (existsSync(systemTar)) {
			return systemTar;
		}
	}
	return "tar.exe";
}

function extractZipArchive(archivePath: string, extractDir: string, assetName: string): void {
	const failures: string[] = [];

	if (platform() === "win32") {
		// Windows ships bsdtar as tar.exe, which supports zip files. Prefer the
		// System32 binary over Git Bash's GNU tar, which does not handle zip archives.
		const tarFailure = runExtractionCommand(getWindowsTarCommand(), ["xf", archivePath, "-C", extractDir]);
		if (!tarFailure) return;
		failures.push(tarFailure);

		const script =
			"& { param($archive, $destination) $ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force }";
		const powershellFailure = runExtractionCommand("powershell.exe", [
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-Command",
			script,
			archivePath,
			extractDir,
		]);
		if (!powershellFailure) return;
		failures.push(powershellFailure);
	} else {
		const unzipFailure = runExtractionCommand("unzip", ["-q", archivePath, "-d", extractDir]);
		if (!unzipFailure) return;
		failures.push(unzipFailure);

		const tarFailure = runExtractionCommand("tar", ["xf", archivePath, "-C", extractDir]);
		if (!tarFailure) return;
		failures.push(tarFailure);
	}

	throw new Error(`Failed to extract ${assetName}: ${failures.join("; ")}`);
}

// Download and install a tool
async function downloadTool(tool: ManagedTool): Promise<string> {
	const config = TOOLS[tool];
	if (!config) throw new Error(`Unknown tool: ${tool}`);

	const plat = platform();
	const architecture = arch();

	// Get the pinned release when one is required; otherwise use the latest release.
	let version = config.pinnedVersion ?? (await getLatestVersion(config.repo));
	if (tool === "fd" && plat === "darwin" && architecture === "x64") {
		version = "10.3.0";
	}

	// Get asset name for this platform
	const assetName = config.getAssetName(version, plat, architecture);
	if (!assetName) {
		throw new Error(`Unsupported platform: ${plat}/${architecture}`);
	}

	// Create tools directory
	mkdirSync(TOOLS_DIR, { recursive: true });

	const releaseTag = `${config.tagPrefix}${version}`;
	const downloadUrl = `https://github.com/${config.repo}/releases/download/${releaseTag}/${assetName}`;
	const archivePath = join(TOOLS_DIR, assetName);
	const binaryExt = plat === "win32" ? ".exe" : "";
	const binaryPath = join(TOOLS_DIR, config.binaryName + binaryExt);

	// Download and verify before extracting any executable.
	try {
		await downloadFile(downloadUrl, archivePath);
		if (config.checksumAssetName) {
			const checksumsUrl = `https://github.com/${config.repo}/releases/download/${releaseTag}/${config.checksumAssetName}`;
			verifySha256(archivePath, await downloadText(checksumsUrl), assetName);
		}

		// Extract into a unique temp directory. Downloads can run concurrently
		// during startup, so sharing a fixed directory causes races.
		const extractDir = join(
			TOOLS_DIR,
			`extract_tmp_${config.binaryName}_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
		);
		mkdirSync(extractDir, { recursive: true });

		try {
			if (assetName.endsWith(".tar.gz")) {
				extractTarGzArchive(archivePath, extractDir, assetName);
			} else if (assetName.endsWith(".zip")) {
				extractZipArchive(archivePath, extractDir, assetName);
			} else {
				throw new Error(`Unsupported archive format: ${assetName}`);
			}

			// Find the binary in extracted files. Some archives contain files directly
			// at root, others nest under a versioned subdirectory.
			const binaryFileName = config.binaryName + binaryExt;
			const extractedDir = join(extractDir, assetName.replace(/\.(tar\.gz|zip)$/, ""));
			const extractedBinaryCandidates = [join(extractedDir, binaryFileName), join(extractDir, binaryFileName)];
			let extractedBinary = extractedBinaryCandidates.find((candidate) => existsSync(candidate));

			if (!extractedBinary) {
				extractedBinary = findBinaryRecursively(extractDir, binaryFileName) ?? undefined;
			}

			if (extractedBinary) {
				renameSync(extractedBinary, binaryPath);
			} else {
				throw new Error(`Binary not found in archive: expected ${binaryFileName} under ${extractDir}`);
			}

			// Make executable (Unix only)
			if (plat !== "win32") {
				chmodSync(binaryPath, 0o755);
			}
		} finally {
			rmSync(extractDir, { recursive: true, force: true });
		}
	} finally {
		// Cleanup partial downloads as well as successful ones.
		rmSync(archivePath, { force: true });
	}

	return binaryPath;
}

// Termux package names for tools
const TERMUX_PACKAGES: Record<string, string> = {
	fd: "fd",
	rg: "ripgrep",
};

// Ensure a tool is available, downloading if necessary
// Returns the path to the tool, or null if unavailable
export async function ensureTool(tool: ManagedTool, silent: boolean = false): Promise<string | undefined> {
	const config = TOOLS[tool];
	if (!config) return undefined;

	// Prefer an existing binary that passes the optional identity/version check.
	// A mismatched binary (e.g. the Rust Type Kit named rtk) is replaced by a
	// fresh managed download rather than being reused.
	const existingPath = getToolPath(tool);
	if (existingPath) {
		if (!config.verify || config.verify(existingPath)) {
			return existingPath;
		}
		if (!silent) {
			console.log(chalk.yellow(`${config.name} found but failed verification; installing managed binary.`));
		}
	}

	if (isOfflineModeEnabled()) {
		if (!silent) {
			console.log(chalk.yellow(`${config.name} not found. Offline mode enabled, skipping download.`));
		}
		return undefined;
	}

	// On Android/Termux, Linux binaries don't work due to Bionic libc incompatibility.
	// Users must install via pkg.
	if (platform() === "android") {
		const pkgName = TERMUX_PACKAGES[tool] ?? tool;
		if (!silent) {
			console.log(chalk.yellow(`${config.name} not found. Install with: pkg install ${pkgName}`));
		}
		return undefined;
	}

	// Tool not found - download it
	if (!silent) {
		console.log(chalk.dim(`${config.name} not found. Downloading...`));
	}

	try {
		const path = await downloadTool(tool);
		if (!silent) {
			console.log(chalk.dim(`${config.name} installed to ${path}`));
		}
		return path;
	} catch (e) {
		if (!silent) {
			console.log(chalk.yellow(`Failed to download ${config.name}: ${e instanceof Error ? e.message : e}`));
		}
		return undefined;
	}
}
