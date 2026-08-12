import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@selesai/code";
import { parseFrontmatter } from "../agents/frontmatter.ts";
import { discoverAgents, discoverAgentsAll, resolveAgentName, type ChainConfig, type ChainStepConfig } from "../agents/agents.ts";
import type { SubagentParamsLike } from "../runs/foreground/subagent-executor.ts";
import type { ChainStep } from "../shared/settings.ts";
import { getPromptDirectories } from "../shared/prompt-resources.ts";

interface PromptWorkflow {
	name: string;
	description: string;
	body: string;
	filePath: string;
	agent: string;
	context?: "fresh" | "fork";
	model?: string;
	skill?: string | string[] | false;
	cwd?: string;
	chain?: string;
}

type PromptWorkflowRunner = (params: SubagentParamsLike, ctx: ExtensionContext) => Promise<void>;

const RESERVED_COMMAND_NAMES = new Set([
	"chain-prompts",
	"prompt-workflow",
	"run",
	"chain",
	"parallel",
	"run-chain",
	"subagents-doctor",
	"subagents-models",
]);

function readPromptFiles(cwd: string): string[] {
	const files: string[] = [];
	for (const dir of Object.values(getPromptDirectories(cwd))) {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (entry.isFile() && entry.name.endsWith(".md")) files.push(path.join(dir, entry.name));
		}
	}
	return files;
}

function firstNonEmptyLine(value: string): string {
	return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "Prompt workflow";
}

function stringField(frontmatter: Record<string, string>, key: string): string | undefined {
	const value = frontmatter[key]?.trim();
	return value ? value : undefined;
}

function booleanField(frontmatter: Record<string, string>, key: string): boolean | undefined {
	const value = frontmatter[key]?.trim().toLowerCase();
	if (value === "true" || value === "yes" || value === "1") return true;
	if (value === "false" || value === "no" || value === "0") return false;
	return undefined;
}

function parseSkill(value: string | undefined): string | string[] | false | undefined {
	if (!value) return undefined;
	if (value === "false") return false;
	const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
	return parts.length > 1 ? parts : parts[0];
}

function parseAgent(frontmatter: Record<string, string>): string {
	const subagent = stringField(frontmatter, "subagent");
	if (!subagent || subagent === "true") return "delegate";
	return subagent;
}

function loadPromptWorkflow(filePath: string): PromptWorkflow | undefined {
	const content = fs.readFileSync(filePath, "utf-8");
	const { frontmatter, body } = parseFrontmatter(content);
	const name = path.basename(filePath, ".md");
	if (!name || RESERVED_COMMAND_NAMES.has(name)) return undefined;
	const model = stringField(frontmatter, "model");
	const skill = parseSkill(stringField(frontmatter, "skill"));
	const cwd = stringField(frontmatter, "cwd");
	const chain = stringField(frontmatter, "chain");
	return {
		name,
		description: stringField(frontmatter, "description") ?? firstNonEmptyLine(body),
		body,
		filePath,
		agent: parseAgent(frontmatter),
		...(booleanField(frontmatter, "inheritContext") === true || booleanField(frontmatter, "fork") === true ? { context: "fork" as const } : {}),
		...(booleanField(frontmatter, "fresh") === true ? { context: "fresh" as const } : {}),
		...(model ? { model } : {}),
		...(skill !== undefined ? { skill } : {}),
		...(cwd ? { cwd } : {}),
		...(chain ? { chain } : {}),
	};
}

