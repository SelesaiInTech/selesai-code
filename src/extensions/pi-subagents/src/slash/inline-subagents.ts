import type { ExtensionAPI } from "@selesai/code";
import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import { discoverAgents, resolveAgentName, type AgentConfig } from "../agents/agents.ts";
import type { SubagentParamsLike } from "../runs/foreground/subagent-executor.ts";
import type { SubagentState } from "../shared/types.ts";
import { launchSlashSubagent } from "./slash-commands.ts";

/** `#agent-name` anywhere in a message (start, middle, or end), like `$skill-name`. */
const INLINE_AGENT_TOKEN_RE = /(^|[^a-z0-9_-])#([a-z0-9]+(?:-[a-z0-9]+)*)(?![a-z0-9_-])/i;

/**
 * Parse an inline subagent invocation from raw input.
 * Returns the (lowercased) agent name, the task text after the mention, and
 * whether the mention is at the start of the input (leading whitespace counts).
 * Returns null when the text contains no `#agent-name` token.
 */
export function parseInlineSubagentInput(text: string): { agentName: string; task: string; atStart: boolean } | null {
	const match = text.match(INLINE_AGENT_TOKEN_RE);
	if (!match) return null;
	const index = match.index ?? 0;
	return {
		agentName: (match[2] ?? "").toLowerCase(),
		task: text.slice(index + match[0].length).trim(),
		atStart: text.slice(0, index).trim() === "",
	};
}

/** Text before the cursor: `#` optionally followed by a partial agent name (anywhere on the line). */
function getInlineAgentToken(textBeforeCursor: string): string | undefined {
	const match = textBeforeCursor.match(/(?:^|[^a-z0-9_-])#([a-z0-9-]*)$/i);
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
			// Like the $ skill picker, # works anywhere on the current line, not just
			// at the start of the message.
			if (!state.baseCwd) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}
			const token = getInlineAgentToken((lines[cursorLine] ?? "").slice(0, cursorCol));
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
 * `#agent-name [task]` inline subagent invocation: typing `#` anywhere in a
 * message suggests installed agents; sending a message that contains
 * `#agent-name` runs that agent (same path as `/run agent task`) instead of
 * sending the text to the main agent.
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
		if (resolved.error || !resolved.agent) {
			// A #mention that does not resolve only consumes the input when it is an
			// explicit invocation at the start of the message. Mid-message mentions
			// (e.g. "issue #42") must never swallow the user's text.
			if (!parsed.atStart) return { action: "continue" };
			ctx.ui.notify?.(resolved.error ?? `Unknown subagent: #${parsed.agentName}`, "warning");
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
