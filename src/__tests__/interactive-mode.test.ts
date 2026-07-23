import { describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../modes/interactive/interactive-mode.js";

describe("InteractiveMode handleEvent tool_execution_update", () => {
	it("refreshes displayed args from execution update", () => {
		const component = {
			updateArgs: vi.fn(),
			updateResult: vi.fn(),
		};
		const requestRender = vi.fn();

		const mode = Object.create(InteractiveMode.prototype) as InteractiveMode;
		mode.isInitialized = true;
		mode.footer = { invalidate: vi.fn() } as any;
		mode.pendingTools = new Map([["tc-1", component as any]]);
		mode.ui = { requestRender } as any as InteractiveMode["ui"];

		mode.handleEvent({
			type: "tool_execution_update",
			toolCallId: "tc-1",
			toolName: "bash",
			args: { command: "rtk ls -la" },
			partialResult: { content: [], details: undefined },
		} as any);

		expect(component.updateArgs).toHaveBeenCalledTimes(1);
		expect(component.updateArgs).toHaveBeenCalledWith({ command: "rtk ls -la" });
		expect(component.updateResult).toHaveBeenCalledTimes(1);
		expect(component.updateResult).toHaveBeenCalledWith(
			{ content: [], details: undefined, isError: false },
			true,
		);
		expect(requestRender).toHaveBeenCalledTimes(1);
	});

	it("is a no-op when update references an unknown tool", () => {
		const requestRender = vi.fn();
		const mode = Object.create(InteractiveMode.prototype) as InteractiveMode;
		mode.isInitialized = true;
		mode.footer = { invalidate: vi.fn() } as any;
		mode.pendingTools = new Map();
		mode.ui = { requestRender } as any as InteractiveMode["ui"];

		mode.handleEvent({
			type: "tool_execution_update",
			toolCallId: "missing",
			toolName: "bash",
			args: { command: "rtk ls -la" },
			partialResult: { content: [], details: undefined },
		} as any);

		expect(requestRender).not.toHaveBeenCalled();
	});
});
