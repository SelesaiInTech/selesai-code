import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@selesai/code";
import contextCompactionReminderExtension, {
	CONTEXT_COMPACTION_REMINDER_MESSAGE,
} from "./context-compaction-reminder.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => void | Promise<void>;

function createHarness(tokens: number | null | undefined = undefined) {
	const handlers = new Map<string, Handler>();
	const notify = vi.fn();
	const pi = {
		on: vi.fn((event: string, handler: Handler) => handlers.set(event, handler)),
	} as unknown as ExtensionAPI;
	const ctx = {
		getContextUsage: () =>
			tokens === undefined ? undefined : { tokens, contextWindow: 200_000, percent: tokens === null ? null : tokens / 2_000 },
		ui: { notify },
	} as unknown as ExtensionContext;

	contextCompactionReminderExtension(pi);

	return {
		notify,
		setTokens: (value: number | null | undefined) => {
			tokens = value;
		},
		settle: () => handlers.get("agent_settled")!({ type: "agent_settled" }, ctx),
		compact: () => handlers.get("session_compact")!({ type: "session_compact" }, ctx),
	};
}

describe("context-compaction-reminder", () => {
	it("warns once when known context reaches 128k", async () => {
		const { notify, setTokens, settle } = createHarness(127_999);

		await settle();
		setTokens(128_000);
		await settle();
		setTokens(130_000);
		await settle();

		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledWith(CONTEXT_COMPACTION_REMINDER_MESSAGE, "warning");
	});

	it("does not reset the reminder for unavailable or post-compaction usage", async () => {
		const { notify, setTokens, settle } = createHarness(128_000);

		await settle();
		setTokens(undefined);
		await settle();
		setTokens(null);
		await settle();
		setTokens(130_000);
		await settle();

		expect(notify).toHaveBeenCalledTimes(1);
	});

	it("allows another warning after successful compaction", async () => {
		const { notify, settle, compact } = createHarness(128_000);

		await settle();
		await compact();
		await settle();

		expect(notify).toHaveBeenCalledTimes(2);
	});

	it("allows another warning after known usage drops below 128k", async () => {
		const { notify, setTokens, settle } = createHarness(128_000);

		await settle();
		setTokens(127_999);
		await settle();
		setTokens(128_000);
		await settle();

		expect(notify).toHaveBeenCalledTimes(2);
	});
});
