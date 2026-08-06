/**
 * Pure task-aware advisory agent recommender.
 *
 * Given an already-discovered, effective agent set and the current capability
 * ceiling, deterministically selects at most one canonical agent to recommend
 * for a task, or returns recovery guidance when intent is unknown or no safe
 * candidate exists. This module is deliberately pure: it performs no
 * filesystem/discovery access, no alias/chains/executor/RPC/preflight/settings
 * access, no mutation, launch, scheduling, or persistence, and never writes to
 * params. Launching stays explicit: the caller must make a separate execution
 * call with the recommended canonical `agent.name`.
 */

import type { AgentConfig, AgentSource } from "./agents.ts";
import { agentHasWriteTools } from "./agent-memory.ts";
import { classifyTaskMutationIntent } from "../runs/shared/task-intent.ts";
import { isAgentAllowedByCapabilityCeiling, type ResolvedSubagentCapabilityCeiling } from "../runs/shared/capability-ceiling.ts";

function resolveAgentRoutingRole(name: string, acceptanceRole: AgentConfig["acceptanceRole"]): "writer" | "read-only" | undefined {
	if (acceptanceRole === "writer" || acceptanceRole === "read-only") return acceptanceRole;
	if (/^(?:builder|developer|coder|implementer|develop)$/i.test(name)) return "writer";
	if (/^(?:architect|commentator|explorer|researcher|recapper)$/i.test(name)) return "read-only";
	return undefined;
}

/** Core tools that make an implementation agent able to write (matches agent-memory). */
const WRITER_TOOLS = new Set(["edit", "write", "bash"]);

/** Source precedence for deterministic ordering: project > user > package > builtin. */
const AGENT_SOURCE_PRECEDENCE: Record<AgentSource, number> = { builtin: 0, package: 1, user: 2, project: 3 };

export type TaskAwareAgentIntent = "implementation" | "read-only" | "unknown";

export interface TaskAwareAgentRecommendationAgent {
	/** Canonical runtime agent name accepted by execution; never an alias. */
	name: string;
	source: AgentSource;
	role: "writer" | "read-only";
	roleBasis: "declared" | "inferred";
	reason: string;
}

export interface TaskAwareAgentRecommendation {
	intent: TaskAwareAgentIntent;
	agent?: TaskAwareAgentRecommendationAgent;
	/** Recovery guidance when no safe recommendation exists (unknown intent or no candidate). */
	next?: string;
}

/**
 * Recommend a canonical agent for a trimmed non-empty task, or `undefined` for
 * an empty/whitespace task (no-op). Never recommends disabled or
 * capability-disallowed agents, never guesses for unknown intent, and never
 * outputs an alias or a role-incompatible agent.
 */
export function recommendTaskAwareAgent(input: {
	task: string;
	agents: AgentConfig[];
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
}): TaskAwareAgentRecommendation | undefined {
	const task = input.task.trim();
	if (!task) return undefined;

	const intent = classifyTaskMutationIntent("builder", task).kind;
	if (intent === "unknown") {
		return {
			intent,
			next: "Clarify whether the task is read-only analysis/review or implementation allowed to edit files.",
		};
	}

	const candidates: TaskAwareAgentRecommendationAgent[] = [];
	for (const agent of input.agents) {
		if (agent.disabled) continue;
		if (!isAgentAllowedByCapabilityCeiling(agent.name, input.capabilityCeiling)) continue;
		const role = resolveAgentRoutingRole(agent.name, agent.acceptanceRole);
		if (!role) continue;
		const hasWriteTools = agentHasWriteTools(agent);
		if (intent === "implementation") {
			if (role !== "writer" || !hasWriteTools) continue;
			const allowedTools = input.capabilityCeiling?.allowedTools;
			if (allowedTools !== undefined && !allowedTools.some((tool) => WRITER_TOOLS.has(tool))) continue;
		} else {
			if (role !== "read-only" || hasWriteTools) continue;
		}
		const roleBasis = agent.acceptanceRole !== undefined ? "declared" : "inferred";
		candidates.push({
			name: agent.name,
			source: agent.source,
			role,
			roleBasis,
			reason: intent === "implementation"
				? `${roleBasis} writer role with write tools`
				: `${roleBasis} read-only role without known write tools`,
		});
	}

	candidates.sort((a, b) => {
		const sourceOrder = AGENT_SOURCE_PRECEDENCE[b.source] - AGENT_SOURCE_PRECEDENCE[a.source];
		if (sourceOrder !== 0) return sourceOrder;
		const declaredOrder = (a.roleBasis === "declared" ? 0 : 1) - (b.roleBasis === "declared" ? 0 : 1);
		if (declaredOrder !== 0) return declaredOrder;
		return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
	});

	const agent = candidates[0];
	if (!agent) {
		return {
			intent,
			next: intent === "implementation"
				? "No executable agent has a writer role with write tools for this task. Check the executable/restricted sections above or adjust the capability ceiling."
				: "No executable agent has a read-only role without known write tools for this task. Check the executable/restricted sections above.",
		};
	}
	return { intent, agent };
}

/** Text-only advisory lines; `undefined` (empty-task no-op) renders nothing. */
export function formatTaskAwareAgentRecommendation(recommendation: TaskAwareAgentRecommendation | undefined): string[] {
	if (!recommendation) return [];
	const lines = ["Task-aware advisory routing:", `- Intent: ${recommendation.intent}`];
	if (recommendation.agent) {
		lines.push(`- Recommended: ${recommendation.agent.name} (${recommendation.agent.source})`);
		lines.push(`- Reason: ${recommendation.agent.reason}`);
		lines.push("- Advisory only: no subagent was launched. To proceed, explicitly call subagent with this canonical agent name and the task.");
	} else {
		lines.push("- Recommendation: none");
		lines.push(`- Next: ${recommendation.next ?? "Refine the task wording and retry."}`);
		lines.push("- Advisory only: no subagent was launched.");
	}
	return lines;
}
