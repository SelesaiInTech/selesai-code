/**
 * auto-session-name
 *
 * Names the session using the currently selected model, but only when the
 * session has no name yet — a user-set or previously generated name is never
 * clobbered. Sends only user messages (current prompt plus previous user
 * messages, truncated) for context, capped at 10 output tokens (1-5 word
 * name). Thinking is never enabled. Equivalent to running /name automatically.
 */

import { complete } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, SessionEntry } from "@selesai/code";

export const NAMING_SYSTEM_PROMPT =
	"Reply with only a short session name (1-5 words) for this conversation based on the user's messages. No punctuation, no quotes, no explanation.";

export const NAMING_MAX_TOKENS = 10;
/** Hard cap on the name itself: at most 5 words (≈5 tokens). */
export const MAX_NAME_WORDS = 5;
/** How many previous user messages to include, newest first. */
export const MAX_PREVIOUS_MESSAGES = 20;
/** Per-message character cap when truncating. */
export const MAX_MESSAGE_CHARS = 200;

function truncate(text: string): string {
	return text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}…` : text;
}

/** Collect previous user message texts from the session branch, newest first, truncated. */
export function previousUserMessages(sessionManager: { getBranch(): SessionEntry[] }): string[] {
	const branch = sessionManager.getBranch();
	const texts: string[] = [];
	for (let i = branch.length - 1; i >= 0 && texts.length < MAX_PREVIOUS_MESSAGES; i--) {
		const entry = branch[i];
		if (entry.type !== "message" || entry.message.role !== "user") continue;
		const content = entry.message.content;
		const text = typeof content === "string" ? content : content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n");
		if (text.trim()) texts.push(truncate(text.trim()));
	}
	return texts;
}

export default function autoSessionNameExtension(pi: ExtensionAPI): void {
	// Guards run synchronously; the naming call itself is fire-and-forget so it
	// never blocks the user's message from being sent.
	let namingSeq = 0;
	pi.on("input", (event, ctx) => {
		// Only real user messages; skip extension-sourced messages and commands.
		if (event.source === "extension") return;
		const text = event.text.trim();
		if (!text || text.startsWith("/")) return;
		if (!ctx.model) return;
		// Only auto-name sessions that have no name yet; never clobber a
		// user-set or previously generated name.
		if (pi.getSessionName()) return;

		const seq = ++namingSeq;
		void (async () => {
			try {
				const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
				if (!auth.ok || !auth.apiKey) return;

				const previous = previousUserMessages(ctx.sessionManager);
				const conversation = [...previous, text].join("\n");

				const response = await complete(
					ctx.model,
					{
						systemPrompt: NAMING_SYSTEM_PROMPT,
						messages: [{ role: "user", content: conversation, timestamp: Date.now() }],
					},
					{
						apiKey: auth.apiKey,
						headers: auth.headers,
						maxTokens: NAMING_MAX_TOKENS,
						cacheRetention: "none",
						// The tokenin gateway ignores `thinking: {type:"disabled"}` and burns the
						// whole budget on reasoning; `reasoning_effort: "none"` is what disables it.
						samplingParams: { reasoning_effort: "none" },
					},
				);
				const name = response.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("")
					.trim()
					.split(/\s+/)
					.slice(0, MAX_NAME_WORDS)
					.join(" ");
				// Only the latest request may set the name; slower older responses lose.
				if (name && seq === namingSeq) pi.setSessionName(name);
			} catch {
				// Best-effort naming; never break the user's message flow.
			}
		})();
	});
}
