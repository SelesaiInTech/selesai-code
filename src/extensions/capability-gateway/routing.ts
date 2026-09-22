/**
 * Capability-gateway Jev-assisted tool tie-breaking.
 *
 * The deterministic catalog router stays the first and only Jev trigger: when it returns an
 * ambiguous lexical hint among optional tools, the gateway offers just those hinted tools to Jev
 * as one bounded choice question. Jev may answer `none` or one hinted canonical tool name; the
 * host revalidates eligibility against the live catalog before activating anything for this run.
 *
 * Jev never sees a tool schema, prior conversation, or the full eligible catalog: the request
 * carries the bounded current prompt and two or three hinted discovery lines. It is never consulted for a unique deterministic activation, a skill-only match, or a
 * prompt with no lexical tool signal; every failure, timeout, low-confidence answer, or `none` is
 * an abstention that leaves the deterministic behavior in place. The transport and validation half
 * lives in the shared `../jev/decisions.ts` client.
 *
 * Configuration (opt-in, disabled by default). The gateway reads its own settings area — it does
 * not inherit `jevAdvisory` route policy; only the Jev provider/model identity is shared so every
 * Jev consumer defaults to the same deployment:
 *
 *   "capabilityGateway": {
 *     "routing": { "jev": { "enabled": true, "timeoutMs": 1000, "minConfidence": 0.6 } }
 *   }
 */
import { readFileSync } from "node:fs";
import { getSettingsPath, type ExtensionContext } from "@selesai/code";
import {
	askJev,
	buildConversation,
	buildJevPayload,
	DEFAULT_JEV_ADVISORY_CONFIG,
	JEV_REQUEST_MAX_BYTES,
	type JevAbstainReason as JevClientAbstainReason,
	type JevConnection,
	type JevDecision,
	type JevQuestion,
} from "../jev/decisions.ts";
import type { CatalogEntry } from "./catalog.ts";

/** Choice-question key for capability routing. */
export const JEV_CAPABILITY_QUESTION = "capability";

/** The abstention answer that is always offered to Jev. */
export const NO_TOOL = "none";

/** Jev only breaks real ties: offer two or three hinted tools, never a singleton. */
export const MIN_GATEWAY_JEV_CANDIDATES = 2;
export const MAX_GATEWAY_JEV_CANDIDATES = 3;

/** Bounded slice of the current prompt sent as Jev's only conversation material. */
export const GATEWAY_JEV_PROMPT_CHARS = 2_000;

/**
 * A pre-turn tie-break must not hold up the run: the default timeout is short even though the
 * shared advisory default is 8s, and `gatewayJevConnection` hard-caps any configured override.
 */
export const DEFAULT_GATEWAY_JEV_TIMEOUT_MS = 1_000;
export const GATEWAY_JEV_MAX_TIMEOUT_MS = 2_000;

/** One gateway route's Jev settings: the shared Jev endpoint plus this route's timing. */
export interface GatewayJevConfig {
	enabled: boolean;
	provider: string;
	model: string;
	baseUrl?: string;
	timeoutMs: number;
	minConfidence: number;
	/** Hard cap on the serialized decision request; oversized requests abstain. */
	payloadBytes: number;
}

