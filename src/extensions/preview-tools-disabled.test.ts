import { describe, expect, it, vi } from "vitest";

import disablePreviewTools from "./preview-tools-disabled.ts";

function setup(active: string[]) {
	let handler!: () => void;
	const getActiveTools = vi.fn(() => active);
	const setActiveTools = vi.fn();
	const pi = {
		on: vi.fn((_event: string, registeredHandler: () => void) => {
			handler = registeredHandler;
		}),
		getActiveTools,
		setActiveTools,
	};
	disablePreviewTools(pi as any);
	return { handler, getActiveTools, setActiveTools };
}

describe("preview-tools-disabled", () => {
	it("keeps a session without preview_export unchanged", () => {
		const { handler, getActiveTools, setActiveTools } = setup(["read", "bash", "edit", "write"]);

		handler();

		expect(getActiveTools).toHaveBeenCalledTimes(1);
		expect(setActiveTools).not.toHaveBeenCalled();
	});

	it("removes preview_export and keeps every other active tool", () => {
		const { handler, setActiveTools } = setup(["read", "bash", "edit", "write", "preview_export", "web_explore"]);

		handler();

		expect(setActiveTools).toHaveBeenCalledWith(["read", "bash", "edit", "write", "web_explore"]);
	});
});
