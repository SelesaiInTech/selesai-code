/**
 * Deterministic long-transcript TUI render benchmark.
 *
 * Run:  npx tsx scripts/bench-long-transcript.ts [maxMessages]
 *
 * Measures the real TuiMainScreen render path used by InteractiveMode at
 * increasing history sizes, separating:
 *   1. root render            (Container.render over the whole tree)
 *   2. line reset pass        (applyLineResets over all rendered lines)
 *   3. unchanged diff scan    (the full old-vs-new line compare)
 *   4. steady-state doRender  (root render + resets + diff + cursor handling)
 *   5. assistant-message render (real component, warm cache)
 *   6. tool-execution render    (real bash/read/grep mix, warm cache; post-fix this
 *      is a cached array identity check, live/partial tools still re-render)
 *
 * A FakeTerminal keeps this deterministic and headless. Numbers are wall-clock
 * medians; the gates in GATES.md record the pass/fail thresholds.
 */
import { performance } from "node:perf_hooks";
import { Box, Container, Markdown, Spacer, Text, TuiMainScreen } from "@earendil-works/pi-tui";
import { getMarkdownTheme, initTheme } from "../src/modes/interactive/theme/theme.ts";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { createAllToolDefinitions } from "../src/core/tools/index.ts";
import { boxToolCall, boxToolResult } from "../src/extensions/pi-tool-display/src/tool-call-box.ts";

initTheme("dark");

const WIDTH = 100;
const HEIGHT = 40;

