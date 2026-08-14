/**
 * Auto-relaunch policy for scripted workflows that end before the goal is clean
 * because the per-run fan-out budget was exhausted.
 *
 * A `budget` result means the goal was demonstrably not reached, so the only
 * decision is whether to relaunch. `clean` and failures always surface to the
 * parent — the parent remains the authority on whether the goal is met.
 */

export const DEFAULT_MAX_WORKFLOW_AUTO_RELAUNCHES = 12;

export interface AutoRelaunchDecision {
	relaunch: boolean;
	capped: boolean;
}

export function resolveMaxWorkflowAutoRelaunches(raw: unknown): number | undefined {
	if (raw === undefined) return DEFAULT_MAX_WORKFLOW_AUTO_RELAUNCHES;
	if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) return DEFAULT_MAX_WORKFLOW_AUTO_RELAUNCHES;
	return raw === 0 ? undefined : raw;
}

export function resolveAutoRelaunchDecision(value: unknown, relaunched: number, cap: number | undefined): AutoRelaunchDecision {
	const budgetExhausted = !!value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).result === "budget";
	if (!budgetExhausted) return { relaunch: false, capped: false };
	if (cap === undefined) return { relaunch: true, capped: false };
	return relaunched >= cap ? { relaunch: false, capped: true } : { relaunch: true, capped: false };
}
