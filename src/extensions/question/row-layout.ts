// Single-select row layout (inlined from pi-ask-user/single-select-layout.ts).

import { COMMENT_TOGGLE_LABEL, FREEFORM_LABEL } from "./constants.ts";
import type { AnnotatedRow, ItemBlock, ListItem, QuestionOption, RenderRowsParams } from "./types.ts";

export function wrapPlain(text: string, width: number): string[] {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) return [""];
	if (width <= 1) return [...normalized];

	const words = normalized.split(" ");
	const lines: string[] = [];
	let current = "";

	for (const word of words) {
		if (!current) {
			if (word.length <= width) {
				current = word;
			} else {
				for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
			}
			continue;
		}
		const candidate = `${current} ${word}`;
		if (candidate.length <= width) {
			current = candidate;
			continue;
		}
		lines.push(current);
		if (word.length <= width) {
			current = word;
		} else {
			current = "";
			for (let i = 0; i < word.length; i += width) {
				const chunk = word.slice(i, i + width);
				if (chunk.length === width || i + width < word.length) lines.push(chunk);
				else current = chunk;
			}
		}
	}
	if (current) lines.push(current);
	return lines;
}

export function padLine(prefix: string, content: string): string {
	return `${prefix}${content}`.trimEnd();
}

export function buildItemBlocks(
	options: QuestionOption[],
	width: number,
	allowFreeform: boolean,
	allowComment: boolean,
	commentEnabled: boolean,
	selectedIndex: number,
	hideDescriptions = false,
): ItemBlock[] {
	const normalizedWidth = Math.max(12, width);
	const allItems: ListItem[] = options.map((option) => ({ type: "option", option }));
	if (allowComment) {
		allItems.push({
			type: "comment-toggle",
			option: { value: "__comment__", label: `${commentEnabled ? "[✓]" : "[ ]"} ${COMMENT_TOGGLE_LABEL}` },
		});
	}
	if (allowFreeform) {
		allItems.push({ type: "freeform", option: { value: "__other__", label: FREEFORM_LABEL } });
	}

	return allItems.map((item, itemIndex) => {
		const pointer = itemIndex === selectedIndex ? "→" : " ";
		const lines: string[] = [];

		if (item.type === "comment-toggle" || item.type === "freeform") {
			const prefix = `${pointer}   `;
			const wrapped = wrapPlain(item.option.label, Math.max(8, normalizedWidth - prefix.length));
			wrapped.forEach((line, lineIndex) => {
				lines.push(padLine(lineIndex === 0 ? prefix : " ".repeat(prefix.length), line));
			});
			return { itemIndex, lines };
		}

		const numberPrefix = `${pointer} ${itemIndex + 1}. `;
		const continuationPrefix = " ".repeat(numberPrefix.length);
		const titleLines = wrapPlain(item.option.label, Math.max(8, normalizedWidth - numberPrefix.length));
		titleLines.forEach((line, lineIndex) => {
			lines.push(padLine(lineIndex === 0 ? numberPrefix : continuationPrefix, line));
		});

		if (item.option.description && !hideDescriptions) {
			const descriptionPrefix = "      ";
			const descriptionLines = wrapPlain(item.option.description, Math.max(8, normalizedWidth - descriptionPrefix.length));
			descriptionLines.forEach((line) => {
				lines.push(padLine(descriptionPrefix, line));
			});
		}

		return { itemIndex, lines };
	});
}

export function flattenBlocks(blocks: ItemBlock[], selectedIndex: number): AnnotatedRow[] {
	return blocks.flatMap((block) =>
		block.lines.map((line) => ({ line, selected: block.itemIndex === selectedIndex })),
	);
}

export function renderSingleSelectRows({
	options,
	selectedIndex,
	width,
	allowFreeform,
	allowComment = false,
	commentEnabled = false,
	maxRows,
	hideDescriptions,
}: RenderRowsParams): AnnotatedRow[] {
	const itemCount = options.length + (allowComment ? 1 : 0) + (allowFreeform ? 1 : 0);
	const blocks = buildItemBlocks(options, width, allowFreeform, allowComment, commentEnabled, selectedIndex, hideDescriptions);
	const allRows = flattenBlocks(blocks, selectedIndex);

	if (!Number.isFinite(maxRows) || !maxRows || maxRows <= 0 || allRows.length <= maxRows) {
		return allRows;
	}

	const safeMaxRows = Math.max(1, Math.floor(maxRows));
	const selectedBlock = blocks[selectedIndex] ?? blocks[0];
	if (!selectedBlock) return [];

	const indicator = `  (${selectedIndex + 1}/${itemCount})`;
	const availableRows = safeMaxRows > 1 ? safeMaxRows - 1 : 1;

	if (selectedBlock.lines.length >= availableRows) {
		const visible = selectedBlock.lines.slice(0, availableRows).map((line) => ({ line, selected: true }));
		if (safeMaxRows > 1) visible.push({ line: indicator, selected: false });
		return visible.slice(0, safeMaxRows);
	}

	let start = selectedIndex;
	let end = selectedIndex + 1;
	let usedRows = selectedBlock.lines.length;

	while (true) {
		const nextCanFit = end < blocks.length && usedRows + blocks[end]!.lines.length <= availableRows;
		if (nextCanFit) {
			usedRows += blocks[end]!.lines.length;
			end += 1;
			continue;
		}
		const prevCanFit = start > 0 && usedRows + blocks[start - 1]!.lines.length <= availableRows;
		if (prevCanFit) {
			start -= 1;
			usedRows += blocks[start]!.lines.length;
			continue;
		}
		break;
	}

	const visible = flattenBlocks(blocks.slice(start, end), selectedIndex);
	visible.push({ line: indicator, selected: false });
	return visible.slice(0, safeMaxRows);
}