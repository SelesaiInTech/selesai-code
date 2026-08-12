// ponytail: the four workflow mode shapes as pi-subagents chain step arrays.
// Execution (checkpoints, acceptance, missions, resumability) is owned by
// pi-subagents; this file is the thin shell's only content.

import type { ChainStep } from "../pi-subagents/src/shared/settings.ts";

/** Plan → reuse → handoff → build↔review loop for a concrete task. */
export const taskChain: ChainStep[] = [
	{
		agent: "architect",
		as: "plan",
		task: "Produce a concrete implementation plan for: {task}. Cover what to build, how, in what order, which files and components, and what the finished result looks like. Return the complete plan inline.",
	},
	{ checkpoint: "approve-plan", message: "Approve the plan before implementation?" },
	{
		agent: "explorer",
		task: "Explore the codebase for reusable patterns relevant to the plan: {outputs.plan}. Point at relevant areas, patterns, and dependencies (e.g. styling setup, state-machine usage). Return the reuse findings inline; skip cleanly if the task creates something wholly new.",
	},
	{
		agent: "recapper",
		as: "handoff",
		task: "Compile a self-contained handoff document from the plan and reuse findings: {outputs.plan}\n\nReuse findings: {previous}. It must let fresh agents understand the goal, constraints, acceptance criteria, and relevant workspace context without re-grilling or re-planning. Return the complete handoff inline.",
	},
	{ checkpoint: "approve-handoff", message: "Approve the handoff before implementation?" },
	{
		agent: "builder",
		task: "Implement the approved work from the handoff: {outputs.handoff}. Make all code changes in the workspace, follow the plan in order, and run relevant checks. Return a completion summary with the checks run.",
		acceptance: { level: "checked", evidence: ["commands-run", "changed-files"] },
	},
	{
		agent: "commentator",
		task: "Independently review the uncommitted diff against the handoff acceptance criteria: {outputs.handoff}. Builder completion summary: {previous}. Verify correctness and plan adherence, run relevant checks where feasible, and report concrete evidence (what you inspected and what you ran). Do not modify the workspace.",
	},
	{ checkpoint: "approve-implementation", message: "Approve the implementation and review?" },
];

/** Research → plan → reuse → handoff → build↔review → audit for a prototype. */
export const prototypeChain: ChainStep[] = [
	{
		agent: "researcher",
		task: "Research the external, fast-changing knowledge this task depends on (libraries, frameworks, languages/SDKs, APIs, or unfamiliar alternatives). Task: {task}. Skip what you already know well. Synthesize actionable findings (versions, APIs, pitfalls, recommended approaches) with sources. Return the findings inline.",
	},
	{
		agent: "architect",
		as: "plan",
		task: "Produce a concrete build plan from the research findings: {previous}.\n\nOriginal request: {task}. Cover what to build, how, in what order, which components, and what the finished prototype looks like. Return the complete plan inline.",
	},
	{ checkpoint: "approve-plan", message: "Approve the plan before implementation?" },
	{
		agent: "explorer",
		task: "Explore the codebase for reusable patterns relevant to the plan: {outputs.plan}. Point at relevant areas, patterns, and dependencies. Return the reuse findings inline; skip cleanly if the task creates something wholly new.",
	},
	{
		agent: "recapper",
		as: "handoff",
		task: "Compile a self-contained handoff document from the plan and reuse findings: {outputs.plan}\n\nReuse findings: {previous}. It must let fresh agents understand the requirements, plan, constraints, acceptance criteria, and relevant workspace context without re-grilling. Return the complete handoff inline.",
	},
	{ checkpoint: "approve-handoff", message: "Approve the handoff before implementation?" },
	{
		agent: "builder",
		task: "Implement the prototype from the plan and handoff: {outputs.handoff}. Make all code changes in the workspace, follow the plan in order, and run relevant checks. Return a completion summary with the checks run.",
		acceptance: { level: "checked", evidence: ["commands-run", "changed-files"] },
	},
	{
		agent: "commentator",
		task: "Independently review the uncommitted diff against the handoff acceptance criteria: {outputs.handoff}. Builder completion summary: {previous}. Verify correctness and plan adherence, run relevant checks where feasible, and report concrete evidence (what you inspected and what you ran). Do not modify the workspace.",
	},
	{ checkpoint: "approve-implementation", message: "Approve the implementation and review?" },
	{
		agent: "commentator",
		task: "Perform a final audit of the uncommitted changes for correctness, plan adherence, and over-engineering. Use ponytail-review style: cut bloat, unnecessary abstractions, dead flexibility, and reinvented stdlib/native behavior. Plan: {outputs.plan}. Do not modify the workspace; report concrete evidence.",
	},
];

/** Same as the prototype chain, minus the researcher step. */
export const quicktypeChain: ChainStep[] = [
	{
		agent: "architect",
		as: "plan",
		task: "Produce a concrete build plan for: {task}. Cover what to build, how, in what order, which components, and what the finished prototype looks like. Return the complete plan inline.",
	},
	{ checkpoint: "approve-plan", message: "Approve the plan before implementation?" },
	{
		agent: "explorer",
		task: "Explore the codebase for reusable patterns relevant to the plan: {outputs.plan}. Point at relevant areas, patterns, and dependencies. Return the reuse findings inline; skip cleanly if the task creates something wholly new.",
	},
	{
		agent: "recapper",
		as: "handoff",
		task: "Compile a self-contained handoff document from the plan and reuse findings: {outputs.plan}\n\nReuse findings: {previous}. It must let fresh agents understand the requirements, plan, constraints, acceptance criteria, and relevant workspace context without re-grilling. Return the complete handoff inline.",
	},
	{ checkpoint: "approve-handoff", message: "Approve the handoff before implementation?" },
	{
		agent: "builder",
		task: "Implement the prototype from the plan and handoff: {outputs.handoff}. Make all code changes in the workspace, follow the plan in order, and run relevant checks. Return a completion summary with the checks run.",
		acceptance: { level: "checked", evidence: ["commands-run", "changed-files"] },
	},
	{
		agent: "commentator",
		task: "Independently review the uncommitted diff against the handoff acceptance criteria: {outputs.handoff}. Builder completion summary: {previous}. Verify correctness and plan adherence, run relevant checks where feasible, and report concrete evidence (what you inspected and what you ran). Do not modify the workspace.",
	},
	{ checkpoint: "approve-implementation", message: "Approve the implementation and review?" },
	{
		agent: "commentator",
		task: "Perform a final audit of the uncommitted changes for correctness, plan adherence, and over-engineering. Use ponytail-review style: cut bloat, unnecessary abstractions, dead flexibility, and reinvented stdlib/native behavior. Plan: {outputs.plan}. Do not modify the workspace; report concrete evidence.",
	},
];

/** Direct build↔review rounds for an already-agreed plan; no plan/reuse/handoff artifacts. */
export const loopChain: ChainStep[] = [
	{
		agent: "builder",
		task: "Implement the agreed work from the request: {task}. Make all code changes in the workspace, follow the agreed plan and constraints, and run relevant checks. Return a completion summary with the checks run.",
		acceptance: { level: "checked", evidence: ["commands-run", "changed-files"] },
	},
	{
		agent: "commentator",
		task: "Independently review the uncommitted diff against the agreed plan and acceptance criteria: {task}. Builder completion summary: {previous}. Verify correctness and plan adherence, run relevant checks where feasible, and report concrete evidence (what you inspected and what you ran). Do not modify the workspace.",
	},
	{ checkpoint: "approve-implementation", message: "Approve the implementation and review?" },
];
