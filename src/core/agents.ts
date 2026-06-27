import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { CONFIG_DIR_NAME } from "../config.ts";
import { parseFrontmatter } from "../utils/frontmatter.ts";
import { canonicalizePath, resolvePath } from "../utils/paths.ts";
import type { ResourceDiagnostic } from "./diagnostics.ts";
import { createSyntheticSourceInfo, type SourceInfo } from "./source-info.ts";
import { validateDescription, validateName } from "./skills.ts";

function toPosixPath(p: string): string {
	return p.split(sep).join("/");
}

export interface AgentFrontmatter {
	name?: string;
	description?: string;
	model?: string;
	skill?: string;
	tools?: string;
	systemPromptMode?: string;
	inheritProjectContext?: boolean;
	inheritSkills?: boolean;
	output?: string;
	defaultReads?: string;
	defaultContext?: string;
	[key: string]: unknown;
}

export interface AgentPersona {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	sourceInfo: SourceInfo;
	frontmatter: AgentFrontmatter;
}

export interface LoadAgentsResult {
	agents: AgentPersona[];
	diagnostics: ResourceDiagnostic[];
}

export interface LoadAgentsFromDirOptions {
	dir: string;
	source: string;
}

function createAgentSourceInfo(filePath: string, baseDir: string, source: string): SourceInfo {
	switch (source) {
		case "user":
			return createSyntheticSourceInfo(filePath, {
				source: "local",
				scope: "user",
				baseDir,
			});
		case "project":
			return createSyntheticSourceInfo(filePath, {
				source: "local",
				scope: "project",
				baseDir,
			});
		default:
			return createSyntheticSourceInfo(filePath, { source, baseDir });
	}
}

function isMarkdown(filePath: string): boolean {
	return extname(filePath).toLowerCase() === ".md";
}

/**
 * Load agent persona markdown files from a directory.
 * Only flat .md files at the top level are loaded (agents are not folder-based like skills).
 */
export function loadAgentsFromDir(options: LoadAgentsFromDirOptions): LoadAgentsResult {
	const { dir, source } = options;
	const agents: AgentPersona[] = [];
	const diagnostics: ResourceDiagnostic[] = [];

	if (!existsSync(dir)) {
		return { agents, diagnostics };
	}

	const root = dir;

	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name.startsWith(".") || entry.isDirectory()) {
				continue;
			}

			const fullPath = join(dir, entry.name);
			let isFile = entry.isFile();
			if (entry.isSymbolicLink()) {
				try {
					isFile = statSync(fullPath).isFile();
				} catch {
					continue;
				}
			}

			const relPath = toPosixPath(relative(root, fullPath));
			if (!isFile || !isMarkdown(fullPath)) {
				continue;
			}

			const result = loadAgentFromFile(fullPath, source);
			if (result.agent) {
				agents.push(result.agent);
			}
			diagnostics.push(...result.diagnostics);
		}
	} catch {}

	return { agents, diagnostics };
}

