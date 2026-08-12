import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TuiAltScreen, TuiMainScreen, type TUI } from "@earendil-works/pi-tui";
import { SettingsManager } from "../../../src/core/settings-manager.ts";
import {
	createInteractiveTui,
	createInteractiveTuiReference,
	InteractiveMode,
} from "../../../src/modes/interactive/interactive-mode.ts";
import { resolveShortcutConfig } from "../../../src/extensions/pi-powerline-footer/index.ts";

const VIEWPORT_TUI = Symbol.for("@earendil-works/pi-tui/viewport");

describe("Selesai TUI mode migration (Pi v0.84.1)", () => {
	it("defaults the TUI mode to fullscreen while honoring an explicit regular mode", () => {
		const manager = SettingsManager.inMemory({});
		expect(manager.getTuiMode()).toBe("fullscreen");

		const explicitRegular = SettingsManager.inMemory({ tuiMode: "regular" });
		expect(explicitRegular.getTuiMode()).toBe("regular");

		const explicitFullscreen = SettingsManager.inMemory({ tuiMode: "fullscreen" });
		expect(explicitFullscreen.getTuiMode()).toBe("fullscreen");

		expect(manager.getFullscreenScrollbar()).toBe("auto");
		expect(SettingsManager.inMemory({ fullscreenScrollbar: "always" }).getFullscreenScrollbar()).toBe("always");
		expect(SettingsManager.inMemory({ fullscreenScrollbar: "hidden" }).getFullscreenScrollbar()).toBe("hidden");
	});

	it("selects the native fullscreen renderer for fullscreen mode and the main screen for regular mode", () => {
		const fullscreen = createInteractiveTui({
			tuiMode: "fullscreen",
			showHardwareCursor: false,
			logDirectory: fileURLToPath(new URL("../../fixtures", import.meta.url)),
		});
		expect(fullscreen).toBeInstanceOf(TuiAltScreen);
		expect(fullscreen.mode).toBe("fullscreen");

		const regular = createInteractiveTui({
			tuiMode: "regular",
			showHardwareCursor: false,
			logDirectory: fileURLToPath(new URL("../../fixtures", import.meta.url)),
		});
		expect(regular).toBeInstanceOf(TuiMainScreen);
		expect(regular.mode).toBe("regular");
	});

	it("mounts components onto the native fixed dock for viewport (fullscreen) renderers", () => {
		const mode = Object.create(InteractiveMode.prototype) as InteractiveMode & {
			fullscreenLayoutRoot: unknown;
		};
		const layoutRoot = { marker: "fullscreen-layout-root" };
		mode.fullscreenLayoutRoot = layoutRoot;

		const added: unknown[] = [];
		const layoutRoots: unknown[] = [];
		const viewportTui = {
			[VIEWPORT_TUI]: true,
			mode: "fullscreen",
			addChild: (component: unknown) => added.push(component),
			setLayoutRoot: (root: unknown) => layoutRoots.push(root),
		} as unknown as TUI;
		const first = { name: "document" };
		const second = { name: "footer-dock" };

		(mode as unknown as { mountInteractiveTui(tui: TUI, components: unknown[]): void }).mountInteractiveTui(
			viewportTui,
			[first, second],
		);

		expect(added).toEqual([first, second]);
		expect(layoutRoots).toEqual([layoutRoot]);
	});

	it("keeps the TUI reference stable across renderer swaps", () => {
		const tuiA = createInteractiveTui({
			tuiMode: "fullscreen",
			showHardwareCursor: false,
			logDirectory: fileURLToPath(new URL("../../fixtures", import.meta.url)),
		});
		const tuiB = createInteractiveTui({
			tuiMode: "regular",
			showHardwareCursor: false,
			logDirectory: fileURLToPath(new URL("../../fixtures", import.meta.url)),
		});
		let current: TUI = tuiA;
		const reference = createInteractiveTuiReference(() => current);

		expect(reference.mode).toBe("fullscreen");
		current = tuiB;
		// The stable reference must route through to the active renderer.
		expect(reference.mode).toBe("regular");
	});
});

describe("Powerline lifecycle without the terminal-split compositor", () => {
	it("does not install or require the old TerminalSplitCompositor / terminal monkey-patching", () => {
		const indexSource = readFileSync(
			fileURLToPath(new URL("../../../src/extensions/pi-powerline-footer/index.ts", import.meta.url)),
			"utf-8",
		);
		const configSource = readFileSync(
			fileURLToPath(new URL("../../../src/extensions/pi-powerline-footer/powerline-config.ts", import.meta.url)),
			"utf-8",
		);

		for (const needle of [
			"TerminalSplitCompositor",
			"terminal-split",
			"renderFixedEditorCluster",
			"emergencyTerminalModeReset",
			"mouseScroll",
			"fixedEditorCompositor",
		]) {
			expect(indexSource).not.toContain(needle);
		}
		expect(configSource).not.toContain("mouseScroll");
		expect(configSource).not.toContain("fixedEditor:");
	});

	it("no longer exposes the compositor-era chat jump and scroll shortcuts", () => {
		const resolved = resolveShortcutConfig({});
		expect(resolved.jumpPreviousUserMessage).toBeUndefined();
		expect(resolved.jumpNextUserMessage).toBeUndefined();
		expect(resolved.jumpPreviousLlmMessage).toBeUndefined();
		expect(resolved.jumpNextLlmMessage).toBeUndefined();
		expect(resolved.jumpChatBottom).toBeUndefined();
		expect(resolved.scrollChatUp).toBeUndefined();
		expect(resolved.scrollChatDown).toBeUndefined();
		// Retained editor/navigation shortcuts still resolve.
		expect(resolved.stashHistory).toBe("ctrl+alt+h");
		expect(resolved.editorStart).toBe("super+shift+up");
		expect(resolved.editorEnd).toBe("super+shift+down");
	});
});
