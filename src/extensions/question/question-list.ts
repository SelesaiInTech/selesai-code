// Unified QuestionList — merges MultiSelectList + WrappedSingleSelectList.
// Single-vs-multi is a SelectionMode flag, not a separate class.
// Fuzzy search + split-pane preview are single-select-only (matching original behavior).

import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	fuzzyFilter,
	Key,
	Markdown,
	matchesKey,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import { COMMENT_TOGGLE_LABEL, SPLIT_PANE_LEFT_MIN_WIDTH, SPLIT_PANE_MIN_WIDTH, SPLIT_PANE_RIGHT_MIN_WIDTH, SPLIT_PANE_SEPARATOR } from "./constants.ts";
import { safeMarkdownTheme } from "./helpers.ts";
import { matchesDown, matchesUp } from "./navigation.ts";
import { renderSingleSelectRows } from "./row-layout.ts";
import type { QuestionOption, ResolvedShortcut } from "./types.ts";
import type { SelectionMode } from "./selection-mode.ts";

export class QuestionList implements Component {
	private selectedIndex = 0;
	private checked = new Set<number>();
	private commentEnabled = false;
	private searchQuery = "";
	private maxVisibleRows = 12;
	private cachedWidth?: number;
	private cachedLines?: string[];

	onCancel?: () => void;
	onSubmit?: (selections: string[], commentEnabled: boolean) => void;
	onEnterFreeform?: () => void;

	private options: QuestionOption[];
	private selectionMode: SelectionMode;
	private allowFreeform: boolean;
	private allowComment: boolean;
	private theme: Theme;
	private keybindings: KeybindingsManager;
	private commentToggle: ResolvedShortcut;

	constructor(
		options: QuestionOption[],
		selectionMode: SelectionMode,
		allowFreeform: boolean,
		allowComment: boolean,
		theme: Theme,
		keybindings: KeybindingsManager,
		commentToggle: ResolvedShortcut,
	) {
		this.options = options;
		this.selectionMode = selectionMode;
		this.allowFreeform = allowFreeform;
		this.allowComment = allowComment;
		this.theme = theme;
		this.keybindings = keybindings;
		this.commentToggle = commentToggle;
	}

	get isMulti(): boolean {
		return this.selectionMode.multi;
	}

	isCommentEnabled(): boolean {
		return this.commentEnabled;
	}

