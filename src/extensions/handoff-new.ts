/**
 * /handoff-new — generate a handoff prompt and open a clean new session with
 * that content as the first unsent prompt (editor text, not hidden system
 * prompt). Sibling of examples/extensions/handoff.ts, adapted to this repo's
 * import conventions and reduced to the one thing that ships.
 *
 * Usage:
 *   /handoff-new continue implementing the workflow fix
 *
 * If no goal argument is given, a default goal is used. The new session opens
 * with the generated text in its editor; the user can change it before submit.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { complete, type Context } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionCommandContext, SessionEntry } from "@selesai/code";
import { BorderedLoader, convertToLlm, serializeConversation } from "@selesai/code";

const SYSTEM_PROMPT = `Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS - not the current workspace.

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
		description: "Generate a handoff prompt and open a clean new session with it as the first draft",
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

	// Editor text, NOT a hidden system prompt: the user can edit before submit.
	const newSessionResult = await ctx.newSession({
		parentSession: currentSessionFile,
		withSession: async (replacementCtx) => {
			replacementCtx.ui.setEditorText(result);
			replacementCtx.ui.notify("Handoff ready. Submit when ready.", "info");
		},
	});

	if (newSessionResult.cancelled) {
		ctx.ui.notify("New session cancelled", "info");
	}
}
