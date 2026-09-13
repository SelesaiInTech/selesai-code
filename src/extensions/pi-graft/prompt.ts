/**
 * Retrieval strategy: when Graft context reaches the model, and how much.
 *
 * Three genuinely different behaviors, not one behavior with a flag:
 *
 * - `pull`   — inject nothing. The model calls the Graft tools when it wants
 *              repository context.
 * - `push`   — before an eligible coding turn, inject a bounded source-backed
 *              pack so the turn can start from repository understanding. Default.
 * - `hybrid` — inject a small orientation pack for eligible coding turns and
 *              keep the precise tools for follow-up.
 *
 * Injection happens through the turn lifecycle as a custom message. User text
 * is never rewritten, and the injected block says it is derived and that the
 * source files remain authoritative.
 */

import type { AskPayload, GraftReference } from "./cli.ts";
import {
	askReferences,
	boundText,
	renderAsk,
	DEFAULT_FIND_LIMIT,
} from "./cli.ts";
import {
	DEFAULT_MAX_INJECTION_BYTES,
	DEFAULT_MIN_COVERAGE,
	type GraftState,
	type GraftStateName,
	isQueryable,
	type RetrievalMode,
} from "./state.ts";

/** Longest prompt text handed to Graft as a retrieval query. */
export const MAX_QUERY_CHARS = 600;

/**
 * Intent words that mean "this turn touches the repository". Kept deliberately
 * concrete: a false positive costs a wasted Graft query and prompt noise, so
 * the list is about *acting on code*, not about mentioning it.
 */
const CODING_INTENT =
	/\b(add|implement(?:ation)?s?|fix|bug|debug|refactor|rename|migrate|port|upgrade|remove|delete|replace|extract|move|rewrite|optimize|optimi[sz]e|revert|patch|wire|hook up|support|handle|test|spec|regression|verif(?:y|ication)|validat(?:e|ion)|crash|error|exception|stack ?trace|type ?error|lint|compile|build failure|review|diff|pull request|\bpr\b|commit|branch|merge|conflict|api|schema|migration|endpoint|component|function|class|method|module|package|dependency|config|performance|memory leak|deadlock|race)\b/i;