	setMaxVisibleRows(rows: number): void {
		if (this.selectionMode.multi) return; // ponytail: multi-select uses fixed max 10, no-op here
		const next = Math.max(1, Math.floor(rows));
		if (next !== this.maxVisibleRows) {
			this.maxVisibleRows = next;
			this.invalidate();
		}
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	// ---------------------------------------------------------------------------
	// Item-index arithmetic (single source of truth)
	// ---------------------------------------------------------------------------

	private getItemCount(filtered?: QuestionOption[]): number {
		const base = filtered ?? this.options;
		return base.length + (this.allowComment ? 1 : 0) + (this.allowFreeform ? 1 : 0);
	}

	private getCommentToggleIndex(filtered?: QuestionOption[]): number | null {
		return this.allowComment ? (filtered ?? this.options).length : null;
	}

	private getFreeformIndex(filtered?: QuestionOption[]): number {
		const base = filtered ?? this.options;
		return base.length + (this.allowComment ? 1 : 0);
	}

	private isCommentToggleRow(index: number, filtered?: QuestionOption[]): boolean {
		const i = this.getCommentToggleIndex(filtered);
		return i !== null && index === i;
	}

	private isFreeformRow(index: number, filtered?: QuestionOption[]): boolean {
		return this.allowFreeform && index === this.getFreeformIndex(filtered);
	}

	private toggleComment(): void {
		if (!this.allowComment) return;
		this.commentEnabled = !this.commentEnabled;
		this.invalidate();
	}

	// ---------------------------------------------------------------------------
	// Single-select: fuzzy search helpers
	// ---------------------------------------------------------------------------

	private getFilteredOptions(): QuestionOption[] {
		return fuzzyFilter(this.options, this.searchQuery, (option) => `${option.label} ${option.description ?? ""}`);
	}

	private setSearchQuery(query: string): void {
		this.searchQuery = query;
		this.selectedIndex = 0;
		this.invalidate();
	}

	private popSearchChar(): void {
		if (!this.searchQuery) return;
		this.setSearchQuery([...this.searchQuery].slice(0, -1).join(""));
	}

	/** Printable character extraction (avoids unverified decodeKittyPrintable import). */
	private getPrintableInput(data: string): string | null {
		const chars = [...data];
		if (chars.length !== 1) return null;
		const [character] = chars;
		if (!character) return null;
		const code = character.charCodeAt(0);
		if (code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return null;
		return character;
	}

	// ---------------------------------------------------------------------------
	// Single-select: split-pane preview
	// ---------------------------------------------------------------------------

	private getSplitPaneWidths(width: number): { left: number; right: number } | null {
		if (width < SPLIT_PANE_MIN_WIDTH) return null;
		const available = width - SPLIT_PANE_SEPARATOR.length;
		if (available < SPLIT_PANE_LEFT_MIN_WIDTH + SPLIT_PANE_RIGHT_MIN_WIDTH) return null;
		const preferredLeft = Math.floor(available * 0.42);
		const left = Math.max(SPLIT_PANE_LEFT_MIN_WIDTH, Math.min(preferredLeft, available - SPLIT_PANE_RIGHT_MIN_WIDTH));
		const right = available - left;
		if (right < SPLIT_PANE_RIGHT_MIN_WIDTH) return null;
		return { left, right };
	}

	private styleListLine(line: string, width: number, isSelected: boolean): string {
		const trimmed = line.trim();
		if (trimmed.startsWith("(")) return truncateToWidth(this.theme.fg("dim", line), width, "");
		if (isSelected) return truncateToWidth(this.theme.fg("accent", this.theme.bold(line)), width, "");
		if (line.startsWith("      ")) return truncateToWidth(this.theme.fg("muted", line), width, "");
		if (line.startsWith("→")) return truncateToWidth(this.theme.fg("accent", this.theme.bold(line)), width, "");
		return truncateToWidth(this.theme.fg("text", line), width, "");
	}

	private buildListLines(width: number, filtered: QuestionOption[], hideDescriptions = false): string[] {
		const theme = this.theme;
		const lines: string[] = [];
		const count = this.getItemCount(filtered);
		const searchValue = this.searchQuery ? theme.fg("text", this.searchQuery) : theme.fg("dim", "type to filter");
		lines.push(truncateToWidth(`${theme.fg("accent", "Filter:")} ${searchValue}`, width, ""));

		if (this.searchQuery && filtered.length === 0) {
			lines.push(truncateToWidth(theme.fg("warning", "No matching options"), width, ""));
		}

		if (count === 0) {
			if (!this.searchQuery) lines.push(truncateToWidth(theme.fg("warning", "No options"), width, ""));
			return lines.slice(0, this.maxVisibleRows);
		}

		const maxRows = Math.max(1, this.maxVisibleRows - lines.length);
		const rows = renderSingleSelectRows({
			options: filtered,
			selectedIndex: this.selectedIndex,
			width,
			allowFreeform: this.allowFreeform,
			allowComment: this.allowComment,
			commentEnabled: this.commentEnabled,
			maxRows,
			hideDescriptions,
		});
		for (const row of rows) lines.push(this.styleListLine(row.line, width, row.selected));
		return lines.slice(0, this.maxVisibleRows);
	}

	private buildPreviewLines(width: number, filtered: QuestionOption[], maxLines: number): string[] {
		if (maxLines <= 0) return [];
		const mdTheme = safeMarkdownTheme();
		let md = "";

		if (this.isCommentToggleRow(this.selectedIndex, filtered)) {
			md += "## Additional context\n\n";
			md += `Currently: **${this.commentEnabled ? "Enabled" : "Disabled"}**\n\n`;
			md += "Turn this on when the selected option needs extra explanation before the tool submits.\n";
		} else if (this.isFreeformRow(this.selectedIndex, filtered)) {
			md += "## Custom response\n\nOpen the editor to write **any** answer.\n\n*Use this when none of the listed options fit.*\n";
			if (this.searchQuery) md += `\n> Current filter: \`${this.searchQuery}\`\n`;
		} else {
			const selected = filtered[this.selectedIndex];
			if (!selected) {
				md += "*No option selected*\n";
			} else {
				md += `## ${selected.label}\n\n`;
				md += selected.description?.trim() ?? "*No additional details provided for this option.*\n";
				md += `\n---\n\nPress \`Enter\` to select this option.\n`;
				if (this.searchQuery) md += `\n> Filter: \`${this.searchQuery}\`\n`;
			}
		}

		let lines: string[];
		if (mdTheme) {
			lines = new Markdown(md.trim(), 0, 0, mdTheme).render(width);
		} else {
			lines = [];
			for (const line of wrapTextWithAnsi(md.trim(), Math.max(10, width))) {
				lines.push(truncateToWidth(line, width, ""));
			}
		}
		while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") lines.pop();
		if (lines.length <= maxLines) return lines;
		if (maxLines === 1) return [truncateToWidth(this.theme.fg("dim", "…"), width, "")];
		const visible = lines.slice(0, maxLines - 1);
		visible.push(truncateToWidth(this.theme.fg("dim", "…"), width, ""));
		return visible;
	}

	// ---------------------------------------------------------------------------
	// Input handling
	// ---------------------------------------------------------------------------

	handleInput(data: string): void {
		if (!this.selectionMode.multi) {
			this.handleSingleSelectInput(data);
		} else {
			this.handleMultiSelectInput(data);
		}
	}

	private handleSingleSelectInput(data: string): void {
		// Single-select order: escape-clears-search → cancel → comment-toggle → up → down
		//   → number → space-on-comment → confirm → backspace → printable
		if (this.searchQuery && matchesKey(data, Key.escape)) {
			this.setSearchQuery("");
			return;
		}
		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.onCancel?.();
			return;
		}
		if (this.allowComment && !this.commentToggle.disabled && this.commentToggle.matches(data)) {
			this.toggleComment();
			return;
		}

		const filtered = this.getFilteredOptions();
		const count = this.getItemCount(filtered);

		if (matchesUp(data, this.keybindings) && count > 0) {
			this.selectedIndex = this.selectedIndex === 0 ? count - 1 : this.selectedIndex - 1;
			this.invalidate();
			return;
		}
		if (matchesDown(data, this.keybindings) && count > 0) {
			this.selectedIndex = this.selectedIndex === count - 1 ? 0 : this.selectedIndex + 1;
			this.invalidate();
			return;
		}

		const numMatch = data.match(/^[1-9]$/);
		if (numMatch && filtered.length > 0) {
			const idx = Number.parseInt(numMatch[0], 10) - 1;
			if (idx >= 0 && idx < filtered.length) {
				this.selectedIndex = idx;
				this.invalidate();
				return;
			}
		}

		if (matchesKey(data, Key.space) && count > 0 && this.isCommentToggleRow(this.selectedIndex, filtered)) {
			this.toggleComment();
			return;
		}

		if (this.keybindings.matches(data, "tui.select.confirm") && count > 0) {
			if (this.isCommentToggleRow(this.selectedIndex, filtered)) {
				this.toggleComment();
				return;
			}
			if (this.isFreeformRow(this.selectedIndex, filtered)) {
				this.onEnterFreeform?.();
				return;
			}
			const result = filtered[this.selectedIndex]?.label;
			if (result) this.onSubmit?.([result], this.commentEnabled);
			else this.onCancel?.();
			return;
		}

		if (this.keybindings.matches(data, "tui.editor.deleteCharBackward") || matchesKey(data, Key.backspace)) {
			this.popSearchChar();
			return;
		}

		const printable = this.getPrintableInput(data);
		if (printable) this.setSearchQuery(this.searchQuery + printable);
	}

	private handleMultiSelectInput(data: string): void {
		// Multi-select order: cancel → count-check → comment-toggle → up → down
		//   → number → space → confirm
		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.onCancel?.();
			return;
		}

		const count = this.getItemCount();
		if (count === 0) {
			this.onCancel?.();
			return;
		}

		if (this.allowComment && !this.commentToggle.disabled && this.commentToggle.matches(data)) {
			this.toggleComment();
			return;
		}

		if (matchesUp(data, this.keybindings)) {
			this.selectedIndex = this.selectedIndex === 0 ? count - 1 : this.selectedIndex - 1;
			this.invalidate();
			return;
		}
		if (matchesDown(data, this.keybindings)) {
			this.selectedIndex = this.selectedIndex === count - 1 ? 0 : this.selectedIndex + 1;
			this.invalidate();
			return;
		}

		const numMatch = data.match(/^[1-9]$/);
		if (numMatch) {
			const idx = Number.parseInt(numMatch[0], 10) - 1;
			if (idx >= 0 && idx < this.options.length) {
				this.selectionMode.toggle(this.checked, idx);
				this.selectedIndex = Math.min(idx, count - 1);
				this.invalidate();
			}
			return;
		}

		if (matchesKey(data, Key.space)) {
			if (this.isCommentToggleRow(this.selectedIndex)) {
				this.toggleComment();
				return;
			}
			if (this.isFreeformRow(this.selectedIndex)) {
				this.onEnterFreeform?.();
				return;
			}
			if (this.selectedIndex < this.options.length) {
				this.selectionMode.toggle(this.checked, this.selectedIndex);
				this.invalidate();
			}
			return;
		}

		if (this.keybindings.matches(data, "tui.select.confirm")) {
			if (this.isCommentToggleRow(this.selectedIndex)) {
				this.toggleComment();
				return;
			}
			if (this.isFreeformRow(this.selectedIndex)) {
				this.onEnterFreeform?.();
				return;
			}

			const result = this.selectionMode.buildResult({
				selectedIndex: this.selectedIndex,
				checked: this.checked,
				options: this.options,
			});
			if (result.length > 0) this.onSubmit?.(result, this.commentEnabled);
			else this.onCancel?.();
		}
	}

