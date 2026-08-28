import assert from "node:assert/strict";
import test from "node:test";
import { Text } from "@earendil-works/pi-tui";
import { boxToolCall, boxToolResult } from "../src/tool-call-box.ts";

interface BoxThemeLike {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

const passThroughTheme: BoxThemeLike = {
	fg: (_color: string, text: string): string => text,
	bold: (text: string): string => text,
};

function render(component: unknown, width = 60): string[] {
	return (component as { render(totalWidth: number): string[] }).render(width);
}

test("boxed call renders the startup-style ASCII top frame around the call", () => {
	const call = boxToolCall(new Text("$ ls", 0, 0), passThroughTheme, true);
	const lines = render(call);

	assert.match(lines[0] ?? "", /╭─ Tools ─/);
	assert.ok(lines.some((line) => line.includes("$ ls")), "call content should be inside the box");
	assert.match(lines.at(-1) ?? "", /│/, "call row should have side borders");
});

test("boxed result renders the bottom frame around the output", () => {
	const result = boxToolResult(new Text("a.txt", 0, 0), passThroughTheme, true);
	const lines = render(result);

	assert.match(lines.at(-1) ?? "", /╰─+╯/);
	assert.ok(lines.some((line) => line.includes("a.txt")), "result content should be inside the box");
});

test("stacked call and result form one contiguous ASCII box", () => {
	const call = boxToolCall(new Text("$ ls", 0, 0), passThroughTheme, true);
	const result = boxToolResult(new Text("a.txt\nb.txt", 0, 0), passThroughTheme, true);

	// Under renderShell "self" the host stacks the call half then the result
	// half (with a leading spacer), so concatenating their lines is exactly
	// what the TUI shows: one contiguous box.
	const lines = [...render(call), ...render(result)];

	const tops = lines.filter((line) => /╭/.test(line));
	const bottoms = lines.filter((line) => /╰/.test(line));
	assert.equal(tops.length, 1, "exactly one top border across the pair");
	assert.equal(bottoms.length, 1, "exactly one bottom border across the pair");
	assert.match(lines[0] ?? "", /╭─ Tools ─/);
	assert.match(lines.at(-1) ?? "", /╰─+╯/);
	assert.ok(lines.some((line) => line.includes("$ ls")), "call row present");
	assert.ok(lines.some((line) => line.includes("a.txt")), "first result row present");
	assert.ok(lines.some((line) => line.includes("b.txt")), "second result row present");
	const borderedRows = lines.filter((line) => /[╭╰│]/.test(line));
	assert.ok(borderedRows.length >= 5, "top, two content rows, result row, bottom");
});

test("disabled box passthrough keeps the original component", () => {
	const call = new Text("$ ls", 0, 0);
	const result = new Text("a.txt", 0, 0);
	assert.equal(boxToolCall(call, passThroughTheme, false), call);
	assert.equal(boxToolResult(result, passThroughTheme, false), result);
});

test("narrow widths fall back to raw rendering instead of overflowing", () => {
	const call = boxToolCall(new Text("$ ls", 0, 0), passThroughTheme, true);
	const lines = render(call, 4);
	assert.equal(lines.join("\n"), "$ ls");
});

test("long content is width-safe and does not exceed the border width", () => {
	const long = new Text("a".repeat(200), 0, 0);
	const call = boxToolCall(long, passThroughTheme, true);
	const lines = render(call, 40);
	for (const line of lines) {
		if (/[╭╰│]/.test(line)) {
			assert.ok(line.length <= 41, `border line too long: ${line.length}`);
		}
	}
});

test("framed lines are cached by width and reused across renders", () => {
	const call = boxToolCall(new Text("$ ls", 0, 0), passThroughTheme, true);
	const first = render(call);
	const second = render(call);
	assert.equal(second, first, "unchanged render should reuse the cached array");
});

test("invalidate clears the frame cache", () => {
	const call = boxToolCall(new Text("$ ls", 0, 0), passThroughTheme, true);
	const first = render(call);
	call.invalidate?.();
	const second = render(call);
	assert.notEqual(second, first, "invalidate should force a rebuild");
	assert.deepEqual(second, first, "content is unchanged, so lines must be identical");
});

test("width change re-renders the frame", () => {
	const call = boxToolCall(new Text("$ ls", 0, 0), passThroughTheme, true);
	const narrow = render(call, 30);
	const wide = render(call, 60);
	assert.notEqual(wide, narrow, "different width must rebuild the frame");
	assert.ok(wide[0]?.includes("─"), "wide frame should still be boxed");
});
