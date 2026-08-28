import { beforeAll, describe, expect, it } from "vitest";
import { initTheme } from "../modes/interactive/theme/theme.ts";
import { buildBulletBoxLines, boxLineWidth, StartupBox } from "../modes/interactive/components/startup-box.ts";

/** Strip ANSI escapes to get the visible text. */
function visible(line: string): string {
	// eslint-disable-next-line no-control-regex
	return line.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("buildBulletBoxLines", () => {
	it("aligns every line to the same visible width", () => {
		const lines = buildBulletBoxLines("Skills", ["read", "bash", "a-very-long-skill-name"]);
		const widths = lines.map((line) => visible(line).length);
		expect(new Set(widths).size).toBe(1);
	});

	it("flows all items onto one row when no maxWidth given", () => {
		const lines = buildBulletBoxLines("Tools", ["read", "bash"]);
		expect(lines).toHaveLength(3); // top + 1 row + bottom
		expect(lines.map(visible).join("\n")).toContain("read");
	});

	it("hugs content instead of stretching to full width", () => {
		const items = ["read", "bash", "edit", "grep", "write", "find", "ls"];
		const lines = buildBulletBoxLines("Tools", items, 120);
		// 7 items flow into one row; box hugs to content (~63) instead of stretching to 120
		expect(visible(lines[0]).length).toBeLessThan(80);
		// but everything still fits
		const joined = lines.map(visible).join("\n");
		for (const item of items) {
			expect(joined).toContain(item);
		}
	});

	it("flows items into multiple columns on wide terminals", () => {
		const items = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
		const lines = buildBulletBoxLines("Skills", items, 80);
		// 6 items in one wide box: rows must be far fewer than items
		expect(lines.length).toBeLessThan(items.length);
		// every item still present
		const joined = lines.map(visible).join("\n");
		for (const item of items) {
			expect(joined).toContain(item);
		}
	});

	it("single column on narrow terminals", () => {
		const items = ["alpha", "bravo", "charlie"];
		const lines = buildBulletBoxLines("Skills", items, 20);
		// narrow: columns can't fit side by side
		expect(lines.length).toBeGreaterThanOrEqual(items.length);
	});

	it("keeps every item when flowing into columns (row-major, no gaps)", () => {
		const items = ["a", "b", "c", "d", "e"];
		const lines = buildBulletBoxLines("T", items, 100);
		const joined = lines.map(visible).join("\n");
		for (const item of items) {
			expect(joined).toContain(`• ${item}`);
		}
	});

	it("aligns columns evenly", () => {
		const lines = buildBulletBoxLines("T", ["bb", "a", "cc", "d"], 100);
		for (const line of lines.slice(1, -1)) {
			expect(visible(line).length).toBe(visible(lines[0]).length);
		}
	});

	it("sorts labels alphabetically", () => {
		const lines = buildBulletBoxLines("T", ["zebra", "alpha", "mango"]);
		expect(visible(lines[1])).toContain("alpha");
	});

	it("trims and drops empty labels", () => {
		const lines = buildBulletBoxLines("T", ["  a  ", "", "b"]);
		const joined = lines.map(visible).join("\n");
		expect(joined).toContain("a");
		expect(joined).not.toContain("•  ");
	});

	it("respects maxWidth at every line", () => {
		const items = ["one", "two", "three", "four", "five", "six"];
		for (let width = 8; width <= 80; width += 2) {
			const lines = buildBulletBoxLines("Tools", items, width);
			for (const line of lines) {
				expect(visible(line).length).toBeLessThanOrEqual(width);
			}
			const widths = new Set(lines.map((line) => visible(line).length));
			expect(widths.size).toBe(1);
		}
	});

	it("handles an extremely narrow width (8 col)", () => {
		const lines = buildBulletBoxLines("Skills", ["x"], 8);
		for (const line of lines) {
			expect(visible(line).length).toBeLessThanOrEqual(8);
		}
		expect(visible(lines[1])).toContain("•");
	});
});

describe("StartupBox component", () => {
	beforeAll(() => {
		initTheme();
	});

	it("renders valid lines at varying widths (responsive)", () => {
		const box = new StartupBox("Skills", ["read", "bash", "averylongskillname"]);
		for (const width of [20, 40, 60, 100, 200]) {
			const lines = box.render(width);
			const widths = new Set(lines.map((line) => visible(line).length));
			expect(widths.size).toBe(1);
			for (const line of lines) {
				expect(visible(line).length).toBeLessThanOrEqual(width);
			}
		}
	});

	it("uses fewer rows on wider terminals (horizontal flow)", () => {
		const box = new StartupBox("Tools", ["a", "b", "c", "d", "e", "f", "g", "h"]);
		const narrow = box.render(20).length;
		const wide = box.render(200).length;
		expect(wide).toBeLessThan(narrow);
	});

	it("colors lines with theme border color and heading title", () => {
		const box = new StartupBox("Tools", ["read"]);
		const lines = box.render(80);
		expect(visible(lines[0])).toContain("Tools");
		// ANSI escapes present (theme coloring applied)
		expect(lines[0]).not.toBe(visible(lines[0]));
	});

	it("invalidate is a safe no-op", () => {
		const box = new StartupBox("T", ["a"]);
		expect(() => box.invalidate()).not.toThrow();
	});
});