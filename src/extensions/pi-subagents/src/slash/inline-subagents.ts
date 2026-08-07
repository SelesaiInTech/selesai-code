import type { ExtensionAPI } from "@selesai/code";
import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import { discoverAgents, resolveAgentName, type AgentConfig } from "../agents/agents.ts";
import type { SubagentParamsLike } from "../runs/foreground/subagent-executor.ts";
import type { SubagentState } from "../shared/types.ts";
import { launchSlashSubagent } from "./slash-commands.ts";

/** `#agent-name` at the very start of a message, followed by end-of-line or a space. */
const INLINE_AGENT_TOKEN_RE = /^#([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/i;

/**
 * Parse an inline subagent invocation from raw input.
 * Returns the (lowercased) agent name and the task text, or null when the
 * message does not start with a `#agent-name` token.
 */
export function parseInlineSubagentInput(text: string): { agentName: string; task: string } | null {
	const trimmed = text.trimStart();
	const match = trimmed.match(INLINE_AGENT_TOKEN_RE);
	if (!match) return null;
	return { agentName: (match[1] ?? "").toLowerCase(), task: trimmed.slice(match[0].length).trim() };
}

/** Text before the cursor: `#` optionally followed by a partial agent name (message start only). */
function getInlineAgentToken(textBeforeCursor: string): string | undefined {
	const match = textBeforeCursor.match(/^#([a-z0-9-]*)$/i);
	return match ? match[1] ?? "" : undefined;
}

// Agent discovery walks builtin+user+project+package agent dirs and node_modules,
// which is far too slow to run synchronously on every `#` keystroke (it blocks the
// event loop and the editor drops results while typing). Cache per cwd with a short
// TTL so the picker is responsive; a failed discovery is cached as empty so a single
// malformed agent file cannot keep blocking the editor (nor reject its shared
// autocomplete request chain, which would permanently kill all autocomplete).
const AGENT_DISCOVERY_CACHE_TTL_MS = 5_000;
const agentDiscoveryCache = new Map<string, { expiry: number; agents: AgentConfig[] }>();

function discoverAgentsForPicker(cwd: string): AgentConfig[] {
	const now = Date.now();
	const cached = agentDiscoveryCache.get(cwd);
	if (cached && cached.expiry > now) {
		return cached.agents;
	}
	let agents: AgentConfig[] = [];
	try {
		agents = discoverAgents(cwd, "both").agents;
	} catch {
		// Never let agent discovery break autocomplete; the editor's shared request
		// chain stays poisoned forever after a single rejected getSuggestions.
	}
	agentDiscoveryCache.set(cwd, { expiry: now + AGENT_DISCOVERY_CACHE_TTL_MS, agents });
	return agents;
}

export function createInlineSubagentAutocompleteProvider(
	state: SubagentState,
	current: AutocompleteProvider,
): AutocompleteProvider {
	return {
		triggerCharacters: ["#"],
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			// Subagent invocations are whole-message actions: only trigger at the start of the first line.
			if (cursorLine !== 0 || !state.baseCwd) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}
			const token = getInlineAgentToken((lines[0] ?? "").slice(0, cursorCol));
			if (token === undefined) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			const items: AutocompleteItem[] = discoverAgentsForPicker(state.baseCwd)
				.filter((agent) => agent.name.includes(token.toLowerCase()))
				.map((agent) => ({
					value: `#${agent.name}`,
					label: `#${agent.name}`,
					description: agent.description,
				}));

			return items.length > 0
				? { prefix: `#${token}`, items }
				: current.getSuggestions(lines, cursorLine, cursorCol, options);
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
		},
		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

/**
 * `#agent-name [task]` inline subagent invocation: typing `#` at the start of a
 * message suggests installed agents; sending `#agent-name task` runs that agent
 * (same path as `/run agent task`) instead of sending the text to the main agent.
 */
export function registerInlineSubagentInvocation(pi: ExtensionAPI, state: SubagentState): void {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.addAutocompleteProvider((current) => createInlineSubagentAutocompleteProvider(state, current));
	});

	pi.on("input", (event, ctx) => {
		if (event.source === "extension") return { action: "continue" };

		const parsed = parseInlineSubagentInput(event.text);
		if (!parsed) return { action: "continue" };
		if (!state.baseCwd) return { action: "continue" };

		const agents = discoverAgents(state.baseCwd, "both").agents;
		const resolved = resolveAgentName(parsed.agentName, agents);
		if (resolved.error) {
			ctx.ui.notify?.(resolved.error, "warning");
			return { action: "handled" };
		}
		if (!resolved.agent) {
			ctx.ui.notify?.(`Unknown subagent: #${parsed.agentName}`, "warning");
			return { action: "handled" };
		}

		const params: SubagentParamsLike = {
			agent: resolved.agent.name,
			task: parsed.task,
			clarify: false,
			agentScope: "both",
		};
		launchSlashSubagent(pi, ctx, params);
		return { action: "handled" };
	});
}
