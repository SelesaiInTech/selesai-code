/**
 * TypeBox schemas for subagent tool parameters
 */

import { Type } from "typebox";

function keepTopLevelParameterDescriptions<T>(schema: T): T {
	return pruneNestedDescriptions(schema, []) as T;
}

function pruneNestedDescriptions(value: unknown, path: string[]): unknown {
	if (!value || typeof value !== "object") return value;

	const result = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor) continue;
		if (key === "description" && !isTopLevelParameterDescription(path)) continue;
		if ("value" in descriptor) {
			const nextPath = typeof key === "string" ? [...path, key] : path;
			descriptor.value = pruneNestedDescriptions(descriptor.value, nextPath);
		}
		Object.defineProperty(result, key, descriptor);
	}
	return result;
}

function isTopLevelParameterDescription(path: string[]): boolean {
	return path.length === 2 && path[0] === "properties";
}

const SkillOverride = Type.Unsafe({
	anyOf: [
		{ type: "array", items: { type: "string" } },
		{ type: "boolean" },
		{ type: "string" },
	],
	description: "Skill name(s) to make available (comma-separated), array of strings, or boolean (false disables, true uses default)",
});

const OutputOverride = Type.Unsafe({
	anyOf: [
		{ type: "string" },
		{ type: "boolean" },
	],
	description: "Output filename/path (string), or false to disable file output",
});

const OutputModeOverride = Type.String({
	enum: ["inline", "file-only"],
	description: "Return saved output inline (default) or only a concise file reference. file-only requires output to be a path.",
});

const ReadsOverride = Type.Unsafe({
	anyOf: [
		{ type: "array", items: { type: "string" } },
		{ type: "boolean" },
	],
	description: "Files to read before running (array of filenames), or false to disable",
});

const JsonSchemaObject = Type.Unsafe({
	type: "object",
	additionalProperties: true,
	description: "JSON Schema object for strict structured output. Non-object roots are rejected.",
});

const AcceptanceEvidenceKinds = [
	"changed-files",
	"tests-added",
	"commands-run",
	"validation-output",
	"residual-risks",
	"no-staged-files",
	"diff-summary",
	"review-findings",
	"manual-notes",
];

const AcceptanceOverride = Type.Unsafe({
	anyOf: [
		{ type: "string", enum: ["auto", "attested", "checked"] },
		{
			type: "string",
			enum: ["reviewed"],
			deprecated: true,
			description: "Invalid as an explicit policy. Recognized only so preflight can explain that reviewed is an achieved status.",
		},
		{ type: "boolean", enum: [false] },
		{ type: "object", additionalProperties: true },
	],
	description: `Optional acceptance policy. Omit for read-only calls. Example: { level: "checked", evidence: ["commands-run", "changed-files"] }. Supported evidence kinds: ${AcceptanceEvidenceKinds.join(", ")}. Evidence levels end at verified; use acceptance.review.required for review.`,
});

const AgentContractOverride = Type.Object({
	version: Type.Integer({ minimum: 1, maximum: 1, description: "Enable compatibility behavior for this run/child." }),
}, { additionalProperties: false, description: "Compatibility behavior. Omit for the default behavior." });

const ChainGateOverride = Type.String({
	enum: ["execution", "acceptance"],
	description: "For chain steps with agentContract, choose whether the chain advances on execution success or acceptance success. Defaults to execution.",
});

const TurnBudgetOverride = Type.Object({
	maxTurns: Type.Integer({ minimum: 1 }),
	graceTurns: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: false, description: "Optional assistant-turn budget. At maxTurns the child is asked to wrap up; after graceTurns additional assistant turns it is aborted and partial output is returned." });