/** A path, an identifier, or an explicitly quoted symbol is a strong signal on its own. */
const CODE_SHAPE = /(`[^`]+`|\b[\w.-]+\.(ts|tsx|js|jsx|py|go|java|kt|php|swift|rs|c|cc|cpp|cs|rb|scala|ex|sol|ml|zig|dart|clj|nix|lua|R)\b|\b[a-z]+[A-Z][A-Za-z0-9]*\b|\b[A-Z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*\b|\b[\w-]+\/[\w./-]+\.\w+\b)/;

/** Prompts that are conversational or meta never warrant repository context. */
const NON_CODING =
	/^(hi|hey|hello|thanks|thank you|ok|okay|cool|nice|great|yes|no|stop|never mind|nevermind|what (do you think|can you do)|who are you)\b[\s!.?]*$/i;

export type TaskClass = "coding" | "other";

/**
 * Classify a user prompt as a repository task or not.
 *
 * `ponytail:` a lexical heuristic, not a model call — it exists so non-coding
 * turns pay no Graft latency at all. It has a known ceiling: an indirect
 * request ("the login flow feels slow") classifies as `other` and simply
 * falls back to `pull` behavior. Upgrade path is a provider-backed classifier
 * once the cheap gate measurably costs us turns.
 */
export function classifyTask(prompt: string): TaskClass {
	const text = prompt.trim();
	if (!text) return "other";
	if (NON_CODING.test(text)) return "other";
	if (text.startsWith("/")) return "other";
	if (CODING_INTENT.test(text) || CODE_SHAPE.test(text)) return "coding";
	return "other";
}

/** Collapse a prompt into a bounded plain-text retrieval query. */
export function retrievalQuery(prompt: string): string {
	const text = prompt
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return text.length > MAX_QUERY_CHARS ? `${text.slice(0, MAX_QUERY_CHARS)}…` : text;
}

export interface InjectionPlan {
	inject: boolean;
	mode: RetrievalMode;
	query: string;
	/** Why nothing was injected; used by tests and by `/graft doctor`. */
	reason: string;
}

/**
 * Decide whether this turn gets an injected pack.
 *
 * Pure: the caller supplies the mode, the prompt, and the current graph state.
 */
export function planInjection(input: {
	mode: RetrievalMode;
	prompt: string;
	state: GraftState;
	enabled: boolean;
}): InjectionPlan {
	const base = { mode: input.mode, query: "" } as const;
	if (!input.enabled) return { ...base, inject: false, reason: "extension disabled by settings" };
	if (input.mode === "pull") return { ...base, inject: false, reason: "pull mode: the model retrieves on demand" };
	if (!isQueryable(input.state)) {
		return { ...base, inject: false, reason: `no usable graph (${input.state.name})` };
	}
	const query = retrievalQuery(input.prompt);
	if (!query) return { ...base, inject: false, reason: "empty prompt" };
	if (classifyTask(query) !== "coding") {
		return { ...base, inject: false, reason: "prompt does not look like a repository task" };
	}
	return { inject: true, mode: input.mode, query, reason: "eligible repository task" };
}

/** Per-mode shape of the injected pack. Push spends more; hybrid orients. */
export function injectionBudget(mode: RetrievalMode, maxInjectionBytes: number): { limit: number; maxBytes: number } {
	if (mode === "push") return { limit: DEFAULT_FIND_LIMIT, maxBytes: maxInjectionBytes };
	return { limit: 3, maxBytes: Math.min(maxInjectionBytes, 6 * 1024) };
}

export interface InjectionPack {
	text: string;
	references: GraftReference[];
	bytes: number;
	truncated: boolean;
	coverage?: number;
}

/**
 * Turn an `ask` payload into a bounded pack, or refuse it.
 *
 * Refusal is the important half: an unprompted pack whose terms barely overlap
 * the graph is noise that the model then has to reason around. Graft reports
 * `coverage` for exactly this gate, so a low-coverage result is dropped rather
 * than injected.
 */
export function buildInjectionPack(
	payload: AskPayload,
	budget: { maxBytes: number; minCoverage?: number },
): InjectionPack | undefined {
	if (payload.hits.length === 0) return undefined;
	const minCoverage = budget.minCoverage ?? DEFAULT_MIN_COVERAGE;
	if (typeof payload.coverage === "number" && payload.coverage < minCoverage) return undefined;

	const bounded = boundText(renderAsk(payload), { maxBytes: budget.maxBytes, maxLines: 300 });
	if (!bounded.text.trim()) return undefined;
	return {
		text: bounded.text,
		references: askReferences(payload),
		bytes: Buffer.byteLength(bounded.text, "utf-8"),
		truncated: bounded.truncated,
		coverage: payload.coverage,
	};
}

/**
 * The injected message body.
 *
 * Three properties are load-bearing, so they are stated in the text itself:
 * where it came from, that it is derived rather than authoritative, and that
 * the model should verify before editing.
 */
export function injectionMessage(input: {
	pack: InjectionPack;
	mode: RetrievalMode;
	state: GraftStateName;
}): string {
	const { pack, mode, state } = input;
	const header =
		`<graft-context source="graft" mode="${mode}" graph="${state}" references="${pack.references.length}">`;
	return [
		header,
		"Repository context prepared by the Graft code-context extension before this turn.",
		"It is a derived summary of the working tree, not the source of truth: files in the",
		"repository are authoritative, so read them before changing anything, and treat a",
		"reachability claim here as a lead rather than proof.",
		"",
		pack.text,
		"</graft-context>",
	].join("\n");
}

/**
 * At-most-once injection per turn.
 *
 * `before_agent_start` runs once per user prompt, but a retried or replayed run
 * can reach it again, and a reload re-registers handlers. The guard makes the
 * seam idempotent regardless of how many times the hook fires.
 */
export function createInjectionGuard(): {
	shouldInject(): boolean;
	markInjected(): void;
	beginTurn(): void;
} {
	let injected = false;
	return {
		shouldInject: () => !injected,
		markInjected: () => {
			injected = true;
		},
		beginTurn: () => {
			injected = false;
		},
	};
}

/** One-line explanation of the current retrieval strategy, for `/graft status`. */
export function describeStrategy(mode: RetrievalMode): string {
	switch (mode) {
		case "pull":
			return "pull — the model calls Graft tools when it needs repository context (nothing is injected).";
		case "push":
			return "push — an eligible repository task starts from a bounded source-backed Graft pack.";
		case "hybrid":
			return "hybrid — an eligible repository task starts from a small orientation pack; tools stay available.";
	}
}
