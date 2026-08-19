/**
 * Auto-relaunch policy for scripted workflows that end before the goal is clean
 * because the per-run fan-out budget was exhausted.
 *
 * A `budget` result means the goal was demonstrably not reached, so the only
 * decision is whether to relaunch. `clean` and failures always surface to the
 * parent — the parent remains the authority on whether the goal is met.
 */

export const DEFAULT_MAX_WORKFLOW_AUTO_RELAUNCHES = 12;

export interface WorkflowRoundProgress {
	launched: number;
	fanoutRejected: number;
	usageBudgetBlocked: number;
	stateWrites: number;
}

export interface AutoRelaunchDecision {
	relaunch: boolean;
	capped: boolean;
	stallReason?: "fanout-limited" | "usage-budget" | "no-progress";
}

export function resolveMaxWorkflowAutoRelaunches(raw: unknown): number | undefined {
	if (raw === undefined) return DEFAULT_MAX_WORKFLOW_AUTO_RELAUNCHES;
	if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) return DEFAULT_MAX_WORKFLOW_AUTO_RELAUNCHES;
	return raw === 0 ? undefined : raw;
}

export function resolveAutoRelaunchDecision(value: unknown, relaunched: number, cap: number | undefined, progress?: WorkflowRoundProgress): AutoRelaunchDecision {
	const budgetExhausted = !!value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).result === "budget";
	if (!budgetExhausted) return { relaunch: false, capped: false };
	if (cap !== undefined && relaunched >= cap) return { relaunch: false, capped: true };
	if (progress) {
		if (progress.usageBudgetBlocked > 0) return { relaunch: false, capped: false, stallReason: "usage-budget" };
		if (progress.fanoutRejected > 0 && progress.launched === 0) return { relaunch: false, capped: false, stallReason: "fanout-limited" };
		if (progress.launched === 0 && progress.stateWrites === 0) return { relaunch: false, capped: false, stallReason: "no-progress" };
	}
	return { relaunch: true, capped: false };
}
