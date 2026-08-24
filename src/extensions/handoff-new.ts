/**
 * /handoff-new — generate a handoff prompt and open a clean new session with
 * that content as the first prompt. Sibling of examples/extensions/handoff.ts,
 * adapted to this repo's
 * import conventions and reduced to the one thing that ships.
 *
 * Usage:
 *   /handoff-new continue implementing the workflow fix
 *
 * If no goal argument is given, a default goal is used. The generated handoff
 * is submitted immediately in the new session.
 */

import { complete } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionCommandContext } from "@selesai/code";
import { BorderedLoader } from "@selesai/code";
import {
	DEFAULT_HANDOFF_GOAL,
	buildAiContext,
	entryToMessage,
	getHandoffMessages,
} from "../core/handoff.ts";
import { serializeConversation } from "../core/compaction/utils.ts";
import { convertToLlm } from "../core/messages.ts";

export { buildAiContext, entryToMessage, getHandoffMessages };
export const DEFAULT_GOAL = DEFAULT_HANDOFF_GOAL;

export default function (pi: ExtensionAPI) {
	pi.registerCommand("handoff-new", {
		description: "Generate a handoff prompt and continue in a clean new session",
		handler: handoffNew,
	});
}

async function handoffNew(args: string, ctx: ExtensionCommandContext) {
	if (ctx.mode !== "tui") {
		ctx.ui.notify("handoff-new requires interactive mode", "error");
		return;
	}
	if (!ctx.model) {
		ctx.ui.notify("No model selected", "error");
		return;
	}

	const goal = args.trim() || DEFAULT_GOAL;

	const messages = getHandoffMessages(ctx.sessionManager.getBranch());
	if (messages.length === 0) {
		ctx.ui.notify("No conversation to hand off", "error");
		return;
	}

	const llmMessages = convertToLlm(messages);
	const conversationText = serializeConversation(llmMessages);
	const currentSessionFile = ctx.sessionManager.getSessionFile();
	const aiContext = buildAiContext(conversationText, goal);

	const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		const loader = new BorderedLoader(tui, theme, `Generating handoff prompt...`);
		loader.onAbort = () => done(null);

		(async () => {
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model!);
			if (!auth.ok || !auth.apiKey) {
				throw new Error(auth.ok ? `No API key for ${ctx.model!.provider}` : auth.error);
			}
			const response = await complete(ctx.model!, aiContext, {
				apiKey: auth.apiKey,
				headers: auth.headers,
				signal: loader.signal,
			});
			if (response.stopReason === "aborted") return null;
			return response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n");
		})()
			.then(done)
			.catch((err) => {
				console.error("handoff-new generation failed:", err);
				done(null);
			});

		return loader;
	});

	if (result === null) {
		ctx.ui.notify("Cancelled", "info");
		return;
	}
	if (!result.trim()) {
		ctx.ui.notify("Handoff generation returned no text", "error");
		return;
	}

	const newSessionResult = await ctx.newSession({
		parentSession: currentSessionFile,
		withSession: async (replacementCtx) => {
			await replacementCtx.sendUserMessage(result);
		},
	});

	if (newSessionResult.cancelled) {
		ctx.ui.notify("New session cancelled", "info");
	}
}