function loadAgentFromFile(
	filePath: string,
	source: string,
): { agent: AgentPersona | null; diagnostics: ResourceDiagnostic[] } {
	const diagnostics: ResourceDiagnostic[] = [];

	try {
		const rawContent = readFileSync(filePath, "utf-8");
		const { frontmatter } = parseFrontmatter<AgentFrontmatter>(rawContent);
		const baseDir = dirname(filePath);
		const fileName = basename(filePath, extname(filePath));

		const descErrors = validateDescription(frontmatter.description);
		for (const error of descErrors) {
			diagnostics.push({ type: "warning", message: error, path: filePath });
		}

		const name = frontmatter.name || fileName;
		const nameErrors = validateName(name);
		for (const error of nameErrors) {
			diagnostics.push({ type: "warning", message: error, path: filePath });
		}

		if (!frontmatter.description || frontmatter.description.trim() === "") {
			return { agent: null, diagnostics };
		}

		return {
			agent: {
				name,
				description: frontmatter.description,
				filePath,
				baseDir,
				sourceInfo: createAgentSourceInfo(filePath, baseDir, source),
				frontmatter,
			},
			diagnostics,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : "failed to parse agent file";
		diagnostics.push({ type: "warning", message, path: filePath });
		return { agent: null, diagnostics };
	}
}

/**
 * Format available agents for inclusion in the system prompt.
 * Tells the model which subagent personas exist and where to read them.
 */
export function formatAgentsForPrompt(agents: AgentPersona[]): string {
	if (agents.length === 0) {
		return "";
	}

	const lines = [
		"\n\nThe following subagent personas are available for delegated work.",
		"Use the read tool to load a persona's file when you need to act as that agent or spawn it via a subagent tool.",
		"",
		"<available_agents>",
	];

	for (const agent of agents) {
		lines.push("  <agent>");
		lines.push(`    <name>${escapeXml(agent.name)}</name>`);
		lines.push(`    <description>${escapeXml(agent.description)}</description>`);
		lines.push(`    <location>${escapeXml(agent.filePath)}</location>`);
		lines.push("  </agent>");
	}

	lines.push("</available_agents>");

	return lines.join("\n");
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

export interface LoadAgentsOptions {
	cwd: string;
	agentDir: string;
	agentPaths: string[];
	includeDefaults: boolean;
}

/**
 * Load agent personas from all configured locations.
 */
export function loadAgents(options: LoadAgentsOptions): LoadAgentsResult {
	const { agentDir, agentPaths, includeDefaults } = options;
	const resolvedCwd = resolvePath(options.cwd);
	const resolvedAgentDir = resolvePath(agentDir ?? "");

	const agentMap = new Map<string, AgentPersona>();
	const realPathSet = new Set<string>();
	const allDiagnostics: ResourceDiagnostic[] = [];
	const collisionDiagnostics: ResourceDiagnostic[] = [];

	function addAgents(result: LoadAgentsResult) {
		allDiagnostics.push(...result.diagnostics);
		for (const agent of result.agents) {
			const realPath = canonicalizePath(agent.filePath);
			if (realPathSet.has(realPath)) {
				continue;
			}
			const existing = agentMap.get(agent.name);
			if (existing) {
				collisionDiagnostics.push({
					type: "collision",
					message: `name "${agent.name}" collision`,
					path: agent.filePath,
					collision: {
						resourceType: "agent",
						name: agent.name,
						winnerPath: existing.filePath,
						loserPath: agent.filePath,
					},
				});
			} else {
				agentMap.set(agent.name, agent);
				realPathSet.add(realPath);
			}
		}
	}

	if (includeDefaults) {
		addAgents(loadAgentsFromDir({ dir: join(resolvedAgentDir, "agents"), source: "user" }));
		addAgents(loadAgentsFromDir({ dir: resolve(resolvedCwd, CONFIG_DIR_NAME, "agents"), source: "project" }));
	}

	const userAgentsDir = join(resolvedAgentDir, "agents");
	const projectAgentsDir = resolve(resolvedCwd, CONFIG_DIR_NAME, "agents");

	const isUnderPath = (target: string, root: string): boolean => {
		const normalizedRoot = resolve(root);
		if (target === normalizedRoot) return true;
		const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
		return target.startsWith(prefix);
	};

	const getSource = (resolvedPath: string): "user" | "project" | "path" => {
		if (!includeDefaults) {
			if (isUnderPath(resolvedPath, userAgentsDir)) return "user";
			if (isUnderPath(resolvedPath, projectAgentsDir)) return "project";
		}
		return "path";
	};

	for (const rawPath of agentPaths) {
		const resolvedPath = resolvePath(rawPath, resolvedCwd, { trim: true });
		if (!existsSync(resolvedPath)) {
			allDiagnostics.push({ type: "warning", message: "agent path does not exist", path: resolvedPath });
			continue;
		}

		try {
			const stats = statSync(resolvedPath);
			const source = getSource(resolvedPath);
			if (stats.isDirectory()) {
				addAgents(loadAgentsFromDir({ dir: resolvedPath, source }));
			} else if (stats.isFile() && isMarkdown(resolvedPath)) {
				const result = loadAgentFromFile(resolvedPath, source);
				if (result.agent) {
					addAgents({ agents: [result.agent], diagnostics: result.diagnostics });
				} else {
					allDiagnostics.push(...result.diagnostics);
				}
			} else {
				allDiagnostics.push({ type: "warning", message: "agent path is not a markdown file", path: resolvedPath });
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : "failed to read agent path";
			allDiagnostics.push({ type: "warning", message, path: resolvedPath });
		}
	}

	return {
		agents: Array.from(agentMap.values()),
		diagnostics: [...allDiagnostics, ...collisionDiagnostics],
	};
}