/**
 * TPS Tracker — tokens-per-second tracking merged into the powerline footer.
 *
 * Writes live and final TPS stats to `ctx.ui.setStatus("tps", ...)`, which the
 * powerline `extension_statuses` segment surfaces in the status bar (and the
 * `setExtensionStatus` repaint hook turns into a re-render automatically).
 *
 * Tracks:
 *  - Main model output tokens vs. streaming wall time (excludes first-token
 *    latency and tool execution gaps).
 *  - pi-subagents child output tokens via tool_execution_* events, aggregated
 *    into a combined "main + subagents" TPS at agent_end.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function setupTpsTracker(pi: ExtensionAPI): void {
	/** Timestamp when the current assistant message event started. Used as a fallback. */
	let messageStart: number | null = null;
	/** Timestamp of the first streamed output delta for the current assistant message. */
	let streamStart: number | null = null;
	/** Estimated streamed output tokens for live display before providers report final usage. */
	let estimatedStreamedTokens = 0;
	/** Cumulative official output tokens across all assistant messages in this agent run. */
	let totalOutputTokens = 0;
	/** Cumulative time (ms) spent actually streaming output deltas (excludes tool execution and first-token latency). */
	let totalStreamMs = 0;
	/** Subagent tool-call start times, used to include pi-subagents child output in aggregate TPS. */
	const subagentStarts = new Map<string, number>();
	/** Latest cumulative foreground subagent tokens seen during tool_execution_update. */
	const subagentLiveTokens = new Map<string, number>();
	/** Cumulative subagent output tokens in this agent run. */
	let totalSubagentTokens = 0;
	/** Cumulative subagent wall time (ms) in this agent run. */
	let totalSubagentMs = 0;
	/** Completed subagent call summaries in this agent run. */
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

	function generatedTokensFromMessage(message: { usage?: unknown; content?: unknown }): number {
		const usageTokens = generatedTokensFromUsage(asRecord(message.usage));
		if (usageTokens > 0) return usageTokens;

		const content = Array.isArray(message.content) ? message.content : [];
		const chars = content.reduce((sum, block) => {
			const item = asRecord(block);
			if (!item) return sum;
			if (item.type === "text") return sum + String(item.text ?? "").length;
			if (item.type === "thinking") return sum + String(item.thinking ?? "").length;
			if (item.type === "toolCall") return sum + String(item.name ?? "").length + JSON.stringify(item.arguments ?? {}).length;
			return sum;
		}, 0);
		return Math.ceil(chars / 4);
	}

	function outputTokensFromResult(value: unknown): number {
		const results = getResults(value);
		return results.reduce((sum, result) => sum + generatedTokensFromUsage(asRecord(result.usage)), 0);
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
		totalOutputTokens = 0;
		totalStreamMs = 0;
		totalSubagentTokens = 0;
		totalSubagentMs = 0;
		subagentSummaries.length = 0;
		messageStart = null;
		streamStart = null;
		estimatedStreamedTokens = 0;
		subagentStarts.clear();
		subagentLiveTokens.clear();
		const theme = ctx.ui.theme;
		ctx.ui.setStatus("tps", theme.fg("success", "generating..."));
	});

	pi.on("message_start", async (event) => {
		if (event.message.role !== "assistant") return;
		messageStart = Date.now();
		streamStart = null;
		estimatedStreamedTokens = 0;
	});

	pi.on("message_update", async (event, ctx) => {
		if (event.message.role !== "assistant") return;

		const streamEvent = event.assistantMessageEvent;
		const isOutputDelta =
			streamEvent.type === "text_delta" ||
			streamEvent.type === "thinking_delta" ||
			streamEvent.type === "toolcall_delta";

		if (!isOutputDelta) return;

		const now = Date.now();
		streamStart ??= now;
		estimatedStreamedTokens += Math.max(0, streamEvent.delta.length / 4);

		const elapsed = (now - streamStart) / 1000;
		const officialTokens = generatedTokensFromUsage(asRecord(event.message.usage));
		const currentTokens = officialTokens > 0 ? officialTokens : estimatedStreamedTokens;

		if (elapsed > 0 && currentTokens > 0) {
			const tps = Math.round(currentTokens / elapsed);
			const tokenLabel = officialTokens > 0
				? `${officialTokens} tok`
				: `~${Math.round(estimatedStreamedTokens)} tok`;
			const theme = ctx.ui.theme;
			ctx.ui.setStatus(
				"tps",
				`${theme.fg("accent", `${tps} tok/s`)}`,
			);
		}
	});

	pi.on("message_end", async (event) => {
		if (event.message.role !== "assistant") return;

		const messageTokens = generatedTokensFromMessage(event.message);
		const timingStart = streamStart ?? messageStart;
		if (!timingStart || messageTokens <= 0) {
			messageStart = null;
			streamStart = null;
			estimatedStreamedTokens = 0;
			return;
		}

		totalOutputTokens += messageTokens;
		totalStreamMs += Math.max(0, Date.now() - timingStart);

		messageStart = null;
		streamStart = null;
		estimatedStreamedTokens = 0;
	});

	pi.on("tool_execution_start", async (event) => {
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
		const agentSummary = items
			.filter((item) => item.tokens > 0 || item.status === "running")
			.map((item) => `${item.name} ${Math.round(item.tokens / elapsed)} t/s`)
			.join(" ");
		const theme = ctx.ui.theme;
		ctx.ui.setStatus("tps", `${theme.fg("accent", `main+${mode} ${tps} t/s`)} ${theme.fg("success", `(${agentSummary || `${tps} t/s`})`)}`);
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
		const mode = subagentModeLabel(event.result);
		const elapsedMs = Math.max(0, Date.now() - start);
		if (displayTokens <= 0 || elapsedMs <= 0) return;
		const elapsedSeconds = elapsedMs / 1000;
		const items = subagentProgressItems(event.result);
		const agentSummary = items
			.filter((item) => item.tokens > 0)
			.map((item) => `${item.name} ${Math.round(item.tokens / elapsedSeconds)} t/s`)
			.join(" ");

		totalOutputTokens += displayTokens;
		totalStreamMs += elapsedMs;
		totalSubagentTokens += displayTokens;
		totalSubagentMs += elapsedMs;

		const tps = Math.round(displayTokens / elapsedSeconds);
		subagentSummaries.push({ tokens: displayTokens, ms: elapsedMs, tps });
		const theme = ctx.ui.theme;
		ctx.ui.notify(`${theme.fg("success", "✓")} ${theme.fg("accent", `${tps} t/s`)}`, "info");
		ctx.ui.setStatus(
			"tps",
			`${theme.fg("accent", `main+${mode} ${tps} t/s`)} ${theme.fg("success", `(${agentSummary || `${tps} t/s`})`)}`,
		);
	});

	pi.on("agent_end", async (_event, ctx) => {
		const elapsed = totalStreamMs / 1000;
		const tps = totalOutputTokens > 0 && elapsed > 0 ? Math.round(totalOutputTokens / elapsed) : 0;

		const theme = ctx.ui.theme;
		const icon = theme.fg("success", "✓");
		const tpsLabel = tps > 0
			? theme.fg("accent", `${tps} t/s`)
			: theme.fg("success", "N/A");
		const mainTokens = totalOutputTokens - totalSubagentTokens;
		const mainMs = totalStreamMs - totalSubagentMs;
		const mainTps = mainTokens > 0 && mainMs > 0 ? Math.round(mainTokens / (mainMs / 1000)) : 0;
		const subagentTps = totalSubagentTokens > 0 && totalSubagentMs > 0
			? Math.round(totalSubagentTokens / (totalSubagentMs / 1000))
			: 0;
		const mainDetail = mainTps > 0 ? theme.fg("success", ` | main ${mainTps} t/s`) : "";
		const subagentDetail = subagentTps > 0
			? theme.fg("success", ` | subagents ${subagentTps} t/s (${subagentSummaries.length} call${subagentSummaries.length === 1 ? "" : "s"})`)
			: "";

		ctx.ui.notify(`${icon} total ${tpsLabel}${mainDetail}${subagentDetail}`, "info");
		const finalMainStatus = mainTps > 0 ? `main ${mainTps} t/s` : "main N/A";
		const finalSubagentStatus = totalSubagentTokens > 0 && totalSubagentMs > 0
			? `subagents ${Math.round(totalSubagentTokens / (totalSubagentMs / 1000))} t/s`
			: "";
		ctx.ui.setStatus(
			"tps",
			`${theme.fg("accent", `done ${tps} t/s`)} ${theme.fg("success", `(${[finalMainStatus, finalSubagentStatus].filter(Boolean).join(" ")})`)}`,
		);
	});
}
