import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai";
import type { SessionEntry } from "./session-manager.ts";
import { serializeConversation } from "./compaction/utils.ts";
import { convertToLlm } from "./messages.ts";

export const DEFAULT_HANDOFF_GOAL = "Continue the previous session from this handoff.";

const SYSTEM_PROMPT = `Write a handoff document for a fresh agent to continue the current conversation. Return only the handoff document text; do not save a file or describe saving one. No question, no fluff, just write the handoff. Do not reproduce, quote, or reformat the conversation history or its tool calls — distill it into what matters; never emit transcript-style markup or raw tool-call text.

Include a "suggested skills" section in the document, which suggests skills that the agent should invoke.

Do not duplicate content already captured in other artifacts (PRDs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.`;

export function entryToMessage(entry: SessionEntry): AgentMessage | undefined {
	if (entry.type === "message") return entry.message;
	if (entry.type === "compaction") {
		return { role: "compactionSummary", summary: entry.summary, tokensBefore: entry.tokensBefore, timestamp: new Date(entry.timestamp).getTime() };
	}
	return undefined;
}

export function getHandoffMessages(branch: SessionEntry[]): AgentMessage[] {
	let compactionIndex = -1;
	for (let i = branch.length - 1; i >= 0; i--) if (branch[i].type === "compaction") { compactionIndex = i; break; }
	if (compactionIndex < 0) return branch.map(entryToMessage).filter((m): m is AgentMessage => m !== undefined);
	const compaction = branch[compactionIndex];
	const firstKeptIndex = compaction.type === "compaction" ? branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId) : -1;
	return [compaction, ...(firstKeptIndex >= 0 ? branch.slice(firstKeptIndex, compactionIndex) : []), ...branch.slice(compactionIndex + 1)]
		.map(entryToMessage).filter((m): m is AgentMessage => m !== undefined);
}

export function buildAiContext(conversationText: string, goal: string): Context {
	return { systemPrompt: SYSTEM_PROMPT, messages: [{ role: "user", content: [{ type: "text", text: `## Conversation History\n\n${conversationText}\n\n## User's Goal for New Thread\n\n${goal}` }], timestamp: Date.now() }] };
}

export async function generateHandoff(model: Model<any>, modelRuntime: { complete(model: Model<any>, context: Context): Promise<AssistantMessage> }, branch: SessionEntry[], goal = DEFAULT_HANDOFF_GOAL): Promise<string> {
	const messages = getHandoffMessages(branch);
	if (messages.length === 0) throw new Error("No conversation to hand off");
	const response = await modelRuntime.complete(model, buildAiContext(serializeConversation(convertToLlm(messages)), goal));
	if (response.stopReason === "aborted") throw new Error("Handoff generation cancelled");
	const text = response.content.filter((c): c is { type: "text"; text: string } => c.type === "text").map((c) => c.text).join("\n");
	if (!text.trim()) throw new Error("Handoff generation returned no text");
	return text;
}
