import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";

const BLOCK_TOOLS = ["read", "write", "edit"];
const SHELL_TOOLS = ["bash"];
const SHELL_READERS = [
	"cat",
	"type",
	"less",
	"more",
	"head",
	"tail",
	"sed",
	"awk",
	"grep",
	"rg",
	"python",
	"python3",
	"py",
	"node",
	"ruby",
	"perl",
	"pwsh",
	"powershell",
	"Get-Content",
];
const SCRIPT_EXTENSIONS = [".js", ".cjs", ".mjs", ".ts", ".py", ".rb", ".pl", ".sh", ".bash", ".ps1"];
const ALLOW_PATTERNS = ["*.example", "*.local", "*.dev"];

export default function (pi: ExtensionAPI) {
	const cache = new Map<string, boolean>();

	pi.on("tool_call", async (event, ctx) => {
		const cwd = ctx.cwd;

		if (BLOCK_TOOLS.includes(event.toolName)) {
			const rawPath = event.input.path as string | undefined;
			if (!rawPath) return;

			const rel = pathRelativeToCwd(rawPath, cwd);
			if (rel === undefined || isAllowed(rel)) return;

			if (await isIgnored(cwd, rel, cache)) {
				if (ctx.hasUI) {
					ctx.ui.notify(`Blocked ${event.toolName} to gitignored path: ${rel}`, "warning");
				}
				return blockedReason(event.toolName, rel);
			}
			return;
		}

		if (SHELL_TOOLS.includes(event.toolName)) {
			const command = event.input.command as string | undefined;
			if (!command) return;

			for (const rawPath of commandPathCandidates(command)) {
				const rel = pathRelativeToCwd(rawPath, cwd);
				if (rel === undefined || isAllowed(rel)) continue;

				if ((usesShellReader(command) || isScriptPath(rel)) && (await isIgnored(cwd, rel, cache))) {
					if (ctx.hasUI) {
						ctx.ui.notify(`Blocked ${event.toolName} access to gitignored path: ${rel}`, "warning");
					}
					return blockedReason(event.toolName, rel);
				}
			}
		}
	});
}

function isAllowed(rel: string): boolean {
	return ALLOW_PATTERNS.some((p) => rel === p || rel.endsWith(`/${p}`));
}

function blockedReason(toolName: string, rel: string) {
	return {
		block: true,
		reason: `You are not allowed to use ${toolName} to access gitignored path "${rel}". It may contain secrets. Stop trying to read it.`,
	};
}

function usesShellReader(command: string): boolean {
	return SHELL_READERS.some((reader) => new RegExp(`(^|[^\\w.-])${escapeRegExp(reader)}([^\\w.-]|$)`, "i").test(command));
}

function commandPathCandidates(command: string): string[] {
	return [...command.matchAll(/[A-Za-z0-9_./\\-]+/g)]
		.map((match) => match[0])
		.filter((token) => !token.startsWith("-") && (token.includes("/") || token.includes("\\") || token.startsWith(".") || isScriptPath(token)));
}

function isScriptPath(path: string): boolean {
	return SCRIPT_EXTENSIONS.some((extension) => path.toLowerCase().endsWith(extension));
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pathRelativeToCwd(rawPath: string, cwd: string): string | undefined {
	const abs = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
	const rel = relative(cwd, abs);
	if (rel.startsWith(`..${sep}`) || rel === "..") return undefined;
	return rel.replace(/\\/g, "/");
}

async function isIgnored(cwd: string, relPath: string, cache: Map<string, boolean>): Promise<boolean> {
	const key = `${cwd}::${relPath}`;
	const cached = cache.get(key);
	if (cached !== undefined) return cached;

	const ignored = await gitCheckIgnore(cwd, relPath);
	cache.set(key, ignored);
	return ignored;
}

function gitCheckIgnore(cwd: string, relPath: string): Promise<boolean> {
	return new Promise((resolve) => {
		let resolved = false;
		const finish = (result: boolean) => {
			if (resolved) return;
			resolved = true;
			resolve(result);
		};

		const child = spawn("git", ["check-ignore", "--quiet", relPath], { cwd, shell: false });
		child.on("exit", (code) => finish(code === 0));
		child.on("error", () => finish(false));
		setTimeout(() => finish(false), 2000).unref();
	});
}
