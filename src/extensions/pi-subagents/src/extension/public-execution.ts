export interface PublicSubagentExecutionParams {
	action?: unknown;
	agent?: unknown;
	task?: unknown;
	step?: unknown;
	tasks?: unknown;
	chain?: unknown;
	parallel?: unknown;
	concurrency?: unknown;
	chainDir?: unknown;
	workflowScript?: unknown;
	resume?: unknown;
	clarify?: unknown;
	runFanoutBudget?: unknown;
	runFanoutAdmitted?: unknown;
}

export type PublicSubagentExecutionMode = "workflow" | "management";

export type PublicSubagentExecutionNormalization<T> =
	| { ok: true; params: T }
	| { ok: false; error: string; mode: PublicSubagentExecutionMode };

/**
 * Normalize public execution requests before they reach the executor. All four
 * execution modes (SINGLE, CHAIN, PARALLEL, SCRIPTED WORKFLOW) are first-class;
 * only malformed or contradictory shapes are rejected. Internal runs.run
 * children and structured owned delegation bypass this boundary.
 */
export function normalizePublicSubagentExecution<T extends PublicSubagentExecutionParams>(params: T): PublicSubagentExecutionNormalization<T> {
	if (params.runFanoutBudget !== undefined || params.runFanoutAdmitted !== undefined) {
		return { ok: false, error: "Public execution does not accept internal run fan-out fields.", mode: params.workflowScript !== undefined ? "workflow" : "management" };
	}
	const action = params.action;
	if (action !== undefined && (typeof action !== "string" || !action.trim())) {
		return { ok: false, error: "action must be a non-empty management/control action, or omit action and execute directly.", mode: "management" };
	}
	const normalizedAction = typeof action === "string" ? action.trim() : undefined;
	if (params.clarify === true && params.workflowScript !== undefined) {
		return { ok: false, error: "Public workflowScript execution does not support clarify UI.", mode: "workflow" };
	}
	if (params.resume !== undefined) {
		return { ok: false, error: "Top-level resume execution is not available. Put resume on a workflowScript runs.run/runs.all item.", mode: "workflow" };
	}
	if (normalizedAction !== undefined) {
		const legacyAction = normalizedAction.toLowerCase();
		if (legacyAction === "single" || legacyAction === "parallel" || legacyAction === "tasks" || legacyAction === "chain") {
			return { ok: false, error: `action '${normalizedAction}' is not a management action; use the direct execution fields ({ agent, task }, { chain: [...] }, { tasks: [...] }).`, mode: "workflow" };
		}
		if (normalizedAction === "schedule.create") {
			if (typeof params.workflowScript === "string" && params.workflowScript.trim()) {
				return { ok: true, params: { ...params, action: normalizedAction } };
			}
			if (params.agent === undefined && params.task === undefined && params.step === undefined && params.tasks === undefined && params.chain === undefined) {
				return { ok: false, error: "schedule.create requires a non-empty workflowScript or direct execution fields (agent, task, tasks, or chain).", mode: "management" };
			}
			return { ok: true, params: { ...params, action: normalizedAction } };
		}
		if (params.workflowScript !== undefined) {
			return { ok: false, error: "workflowScript execution must omit action; only schedule.create accepts action with workflowScript.", mode: "management" };
		}
		return { ok: true, params: { ...params, action: normalizedAction } };
	}
	if (typeof params.workflowScript === "string" && params.workflowScript.trim()) {
		return { ok: true, params };
	}
	if (params.chain !== undefined) {
		return { ok: true, params };
	}
	if (params.tasks !== undefined) {
		return { ok: true, params };
	}
	if (params.agent !== undefined || params.task !== undefined || params.step !== undefined) {
		return { ok: true, params };
	}
	return { ok: false, error: "Execution requires one mode: { agent, task? }, { chain: [...] }, { tasks: [...] }, or { workflowScript }.", mode: "workflow" };
}
