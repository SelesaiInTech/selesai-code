import type { ExtensionAPI } from "@selesai/code";
import type { AgentConfig } from "./agents.ts";

/** Public event emitted by pi-subagents while its parent extension is loading. */
export const BUILTIN_AGENT_AUGMENTATION_REQUEST_EVENT = "pi-subagents:request-builtin-agent-augmentations";

export interface BuiltinAgentAugmentation {
	id: string;
	agentNames: readonly string[];
	addTools?: readonly string[];
	subagentOnlyExtensions?: readonly string[];
}

interface BuiltinAgentAugmentationRequest {
	register(augmentation: BuiltinAgentAugmentation): void;
}

function strings(value: unknown, field: string): string[] {
	if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== "string" || !entry.trim() || entry.trim() !== entry)) {
		throw new Error(`Builtin agent augmentation ${field} must be a non-empty array of trimmed strings.`);
	}
	return [...new Set(value)];
}

function validate(augmentation: BuiltinAgentAugmentation): BuiltinAgentAugmentation {
	if (!augmentation || typeof augmentation !== "object") throw new Error("Builtin agent augmentation must be an object.");
	if (typeof augmentation.id !== "string" || !augmentation.id.trim() || augmentation.id.trim() !== augmentation.id) throw new Error("Builtin agent augmentation id must be a non-empty trimmed string.");
	const agentNames = strings(augmentation.agentNames, "agentNames");
	const addTools = augmentation.addTools === undefined ? undefined : strings(augmentation.addTools, "addTools");
	const subagentOnlyExtensions = augmentation.subagentOnlyExtensions === undefined ? undefined : strings(augmentation.subagentOnlyExtensions, "subagentOnlyExtensions");
	if (!addTools?.length && !subagentOnlyExtensions?.length) throw new Error("Builtin agent augmentation must add tools or child extensions.");
	return { id: augmentation.id, agentNames, ...(addTools ? { addTools } : {}), ...(subagentOnlyExtensions ? { subagentOnlyExtensions } : {}) };
}

/** Ask already-loaded extensions for additive patches to pi-subagents builtins. */
export function requestBuiltinAgentAugmentations(pi: ExtensionAPI): BuiltinAgentAugmentation[] {
	const byId = new Map<string, BuiltinAgentAugmentation>();
	const request: BuiltinAgentAugmentationRequest = {
		register(augmentation) {
			const parsed = validate(augmentation);
			if (byId.has(parsed.id)) throw new Error(`Builtin agent augmentation '${parsed.id}' was registered more than once.`);
			byId.set(parsed.id, parsed);
		},
	};
	pi.events.emit(BUILTIN_AGENT_AUGMENTATION_REQUEST_EVENT, request);
	return [...byId.values()];
}

/**
 * Apply patches only to selected builtins. User/project profiles and explicit
 * builtin overrides retain precedence over an extension's defaults.
 */
export function applyBuiltinAgentAugmentations(agents: AgentConfig[], augmentations: readonly BuiltinAgentAugmentation[]): AgentConfig[] {
	return agents.map((agent) => {
		if (agent.source !== "builtin") return agent;
		const matches = augmentations.filter((augmentation) => augmentation.agentNames.includes(agent.name));
		if (matches.length === 0) return agent;
		const overridden = new Set(agent.override?.fields ?? []);
		const tools = overridden.has("tools")
			? agent.tools
			: [...new Set([...(agent.tools ?? []), ...matches.flatMap((augmentation) => augmentation.addTools ?? [])])];
		const subagentOnlyExtensions = overridden.has("subagentOnlyExtensions")
			? agent.subagentOnlyExtensions
			: [...new Set([...(agent.subagentOnlyExtensions ?? []), ...matches.flatMap((augmentation) => augmentation.subagentOnlyExtensions ?? [])])];
		return {
			...agent,
			...(tools ? { tools } : {}),
			...(subagentOnlyExtensions ? { subagentOnlyExtensions } : {}),
		};
	});
}
