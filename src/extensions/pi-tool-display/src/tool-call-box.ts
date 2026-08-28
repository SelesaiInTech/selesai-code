import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";

interface ToolCallBoxTheme {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

const MIN_BOX_WIDTH = 8;
const TITLE = "Tools";

function border(theme: ToolCallBoxTheme, text: string): string {
	return theme.fg("border", text);
}

function contentLine(line: string, width: number, theme: ToolCallBoxTheme): string {
	const contentWidth = Math.max(1, width - 4);
	const content = truncateToWidth(line, contentWidth, "", true);
	const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(content)));
	return `${border(theme, "│")} ${content}${padding} ${border(theme, "│")}`;
}

function topBorder(width: number, theme: ToolCallBoxTheme): string {
	const innerWidth = Math.max(0, width - 2);
	const label = theme.fg("toolTitle", theme.bold(TITLE));
	const prefix = "─ ";
	const suffix = " ";
	const gap = Math.max(0, innerWidth - visibleWidth(prefix + TITLE + suffix));
	return `${border(theme, "╭" + prefix)}${label}${border(theme, suffix + "─".repeat(gap) + "╮")}`;
}

function bottomBorder(width: number, theme: ToolCallBoxTheme): string {
	return `${border(theme, "╰" + "─".repeat(Math.max(0, width - 2)) + "╯")}`;
}

function boxedLines(component: Component, width: number, theme: ToolCallBoxTheme): string[] {
	return component.render(Math.max(1, width - 4)).map((line) => contentLine(line, width, theme));
}

/**
 * Wrap a tool renderer's component so it renders inside an ASCII frame while
 * remaining a transparent stand-in for the wrapped component.
 *
 * The frame (or the raw fallback for narrow widths) is cached by width:
 * TuiMainScreen re-renders the whole transcript on every frame, and without
 * this cache every finalized tool would re-run its inner renderer + border
 * construction per frame (measured ~24 ms for 1000 boxed tools).
 *
 * A Proxy is required, not a plain object wrapper: Pi's built-in renderers
 * (bash, grep, ...) reuse the previous component through `lastComponent` and
 * mutate it in place (`setText`, `clear`, `addChild`, `state`). A Proxy
 * forwards all of those to the real component, and bumps a mutation counter so
 * the frame cache is dropped exactly when the wrapped content changes.
 */
function framedBox(
	component: Component,
	getTheme: () => ToolCallBoxTheme,
	frame: (width: number, lines: string[], theme: ToolCallBoxTheme) => string[],
): Component {
	let cacheWidth = -1;
	let cacheLines: string[] | undefined;
	let cacheIsFramed = false;

	const target = component as unknown as Record<string | symbol, unknown>;

	return new Proxy(target, {
		get(_t, prop) {
			if (prop === "render") {
				return (width: number): string[] => {
					if (cacheWidth === width && cacheLines !== undefined && cacheIsFramed) {
						return cacheLines;
					}
					if (width < MIN_BOX_WIDTH) {
						return component.render(width);
					}
					const lines = frame(width, component.render(Math.max(1, width - 4)), getTheme());
					cacheWidth = width;
					cacheLines = lines;
					cacheIsFramed = true;
					return lines;
				};
			}
			if (prop === "invalidate") {
				return () => {
					cacheWidth = -1;
					cacheLines = undefined;
					cacheIsFramed = false;
					component.invalidate?.();
				};
			}
			const value = Reflect.get(target, prop, target);
			if (typeof value === "function") {
				// Renderers mutate the reused component through these entry points;
				// any such mutation makes the cached frame stale.
				if (prop === "setText" || prop === "clear" || prop === "addChild" || prop === "removeChild") {
					return (...args: unknown[]) => {
						const result = (value as (...a: unknown[]) => unknown).apply(target, args);
						cacheWidth = -1;
						cacheLines = undefined;
						cacheIsFramed = false;
						return result;
					};
				}
				return (value as (...a: unknown[]) => unknown).bind(target);
			}
			return value;
		},
	}) as unknown as Component;
}

/**
 * Pi's renderers hand the previous component back through `lastComponent`, so a
 * component can be wrapped on every updateDisplay. Idempotent wrapping (one
 * framed proxy per wrapped component and role) prevents frames from stacking;
 * the theme cell is refreshed on each wrap so a theme change rebuilds frames
 * with the new colors instead of the first-wrap palette.
 */
const framedWrappers = new WeakMap<object, { theme: ToolCallBoxTheme; call?: Component; result?: Component }>();

function wrapFramed(
	component: Component,
	theme: ToolCallBoxTheme,
	enabled: boolean,
	role: "call" | "result",
): Component {
	if (!enabled) {
		return component;
	}
	const target = component as object;
	let entry = framedWrappers.get(target);
	if (!entry) {
		entry = { theme };
		framedWrappers.set(target, entry);
	} else {
		entry.theme = theme;
	}
	const existing = role === "call" ? entry.call : entry.result;
	if (existing) {
		// updateDisplay always accompanies content/state changes. Re-wrapping means
		// the renderer is about to rebuild content, so drop any cached frame now;
		// the hot path (spinner ticks, input, terminal events) re-renders without
		// updateDisplay and still hits the width-keyed cache.
		existing.invalidate?.();
		return existing;
	}
	const getTheme = (): ToolCallBoxTheme => entry.theme;
	const frame =
		role === "call"
			? (width: number, lines: string[], currentTheme: ToolCallBoxTheme) => [
					topBorder(width, currentTheme),
					...lines.map((line) => contentLine(line, width, currentTheme)),
				]
			: (width: number, lines: string[], currentTheme: ToolCallBoxTheme) => [
					...lines.map((line) => contentLine(line, width, currentTheme)),
					bottomBorder(width, currentTheme),
				];
	const proxy = framedBox(component, getTheme, frame);
	if (role === "call") {
		entry.call = proxy;
	} else {
		entry.result = proxy;
	}
	// Register the proxy itself so renderers handing the wrapped component back
	// through lastComponent re-wrap to the same proxy instead of stacking frames.
	framedWrappers.set(proxy, entry);
	return proxy;
}

/**
 * Split framing lets Pi keep its normal call/result renderers while presenting
 * the two adjacent components as one bordered tool transaction. The call half
 * renders the top border + content; the result half renders content + bottom
 * border. Under renderShell "self" the host stacks the two halves adjacently,
 * so the pair forms one contiguous ASCII box.
 */
export function boxToolCall(component: Component, theme: ToolCallBoxTheme, enabled: boolean): Component {
	return wrapFramed(component, theme, enabled, "call");
}

export function boxToolResult(component: Component, theme: ToolCallBoxTheme, enabled: boolean): Component {
	return wrapFramed(component, theme, enabled, "result");
}
