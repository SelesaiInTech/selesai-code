import type { ExtensionAPI } from "@selesai/code";

export const CONTEXT_COMPACTION_REMINDER_THRESHOLD = 128_000;
export const CONTEXT_COMPACTION_REMINDER_MESSAGE =
	"Conversation context has reached 128k tokens. Run /compact to summarize older context.";

export default function contextCompactionReminderExtension(pi: ExtensionAPI): void {
	let reminderShown = false;

	pi.on("session_compact", () => {
		reminderShown = false;
	});

	pi.on("agent_settled", (_event, ctx) => {
		const tokens = ctx.getContextUsage()?.tokens;
		if (tokens === undefined || tokens === null) return;

		if (tokens < CONTEXT_COMPACTION_REMINDER_THRESHOLD) {
			reminderShown = false;
			return;
		}

		if (!reminderShown) {
			ctx.ui.notify(CONTEXT_COMPACTION_REMINDER_MESSAGE, "warning");
			reminderShown = true;
		}
	});
}
