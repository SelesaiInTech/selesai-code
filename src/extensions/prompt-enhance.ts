/**
 * /enhance (alt+e) — enhance the draft prompt in the editor with an LLM pass.
 *
 * Reads the optional config from the global settings file and (when the
 * project is trusted) the project settings file:
 *
 *   {
 *     "mode": "replace" | "append",
 *     "instructions": "optional extra guidance prepended to the request"
 *   }
 *
 * Mode precedence: /enhance <replace|append> argument > config > interactive
 * select. The LLM result replaces the editor content (or is appended to it)
 * only when it returned non-empty text.
 */

import { complete, type Context } from "@earendil-works/pi-ai/compat";
import { BorderedLoader, CONFIG_DIR_NAME, getAgentDir, type ExtensionAPI, type ExtensionCommandContext } from "@selesai/code";
import { Key } from "@earendil-works/pi-tui";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const REPLACE_SYSTEM_PROMPT =
	"Rewrite the user's draft into a complete, improved prompt for a coding agent. Preserve the user's intent and concrete constraints. Return ONLY the improved prompt text — no explanations, no headings, no markdown fences.";

const APPEND_SYSTEM_PROMPT =
	"Write an ADDITIVE supplement that extends the user's draft prompt. Do NOT repeat the draft. Return ONLY the supplement text.";

export interface PromptEnhanceConfig {
	mode: "replace" | "append";
	instructions?: string;
}

export function resolvePromptEnhanceConfig(
	globalRaw: unknown,
	projectRaw: unknown,
	projectTrusted: boolean,
): PromptEnhanceConfig {
	const merged: PromptEnhanceConfig = { mode: "replace" };

	const apply = (raw: unknown) => {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
		const candidate = raw as Record<string, unknown>;
		const mode = candidate.mode;
		if (mode === "replace" || mode === "append") {
			merged.mode = mode;
		}
		const instructions = candidate.instructions;
		if (typeof instructions === "string") {
			merged.instructions = instructions;
		}
	};

	apply(globalRaw);
	if (projectTrusted) apply(projectRaw);
	return merged;
}

export function buildEnhanceContext(draft: string, mode: "replace" | "append", instructions: string | undefined): Context {
	const systemPrompt = mode === "append" ? APPEND_SYSTEM_PROMPT : REPLACE_SYSTEM_PROMPT;
	const instructionsText = instructions?.trim() ? `${instructions.trim()}\n\n` : "";
	return {
		systemPrompt,
		messages: [
			{
				role: "user",
				content: [{ type: "text", text: `${instructionsText}${draft}` }],
				timestamp: Date.now(),
			},
		],
	};
}

export function extractText(content: readonly { type?: string; text?: string }[]): string {
	return content
		.filter((block): block is { type: "text"; text: string } => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n");
}

export default function (pi: ExtensionAPI) {
	pi.registerShortcut(Key.alt("e"), {
		description: "Enhance editor prompt",
		handler: (ctx) => enhancePrompt("", ctx as ExtensionCommandContext),
	});
	pi.registerCommand("enhance", {
		description: "Enhance the draft prompt in the editor",
		handler: enhancePrompt,
	});
}

function hasExplicitMode(raw: unknown): boolean {
	return !!raw && typeof raw === "object" && !Array.isArray(raw) && "mode" in (raw as Record<string, unknown>);
}

async function readSettingsJson(path: string): Promise<unknown> {
	try {
		return JSON.parse(await readFile(path, "utf-8"));
	} catch {
		return undefined;
	}
}

async function enhancePrompt(args: string, ctx: ExtensionCommandContext) {
	if (ctx.mode !== "tui") {
		ctx.ui.notify("prompt enhance requires interactive mode", "error");
		return;
	}
	if (!ctx.model) {
		ctx.ui.notify("No model selected", "error");
		return;
	}

	const draft = ctx.ui.getEditorText();
	if (!draft.trim()) {
		ctx.ui.notify("Editor is empty; nothing to enhance", "info");
		return;
	}

	const projectTrusted = ctx.isProjectTrusted();
	const globalRaw = await readSettingsJson(join(getAgentDir(), "settings.json"));
	const projectRaw = projectTrusted ? await readSettingsJson(join(ctx.cwd, CONFIG_DIR_NAME, "settings.json")) : undefined;
	const config = resolvePromptEnhanceConfig(globalRaw, projectRaw, projectTrusted);

	let mode = config.mode;
	const explicitMode = args.trim().toLowerCase();
	if (explicitMode === "replace" || explicitMode === "append") {
		mode = explicitMode;
	} else if (!hasExplicitMode(globalRaw) && !(projectTrusted && hasExplicitMode(projectRaw))) {
		const choice = await ctx.ui.select("Enhance mode", ["replace", "append"]);
		if (!choice) {
			ctx.ui.notify("Cancelled", "info");
			return;
		}
		mode = choice as "replace" | "append";
	}

	const aiContext = buildEnhanceContext(draft, mode, config.instructions);

	const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		const loader = new BorderedLoader(tui, theme, "Enhancing prompt...");
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
			return extractText(response.content);
		})()
			.then(done)
			.catch((err) => {
				console.error("prompt enhance generation failed:", err);
				done(null);
			});

		return loader;
	});

	if (result === null) {
		ctx.ui.notify("Cancelled", "info");
		return;
	}
	if (!result.trim()) {
		ctx.ui.notify("Enhancement returned no text", "error");
		return;
	}

	if (mode === "append") {
		ctx.ui.setEditorText(`${draft}\n\n${result}`);
	} else {
		ctx.ui.setEditorText(result);
	}
}