const ToolBudgetBlock = Type.Unsafe({
	anyOf: [
		{ type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
		{ type: "string", enum: ["*"] },
	],
});

const ToolBudgetOverride = Type.Object({
	soft: Type.Optional(Type.Integer({ minimum: 1 })),
	hard: Type.Integer({ minimum: 1 }),
	block: Type.Optional(ToolBudgetBlock),
}, { additionalProperties: false, description: "Optional child tool-call budget. soft nudges the child; after hard, block tools (default read/grep/find/ls, or '*' for all tools) are blocked so the child can finalize." });

const UsageBudgetLimitOverride = Type.Object({
	soft: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
	hard: Type.Number({ exclusiveMinimum: 0 }),
}, { additionalProperties: false });

const UsageBudgetOverride = Type.Object({
	tokens: Type.Optional(UsageBudgetLimitOverride),
	costUsd: Type.Optional(UsageBudgetLimitOverride),
}, { additionalProperties: false, description: "Optional root-only reported-usage budget. Hard limits prevent future child launches; running children are not stopped." });

// Parallel task item (within a parallel step)
export const ParallelTaskSchema = Type.Object({
	agent: Type.String(),
	task: Type.Optional(Type.String({ description: "Task template with {task}, {previous}, {chain_dir} variables. Defaults to {previous}." })),
	phase: Type.Optional(Type.String({ description: "Optional phase/group label for status and graph rendering." })),
	label: Type.Optional(Type.String({ description: "Optional user-facing label for this parallel task." })),
	as: Type.Optional(Type.String({ description: "Optional safe identifier used as {outputs.name} in later chain steps." })),
	outputSchema: Type.Optional(JsonSchemaObject),
	cwd: Type.Optional(Type.String()),
	count: Type.Optional(Type.Integer({ minimum: 1, description: "Repeat this parallel task N times with the same settings." })),
	output: Type.Optional(OutputOverride),
	outputMode: Type.Optional(OutputModeOverride),
	reads: Type.Optional(ReadsOverride),
	progress: Type.Optional(Type.Boolean({ description: "Enable progress.md tracking in {chain_dir}" })),
	skill: Type.Optional(SkillOverride),
	model: Type.Optional(Type.String({ description: "Override model for this task" })),
	toolBudget: Type.Optional(ToolBudgetOverride),
	acceptance: Type.Optional(AcceptanceOverride),
	agentContract: Type.Optional(AgentContractOverride),
	gateOn: Type.Optional(ChainGateOverride),
});

export const DynamicExpandSchema = Type.Object({
	from: Type.Object({
		output: Type.String({ description: "Prior named structured output to expand from." }),
		path: Type.String({ description: "JSON Pointer into the structured output, e.g. /items." }),
	}, { additionalProperties: false }),
	item: Type.Optional(Type.String({ description: "Template variable name for each item. Defaults to item." })),
	key: Type.Optional(Type.String({ description: "JSON Pointer relative to each item for stable child ids." })),
	maxItems: Type.Optional(Type.Integer({ minimum: 0, description: "Required fanout bound unless configured globally." })),
	onEmpty: Type.Optional(Type.String({ enum: ["skip", "fail"], description: "Empty input behavior. Defaults to skip." })),
}, { additionalProperties: false });

export const DynamicParallelTemplateSchema = Type.Object({
	agent: Type.String(),
	task: Type.Optional(Type.String({ description: "Task template with {item}, {item.path}, {task}, {previous}, {chain_dir}, and {outputs.name} variables." })),
	phase: Type.Optional(Type.String({ description: "Optional phase/group label for status and graph rendering." })),
	label: Type.Optional(Type.String({ description: "Optional user-facing label; item templates are supported." })),
	outputSchema: Type.Optional(JsonSchemaObject),
	cwd: Type.Optional(Type.String()),
	output: Type.Optional(OutputOverride),
	outputMode: Type.Optional(OutputModeOverride),
	reads: Type.Optional(ReadsOverride),
	progress: Type.Optional(Type.Boolean({ description: "Enable progress.md tracking in {chain_dir}" })),
	skill: Type.Optional(SkillOverride),
	model: Type.Optional(Type.String({ description: "Override model for this task" })),
	toolBudget: Type.Optional(ToolBudgetOverride),
	acceptance: Type.Optional(AcceptanceOverride),
	agentContract: Type.Optional(AgentContractOverride),
	gateOn: Type.Optional(ChainGateOverride),
}, { additionalProperties: false });

export const DynamicCollectSchema = Type.Object({
	as: Type.String({ description: "Safe output name for the ordered collected result array." }),
	outputSchema: Type.Optional(JsonSchemaObject),
}, { additionalProperties: false });

// Flattened so chain steps do not need an object-shape anyOf/oneOf union.
export const ChainItem = Type.Object({
	checkpoint: Type.Optional(Type.String({ description: "Approval checkpoint name. Pauses the chain without launching a child until approve-checkpoint or reject-checkpoint is called." })),
	message: Type.Optional(Type.String({ description: "Optional approval message shown while the checkpoint is paused." })),
	agent: Type.Optional(Type.String({ description: "Sequential step agent name" })),
	task: Type.Optional(Type.String({
		description: "Task template with variables: {task}=original request, {previous}=prior step's text response, {chain_dir}=shared folder, {outputs.name}=prior named output. Required for first step, defaults to '{previous}' for subsequent steps."
	})),
	phase: Type.Optional(Type.String({ description: "Optional phase/group label for status and graph rendering." })),
	label: Type.Optional(Type.String({ description: "Optional user-facing label for this chain step." })),
	as: Type.Optional(Type.String({ description: "Optional safe identifier used as {outputs.name} in later chain steps." })),
	outputSchema: Type.Optional(JsonSchemaObject),
	cwd: Type.Optional(Type.String()),
	output: Type.Optional(OutputOverride),
	outputMode: Type.Optional(OutputModeOverride),
	reads: Type.Optional(ReadsOverride),
	progress: Type.Optional(Type.Boolean({ description: "Enable progress.md tracking in {chain_dir}" })),
	skill: Type.Optional(SkillOverride),
	model: Type.Optional(Type.String({ description: "Override model for this step" })),
	toolBudget: Type.Optional(ToolBudgetOverride),
	acceptance: Type.Optional(AcceptanceOverride),
	agentContract: Type.Optional(AgentContractOverride),
	gateOn: Type.Optional(ChainGateOverride),
	parallel: Type.Optional(Type.Unsafe({
		anyOf: [
			Type.Array(ParallelTaskSchema, { minItems: 1, description: "Tasks to run in parallel" }),
			DynamicParallelTemplateSchema,
		],
		description: "Static parallel tasks array, or a single dynamic fanout child template when expand/collect are present.",
	})),
	expand: Type.Optional(DynamicExpandSchema),
	collect: Type.Optional(DynamicCollectSchema),
	concurrency: Type.Optional(Type.Number({ description: "Max concurrent tasks (default: 4)" })),
	failFast: Type.Optional(Type.Boolean({ description: "Stop on first failure (default: false)" })),
	worktree: Type.Optional(Type.Boolean({
		description: "Create isolated git worktrees for each parallel task."
	})),
}, {
	description: "Chain step: use {agent, task?, ...} for sequential, {parallel: [...]} for static concurrent execution, {expand, parallel: {...}, collect} for dynamic fanout, or {checkpoint: name, message?} for an approval pause.",
	additionalProperties: false,
});

// Runtime mission handlers validate these untrusted nested objects loudly. Keeping
// their provider schema shallow avoids repeating a full durable-record schema in
// every tool request.
const MissionLaunchOverride = Type.Unsafe({
	anyOf: [
		{ type: "object", additionalProperties: true },
		{ type: "boolean", enum: [false] },
	],
});
const MissionUpdateOverride = Type.Unsafe({ type: "object", additionalProperties: true });

const ControlOverrides = Type.Object({
	enabled: Type.Optional(Type.Boolean({ description: "Enable/disable subagent control attention tracking for this run" })),
	needsAttentionAfterMs: Type.Optional(Type.Integer({ minimum: 1, description: "No-observed-activity window before a run needs attention" })),
	activeNoticeAfterMs: Type.Optional(Type.Integer({ minimum: 1, description: "Active-long-running notice threshold by elapsed ms (default: 240000)" })),
	activeNoticeAfterTurns: Type.Optional(Type.Integer({ minimum: 1, description: "Optional active-long-running notice threshold by assistant turns (disabled by default)" })),
	activeNoticeAfterTokens: Type.Optional(Type.Integer({ minimum: 1, description: "Optional active-long-running notice threshold by total tokens (disabled by default)" })),
	failedToolAttemptsBeforeAttention: Type.Optional(Type.Integer({ minimum: 1, description: "Consecutive mutating-tool failures before escalating to needs_attention (default: 3)" })),
	notifyOn: Type.Optional(Type.Array(Type.String({ enum: ["active_long_running", "needs_attention"] }), {
		description: "Control event types that should notify the parent/orchestrator. Defaults to active_long_running and needs_attention.",
	})),
	notifyChannels: Type.Optional(Type.Array(Type.String({ enum: ["event", "async", "intercom"] }), {
		description: "Notification channels to use when available. Defaults to event, async, and intercom.",
	})),
});

const SubagentParamProperties = {
	agent: Type.Optional(Type.String({ description: "Agent for one-child execution, or target for agent management actions." })),
	task: Type.Optional(Type.String({ description: "Optional one-child task. Requires agent; cannot combine with action or workflowScript." })),
	resume: Type.Optional(Type.String({ description: "Retained child run id for a workflowScript runs.run/runs.all item. Mutually exclusive with agent; task supplies the follow-up." })),
	// Management action (when present, tool operates in management mode)
	action: Type.Optional(Type.String({ minLength: 1,
		description: "Optional management/control action. Omit this field for structured single-child or workflowScript execution; use it only for management/control actions."
	})),
	id: Type.Optional(Type.String({
		description: "Run id/prefix for status/debug.run, interrupt, steer, append-step, approve-checkpoint, reject-checkpoint, or mission."
	})),
	runId: Type.Optional(Type.String({
		description: "Target run ID for debug.run, interrupt, steer, append-step, or mission.attach-run. Prefer id."
	})),
	dir: Type.Optional(Type.String({
		description: "Async run directory for status/debug.run, stop, resume, or steer."
	})),
	handoffPath: Type.Optional(Type.String({ description: "worktree.discard manifest." })),
	index: Type.Optional(Type.Integer({ minimum: 0, description: "Zero-based child index for actions that target a specific child or transcript." })),
	view: Type.Optional(Type.String({
		enum: ["fleet", "transcript"],
		description: "Optional status view: 'fleet' for a read-only fleet surface, or 'transcript' with id/dir (and optional index) to tail a run transcript.",
	})),
	lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: "Maximum transcript lines for action='status', view='transcript'. Defaults to 80." })),
	topic: Type.Optional(Type.String()),
	message: Type.Optional(Type.String({ description: "Follow-up message for resume, live guidance for steer, or optional startup prompt for project.open." })),
	mode: Type.Optional(Type.String({ enum: ["steer", "follow_up", "auto"], description: "Delivery mode for action='steer': steer interrupts at the next safe point (default), follow_up waits for the next turn boundary, auto follows up mid-turn." })),
	steeringRecovery: Type.Optional(Type.Boolean({ description: "For action='steer', allow pause-and-revive recovery after a missed acknowledgment. Defaults true for direct tool calls; false for extension RPC steering." })),
	additional: Type.Optional(Type.Integer({ minimum: 1, description: "Positive launches to add with action='grant-spawn-budget'. Root interactive parent with native user confirmation only." })),
	focus: Type.Optional(Type.Boolean({ description: "Focus the new Herdr pane for inspector.open or project.open." })),
	thinking: Type.Optional(Type.Unsafe({ anyOf: [{ type: "string" }, { type: "boolean", enum: [false] }], description: "Thinking level override." })),
	missionId: Type.Optional(Type.String({ description: "Mission id." })),
	mission: Type.Optional(Type.Unsafe({ ...MissionLaunchOverride, description: "Mission object, or false for no mission. Requires exactly one non-empty title or summary; goal may only be true and then requires budget.tokens." })),
	missionUpdate: Type.Optional(Type.Unsafe({ ...MissionUpdateOverride, description: "Mission update: objective, goal false or {paused:boolean}, budget, summary, labels, decisions, artifacts, or delivery receipts." })),
	missionStatus: Type.Optional(Type.String({ description: "Mission status." })),
	missionScope: Type.Optional(Type.String({ description: "Mission list scope: project (default) or global pointer index." })),
	runMode: Type.Optional(Type.String({ description: "Attached run mode." })),
	runStatus: Type.Optional(Type.String({ description: "Attached run status." })),
	summary: Type.Optional(Type.String({ description: "Mission close summary." })),
	// Chain identifier for management (can't reuse 'chain' — that's the execution array)
	chainName: Type.Optional(Type.String({
		description: "Chain name for get/update/delete management actions"
	})),
	// Agent/chain configuration for create/update (nested to avoid conflicts with execution fields)
	config: Type.Optional(Type.Unsafe({
		anyOf: [
			{ type: "object", additionalProperties: true },
			{ type: "string" },
		],
		description: "Agent/chain config for create/update. Object or JSON string; presence of steps creates a chain."
	})),
	workflowScript: Type.Optional(Type.String({ minLength: 1, description: "Trusted inline JavaScript statement body; use explicit return for output. Available: runs.run(key, {agent, task, ...}) and runs.run(key, {resume, task}), runs.all([...]), runs.status(id), runs.ref(s), await prompts.render(ref, vars?), emit, console; mission workflows also have async state.get/set. Scripts start async by default. Set worktree:true at workflow or child level for a separate managed worktree; child fields override workflow defaults. Compose sequential and parallel phases dynamically. No filesystem, shell, Pi tools, or host globals." })),
	chain: Type.Optional(Type.Unsafe({
		anyOf: [Type.Array(ChainItem, { minItems: 1, description: "Sequential chain of steps" })],
		description: "Sequential chain of steps. Steps support template variables {task}, {previous}, {chain_dir}, and {outputs.name}; use as: \"name\" on a step to bind {outputs.name} for later steps; { checkpoint: \"name\", message?: \"...\" } pauses for approve-checkpoint / reject-checkpoint; gateOn: \"acceptance\" advances on acceptance instead of execution.",
	})),
	tasks: Type.Optional(Type.Unsafe({
		anyOf: [
			Type.Array(ParallelTaskSchema, { minItems: 1, description: "Tasks to run in parallel" }),
			DynamicParallelTemplateSchema,
		],
		description: "Top-level parallel tasks array, or a single dynamic fanout child template when expand/collect are present.",
	})),
	chatProgress: Type.Optional(Type.String({ enum: ["auto", "off", "terminal", "milestones", "live-card"], description: "WorkflowScript chat progress projection: auto shows a live in-chat card for watched foreground workflows in the same Git repository, milestones for background runs, terminal otherwise." })),
	worktree: Type.Optional(Type.Boolean({ description: "Managed child isolation. true gives each workflow child a separate git worktree; individual runs.run/runs.all items can override with worktree:false." })),
	step: Type.Optional(Type.Unsafe({ ...ChainItem, description: "One chain step for action='append-step' only. Not an execution mode." })),
	context: Type.Optional(Type.String({
		enum: ["fresh", "fork"],
		description: "'fresh' or 'fork' to branch from parent session. Explicit context overrides every child in the invocation. If omitted, each requested agent uses its own defaultContext; agents without one run 'fork' fresh.",
	})),
	async: Type.Optional(Type.Boolean({ description: "Run in background (default: false, or per config)" })),
	clarify: Type.Optional(Type.Boolean({ description: "Show TUI to preview/edit before execution; explicit true keeps the run foreground." })),
	timeoutMs: Type.Optional(Type.Integer({ minimum: 1, description: "Timeout. Defaults to config timeoutMs or 30m for foreground/single async runs. Alias maxRuntimeMs." })),
	maxRuntimeMs: Type.Optional(Type.Integer({ minimum: 1, description: "Alias of timeoutMs." })),
	toolTimeoutMs: Type.Optional(Type.Integer({ minimum: 1, description: "Optional hard per-tool-call timeout in milliseconds." })),
	turnBudget: Type.Optional(TurnBudgetOverride),
	toolBudget: Type.Optional(ToolBudgetOverride),
	usageBudget: Type.Optional(UsageBudgetOverride),
	agentScope: Type.Optional(Type.String({ description: "Agent discovery scope: 'user', 'project', or 'both' (default 'both')." })),
	cwd: Type.Optional(Type.String({ description: "Execution cwd, or target project directory for project.open/status/close." })),
	artifacts: Type.Optional(Type.Boolean({ description: "Write debug artifacts (default: true)" })),
	includeProgress: Type.Optional(Type.Boolean({ description: "Include full progress in result (default: false)" })),
	share: Type.Optional(Type.Boolean({ description: "Upload session to GitHub Gist for sharing (default: false)" })),
	sessionDir: Type.Optional(
		Type.String({ description: "Directory to store session logs (default: temp)." }),
	),
	control: Type.Optional(ControlOverrides),
	// Workflow defaults forwarded to each runs.run/runs.all child unless overridden there.
	output: Type.Optional(Type.Unsafe({
		anyOf: [
			{ type: "string" },
			{ type: "boolean" },
		],
		description: "Default child output file (string), or false to disable. Relative paths resolve against cwd.",
	})),
	outputMode: Type.Optional(OutputModeOverride),
	skill: Type.Optional(SkillOverride),
	model: Type.Optional(Type.String({ description: "Default child model override (e.g. 'anthropic/claude-sonnet-4')" })),
	outputSchema: Type.Optional(JsonSchemaObject),
	agentContract: Type.Optional(AgentContractOverride),
	acceptance: Type.Optional(AcceptanceOverride),
	gate: Type.Optional(Type.String({ minLength: 1, description: "Host gate command. Cannot be combined with acceptance." })),
};