class FakeTerminal {
	columns = WIDTH;
	rows = HEIGHT;
	bytesWritten = 0;
	write(data: string): void {
		this.bytesWritten += data.length;
	}
	start(): void {}
	stop(): void {}
	hideCursor(): void {}
	showCursor(): void {}
	setProgress(): void {}
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

function measureMs(fn: () => void, iterations = 5): number {
	const samples: number[] = [];
	for (let i = 0; i < iterations; i++) {
		const start = performance.now();
		fn();
		samples.push(performance.now() - start);
	}
	return median(samples);
}

const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;

/** Approximate an interactive transcript: user text, assistant markdown, boxed tool output. */
function buildSyntheticChat(messages: number): Container {
	const chat = new Container();
	for (let i = 0; i < messages; i++) {
		switch (i % 3) {
			case 0:
				chat.addChild(new Text(`user ${i}: show me the contents of the directory and explain what changed`, 1, 0));
				break;
			case 1:
				chat.addChild(
					new Markdown(
						`assistant ${i}: here is a **summary** with \`code\` and a list:\n\n- first\n- second\n\nMore prose to wrap. `.repeat(2),
						1,
						0,
						getMarkdownTheme(),
					),
				);
				break;
			default: {
				const box = new Box(1, 1, (s: string) => dim(s));
				box.addChild(new Text(bold("bash") + `\n$ echo hello ${i}\nhello ${i}\n`, 0, 0));
				chat.addChild(box);
				break;
			}
		}
	}
	return chat;
}

function makeMainScreen(): TuiMainScreen {
	return new TuiMainScreen(new FakeTerminal() as never, false, "/tmp/selesai-bench");
}

/** Pre-warm render caches, then return measured steady-state render costs. */
function benchMainScreen(messages: number) {
	const tui = makeMainScreen();
	tui.addChild(buildSyntheticChat(messages));

	// First render populates component caches and TuiMainScreen.previousLines.
	tui.doRender();
	const renderedLines = tui.previousLines.length;

	const rootRender = measureMs(() => {
		tui.render(WIDTH);
	});

	const lineReset = measureMs(() => {
		tui.applyLineResets([...tui.previousLines]);
	});

	// Unchanged-diff scan: same comparison loop TuiMainScreen.doRender performs.
	const oldLines = tui.previousLines;
	const diffScan = measureMs(() => {
		const newLines = oldLines; // unchanged, worst-case full scan
		const maxLines = Math.max(newLines.length, oldLines.length);
		let firstChanged = -1;
		let lastChanged = -1;
		for (let i = 0; i < maxLines; i++) {
			const oldLine = i < oldLines.length ? oldLines[i] : "";
			const newLine = i < newLines.length ? newLines[i] : "";
			if (oldLine !== newLine) {
				if (firstChanged === -1) firstChanged = i;
				lastChanged = i;
			}
		}
		void firstChanged;
		void lastChanged;
	});

	// Steady-state doRender with no changes exercises the full real path.
	const steadyDoRender = measureMs(() => {
		tui.doRender();
	});

	const firstRender = measureMs(() => {
		const fresh = makeMainScreen();
		fresh.addChild(buildSyntheticChat(messages));
		fresh.doRender();
	}, 3);

	return { renderedLines, rootRender, lineReset, diffScan, steadyDoRender, firstRender };
}

function benchAssistantComponents(messages: number) {
	const container = new Container();
	const components: AssistantMessageComponent[] = [];
	for (let i = 0; i < messages; i++) {
		const component = new AssistantMessageComponent(undefined, false);
		component.updateContent({
			role: "assistant",
			content: [{ type: "text", text: `assistant ${i}: **bold** claim with \`code\` and enough prose to wrap across the terminal width.`.repeat(2) }],
			stopReason: "stop",
		} as never);
		container.addChild(component);
		components.push(component);
	}
	// Warm caches, then measure a cached full-container render.
	container.render(WIDTH);
	const renderMs = measureMs(() => {
		container.render(WIDTH);
	});
	return { lines: container.render(WIDTH).length, renderMs };
}

const TOOL_DEFS = createAllToolDefinitions("/tmp");
const TOOL_MIX = ["bash", "read", "grep"] as const;

/** Mirror pi-tool-display's decoration: boxed renderers + renderShell self. */
function decorateTool(name: (typeof TOOL_MIX)[number]): never {
	const def = TOOL_DEFS[name];
	return {
		...def,
		renderShell: "self",
		renderCall: (args: unknown, theme: unknown, context: unknown) =>
			boxToolCall(def.renderCall(args, theme, context) as never, theme as never, true),
		renderResult: (result: unknown, options: unknown, theme: unknown, context: unknown) =>
			boxToolResult(def.renderResult(result, options, theme, context) as never, theme as never, true),
	} as never;
}

function benchToolComponents(messages: number) {
	const container = new Container();
	const components: ToolExecutionComponent[] = [];
	for (let i = 0; i < messages; i++) {
		const name = TOOL_MIX[i % TOOL_MIX.length];
		const args =
			name === "bash"
				? { command: "ls -la src" }
				: name === "grep"
					? { pattern: "TODO", path: "src" }
					: { path: "src/index.ts" };
		const out = Array.from({ length: 40 }, (_, k) => `line ${k}: output content`).join("\n");
		const component = new ToolExecutionComponent(
			name,
			`tc-${i}`,
			args,
			{ showImages: false },
			decorateTool(name),
			{ requestRender() {} } as never,
			"/tmp",
		);
		component.updateResult({ content: [{ type: "text", text: out }], isError: false });
		component.setArgsComplete();
		container.addChild(component);
		components.push(component);
	}
	container.render(WIDTH);
	const renderMs = measureMs(() => {
		container.render(WIDTH);
	});
	return { lines: container.render(WIDTH).length, renderMs };
}

function fmt(ms: number): string {
	return ms.toFixed(2);
}

function main(): void {
	const maxMessages = Number.parseInt(process.argv[2] ?? "3000", 10);
	const sizes = [50, 200, 500, 1000, 2000, maxMessages].filter((n, i, a) => a.indexOf(n) === i && n > 0);

	console.log(`TUI long-transcript render benchmark (width=${WIDTH}, height=${HEIGHT})\n`);
	console.log(
		["messages", "lines", "rootRender ms", "lineReset ms", "diffScan ms", "steady doRender ms", "first render ms"].join("\t"),
	);
	for (const messages of sizes) {
		const r = benchMainScreen(messages);
		console.log(
			[
				messages,
				r.renderedLines,
				fmt(r.rootRender),
				fmt(r.lineReset),
				fmt(r.diffScan),
				fmt(r.steadyDoRender),
				fmt(r.firstRender),
			].join("\t"),
		);
	}

	console.log("\nReal component render (warm cache):");
	console.log(["component", "messages", "lines", "render ms"].join("\t"));
	for (const messages of [100, 1000]) {
		const a = benchAssistantComponents(messages);
		console.log(["assistant-message", messages, a.lines, fmt(a.renderMs)].join("\t"));
		const t = benchToolComponents(messages);
		console.log(["tool-execution", messages, t.lines, fmt(t.renderMs)].join("\t"));
	}
}

main();