export function discoverPromptWorkflows(cwd: string): PromptWorkflow[] {
	const workflows = new Map<string, PromptWorkflow>();
	for (const file of readPromptFiles(cwd)) {
		const workflow = loadPromptWorkflow(file);
		if (workflow) workflows.set(workflow.name, workflow);
	}
	return [...workflows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function shellWords(input: string): string[] {
	const words: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	let escaped = false;
	for (const ch of input) {
		if (escaped) {
			current += ch;
			escaped = false;
			continue;
		}
		if (ch === "\\") {
			escaped = true;
			continue;
		}
		if (quote) {
			if (ch === quote) quote = undefined;
			else current += ch;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			continue;
		}
		if (/\s/.test(ch)) {
			if (current) {
				words.push(current);
				current = "";
			}
			continue;
		}
		current += ch;
	}
	if (current) words.push(current);
	return words;
}

function substituteArgs(template: string, args: string[]): string {
	const all = args.join(" ");
	return template
		.replace(/\$ARGUMENTS/g, all)
		.replace(/\$@/g, all)
		.replace(/\$\{(\d+):-([^}]*)\}/g, (_match, index: string, fallback: string) => args[Number(index) - 1] || fallback)
		.replace(/\$(\d+)/g, (_match, index: string) => args[Number(index) - 1] ?? "");
}

function parseRuntimeOptions(words: string[]): { args: string[]; agentOverride?: string; fork?: boolean; fresh?: boolean; bg?: boolean } {
	const args: string[] = [];
	let agentOverride: string | undefined;
	let fork = false;
	let fresh = false;
	let bg = false;
	for (let i = 0; i < words.length; i++) {
		const word = words[i]!;
		if (word === "--fork") {
			fork = true;
			continue;
		}
		if (word === "--fresh") {
			fresh = true;
			continue;
		}
		if (word === "--bg" || word === "--async") {
			bg = true;
			continue;
		}
		if (word === "--subagent") {
			agentOverride = words[++i];
			continue;
		}
		const eq = word.match(/^--subagent(?:=|:)(.+)$/);
		if (eq) {
			agentOverride = eq[1];
			continue;
		}
		args.push(word);
	}
	return { args, agentOverride, fork, fresh, bg };
}


function splitPromptChain(input: string): string[] {
	return input.split(" -> ").map((part) => part.trim()).filter(Boolean);
}

function workflowParams(workflow: PromptWorkflow, args: string[], runtime: ReturnType<typeof parseRuntimeOptions>): SubagentParamsLike {
	const task = substituteArgs(workflow.body, args).trim();
	const context = runtime.fork ? "fork" : runtime.fresh ? "fresh" : workflow.context;
	return {
		agent: runtime.agentOverride ?? workflow.agent,
		task,
		agentScope: "both",
		...(context ? { context } : {}),
		...(workflow.model ? { model: workflow.model } : {}),
		...(workflow.skill !== undefined ? { skill: workflow.skill } : {}),
		...(workflow.cwd ? { cwd: workflow.cwd } : {}),
	};
}

function promptWorkflowExecutionParams(workflows: PromptWorkflow[], args: string[], runtime: ReturnType<typeof parseRuntimeOptions>): SubagentParamsLike {
	return {
		workflowScript: promptWorkflowScript(workflows, args, runtime),
		agentScope: "both",
		async: runtime.bg ? true : false,
	};
}

function promptWorkflowScript(workflows: PromptWorkflow[], args: string[], runtime: ReturnType<typeof parseRuntimeOptions>): string {
	const launches = workflows.map((workflow, index) => {
		const params = workflowParams(workflow, args, runtime);
		const task = params.task ?? "";
		const child = {
			agent: params.agent ?? "delegate",
			task,
			...(params.model ? { model: params.model } : {}),
			...(params.skill !== undefined ? { skill: params.skill } : {}),
			...(params.cwd ? { cwd: params.cwd } : {}),
			...(params.context ? { context: params.context } : {}),
		};
		return `const step${index} = await runs.run(${JSON.stringify(`prompt-${index + 1}-${workflow.name}`)}, { ...${JSON.stringify(child)}, task: ${JSON.stringify(task)}.replaceAll("{previous}", previous) });\nprevious = step${index}.output;`;
	});
	return `let previous = "";\n${launches.join("\n")}\nreturn previous;`;
}

function findWorkflow(workflows: PromptWorkflow[], name: string): PromptWorkflow | undefined {
	return workflows.find((workflow) => workflow.name === name);
}

function formatWorkflowList(workflows: PromptWorkflow[]): string {
	if (workflows.length === 0) return "No prompt workflows found in package, user, or project prompts.";
	return [
		"Prompt workflows:",
		...workflows.map((workflow) => `- ${workflow.name}: ${workflow.description} (${workflow.filePath})`),
	].join("\n");
}

// --- Selesai additions: native chain / parallel / saved-chain slash commands ---

/**
 * Parse `agent task | agent task | ...` into chain steps. Runtime flags
 * (`--bg`, `--fork`, `--fresh`) are stripped before splitting on `|`.
 */
function parseStepList(input: string): { agent: string; task: string }[] {
	const words = shellWords(input);
	const args: string[] = [];
	let fork = false;
	let fresh = false;
	let bg = false;
	for (let i = 0; i < words.length; i++) {
		const word = words[i]!;
		if (word === "--fork") { fork = true; continue; }
		if (word === "--fresh") { fresh = true; continue; }
		if (word === "--bg" || word === "--async") { bg = true; continue; }
		args.push(word);
	}
	const steps: { agent: string; task: string }[] = [];
	let current = "";
	for (const word of args) {
		if (word === "|") {
			if (current.trim()) steps.push(parseStep(current));
			current = "";
			continue;
		}
		current += (current ? " " : "") + word;
	}
	if (current.trim()) steps.push(parseStep(current));
	return steps.map((step) => ({ ...step, ...(fork ? { context: "fork" as const } : {}), ...(fresh ? { context: "fresh" as const } : {}) }));
}

function parseStep(stepText: string): { agent: string; task: string } {
	const space = stepText.indexOf(" ");
	if (space === -1) return { agent: stepText, task: "" };
	return { agent: stepText.slice(0, space), task: stepText.slice(space + 1).trim() };
}

function resolveStepsAgents(steps: { agent: string; task: string }[], cwd: string): { agent: string; task: string }[] {
	const agents = discoverAgents(cwd, "both").agents;
	return steps.map((step) => {
		const resolved = resolveAgentName(step.agent, agents);
		if (resolved.error || !resolved.agent) throw new Error(`Unknown agent: ${step.agent}`);
		return { agent: resolved.agent.name, task: step.task };
	});
}

function normalizeChainStep(step: ChainStepConfig): Record<string, unknown> {
	const normalized: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(step)) {
		if (value === undefined) continue;
		if (key === "skills") {
			if (value !== false) normalized.skill = value;
			continue;
		}
		normalized[key] = value;
	}
	return normalized;
}

