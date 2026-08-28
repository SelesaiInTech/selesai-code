import type { Component } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";

/**
 * Pure layout math for the startup resource boxes. No coloring here so it can
 * be unit-tested without a terminal.
 *
 * Items flow horizontally into columns; the box width hugs its content and
 * never exceeds maxWidth:
 *
 *   ╭─ Skills ────────────────────────╮
 *   │ • alpha    • gamma    • zeta    │
 *   │ • beta     • delta              │
 *   ╰─────────────────────────────────╯
 *
 * Every line is exactly `innerWidth + 2` visible characters: outer border char
 * (1) + inner content (innerWidth) + border char (1).
 */

/** Minimum inner width so the bullet, label, and padding always have room. */
export const MIN_BOX_INNER_WIDTH = 6;

/** Visible line width for a box with the given inner content width. */
export function boxLineWidth(innerWidth: number): number {
	return innerWidth + 2;
}

/**
 * Build the box lines for a titled bullet box.
 * Labels are trimmed and sorted. Items flow into as many columns as fit within
 * `maxWidth`; the box shrinks to its content (never wider than maxWidth).
 * Anything that still doesn't fit is ellipsis-truncated.
 */
export function buildBulletBoxLines(title: string, items: string[], maxWidth?: number): string[] {
	const labels = items
		.map((item) => item.trim())
		.filter((item) => item.length > 0)
		.sort((a, b) => a.localeCompare(b));

	const longestLabel = labels.reduce((max, label) => Math.max(max, label.length), 0);
	const gap = 2;
	const naturalCell = longestLabel + 2; // "• label" + one pad
	const titleWidth = Math.max(title.length + 4, MIN_BOX_INNER_WIDTH);

	const maxInner = maxWidth !== undefined ? Math.max(1, maxWidth - 2) : Infinity;

	// Cell width and column count: fit as many columns as the budget allows.
	const cellWidth = Math.min(naturalCell, maxInner);
	const maxCols = maxWidth !== undefined
		? Math.max(1, Math.floor((maxInner + gap) / (cellWidth + gap)))
		: Math.max(1, labels.length);
	const cols = Math.min(labels.length, maxCols);

	// Box hugs content: columns + gaps, at least as wide as the title, capped by budget.
	const contentWidth = cols * cellWidth + gap * (cols - 1);
	const innerWidth = Math.min(
		Math.max(titleWidth, contentWidth),
		maxInner,
	);

	const fit = (label: string): string =>
		label.length <= cellWidth - 2 ? label : `${label.slice(0, cellWidth - 3)}…`;

	const rows = Math.ceil(labels.length / cols);
	const topInner = `─ ${title} ${"─".repeat(Math.max(0, innerWidth - title.length - 3))}`.slice(0, innerWidth);
	const top = `╭${topInner}╮`;
	const bottom = `╰${"─".repeat(innerWidth)}╯`;
	const rowLines = Array.from({ length: rows }, (_, row) => {
		const cells: string[] = [];
		for (let col = 0; col < cols; col++) {
			const label = labels[row * cols + col];
			cells.push(label === undefined ? " ".repeat(cellWidth) : `• ${fit(label)}`.padEnd(cellWidth));
		}
		const content = cells.join(" ".repeat(gap));
		return `│${content.padEnd(innerWidth)}│`;
	});
	return [top, ...rowLines, bottom];
}

/**
 * Responsive boxed bullet list component. Recomputes layout per render width,
 * so it stays correct on terminal resize.
 */
export class StartupBox implements Component {
	private readonly title: string;
	private readonly items: string[];

	constructor(title: string, items: string[]) {
		this.title = title;
		this.items = items;
	}

	invalidate(): void {
		// Stateless per render; nothing cached.
	}

	render(width: number): string[] {
		const lines = buildBulletBoxLines(this.title, this.items, width);
		const border = (s: string) => theme.fg("border", s);
		return lines.map((line, index) => {
			// Top line: color the embedded title with the heading color.
			const match = index === 0 ? line.match(/^(╭─ )(.+?)( ─*╮)$/) : undefined;
			if (match) {
				return border(match[1]) + theme.fg("mdHeading", match[2]) + border(match[3]);
			}
			return border(line);
		});
	}
}