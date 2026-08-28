/**
 * Cost Reconcile — records the real billed cost the provider reports in its
 * own response payload, for any provider that includes one.
 *
 * pi-ai reads token counts from provider payloads but discards any
 * provider-reported `cost` field, recomputing cost from the local rate card.
 * For gateways (OpenRouter etc.) and custom catalog entries that bill with
 * their own tokenizers or dated pricing, the estimate diverges from the bill.
 *
 * Extensions cannot hook the response body through the event API
 * (`after_provider_response` exposes only status/headers), but provider SDKs
 * fall back to `globalThis.fetch`. This extension installs a tee-wrapping
 * fetch once per process: LLM API responses are scanned for a
 * provider-reported cost (LiteLLM `x-litellm-response-cost` header,
 * OpenRouter `usage.cost`, `total_cost`, plus object-shaped `cost.total`)
 * and its response id, then recorded as a custom session entry on
 * `message_end`.
 *
 * Providers whose payloads carry no cost (first-party OpenAI/Anthropic due to
 * their usage APIs) simply record nothing — their rate-card estimate matches
 * their bill anyway when catalog prices are configured.
 *
 * The zentui footer prefers reconciled entries over the rate-card total when
 * both exist for the same response id.
 */

import type { ExtensionAPI } from "@selesai/code";

const ENTRY_TYPE = "cost-reconcile";
const ENTRY_VERSION = 1 as const;

// Guard against pathological bodies; real usage chunks arrive well under 1MB.
const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;
// Only LLM API paths are tee'd and scanned; unrelated fetches (web fetch tool,
// model catalog refreshes) pass through untouched.
const LLM_PATH_RE = /(\/chat\/completions|\/responses|\/messages\b|:streamGenerateContent)/;
const MAX_CAPTURED_IDS = 50;
const MAX_PENDING_LOOKUPS = 200;
const MAX_SESSION_ENTRIES = 2_000;

type ReconcileEntry = {
	version: typeof ENTRY_VERSION;
	provider: string;
	model: string;
	responseId: string;
	/** Provider-reported billed cost in USD. */
	cost: number;
	reconciledAt: number;
	source: "payload";
};

/**
 * Scan a captured SSE/JSON body for provider-reported cost and response ids.
 * Exported for tests.
 *
 * In streams, usage lands in the final chunk, so the LAST cost match wins.
 */
type MessageInfo = {
	provider: string;
	model: string;
	responseId: string;
};

// Process-wide capture state. The fetch patch is installed once per process
// and must not capture session-bound `pi`; per-session message_end handlers
// read these maps and write entries through their own session's appendEntry.
const processCaptured = new Map<string, number>();
const processWaiting = new Map<
	string,
	{ info: MessageInfo; write: (info: MessageInfo, cost: number) => void }
>();

/**
 * Scan a captured SSE/JSON body for provider-reported cost and response ids.
 * Pure function; exported for tests.
 *
 * In streams, usage lands in the final chunk, so the LAST cost match wins.
 */
/**
 * Parse a LiteLLM `x-litellm-response-cost` header value (a USD float,
 * possibly in scientific notation). Exported for tests.
 */
export function parseCostHeader(value: string | null): number | undefined {
	if (value === null) return undefined;
	const cost = Number(value);
	return Number.isFinite(cost) && cost >= 0 ? cost : undefined;
}

export function extractCosts(
	text: string,
): { ids: string[]; cost?: number } {
	const ids = new Set<string>();
	for (const match of text.matchAll(/"id"\s*:\s*"([^"]{1,200})"/g)) {
		ids.add(match[1]);
		if (ids.size >= MAX_CAPTURED_IDS) break;
	}

	// OpenRouter native API uses `total_cost`; chat-completions streams use
	// `cost` (number or `{total}`); gateways behind the responses API have
	// been observed with object-shaped cost too.
	let cost: number | undefined;
	for (const match of text.matchAll(
		/"total_cost"\s*:\s*(-?[\d.eE+]+)|"cost"\s*:\s*(-?[\d.eE+]+)|"cost"\s*:\s*\{[^}]*?"total"\s*:\s*(-?[\d.eE+]+)/g,
	)) {
		const value = Number(match[1] ?? match[2] ?? match[3]);
		if (Number.isFinite(value) && value >= 0) cost = value;
	}

	return { ids: [...ids], cost };
}

function isLlmUrl(input: unknown): boolean {
	try {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input instanceof Request
						? input.url
						: undefined;
		if (!url) return false;
		if (!/^https?:/i.test(url)) return false;
		return LLM_PATH_RE.test(url);
	} catch {
		return false;
	}
}

/** Install the capture fetch once per process, across extension reloads. */
const FETCH_PATCHED = Symbol.for("selesai.cost-reconcile.fetch-patched");

