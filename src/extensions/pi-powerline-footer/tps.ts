/**
 * TPS Tracker — tokens-per-second tracking merged into the powerline footer.
 *
 * Live status remains intentionally approximate. Final main-model TPS uses
 * provider output usage plus pi-tps' reliability, stall, and tool-call gates.
 * Subagent UI/aggregation remains separate.
 */

import type { ExtensionAPI } from "@selesai/code";

const STALL_THRESHOLD_MS = 500;
const MAX_PLAUSIBLE_TPS = 10_000;
const MIN_STREAM_MS = 1;
const MIN_STREAM_UPDATES = 5;
const MIN_INTER_CHUNK_MS = 1;
const MIN_GENERATION_MS = 200;
const ACTIVE_TIME_THRESHOLD_MS = 200;
const STALL_REDUCTION_DENOM = 2;
const STALL_DOMINANCE_RATIO = 0.85;

export interface TpsTiming {
	messageStartMs: number;
	lastUpdateMs: number;
	firstTokenMs: number | null;
	updateCount: number;
	firstStreamUpdateMs: number | null;
	lastStreamUpdateMs: number;
	stallMs: number;
	generationMs: number;
}

export interface ReliableTps {
	tps: number;
	effectiveMs: number;
	isPrimary: boolean;
}

/** Port of pi-tps' primary/fallback reliability and volume gates. */
export function calculateReliableTps(outputTokens: number, timing: TpsTiming): ReliableTps | null {
	if (outputTokens <= 0 || timing.firstTokenMs === null) return null;

	const streamMs = timing.updateCount > 0 && timing.firstStreamUpdateMs !== null
		? timing.lastStreamUpdateMs - timing.firstStreamUpdateMs
		: null;
	const avgInterChunkGap = streamMs !== null && timing.updateCount > 1
		? streamMs / (timing.updateCount - 1)
		: 0;

	let tps: number | null = null;
	let effectiveMs = 0;
	let isPrimary = false;
	if (
		streamMs !== null &&
		streamMs >= MIN_STREAM_MS &&
		timing.updateCount >= MIN_STREAM_UPDATES &&
		avgInterChunkGap >= MIN_INTER_CHUNK_MS &&
		timing.stallMs < streamMs &&
		streamMs - timing.stallMs >= MIN_GENERATION_MS &&
		timing.stallMs < streamMs - timing.stallMs
	) {
		effectiveMs = streamMs - timing.stallMs;
		tps = Math.round((outputTokens / (effectiveMs / 1000)) * 10) / 10;
		isPrimary = true;
	} else if (timing.updateCount >= 2 && timing.generationMs >= MIN_GENERATION_MS) {
		const stallsDominate =
			timing.generationMs - timing.stallMs < ACTIVE_TIME_THRESHOLD_MS ||
			timing.stallMs > timing.generationMs * STALL_DOMINANCE_RATIO;
		effectiveMs = stallsDominate
			? Math.max(timing.generationMs - timing.stallMs / STALL_REDUCTION_DENOM, MIN_GENERATION_MS)
			: Math.max(timing.generationMs - timing.stallMs, MIN_GENERATION_MS);
		tps = Math.round((outputTokens / (effectiveMs / 1000)) * 10) / 10;
	}

	if (tps === null || tps > MAX_PLAUSIBLE_TPS) return null;
	return { tps, effectiveMs, isPrimary };
}

