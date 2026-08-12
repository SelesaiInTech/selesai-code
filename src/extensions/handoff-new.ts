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

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { complete, type Context } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionCommandContext, SessionEntry } from "@selesai/code";
import { BorderedLoader, convertToLlm, serializeConversation } from "@selesai/code";

const SYSTEM_PROMPT = `Write a handoff document for a fresh agent to continue the current conversation. Return only the handoff document text; do not save a file or describe saving one. No question, no fluff, just write the handoff. Do not reproduce, quote, or reformat the conversation history or its tool calls — distill it into what matters; never emit transcript-style markup or raw tool-call text.

Include a "suggested skills" section in the document, which suggests skills that the agent should invoke.

Do not duplicate content already captured in other artifacts (PRDs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.`;

export const DEFAULT_GOAL = "Continue the previous session from this handoff.";

export function entryToMessage(entry: SessionEntry): AgentMessage | undefined {
	if (entry.type === "message") {
		return entry.message;
	}
	if (entry.type === "compaction") {
		return {
			role: "compactionSummary",
			summary: entry.summary,
			tokensBefore: entry.tokensBefore,
			timestamp: new Date(entry.timestamp).getTime(),
		};
	}
	return undefined;
}

export function getHandoffMessages(branch: SessionEntry[]): AgentMessage[] {
	let compactionIndex = -1;
	for (let i = branch.length - 1; i >= 0; i--) {
		if (branch[i].type === "compaction") {
			compactionIndex = i;
			break;
		}
	}
	if (compactionIndex < 0) {
		return branch.map(entryToMessage).filter((m): m is AgentMessage => m !== undefined);
	}

	const compaction = branch[compactionIndex];
	const firstKeptIndex =
		compaction.type === "compaction" ? branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId) : -1;
	const compactedBranch = [
		compaction,
		...(firstKeptIndex >= 0 ? branch.slice(firstKeptIndex, compactionIndex) : []),
		...branch.slice(compactionIndex + 1),
	];
	return compactedBranch.map(entryToMessage).filter((m): m is AgentMessage => m !== undefined);
}

export function buildAiContext(conversationText: string, goal: string): Context {
	return {
		systemPrompt: SYSTEM_PROMPT,
		messages: [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: `## Conversation History\n\n${conversationText}\n\n## User's Goal for New Thread\n\n${goal}`,
					},
				],
				timestamp: Date.now(),
			},
		],
	};
}

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