	// ---------------------------------------------------------------------------
	// Rendering
	// ---------------------------------------------------------------------------

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

		let lines: string[];

		if (this.selectionMode.multi) {
			lines = this.renderMulti(width);
		} else {
			lines = this.renderSingle(width);
		}

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	private renderMulti(width: number): string[] {
		const theme = this.theme;
		const count = this.getItemCount();
		const maxVisible = Math.min(count, 10);

		if (count === 0) {
			return [theme.fg("warning", "No options")];
		}

		const startIndex = Math.max(0, Math.min(this.selectedIndex - Math.floor(maxVisible / 2), count - maxVisible));
		const endIndex = Math.min(startIndex + maxVisible, count);
		const lines: string[] = [];

		for (let i = startIndex; i < endIndex; i++) {
			const isSelected = i === this.selectedIndex;
			const prefix = isSelected ? theme.fg("accent", "→") : " ";

			if (this.isCommentToggleRow(i)) {
				const checkbox = this.commentEnabled ? theme.fg("success", "[✓]") : theme.fg("dim", "[ ]");
				const label = isSelected
					? theme.fg("accent", theme.bold(COMMENT_TOGGLE_LABEL))
					: theme.fg("text", theme.bold(COMMENT_TOGGLE_LABEL));
				lines.push(truncateToWidth(`${prefix}   ${checkbox} ${label}`, width, ""));
				continue;
			}

			if (this.isFreeformRow(i)) {
				const label = theme.fg("text", theme.bold("Type custom answer."));
				const desc = theme.fg("muted", "Enter a custom response");
				lines.push(truncateToWidth(`${prefix}   ${label} ${theme.fg("dim", "—")} ${desc}`, width, ""));
				continue;
			}

			const option = this.options[i];
			if (!option) continue;

			const checkbox = this.checked.has(i) ? theme.fg("success", "[✓]") : theme.fg("dim", "[ ]");
			const num = theme.fg("dim", `${i + 1}.`);
			const title = isSelected ? theme.fg("accent", theme.bold(option.label)) : theme.fg("text", theme.bold(option.label));
			lines.push(truncateToWidth(`${prefix} ${num} ${checkbox} ${title}`, width, ""));

			if (option.description) {
				const indent = "      ";
				for (const w of wrapTextWithAnsi(option.description, Math.max(10, width - indent.length))) {
					lines.push(truncateToWidth(indent + theme.fg("muted", w), width, ""));
				}
			}
		}

		if (startIndex > 0 || endIndex < count) {
			lines.push(theme.fg("dim", truncateToWidth(`  (${this.selectedIndex + 1}/${count})`, width, "")));
		}

		return lines;
	}

	private renderSingle(width: number): string[] {
		const filtered = this.getFilteredOptions();
		const count = this.getItemCount(filtered);
		this.selectedIndex = count > 0 ? Math.max(0, Math.min(this.selectedIndex, count - 1)) : 0;

		const split = this.getSplitPaneWidths(width);

		if (!split) {
			return this.buildListLines(width, filtered);
		}

		const listLines = this.buildListLines(split.left, filtered, true);
		const previewLines = this.buildPreviewLines(split.right, filtered, this.maxVisibleRows);
		const rowCount = Math.min(this.maxVisibleRows, Math.max(listLines.length, previewLines.length));
		const separator = this.theme.fg("dim", SPLIT_PANE_SEPARATOR);
		return Array.from({ length: rowCount }, (_, index) => {
			const left = truncateToWidth(listLines[index] ?? "", split.left, "", true);
			const right = truncateToWidth(previewLines[index] ?? "", split.right, "");
			return `${left}${separator}${right}`;
		});
	}
}