/**
 * model-prompt-injector
 *
 * Injects a model-specific prompt into the system prompt whenever the active
 * model matches a rule in config.json (sibling of this file).
 *
 * Config lives only here in host code — nothing is exposed to user settings.
 * `/reload` re-reads it.
 *
 * config.json format:
 * {
 *   "rules": [
 *     {
 *       "match": ["provider/model", "provider/*", "<any>/model", "bare-name", "*"],
 *       "mode": "append" | "replace",   // default: "append"
 *       "prompt": "...",
 *       "enabled": true                 // default: true
 *     }
 *   ]
 * }
 *
 * Matching (case-insensitive, "*" is a wildcard):
 * - "provider/model" — glob against `<provider>/<id>`.
 * - bare pattern (no "/") — glob against model id OR display name.
 * - First matching rule wins; later rules are ignored.
 * - mode "append" adds the prompt to the end of the system prompt;
 *   mode "replace" replaces the whole system prompt.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@selesai/code";

export type InjectMode = "append" | "replace";

export interface InjectRule {
	match: string[];
	prompt: string;
	mode?: InjectMode;
	enabled?: boolean;
}

export interface InjectConfig {
	rules: InjectRule[];
}

/** Model shape needed for matching (structurally compatible with pi's Model). */
export interface ModelRef {
	provider: string;
	id: string;
	name: string;
}

const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), "config.json");

function globToRegex(glob: string): RegExp {
	const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	return new RegExp(`^${escaped}$`, "i");
}

export function patternMatches(pattern: string, model: ModelRef): boolean {
	const slash = pattern.indexOf("/");
	if (slash >= 0) {
		return (
			globToRegex(pattern.slice(0, slash)).test(model.provider) &&
			globToRegex(pattern.slice(slash + 1)).test(model.id)
		);
	}
	return globToRegex(pattern).test(model.id) || globToRegex(pattern).test(model.name);
}

export function findRule(rules: readonly InjectRule[], model: ModelRef): InjectRule | undefined {
	for (const rule of rules) {
		if (rule.enabled === false) continue;
		if (rule.match.some((pattern) => patternMatches(pattern, model))) return rule;
	}
	return undefined;
}

export function loadConfig(path: string = CONFIG_PATH): InjectConfig {
	const fail = (message: string): InjectConfig => {
		console.error(`[model-prompt-injector] ${message}`);
		return { rules: [] };
	};

	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		return fail(`cannot load ${path}: ${(error as Error).message}`);
	}

	if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { rules?: unknown }).rules)) {
		return fail(`invalid config: expected { "rules": [...] }`);
	}

	const rules: InjectRule[] = [];
	for (const [index, entry] of (raw as { rules: unknown[] }).rules.entries()) {
		const label = `rule #${index + 1}`;
		if (typeof entry !== "object" || entry === null) {
			console.error(`[model-prompt-injector] ${label} is not an object — skipped`);
			continue;
		}
		const rule = entry as Partial<InjectRule>;
		if (!Array.isArray(rule.match) || rule.match.length === 0 || !rule.match.every((m) => typeof m === "string")) {
			console.error(`[model-prompt-injector] ${label} needs a non-empty "match" string array — skipped`);
			continue;
		}
		if (typeof rule.prompt !== "string" || rule.prompt.trim() === "") {
			console.error(`[model-prompt-injector] ${label} needs a non-empty "prompt" string — skipped`);
			continue;
		}
		if (rule.mode !== undefined && rule.mode !== "append" && rule.mode !== "replace") {
			console.error(`[model-prompt-injector] ${label}: "mode" must be "append" or "replace" — skipped`);
			continue;
		}
		rules.push({
			match: rule.match,
			prompt: rule.prompt,
			mode: rule.mode ?? "append",
			enabled: rule.enabled ?? true,
		});
	}
	return { rules };
}

export default function modelPromptInjector(pi: ExtensionAPI, config: InjectConfig = loadConfig()) {
	const ruleFor = (model: ModelRef | undefined): InjectRule | undefined =>
		model ? findRule(config.rules, model) : undefined;

	const active = config.rules.filter((rule) => rule.enabled !== false);
	if (active.length > 0) {
		console.log(
			`[model-prompt-injector] ${active.length} rule(s) active: ${active
				.map((rule) => rule.match.join(","))
				.join(" | ")}`,
		);
	}

	pi.on("before_agent_start", async (event, ctx) => {
		const rule = ruleFor(ctx.getModel());
		if (!rule) return;
		if (rule.mode === "replace") return { systemPrompt: rule.prompt };
		return { systemPrompt: `${event.systemPrompt}\n\n${rule.prompt}` };
	});

	pi.on("model_select", async (event, ctx) => {
		ctx.ui.setStatus("model-prompt-injector", ruleFor(event.model) ? "prompt-inject: active" : undefined);
	});
}