export function setupTpsTracker(pi: ExtensionAPI): void {
	let messageStart: number | null = null;
	let streamStart: number | null = null;
	let estimatedStreamedTokens = 0;
	let mainTiming: TpsTiming | null = null;
	const mainMeasurements: Array<{
		outputTokens: number;
		timing: TpsTiming;
		modelKey: string | null;
		isToolCall: boolean;
	}> = [];
	let pendingToolMeasurement: (typeof mainMeasurements)[number] | null = null;
	const tpsCaps = new Map<string, number>();

	const subagentStarts = new Map<string, number>();
	const subagentLiveTokens = new Map<string, number>();
	let totalSubagentTokens = 0;
	let totalSubagentMs = 0;
	const subagentSummaries: Array<{ tokens: number; ms: number; tps: number }> = [];

	function asRecord(value: unknown): Record<string, unknown> | null {
		return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
	}

	function numberValue(value: unknown): number {
		return typeof value === "number" && Number.isFinite(value) ? value : 0;
	}

	function getDetailsResult(value: unknown): Record<string, unknown> {
		const result = asRecord(value);
		const details = asRecord(result?.details);
		return details ?? result ?? {};
	}

	function getResults(value: unknown): Record<string, unknown>[] {
		const details = getDetailsResult(value);
		return Array.isArray(details.results)
			? details.results.map(asRecord).filter((item): item is Record<string, unknown> => !!item)
			: [];
	}

	function generatedTokensFromUsage(usage: Record<string, unknown> | null): number {
		return numberValue(usage?.output ?? usage?.outputTokens ?? usage?.completionTokens ?? usage?.completion_tokens);
	}

	function outputTokensFromResult(value: unknown): number {
		return getResults(value).reduce((sum, result) => sum + generatedTokensFromUsage(asRecord(result.usage)), 0);
	}

	function liveTokensFromResult(value: unknown): number {
		return subagentProgressItems(value).reduce((sum, item) => sum + item.tokens, 0);
	}

	function subagentProgressItems(value: unknown): Array<{ name: string; tokens: number; status?: string }> {
		const details = getDetailsResult(value);
		const progress = Array.isArray(details.progress) ? details.progress : undefined;
		const resultItems = getResults(value).map((result, index) => {
			const progress = asRecord(result.progress);
			const usage = asRecord(result.usage);
			return {
				name: String(result.agent || progress?.agent || `agent${index + 1}`),
				tokens: generatedTokensFromUsage(usage) || generatedTokensFromUsage(progress),
				status: typeof progress?.status === "string" ? progress.status : undefined,
			};
		});
		if (!progress || resultItems.some((item) => item.tokens > 0)) return resultItems;

		return progress.map((entry, index) => {
			const item = asRecord(entry) ?? {};
			return {
				name: String(item.agent || `agent${index + 1}`),
				tokens: generatedTokensFromUsage(item),
				status: typeof item.status === "string" ? item.status : undefined,
			};
		});
	}

	function subagentModeLabel(value: unknown): string {
		const details = getDetailsResult(value);
		const mode = typeof details.mode === "string" ? details.mode : "subagents";
		return mode === "parallel" ? "parallel" : mode === "chain" ? "chain" : "subagent";
	}

	pi.on("agent_start", async (_event, ctx) => {
		mainMeasurements.length = 0;
		pendingToolMeasurement = null;
		mainTiming = null;
		totalSubagentTokens = 0;
		totalSubagentMs = 0;
		subagentSummaries.length = 0;
		messageStart = null;
		streamStart = null;
		estimatedStreamedTokens = 0;
		subagentStarts.clear();
		subagentLiveTokens.clear();
		ctx.ui.setStatus("tps", ctx.ui.theme.fg("success", "generating..."));
	});

	pi.on("message_start", async (event) => {
		if (event.message.role !== "assistant") return;
		const now = performance.now();
		messageStart = now;
		streamStart = null;
		estimatedStreamedTokens = 0;
		mainTiming = {
			messageStartMs: now,
			lastUpdateMs: now,
			firstTokenMs: null,
			updateCount: 0,
			firstStreamUpdateMs: null,
			lastStreamUpdateMs: 0,
			stallMs: 0,
			generationMs: 0,
		};
		pendingToolMeasurement = null;
	});

	pi.on("message_update", async (event, ctx) => {
		if (event.message.role !== "assistant") return;

		const now = performance.now();
		if (mainTiming) {
			if (mainTiming.firstTokenMs === null) {
				mainTiming.firstTokenMs = now;
				mainTiming.lastUpdateMs = now;
			} else {
				mainTiming.updateCount++;
				mainTiming.firstStreamUpdateMs ??= now;
				mainTiming.lastStreamUpdateMs = now;
				const gap = now - mainTiming.lastUpdateMs;
				if (gap >= STALL_THRESHOLD_MS) mainTiming.stallMs += gap;
				mainTiming.lastUpdateMs = now;
			}
		}

		const streamEvent = event.assistantMessageEvent;
		const isOutputDelta =
			streamEvent.type === "text_delta" ||
			streamEvent.type === "thinking_delta" ||
			streamEvent.type === "toolcall_delta";
		if (!isOutputDelta) return;

		streamStart ??= now;
		estimatedStreamedTokens += Math.max(0, streamEvent.delta.length / 4);
		const elapsed = (now - streamStart) / 1000;
		const officialTokens = generatedTokensFromUsage(asRecord(event.message.usage));
		const currentTokens = officialTokens > 0 ? officialTokens : estimatedStreamedTokens;
		if (elapsed > 0 && currentTokens > 0) {
			ctx.ui.setStatus("tps", ctx.ui.theme.fg("accent", `${Math.round(currentTokens / elapsed)} tok/s`));
		}
	});

	pi.on("message_end", async (event) => {
		if (event.message.role !== "assistant") return;

		const now = performance.now();
		if (mainTiming) {
			mainTiming.generationMs = now - mainTiming.messageStartMs;
			const message = asRecord(event.message);
			const provider = typeof message?.provider === "string" ? message.provider : null;
			const model = typeof message?.model === "string" ? message.model : null;
			const outputTokens = generatedTokensFromUsage(asRecord(message?.usage));
			if (outputTokens > 0) {
				const measurement = {
					outputTokens,
					timing: mainTiming,
					modelKey: provider && model ? `${provider}:${model}` : null,
					isToolCall: false,
				};
				mainMeasurements.push(measurement);
				pendingToolMeasurement = measurement;
			}
		}

		mainTiming = null;
		messageStart = null;
		streamStart = null;
		estimatedStreamedTokens = 0;
	});

	pi.on("tool_execution_start", async (event) => {
		if (pendingToolMeasurement) pendingToolMeasurement.isToolCall = true;
		if (event.toolName !== "subagent") return;
		subagentStarts.set(event.toolCallId, Date.now());
	});

	pi.on("tool_execution_update", async (event, ctx) => {
		if (event.toolName !== "subagent") return;
		const start = subagentStarts.get(event.toolCallId);
		if (!start) return;

		const items = subagentProgressItems(event.partialResult);
		const tokens = items.reduce((sum, item) => sum + item.tokens, 0);
		subagentLiveTokens.set(event.toolCallId, tokens);
		const elapsed = (Date.now() - start) / 1000;
		if (tokens <= 0 || elapsed <= 0) return;

		const tps = Math.round(tokens / elapsed);
		const mode = subagentModeLabel(event.partialResult);
		const agentSummary = items.filter((item) => item.tokens > 0 || item.status === "running")
			.map((item) => `${item.name} ${Math.round(item.tokens / elapsed)} t/s`).join(" ");
		ctx.ui.setStatus("tps", `${ctx.ui.theme.fg("accent", `main+${mode} ${tps} t/s`)} ${ctx.ui.theme.fg("success", `(${agentSummary || `${tps} t/s`})`)}`);
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		if (event.toolName !== "subagent") return;
		const start = subagentStarts.get(event.toolCallId);
		subagentStarts.delete(event.toolCallId);
		const liveTokens = subagentLiveTokens.get(event.toolCallId) ?? liveTokensFromResult(event.result);
		subagentLiveTokens.delete(event.toolCallId);
		if (!start || event.isError) return;

		const outputTokens = outputTokensFromResult(event.result);
		const displayTokens = outputTokens || liveTokens;
		const elapsedMs = Math.max(0, Date.now() - start);
		if (displayTokens <= 0 || elapsedMs <= 0) return;
		const elapsedSeconds = elapsedMs / 1000;
		const items = subagentProgressItems(event.result);
		const agentSummary = items.filter((item) => item.tokens > 0)
			.map((item) => `${item.name} ${Math.round(item.tokens / elapsedSeconds)} t/s`).join(" ");
		const tps = Math.round(displayTokens / elapsedSeconds);
		const mode = subagentModeLabel(event.result);

		totalSubagentTokens += displayTokens;
		totalSubagentMs += elapsedMs;
		subagentSummaries.push({ tokens: displayTokens, ms: elapsedMs, tps });
		ctx.ui.notify(`${ctx.ui.theme.fg("success", "✓")} ${ctx.ui.theme.fg("accent", `${tps} t/s`)}`, "info");
		ctx.ui.setStatus("tps", `${ctx.ui.theme.fg("accent", `main+${mode} ${tps} t/s`)} ${ctx.ui.theme.fg("success", `(${agentSummary || `${tps} t/s`})`)}`);
	});

	pi.on("agent_end", async (_event, ctx) => {
		let measuredMainTokens = 0;
		let measuredMainMs = 0;
		for (const measurement of mainMeasurements) {
			if (!measurement.modelKey) continue;
			const reliable = calculateReliableTps(measurement.outputTokens, measurement.timing);
			if (!reliable) continue;

			let tps = reliable.tps;
			if (measurement.isToolCall) {
				const cap = tpsCaps.get(measurement.modelKey);
				if (cap === undefined) continue;
				tps = Math.min(tps, cap);
			} else if (reliable.isPrimary) {
				const cap = tpsCaps.get(measurement.modelKey);
				if (cap === undefined || tps > cap) tpsCaps.set(measurement.modelKey, tps);
			}
			measuredMainTokens += tps * (reliable.effectiveMs / 1000);
			measuredMainMs += reliable.effectiveMs;
		}

		const totalTokens = measuredMainTokens + totalSubagentTokens;
		const totalMs = measuredMainMs + totalSubagentMs;
		const tps = totalTokens > 0 && totalMs > 0 ? Math.round(totalTokens / (totalMs / 1000)) : 0;
		const mainTps = measuredMainTokens > 0 && measuredMainMs > 0
			? Math.round(measuredMainTokens / (measuredMainMs / 1000)) : 0;
		const subagentTps = totalSubagentTokens > 0 && totalSubagentMs > 0
			? Math.round(totalSubagentTokens / (totalSubagentMs / 1000)) : 0;
		const theme = ctx.ui.theme;
		const mainDetail = mainTps > 0 ? theme.fg("success", ` | main ${mainTps} t/s`) : "";
		const subagentDetail = subagentTps > 0
			? theme.fg("success", ` | subagents ${subagentTps} t/s (${subagentSummaries.length} call${subagentSummaries.length === 1 ? "" : "s"})`) : "";
		ctx.ui.notify(`${theme.fg("success", "✓")} total ${tps > 0 ? theme.fg("accent", `${tps} t/s`) : theme.fg("success", "N/A")}${mainDetail}${subagentDetail}`, "info");
		const finalMainStatus = mainTps > 0 ? `main ${mainTps} t/s` : "main N/A";
		const finalSubagentStatus = subagentTps > 0 ? `subagents ${subagentTps} t/s` : "";
		ctx.ui.setStatus("tps", `${theme.fg("accent", `done ${tps} t/s`)} ${theme.fg("success", `(${[finalMainStatus, finalSubagentStatus].filter(Boolean).join(" ")})`)}`);
	});
}
