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
 * fall back to `globalThis.fetch`. This extension installs a stream-wrapping
 * fetch once per process: LLM API responses are scanned for a provider-reported
 * cost (LiteLLM `x-litellm-response-cost` header, OpenRouter `usage.cost`,
 * `total_cost`, plus object-shaped `cost.total`) and response id. The wrapper
 * finishes capture before the provider SDK finalizes its assistant message, so
 * `message_end` can replace `usage.cost.total` before session persistence.
 *
 * Providers whose payloads carry no cost retain their rate-card estimate.
 * Reconciled entries remain persisted for zentui and existing-session
 * compatibility.
 */

import type { ExtensionAPI } from "@selesai/code";

const ENTRY_TYPE = "cost-reconcile";
const ENTRY_VERSION = 1 as const;

// Guard against pathological bodies; real usage chunks arrive well under 1MB.
const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;
// Only LLM API paths are scanned; unrelated fetches (web fetch tool, model
// catalog refreshes) pass through untouched.
const LLM_PATH_RE = /(\/chat\/completions|\/responses|\/messages\b|:streamGenerateContent)/;
const MAX_CAPTURED_IDS = 50;
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

type MessageInfo = {
	provider: string;
	model: string;
	responseId: string;
};

// Process-wide capture state. The fetch patch is installed once per process;
// per-session message_end handlers consume the matching response id. A duplicate
// capture for the same id is marked ambiguous rather than assigning either bill.
const processCaptured = new Map<string, number | null>();

/**
 * Parse a LiteLLM `x-litellm-response-cost` header value (a USD float,
 * possibly in scientific notation). Exported for tests.
 */
export function parseCostHeader(value: string | null): number | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	const cost = Number(trimmed);
	return Number.isFinite(cost) && cost >= 0 ? cost : undefined;
}

/**
 * Scan a captured SSE/JSON body for provider-reported cost and response ids.
 * Exported for tests. In streams, usage lands in the final chunk, so the LAST
 * valid cost match wins.
 */
export function extractCosts(text: string): { ids: string[]; cost?: number } {
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
			// Transcript persistence failure must not break the session.
		}
	};

	const finishCapture = (rawBody: string, headerCost?: number): void => {
		// Ponytail: one naive regex pass over the whole body; a streaming parser
		// only matters if bodies grow past the 4MB cap.
		const { ids, cost } = extractCosts(rawBody);
		// LiteLLM's header is the amount the gateway billed; prefer it over any
		// cost the upstream payload reports.
		const effectiveCost = headerCost ?? cost;
		// A cost must identify exactly one response. Applying it to every `id` in
		// a body can mistake nested tool/message ids for the assistant response.
		if (effectiveCost === undefined || ids.length !== 1) return;
		const responseId = ids[0]!;
		processCaptured.set(responseId, processCaptured.has(responseId) ? null : effectiveCost);
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
			// Best effort only.
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
				let raw = "";
				let captureFailed = false;
				const decoder = new TextDecoder();
				const capture = new TransformStream<Uint8Array, Uint8Array>({
					transform(chunk, controller) {
						controller.enqueue(chunk);
						if (captureFailed) return;
						try {
							raw += decoder.decode(chunk, { stream: true });
							if (raw.length > MAX_CAPTURE_BYTES) captureFailed = true;
						} catch {
							captureFailed = true;
						}
					},
					flush() {
						if (captureFailed) return;
						try {
							raw += decoder.decode();
							finishCapture(raw, headerCost);
						} catch {
							// Capture is best-effort; the response stream is unaffected.
						}
					},
				});
				// flush() runs before the SDK observes EOF, so message_end can safely
				// replace the finalized message usage without waiting on another fetch.
				const body = response.body.pipeThrough(capture);
				return new Response(body, {
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
		const message = event.message;
		if (message.role !== "assistant") return;
		if (message.stopReason === "error" || message.stopReason === "aborted") return;
		const responseId = message.responseId;
		if (typeof responseId !== "string" || responseId.length === 0) return;

		const cost = processCaptured.get(responseId);
		if (cost === undefined || cost === null || !message.usage?.cost) {
			processCaptured.delete(responseId);
			return;
		}
		processCaptured.delete(responseId);

		writeEntry(
			{
				provider: message.provider ?? "",
				model: message.responseModel ?? message.model ?? "",
				responseId,
			},
			cost,
		);
		return {
			message: {
				...message,
				usage: { ...message.usage, cost: { ...message.usage.cost, total: cost } },
			},
		};
	});
}