function formatChainList(chains: ChainConfig[]): string {
	if (chains.length === 0) return "No saved chains found in user or project chains.";
	return [
		"Saved chains:",
		...chains.map((chain) => `- ${chain.name}: ${chain.description ?? chain.filePath}`),
	].join("\n");
}

export function registerPromptWorkflowCommands(input: {
	pi: ExtensionAPI;
	run: PromptWorkflowRunner;
}): void {
	const { pi, run } = input;

	pi.registerCommand("prompt-workflow", {
		description: "Run a prompt template through native pi-subagents: /prompt-workflow <name> [args]",
		handler: async (rawArgs, ctx) => {
			const words = shellWords(rawArgs);
			const name = words.shift();
			const workflows = discoverPromptWorkflows(ctx.cwd);
			if (!name || name === "list") {
				pi.sendMessage({ content: formatWorkflowList(workflows), display: true } as Parameters<typeof pi.sendMessage>[0]);
				return;
			}
			const workflow = findWorkflow(workflows, name);
			if (!workflow) {
				ctx.ui.notify(`Unknown prompt workflow: ${name}`, "error");
				return;
			}
			const runtime = parseRuntimeOptions(words);
			try {
				if (workflow.chain) {
					const chain = splitPromptChain(workflow.chain).map((stepName) => {
						const step = findWorkflow(workflows, stepName);
						if (!step) throw new Error(`Unknown prompt workflow in chain '${workflow.name}': ${stepName}`);
						return step;
					});
					await run(promptWorkflowExecutionParams(chain, runtime.args, runtime), ctx);
					return;
				}
				await run(promptWorkflowExecutionParams([workflow], runtime.args, runtime), ctx);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("chain", {
		description: "Launch a chain of steps: /chain <agent> <task> | <agent> <task> [--bg] [--fork] [--fresh]",
		handler: async (rawArgs, ctx) => {
			try {
				const steps = resolveStepsAgents(parseStepList(rawArgs), ctx.cwd);
				if (steps.length === 0) {
					ctx.ui.notify("Usage: /chain <agent> <task> | <agent> <task> [--bg] [--fork] [--fresh]", "error");
					return;
				}
				const bg = rawArgs.includes("--bg") || rawArgs.includes("--async");
				await run({ chain: steps as ChainStep[], agentScope: "both", ...(bg ? { async: true } : {}) }, ctx);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("parallel", {
		description: "Launch top-level parallel tasks: /parallel <agent> <task> | <agent> <task> [--bg]",
		handler: async (rawArgs, ctx) => {
			try {
				const steps = resolveStepsAgents(parseStepList(rawArgs), ctx.cwd);
				if (steps.length === 0) {
					ctx.ui.notify("Usage: /parallel <agent> <task> | <agent> <task> [--bg]", "error");
					return;
				}
				const bg = rawArgs.includes("--bg") || rawArgs.includes("--async");
				await run({ tasks: steps, agentScope: "both", ...(bg ? { async: true } : {}) }, ctx);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("run-chain", {
		description: "Run a saved .chain.md/.chain.json workflow: /run-chain <name> [--bg]",
		handler: async (rawArgs, ctx) => {
			const words = shellWords(rawArgs);
			const name = words.find((word) => !word.startsWith("--"));
			const bg = words.includes("--bg") || words.includes("--async");
			const chains = discoverAgentsAll(ctx.cwd).chains;
			if (!name || name === "list") {
				pi.sendMessage({ content: formatChainList(chains), display: true } as Parameters<typeof pi.sendMessage>[0]);
				return;
			}
			const chain = chains.find((candidate) => candidate.name === name || candidate.localName === name);
			if (!chain) {
				ctx.ui.notify(`Unknown saved chain: ${name}`, "error");
				return;
			}
			try {
				await run({ chain: chain.steps.map(normalizeChainStep) as unknown as ChainStep[], agentScope: "both", ...(bg ? { async: true } : {}) }, ctx);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("chain-prompts", {
		description: "Run a prompt template whose frontmatter declares a chain, as a native chain: /chain-prompts <name> [args]",
		handler: async (rawArgs, ctx) => {
			const words = shellWords(rawArgs);
			const name = words.shift();
			const workflows = discoverPromptWorkflows(ctx.cwd);
			if (!name || name === "list") {
				pi.sendMessage({ content: formatWorkflowList(workflows), display: true } as Parameters<typeof pi.sendMessage>[0]);
				return;
			}
			const workflow = findWorkflow(workflows, name);
			if (!workflow) {
				ctx.ui.notify(`Unknown prompt workflow: ${name}`, "error");
				return;
			}
			const runtime = parseRuntimeOptions(words);
			try {
				if (workflow.chain) {
					const steps = splitPromptChain(workflow.chain).map((stepName) => {
						const step = findWorkflow(workflows, stepName);
						if (!step) throw new Error(`Unknown prompt workflow in chain '${workflow.name}': ${stepName}`);
						const params = workflowParams(step, runtime.args, runtime);
						return { agent: params.agent, task: params.task };
					});
					await run({ chain: steps as ChainStep[], agentScope: "both", ...(runtime.bg ? { async: true } : {}) }, ctx);
					return;
				}
				ctx.ui.notify(`Prompt workflow '${name}' has no chain frontmatter; use /prompt-workflow for single-step templates.`, "warning");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