export const DEFAULT_GATEWAY_JEV_CONFIG: GatewayJevConfig = {
	enabled: false,
	// The Jev deployment identity, shared with every other Jev consumer.
	provider: DEFAULT_JEV_ADVISORY_CONFIG.provider,
	model: DEFAULT_JEV_ADVISORY_CONFIG.model,
	timeoutMs: DEFAULT_GATEWAY_JEV_TIMEOUT_MS,
	minConfidence: 0.6,
	payloadBytes: 8_192,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOr(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function numberOr(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Read `capabilityGateway.routing.jev` over the gateway defaults. Never throws. */
export function readGatewayJevConfig(settingsPath: string = getSettingsPath()): GatewayJevConfig {
	let raw: Record<string, unknown> | undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(settingsPath, "utf-8"));
		if (isRecord(parsed) && isRecord(parsed.capabilityGateway) && isRecord(parsed.capabilityGateway.routing)) {
			const jev = parsed.capabilityGateway.routing.jev;
			if (isRecord(jev)) raw = jev;
		}
	} catch {
		// Missing or malformed settings: the feature stays disabled.
	}
	if (!raw) return DEFAULT_GATEWAY_JEV_CONFIG;

	const baseUrl = raw.baseUrl;
	return {
		enabled: raw.enabled === true,
		provider: stringOr(raw.provider, DEFAULT_GATEWAY_JEV_CONFIG.provider),
		model: stringOr(raw.model, DEFAULT_GATEWAY_JEV_CONFIG.model),
		baseUrl: typeof baseUrl === "string" && baseUrl.trim() !== "" ? baseUrl : undefined,
		timeoutMs: numberOr(raw.timeoutMs, DEFAULT_GATEWAY_JEV_CONFIG.timeoutMs),
		minConfidence: numberOr(raw.minConfidence, DEFAULT_GATEWAY_JEV_CONFIG.minConfidence),
		payloadBytes: numberOr(raw.payloadBytes, DEFAULT_GATEWAY_JEV_CONFIG.payloadBytes),
	};
}

/** The transport settings this route uses, with the pre-turn timeout hard-capped. */
export function gatewayJevConnection(config: GatewayJevConfig): JevConnection {
	return {
		provider: config.provider,
		model: config.model,
		baseUrl: config.baseUrl,
		timeoutMs: Math.min(config.timeoutMs, GATEWAY_JEV_MAX_TIMEOUT_MS),
		minConfidence: config.minConfidence,
	};
}

/**
 * The tools an ambiguous deterministic hint may offer Jev: eligible extension tools only, never
 * skills or always-active tools, capped at `MAX_GATEWAY_JEV_CANDIDATES`.
 */
export function hintedToolCandidates(hints: readonly CatalogEntry[] = []): CatalogEntry[] {
	// ponytail: retain catalog order after the cap; add specificity ranking if real hint ties crowd out candidates.
	return hints.filter((entry) => entry.kind === "tool" && entry.eligible).slice(0, MAX_GATEWAY_JEV_CANDIDATES);
}

/** Allowlisted choices: `none` plus one compact discovery-metadata line per candidate. */
export function candidateCriteria(candidates: CatalogEntry[]): Record<string, string> {
	const criteria: Record<string, string> = {
		[NO_TOOL]: "No optional tool is needed for the latest request.",
	};
	for (const candidate of candidates) {
		const category = candidate.category ? ` Category: ${candidate.category}.` : "";
		const aliases = candidate.aliases.length > 0 ? ` Aliases: ${candidate.aliases.join(", ")}.` : "";
		criteria[candidate.name] = `${candidate.summary}${category}${aliases}`;
	}
	return criteria;
}

/** Why no tool was routed: a clean `none`, an empty candidate set, or an absent Jev decision. */
export type JevToolAbstainReason = "none" | "no-candidates" | "unquantified" | JevClientAbstainReason;

export type JevToolRoute =
	| { selected: true; tool: string; confidence: number; candidates: number; elapsedMs: number }
	| { selected: false; reason: JevToolAbstainReason; candidates: number; elapsedMs: number };

/** Absence reasons that mean Jev could not be consulted at all, rather than answering nothing. */
export const JEV_UNAVAILABLE_REASONS: ReadonlySet<JevToolAbstainReason> = new Set([
	"no-template",
	"no-credential",
	"timeout",
	"transport",
]);

/** The decision call, injectable so catalog routing is testable without a live transport. */
export type JevAsk = typeof askJev;

/**
 * Offer the hinted tools to Jev and return the tool it selected for this run. Anything outside one
 * confident, canonical, allowlisted choice is an abstention.
 */
export async function routeToJevTool(
	hints: readonly CatalogEntry[],
	prompt: string,
	ctx: Pick<ExtensionContext, "modelRegistry">,
	config: GatewayJevConfig,
	ask: JevAsk = askJev,
): Promise<JevToolRoute> {
	const candidates = hintedToolCandidates(hints);
	if (candidates.length === 0) return { selected: false, reason: "no-candidates", candidates: 0, elapsedMs: 0 };

	const question: JevQuestion = {
		question:
			"Which single hinted optional tool should be activated for the latest request in `conversation`, " +
			"or `none` when none of them is clearly needed?",
		focus: "Choose `none` unless exactly one listed tool is clearly needed; the prompt only weakly suggests these tools.",
		criteria: candidateCriteria(candidates),
	};
	// Only the current prompt, bounded: no prior conversation, no tool schema, no history.
	const payload = buildJevPayload(
		buildConversation(prompt, [], { contextTurns: 1, contextChars: GATEWAY_JEV_PROMPT_CHARS }),
		{ [JEV_CAPABILITY_QUESTION]: question },
	);
	const decision = await ask(ctx, gatewayJevConnection(config), {
		payload,
		maxBytes: Math.min(config.payloadBytes, JEV_REQUEST_MAX_BYTES),
		allowed: { [JEV_CAPABILITY_QUESTION]: [NO_TOOL, ...candidates.map((candidate) => candidate.name)] },
	});

	const abstained = (reason: JevToolAbstainReason): JevToolRoute => ({
		selected: false,
		reason,
		candidates: candidates.length,
		elapsedMs: decision.elapsedMs,
	});
	const answer = decision.choices[JEV_CAPABILITY_QUESTION];
	if (!answer) {
		return abstained(decision.rejected[JEV_CAPABILITY_QUESTION] ?? decision.failure ?? "missing");
	}
	if (answer.choice === NO_TOOL) return abstained("none");
	// A choice without a numeric confidence is not a confident enough answer to activate a tool.
	if (answer.confidence === undefined) return abstained("unquantified");
	return {
		selected: true,
		tool: answer.choice,
		confidence: answer.confidence,
		candidates: candidates.length,
		elapsedMs: decision.elapsedMs,
	};
}
