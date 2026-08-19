import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Api, ImageContent, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "../extensions/types.ts";
import { captionImageWithModel } from "../vision-caption.ts";
import { captionImage } from "./read.ts";

const completeMock = vi.hoisted(() => vi.fn());
vi.mock("@earendil-works/pi-ai/compat", async () => {
	const actual = await vi.importActual<typeof import("@earendil-works/pi-ai/compat")>(
		"@earendil-works/pi-ai/compat",
	);
	return { ...actual, complete: completeMock };
});

const image: ImageContent = { type: "image", data: "aGVsbG8=", mimeType: "image/png" };

function visionModel(): Model<Api> {
	return {
		id: "kimi-k3",
		name: "Kimi K3",
		api: "openai-completions" as const,
		provider: "tokenin",
		baseUrl: "https://example.com/v1",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 512000,
		maxTokens: 64000,
	};
}

function makeCtx(): { ctx: ExtensionContext; find: ReturnType<typeof vi.fn>; auth: ReturnType<typeof vi.fn> } {
	const find = vi.fn().mockReturnValue(visionModel());
	const auth = vi.fn().mockResolvedValue({ ok: true, apiKey: "sk-test", headers: {} });
	return {
		ctx: {
			model: { ...visionModel(), input: ["text"] } as Model<Api>,
			modelRegistry: { find, getApiKeyAndHeaders: auth },
		} as unknown as ExtensionContext,
		find,
		auth,
	};
}

describe("captionImage", () => {
	beforeEach(() => {
		completeMock.mockReset();
	});

	it("returns null when no caption model is configured", async () => {
		const { ctx } = makeCtx();
		const result = await captionImage(image, undefined, ctx, undefined);
		expect(result).toBeNull();
		expect(completeMock).not.toHaveBeenCalled();
	});

	it("returns null when the caption model cannot accept images", async () => {
		const { ctx, find } = makeCtx();
		find.mockReturnValue({ ...visionModel(), input: ["text"] });
		const result = await captionImage(image, "tokenin/kimi-k3", ctx, undefined);
		expect(result).toBeNull();
		expect(completeMock).not.toHaveBeenCalled();
	});

	it("returns null when credentials are unavailable", async () => {
		const { ctx, auth } = makeCtx();
		auth.mockResolvedValue({ ok: false, error: "no key" });
		const result = await captionImage(image, "tokenin/kimi-k3", ctx, undefined);
		expect(result).toBeNull();
	});

	it("returns the caption text from the vision model", async () => {
		completeMock.mockResolvedValue({
			stopReason: "end_turn",
			content: [{ type: "text", text: "A login form with a username field." }],
		});
		const { ctx, find } = makeCtx();
		const result = await captionImage(image, "tokenin/kimi-k3", ctx, undefined);
		expect(result).toBe("A login form with a username field.");
		expect(find).toHaveBeenCalledWith("tokenin", "kimi-k3");
		// The image block must be forwarded to the vision model.
		const sentMessages = completeMock.mock.calls[0][1].messages;
		expect(sentMessages[0].content).toContainEqual(image);
	});

	it("returns null and does not throw when the vision request errors", async () => {
		completeMock.mockRejectedValue(new Error("boom"));
		const { ctx } = makeCtx();
		const result = await captionImage(image, "tokenin/kimi-k3", ctx, undefined);
		expect(result).toBeNull();
	});
});

describe("captionImageWithModel", () => {
	beforeEach(() => {
		completeMock.mockReset();
	});

	it("returns the caption text with a minimal context", async () => {
		completeMock.mockResolvedValue({
			stopReason: "end_turn",
			content: [{ type: "text", text: "A red button labeled Save." }],
		});
		const result = await captionImageWithModel(visionModel(), image, {
			apiKey: "sk-test",
		});
		expect(result).toBe("A red button labeled Save.");
		const sentContext = completeMock.mock.calls[0][1];
		// The caption request must not include any main-agent conversation history.
		expect(sentContext.messages).toHaveLength(1);
		expect(sentContext.messages[0].content).toContainEqual(image);
		expect(completeMock.mock.calls[0][2]).toMatchObject({ apiKey: "sk-test" });
	});

	it("returns null on aborted stop reason", async () => {
		completeMock.mockResolvedValue({ stopReason: "aborted", content: [] });
		const result = await captionImageWithModel(visionModel(), image);
		expect(result).toBeNull();
	});

	it("returns null on request failure", async () => {
		completeMock.mockRejectedValue(new Error("network down"));
		const result = await captionImageWithModel(visionModel(), image);
		expect(result).toBeNull();
	});

	it("includes the user prompt and bounded context text", async () => {
		completeMock.mockResolvedValue({
			stopReason: "end_turn",
			content: [{ type: "text", text: "A slider" }],
		});
		const result = await captionImageWithModel(visionModel(), image, {
			userPrompt: "make this UI element bigger",
			contextText: "User: we are fixing the settings panel",
		});
		expect(result).toBe("A slider");
		const sentText = (completeMock.mock.calls[0][1].messages[0].content[0] as { text: string }).text;
		expect(sentText).toContain("make this UI element bigger");
		expect(sentText).toContain("we are fixing the settings panel");
	});
});
