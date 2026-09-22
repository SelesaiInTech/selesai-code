/** A small local-only bridge for extensions that need one read-only memory lookup. */
export const MEMORY_SEARCH_REQUEST_EVENT = "hermes-memory:search-request";

export type MemorySearchTarget = "memory" | "user" | "failure" | "project";

export interface MemorySearchRequestInput {
	query: string;
	target?: MemorySearchTarget;
	project?: string;
	category?: "failure" | "correction" | "insight" | "preference" | "convention" | "tool-quirk";
	limit?: number;
}

export interface MemorySearchResponse {
	success: boolean;
	count?: number;
	message?: string;
	output?: string;
}

export interface MemorySearchRequest {
	input: MemorySearchRequestInput;
	respond: (result: MemorySearchResponse) => void;
}

export function isMemorySearchRequest(value: unknown): value is MemorySearchRequest {
	if (typeof value !== "object" || value === null) return false;
	const request = value as Partial<MemorySearchRequest>;
	return typeof request.respond === "function" && typeof request.input?.query === "string";
}

/** Request a synchronous local lookup; no registered memory extension means no result. */
export function requestMemorySearch(
	events: { emit(channel: string, data: unknown): void },
	input: MemorySearchRequestInput,
): MemorySearchResponse | undefined {
	let result: MemorySearchResponse | undefined;
	events.emit(MEMORY_SEARCH_REQUEST_EVENT, { input, respond: (value: MemorySearchResponse) => (result ??= value) });
	return result;
}
