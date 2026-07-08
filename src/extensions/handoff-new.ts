/**
 * /handoff-new — generate a handoff prompt and open a clean new session with
 * that content as the editable first prompt (editor text, not hidden system
 * prompt). Sibling of examples/extensions/handoff.ts, adapted to this repo's
 * import conventions and reduced to the one thing that ships.
 *
 * Usage:
 *   /handoff-new continue implementing the workflow fix
 *   /handover-new ship plan 2
 *
 * If no goal argument is given, a default goal is used. The generated text is
 * shown in the editor for review before the user submits it.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { complete, type Context } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionCommandContext, SessionEntry } from "@selesai/code";
import { BorderedLoader, convertToLlm, serializeConversation } from "@selesai/code";

const SYSTEM_PROMPT = `You are a context transfer assistant. Given a conversation history and the user's goal for a new thread, generate a focused prompt that:

1. Summarizes relevant context from the conversation (decisions made, approaches taken, key findings)
2. Lists any relevant files that were discussed or modified
3. Clearly states the next task based on the user's goal
4. Is self-contained - the new thread should be able to proceed without the old conversation

Format your response as a prompt the user can send to start the new thread. Be concise but include all necessary context. Do not include any preamble like "Here's the prompt" - just output the prompt itself.`;

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
	// ponytail: single handler behind two command names; no separate config.
	for (const name of ["handoff-new", "handover-new"]) {
		pi.registerCommand(name, {
			description: "Generate a handoff prompt and open a clean new session with it as the first draft",
			handler: handoffNew,
		});
	}
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

	const editedPrompt = await ctx.ui.editor("Edit handoff prompt", result);
	if (editedPrompt === undefined) {
		ctx.ui.notify("Cancelled", "info");
		return;
	}

	// Editor text, NOT a hidden system prompt: the user reviews and submits.
	const newSessionResult = await ctx.newSession({
		parentSession: currentSessionFile,
		withSession: async (replacementCtx) => {
			replacementCtx.ui.setEditorText(editedPrompt);
			replacementCtx.ui.notify("Handoff ready. Submit when ready.", "info");
		},
	});

	if (newSessionResult.cancelled) {
		ctx.ui.notify("New session cancelled", "info");
	}
}
