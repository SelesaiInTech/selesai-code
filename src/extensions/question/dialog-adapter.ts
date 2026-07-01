// Dialog/RPC fallback adapter — used when ctx.hasUI is false or custom() returns undefined.

import {
	buildCommentPrompt,
	createFreeformResponse,
	createSelectionResponse,
	formatOptionsForMessage,
	isCancelled,
	parseDialogSelections,
} from "./helpers.ts";
import type { QuestionOption, QuestionResponse, ResolvedQuestionParams } from "./types.ts";
import type { FallbackProtocol, UIProtocol } from "./ui-protocol.ts";

const FREEFORM_DIALOG_OPTION = "✏️ Type custom response...";

async function askViaDialogs(
	ui: Pick<UIProtocol, "select" | "input">,
	question: string,
	context: string | undefined,
	options: QuestionOption[],
	allowMultiple: boolean,
	allowFreeform: boolean,
	allowComment: boolean,
	timeout?: number,
): Promise<QuestionResponse | null> {
	const dialogOpts = timeout ? { timeout } : undefined;
	const prompt = context ? `${question}\n\nContext:\n${context}` : question;

	if (allowMultiple) {
		const optionList = formatOptionsForMessage(options);
		const raw = await ui.input(
			`${prompt}\n\nOptions (select one or more):\n${optionList}`,
			"Type your selection(s)...",
			dialogOpts,
		);
		if (isCancelled(raw)) return null;
		const selections = parseDialogSelections(raw);
		if (selections.length === 0) return null;
		if (!allowComment) return createSelectionResponse(selections);
		const comment = await ui.input(buildCommentPrompt(prompt, selections), "Optional comment (press Enter to skip)...", dialogOpts);
		return createSelectionResponse(selections, comment);
	}

	const selectOptions = options.map((o) => o.label);
	if (allowFreeform) selectOptions.push(FREEFORM_DIALOG_OPTION);

	const selected = await ui.select(prompt, selectOptions, dialogOpts);
	if (isCancelled(selected)) return null;

	if (selected === FREEFORM_DIALOG_OPTION) {
		const answer = await ui.input(prompt, "Type your answer...", dialogOpts);
		if (isCancelled(answer)) return null;
		return createFreeformResponse(answer);
	}

	if (!allowComment) return createSelectionResponse([selected]);
	const comment = await ui.input(buildCommentPrompt(prompt, [selected]), "Optional comment (press Enter to skip)...", dialogOpts);
	return createSelectionResponse([selected], comment);
}

export const DialogFallback: FallbackProtocol = {
	async ask(params, protocol) {
		return askViaDialogs(
			protocol,
			params.question,
			params.context,
			params.options,
			params.allowMultiple,
			params.allowFreeform,
			params.allowComment,
			params.timeout,
		);
	},
};