export default function costReconcileExtension(pi: ExtensionAPI): void {
	/** Response ids already written to this session's file. */
	const seen = new Set<string>();
	let entriesWritten = 0;

	const writeEntry = (info: MessageInfo, cost: number): void => {
		if (seen.has(info.responseId) || entriesWritten >= MAX_SESSION_ENTRIES) return;
		seen.add(info.responseId);
		entriesWritten += 1;
		const entry: ReconcileEntry = {
			version: ENTRY_VERSION,
			provider: info.provider,
			model: info.model,
			responseId: info.responseId,
			cost,
			reconciledAt: Date.now(),
			source: "payload",
		};
		try {
			pi.appendEntry(ENTRY_TYPE, entry);
		} catch {
			// transcript persistence failure must not break the session
		}
	};

	const finishCapture = (rawBody: string, headerCost?: number): void => {
		// ponytail: one naive regex pass over the whole body; a streaming
		// parser only matters if bodies grow past the 4MB cap.
		const { ids, cost } = extractCosts(rawBody);
		// LiteLLM's header is the amount the gateway billed; prefer it over
		// any cost the upstream payload reports.
		const effectiveCost = headerCost ?? cost;
		if (effectiveCost === undefined) return;
		for (const responseId of ids) {
			processCaptured.set(responseId, effectiveCost);
			const waiting = processWaiting.get(responseId);
			if (waiting) {
				processWaiting.delete(responseId);
				waiting.write(waiting.info, effectiveCost);
			}
		}
		if (processCaptured.size > 500) {
			for (const key of [...processCaptured.keys()].slice(0, processCaptured.size - 500))
				processCaptured.delete(key);
		}
	};

	pi.on("session_start", (_event, ctx) => {
		try {
			const entries =
				(
					ctx.sessionManager as {
						getEntries?: () => readonly { type?: string; customType?: string; data?: ReconcileEntry }[];
					}
				).getEntries?.() ?? [];
			for (const entry of entries) {
				if (entry?.type !== "custom" || entry?.customType !== ENTRY_TYPE) continue;
				const responseId = entry?.data?.responseId;
				if (typeof responseId === "string") seen.add(responseId);
			}
		} catch {
			// best effort only
		}

		const globalFetch = globalThis as typeof globalThis & { [FETCH_PATCHED]?: boolean };
		if (globalFetch[FETCH_PATCHED]) return;
		globalFetch[FETCH_PATCHED] = true;
		const realFetch = globalThis.fetch.bind(globalThis);
		globalThis.fetch = async (input, init) => {
			const response = await realFetch(input as Parameters<typeof realFetch>[0], init);
			try {
				if (!isLlmUrl(input)) return response;
				const contentType = response.headers.get("content-type") ?? "";
				if (!contentType.includes("json") && !contentType.includes("event-stream")) return response;
				if (!response.body) return response;
				const headerCost = parseCostHeader(response.headers.get("x-litellm-response-cost"));
				const [main, tee] = response.body.tee();
				void (async () => {
					let raw = "";
					try {
						const reader = tee.getReader();
						const decoder = new TextDecoder();
						for (;;) {
							const { done, value } = await reader.read();
							if (done) break;
							raw += decoder.decode(value, { stream: true });
							if (raw.length > MAX_CAPTURE_BYTES) break;
						}
					} catch {
						// capture is best-effort; the main branch is unaffected
					}
					finishCapture(raw, headerCost);
				})();
				// Preserve response identity as seen by the SDK: body swapped, rest identical.
				return new Response(main, {
					status: response.status,
					statusText: response.statusText,
					headers: response.headers,
				});
			} catch {
				return response;
			}
		};
	});

	pi.on("message_end", (event) => {
		const message = event.message as
			| {
					role?: string;
					provider?: string;
					model?: string;
					responseId?: string;
					stopReason?: string;
				}
			| undefined;
		if (!message || message.role !== "assistant") return;
		if (message.stopReason === "error" || message.stopReason === "aborted") return;
		const responseId = message.responseId;
		if (typeof responseId !== "string" || responseId.length === 0) return;

		const info: MessageInfo = {
			provider: message.provider ?? "",
			model: message.responseModel ?? message.model ?? "",
			responseId,
		};
		const cost = processCaptured.get(responseId);
		if (cost !== undefined) {
			writeEntry(info, cost);
			return;
		}
		// The tee branch may finish after message_end; remember the message so
		// the capture can match it on completion and write via this session.
		if (!seen.has(responseId) && !processWaiting.has(responseId)) {
			waitingLimitGuard();
			processWaiting.set(responseId, { info, write: writeEntry });
		}
	});
}

// Trim oldest waiting entries so unclaimed captures cannot grow unbounded.
function waitingLimitGuard(): void {
	if (processWaiting.size >= MAX_PENDING_LOOKUPS) {
		for (const key of [...processWaiting.keys()].slice(0, processWaiting.size - MAX_PENDING_LOOKUPS + 1))
			processWaiting.delete(key);
	}
}