const { step: _legacyChainStep, ...subagentParamPropertiesWithoutStep } = SubagentParamProperties;
const trimmedSubagentParamProperties = {
	...subagentParamPropertiesWithoutStep,
	id: Type.Optional(Type.String({
		description: "Run id/prefix for status/debug.run, interrupt, steer, or mission.attach-run."
	})),
	runId: Type.Optional(Type.String({
		description: "Target run ID for debug.run, interrupt, steer, or mission.attach-run. Prefer id."
	})),
};
const SubagentParamsSchema = Type.Object(SubagentParamProperties);
const TrimmedSubagentParamsSchema = Type.Object(trimmedSubagentParamProperties);

export const SubagentParams = keepTopLevelParameterDescriptions(SubagentParamsSchema);
export const SubagentParamsWithoutLegacyChainControls = keepTopLevelParameterDescriptions(TrimmedSubagentParamsSchema);

export function createSubagentParamsSchema(options: { legacyChainControls?: boolean } = {}): typeof SubagentParams | typeof SubagentParamsWithoutLegacyChainControls {
	// Selesai default: the full schema (task/chain/tasks/clarify/step) is the
	// model-facing surface. Set legacyChainControls: false in the extension config
	// to opt into the trimmed workflowScript-only schema.
	return options.legacyChainControls === false
		? SubagentParamsWithoutLegacyChainControls
		: SubagentParams;
}

const SubagentWaitParamsSchema = Type.Object({
	id: Type.Optional(Type.String({
		description: "Async run or remembered detached foreground run id/prefix to wait for one specific run. Omit to wait across every active async run started in this session.",
	})),
	nonBlocking: Type.Optional(Type.Boolean({
		description: "When true, resolve id to one exact run, persist a wake subscription, and return immediately. The originating session is woken on completion, failure, attention, reconciliation failure, or timeout. Requires id and cannot be combined with all.",
	})),
	all: Type.Optional(Type.Boolean({
		description: "Wait for ALL active runs to finish. Default false: return as soon as the first run finishes, so a fleet manager can spawn a replacement and wait again. Ignored when id targets a single run.",
	})),
	timeoutMs: Type.Optional(Type.Integer({
		minimum: 1,
		description: "Give up waiting after this many milliseconds (the runs keep going regardless). Defaults to 1800000 (30 minutes).",
	})),
});

export const SubagentWaitParams = keepTopLevelParameterDescriptions(SubagentWaitParamsSchema);
