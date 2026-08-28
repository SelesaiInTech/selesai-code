import type { Theme } from "@earendil-works/pi-coding-agent";
import { Input, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { getModalIcons } from "./modal-icons.js";
import type { ZellijModalContentRenderer } from "./zellij-modal.js";

const SPLIT_PANE_MIN_WIDTH = 84;
const LIST_MIN_WIDTH = 28;
const INSPECTOR_MIN_WIDTH = 36;
const BODY_ROW_MIN = 8;
const BODY_ROW_MAX = 14;
const SEARCH_BOX_MIN_WIDTH = 12;
const SEARCH_BOX_MAX_WIDTH = 24;
const INSPECTOR_TITLE_GAP_ROWS = 1;
const INSPECTOR_PATH_GAP_ROWS = 1;
const FOOTER_ACTIONS = ["Space/Enter toggle", "↑↓ navigate", "Esc close"] as const;

export interface InspectorSettingItem {
	id: string;
	label: string;
	currentValue: string;
	values?: readonly string[];
	inspectorTitle: string;
	inspectorSummary: readonly string[];
	inspectorOptions?: readonly string[];
	inspectorPath?: string;
	inspectorAdvanced?: readonly string[];
	searchTerms?: readonly string[];
}

export interface SplitPaneInspectorModalOptions {
	getSettings: () => readonly InspectorSettingItem[];
	onChange: (id: string, value: string) => void;
	onClose: () => void;
}

interface SplitPaneWidths {
	list: number;
	inspector: number;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function fitText(text: string, width: number): string {
	const safeWidth = Math.max(0, width);
	if (safeWidth === 0) {
		return "";
	}
	const fitted = truncateToWidth(text, safeWidth, "…", true);
	const padding = Math.max(0, safeWidth - visibleWidth(fitted));
	return `${fitted}${" ".repeat(padding)}`;
}

function wrapText(text: string, width: number): string[] {
	const safeWidth = Math.max(1, width);
	const normalized = text.trim();
	if (!normalized) {
		return [];
	}

	const words = normalized.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let current = "";

	for (const word of words) {
		const candidate = current ? `${current} ${word}` : word;
		if (visibleWidth(candidate) <= safeWidth) {
			current = candidate;
			continue;
		}

		if (current) {
			lines.push(current);
			current = "";
		}

		if (visibleWidth(word) <= safeWidth) {
			current = word;
			continue;
		}

		let remaining = word;
		while (visibleWidth(remaining) > safeWidth) {
			const piece = truncateToWidth(remaining, safeWidth, "", false);
			lines.push(piece);
			remaining = remaining.slice(Math.max(1, piece.length));
		}
		current = remaining;
	}

	if (current) {
		lines.push(current);
	}

	return lines.length > 0 ? lines : [normalized];
}

function getScrollableWindow<T>(items: readonly T[], selectedIndex: number, visibleRows: number): readonly T[] {
	if (items.length <= visibleRows) {
		return items;
	}

	const halfWindow = Math.floor(visibleRows / 2);
	const maxStart = Math.max(0, items.length - visibleRows);
	const start = clamp(selectedIndex - halfWindow, 0, maxStart);
	return items.slice(start, start + visibleRows);
}

function splitPaneWidths(totalWidth: number): SplitPaneWidths {
	const usable = Math.max(LIST_MIN_WIDTH + INSPECTOR_MIN_WIDTH, totalWidth - 1);
	const preferredList = Math.floor(usable * 0.38);
	const list = clamp(preferredList, LIST_MIN_WIDTH, Math.max(LIST_MIN_WIDTH, usable - INSPECTOR_MIN_WIDTH));
	const inspector = Math.max(INSPECTOR_MIN_WIDTH, usable - list);
	return { list, inspector };
}

function getBodyRowBudget(): number {
	const terminalRows =
		typeof process.stdout.rows === "number" && Number.isFinite(process.stdout.rows)
			? process.stdout.rows
			: 36;
	return clamp(Math.floor(terminalRows * 0.33), BODY_ROW_MIN, BODY_ROW_MAX);
}

function isSlashInput(data: string): boolean {
	return data === "/" || matchesKey(data, "/");
}

function shouldForwardInputToSearch(data: string): boolean {
	if (!data) {
		return false;
	}
	if (matchesKey(data, "space") || data === " ") {
		return false;
	}
	return true;
}

export class SplitPaneInspectorModal implements ZellijModalContentRenderer {
	private readonly options: SplitPaneInspectorModalOptions;
	private readonly theme: Theme;
	private readonly searchInput: Input;
	private readonly icons = getModalIcons();
	private selectedId: string | null = null;
	private showAdvanced = false;

	constructor(options: SplitPaneInspectorModalOptions, theme: Theme) {
		this.options = options;
		this.theme = theme;
		this.searchInput = new Input();
		this.searchInput.focused = true;
	}

	render(width: number): string[] {
		const safeWidth = Math.max(1, width);
		const items = this.getFilteredItems();
		this.ensureSelection(items);

		if (safeWidth < SPLIT_PANE_MIN_WIDTH) {
			return this.renderStackedLayout(items, safeWidth);
		}

		return this.renderSplitLayout(items, safeWidth);
	}

	invalidate(): void {
		// Fully state-driven renderer.
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.options.onClose();
			return;
		}

		if (matchesKey(data, "up")) {
			this.moveSelection(-1);
			return;
		}

		if (matchesKey(data, "down")) {
			this.moveSelection(1);
			return;
		}

		if (matchesKey(data, "return") || matchesKey(data, "space") || data === " ") {
			this.cycleSelectedValue();
			return;
		}

		if (isSlashInput(data)) {
			this.showAdvanced = !this.showAdvanced;
			return;
		}

		if (!shouldForwardInputToSearch(data)) {
			return;
		}

		this.searchInput.handleInput(data);
		this.ensureSelection(this.getFilteredItems());
	}

	private renderSplitLayout(items: readonly InspectorSettingItem[], width: number): string[] {
		const paneWidths = splitPaneWidths(width);
		const bodyRows = getBodyRowBudget();
		const header = this.buildHeaderRow(width);
		const divider = this.buildHorizontalDivider(paneWidths.list, paneWidths.inspector);
		const footer = this.buildFooterRow(width);
		const listLines = this.buildListPaneLines(items, paneWidths.list, bodyRows);
		const inspectorLines = this.buildInspectorPaneLines(this.getSelectedItem(items), paneWidths.inspector, bodyRows);
		const lines: string[] = [header, divider];
		const dividerPaint = this.theme.fg("dim", "│");

		for (let index = 0; index < bodyRows; index += 1) {
			const listLine = listLines[index] ?? " ".repeat(paneWidths.list);
			const inspectorLine = inspectorLines[index] ?? " ".repeat(paneWidths.inspector);
			lines.push(`${listLine}${dividerPaint}${inspectorLine}`);
		}

		lines.push(divider);
		lines.push(footer);
		return lines;
	}

	private renderStackedLayout(items: readonly InspectorSettingItem[], width: number): string[] {
		const bodyRows = Math.max(BODY_ROW_MIN, Math.floor(getBodyRowBudget() / 2));
		const divider = this.theme.fg("dim", "─".repeat(Math.max(1, width)));
		return [
			this.buildHeaderRow(width),
			divider,
			...this.buildListPaneLines(items, width, bodyRows),
			divider,
			...this.buildInspectorPaneLines(this.getSelectedItem(items), width, bodyRows + 2),
			divider,
			this.buildFooterRow(width),
		];
	}

	private buildHeaderRow(width: number): string {
		const searchBox = this.buildSearchBox(width);
		const leftText = this.theme.fg("accent", this.theme.bold("Pi Tool Display Settings"));
		const leftWidth = visibleWidth("Pi Tool Display Settings");
		const searchWidth = visibleWidth(searchBox);
		const gap = Math.max(1, width - leftWidth - searchWidth);
		if (gap <= 1) {
			return truncateToWidth(`${leftText} ${searchBox}`, width, "", true);
		}
		return `${leftText}${" ".repeat(gap)}${searchBox}`;
	}

	private buildSearchBox(width: number): string {
		const desiredInnerWidth = clamp(Math.floor(width * 0.18), SEARCH_BOX_MIN_WIDTH, SEARCH_BOX_MAX_WIDTH);
		const rendered = this.searchInput.render(desiredInnerWidth + 2)[0] ?? "> ";
		const normalized = rendered.startsWith("> ") ? rendered.slice(2) : rendered;
		const inner = fitText(normalized, desiredInnerWidth);
		return `${this.theme.fg("muted", this.icons.search)} [${inner}]`;
	}

	private buildHorizontalDivider(leftWidth: number, rightWidth: number): string {
		const paint = (text: string) => this.theme.fg("dim", text);
		return `${paint("─".repeat(Math.max(1, leftWidth)))}${paint("┬")}${paint("─".repeat(Math.max(1, rightWidth)))}`;
	}

	private buildFooterRow(width: number): string {
		const modeAction = this.showAdvanced ? "/ basic" : "/ advanced";
		const text = [...FOOTER_ACTIONS.slice(0, 2), modeAction, FOOTER_ACTIONS[2]].join(" │ ");
		return this.theme.fg("dim", fitText(text, width));
	}

	private getAllSettings(): readonly InspectorSettingItem[] {
		return this.options.getSettings();
	}

	private getFilteredItems(): readonly InspectorSettingItem[] {
		const query = this.searchInput.getValue().trim().toLowerCase();
		const settings = this.getAllSettings();
		if (!query) {
			return settings;
		}

		return settings.filter((item) => {
			const haystack = [
				item.label,
				item.currentValue,
				item.inspectorTitle,
				...item.inspectorSummary,
				...(item.inspectorOptions ?? []),
				...(item.searchTerms ?? []),
			]
				.join(" ")
				.toLowerCase();
			return haystack.includes(query);
		});
	}

	private ensureSelection(items: readonly InspectorSettingItem[]): void {
		if (items.length === 0) {
			this.selectedId = null;
			return;
		}

		if (this.selectedId && items.some((item) => item.id === this.selectedId)) {
			return;
		}

		this.selectedId = items[0]?.id ?? null;
	}

	private moveSelection(delta: number): void {
		const items = this.getFilteredItems();
		if (items.length === 0) {
			return;
		}

		this.ensureSelection(items);
		const currentIndex = Math.max(0, items.findIndex((item) => item.id === this.selectedId));
		const nextIndex = (currentIndex + delta + items.length) % items.length;
		this.selectedId = items[nextIndex]?.id ?? this.selectedId;
	}

	private cycleSelectedValue(): void {
		const item = this.getSelectedItem(this.getFilteredItems());
		if (!item || !item.values || item.values.length === 0) {
			return;
		}

		const currentIndex = item.values.indexOf(item.currentValue);
		const nextIndex = (currentIndex + 1 + item.values.length) % item.values.length;
		const nextValue = item.values[nextIndex] ?? item.values[0];
		if (!nextValue) {
			return;
		}

		this.options.onChange(item.id, nextValue);
		this.selectedId = item.id;
	}

	private getSelectedItem(items: readonly InspectorSettingItem[]): InspectorSettingItem | null {
		this.ensureSelection(items);
		return items.find((item) => item.id === this.selectedId) ?? null;
	}

	private buildListPaneLines(items: readonly InspectorSettingItem[], width: number, rowCount: number): string[] {
		const safeWidth = Math.max(1, width);
		if (items.length === 0) {
			return this.padRows(
				[
					this.theme.fg("warning", fitText("No matching settings.", safeWidth)),
					this.theme.fg("dim", fitText("Backspace in search to widen the filter.", safeWidth)),
				],
				rowCount,
				safeWidth,
			);
		}

		const selectedIndex = Math.max(0, items.findIndex((item) => item.id === this.selectedId));
		const visibleItems = getScrollableWindow(items, selectedIndex, rowCount);
		const maxValueWidth = Math.max(...visibleItems.map((item) => visibleWidth(item.currentValue)), 6);
		const valueWidth = clamp(maxValueWidth, 6, Math.max(6, Math.floor(safeWidth * 0.34)));
		const labelWidth = Math.max(8, safeWidth - 3 - valueWidth);
		const lines = visibleItems.map((item) => this.renderSettingRow(item, safeWidth, labelWidth, valueWidth));
		return this.padRows(lines, rowCount, safeWidth);
	}

	private renderSettingRow(item: InspectorSettingItem, width: number, labelWidth: number, valueWidth: number): string {
		const selected = item.id === this.selectedId;
		const cursor = selected ? this.theme.fg("accent", this.theme.bold(">")) : " ";
		const labelText = fitText(item.label, labelWidth);
		const valueText = fitText(item.currentValue, valueWidth);
		const styledLabel = selected ? this.theme.bold(labelText) : labelText;
		const styledValue = selected ? this.theme.fg("accent", valueText) : this.theme.fg("muted", valueText);
		return truncateToWidth(`${cursor} ${styledLabel} ${styledValue}`, width, "", true);
	}

	private buildInspectorPaneLines(selectedItem: InspectorSettingItem | null, width: number, rowCount: number): string[] {
		const safeWidth = Math.max(1, width);
		if (!selectedItem) {
			return this.padRows(
				[
					this.theme.fg("accent", fitText("[ Search ]", safeWidth)),
					"",
					...this.colorWrappedParagraphs(
						["No settings matched the current filter. Adjust the search field to repopulate the settings index."],
						safeWidth,
						"muted",
					),
				],
				rowCount,
				safeWidth,
			);
		}

		const topLines: string[] = [this.theme.fg("accent", fitText(`[ ${selectedItem.inspectorTitle} ]`, safeWidth))];
		for (let index = 0; index < INSPECTOR_TITLE_GAP_ROWS; index += 1) {
			topLines.push("");
		}
		topLines.push(...this.colorWrappedParagraphs(selectedItem.inspectorSummary, safeWidth, "muted"));

		if (this.showAdvanced && (selectedItem.inspectorAdvanced?.length ?? 0) > 0) {
			topLines.push("");
			topLines.push(this.theme.fg("accent", fitText("Advanced:", safeWidth)));
			topLines.push(...this.colorWrappedBullets(selectedItem.inspectorAdvanced ?? [], safeWidth, "dim"));
		}

		if ((selectedItem.inspectorOptions?.length ?? 0) > 0) {
			topLines.push("");
			topLines.push(this.theme.fg("dim", fitText("Options:", safeWidth)));
			topLines.push(...this.colorWrappedBullets(selectedItem.inspectorOptions ?? [], safeWidth, "muted"));
		}

		const bottomLines: string[] = [];
		if (selectedItem.inspectorPath) {
			for (let index = 0; index < INSPECTOR_PATH_GAP_ROWS; index += 1) {
				bottomLines.push(" ".repeat(safeWidth));
			}
			bottomLines.push(this.theme.fg("dim", fitText("Path:", safeWidth)));
			bottomLines.push(this.theme.fg("muted", fitText(selectedItem.inspectorPath, safeWidth)));
		}

		return this.composeInspectorRows(topLines, bottomLines, rowCount, safeWidth);
	}

	private composeInspectorRows(topLines: string[], bottomLines: string[], rowCount: number, width: number): string[] {
		const totalLines = [...topLines];
		if (bottomLines.length === 0) {
			return this.padRows(totalLines, rowCount, width);
		}

		if (topLines.length + bottomLines.length <= rowCount) {
			const spacerCount = rowCount - topLines.length - bottomLines.length;
			return [...topLines, ...Array.from({ length: spacerCount }, () => " ".repeat(width)), ...bottomLines];
		}

		const reservedBottom = bottomLines.length;
		const maxTopLines = Math.max(1, rowCount - reservedBottom - 1);
		const trimmedTop = topLines.slice(0, maxTopLines);
		trimmedTop.push(this.theme.fg("dim", fitText("…", width)));
		return [...trimmedTop, ...bottomLines].slice(0, rowCount);
	}

	private colorWrappedParagraphs(paragraphs: readonly string[], width: number, color: "muted" | "dim"): string[] {
		const lines: string[] = [];
		for (const paragraph of paragraphs) {
			for (const line of wrapText(paragraph, width)) {
				lines.push(this.theme.fg(color, fitText(line, width)));
			}
		}
		return lines;
	}

	private colorWrappedBullets(bullets: readonly string[], width: number, color: "muted" | "dim"): string[] {
		const lines: string[] = [];
		const bulletPrefix = "• ";
		const continuationPrefix = "  ";
		const contentWidth = Math.max(1, width - visibleWidth(bulletPrefix));
		for (const bullet of bullets) {
			const wrapped = wrapText(bullet, contentWidth);
			for (const [index, line] of wrapped.entries()) {
				const prefix = index === 0 ? bulletPrefix : continuationPrefix;
				lines.push(this.theme.fg(color, fitText(`${prefix}${line}`, width)));
			}
		}
		return lines;
	}

	private padRows(lines: string[], rowCount: number, width: number): string[] {
		const padded = [...lines];
		while (padded.length < rowCount) {
			padded.push(" ".repeat(width));
		}
		return padded.slice(0, rowCount);
	}
}
