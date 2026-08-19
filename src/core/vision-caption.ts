/**
 * Shared vision-caption relay: ask a vision-capable model to describe an image
 * as plain text, so a text-only main model can still work from it.
 */

import type { Api, ImageContent, Model, ProviderHeaders } from "@earendil-works/pi-ai";
import { complete, type Context } from "@earendil-works/pi-ai/compat";

export const VISION_CAPTION_SYSTEM_PROMPT =
	"You are an image captioner for a coding agent whose main model cannot see images. " +
	"Describe the image as completely and precisely as possible in plain text so that a programmer " +
	"can work from your description alone, as if looking at the image themselves. " +
	"Read any visible text, code, UI labels, error messages, terminal output, or diagrams verbatim. " +
	"Cover layout, colors, spatial relationships, relative positions and sizes of elements, " +
	"window or panel structure, and anything relevant to debugging or implementing. " +
	"When a simple ASCII sketch clarifies the layout, include it.";

export interface VisionCaptionRequestOptions {
	apiKey?: string;
	headers?: ProviderHeaders;
	signal?: AbortSignal;
	/** Called with the underlying error message when the caption request fails. */
	onError?: (message: string) => void;
	/**
	 * The user's current instruction (e.g. "make this UI element bigger").
	 * Included so the caption is targeted at the task, not generic.
	 */
	userPrompt?: string;
	/**
	 * A small, already-bounded slice of recent conversation text (or other relevant
	 * context) to help the caption model understand intent. Must be small enough to
	 * stay safely under the caption model's context window. Omit for none.
	 */
	contextText?: string;
}

function buildUserPrompt(userPrompt?: string, contextText?: string): string {
	const lines: string[] = [];
	if (userPrompt) {
		lines.push(`The user said:\n${userPrompt}`);
	}
	if (contextText) {
		lines.push(`Relevant context (recent conversation):\n${contextText}`);
	}
	lines.push("Describe this image in detail:");
	return lines.join("\n\n");
}

/**
 * Ask a vision model to describe an image. Returns the caption text, or null if
 * the request fails or is aborted. The request context is minimal (prompt +
 * image only), so it is independent of any main-agent context usage.
 */
export async function captionImageWithModel(
	captionModel: Model<Api>,
	image: ImageContent,
	options?: VisionCaptionRequestOptions,
): Promise<string | null> {
	const aiContext: Context = {
		systemPrompt: VISION_CAPTION_SYSTEM_PROMPT,
		messages: [
			{
				role: "user",
				timestamp: Date.now(),
				content: [
					{ type: "text", text: buildUserPrompt(options?.userPrompt, options?.contextText) },
					image,
				],
			},
		],
	};

	try {
		const response = await complete(captionModel, aiContext, {
			apiKey: options?.apiKey,
			headers: options?.headers,
			signal: options?.signal,
		});
		if (response.stopReason === "aborted") return null;
		const text = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n")
			.trim();
		return text.length > 0 ? text : null;
	} catch (error) {
		options?.onError?.(error instanceof Error ? error.message : String(error));
		return null;
	}
}
