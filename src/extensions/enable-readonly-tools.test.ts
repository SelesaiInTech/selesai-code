import { describe, expect, it, vi } from "vitest";

const { createFindToolDefinition, createGrepToolDefinition, createLsToolDefinition } = vi.hoisted(() => ({
	createFindToolDefinition: vi.fn(() => ({ name: "find" })),
	createGrepToolDefinition: vi.fn(() => ({ name: "grep" })),
	createLsToolDefinition: vi.fn(() => ({ name: "ls" })),
}));

vi.mock("@selesai/code", () => ({
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
}));

import enableReadonlyTools from "./enable-readonly-tools.ts";

function setup() {
	let handler!: (event: { toolName: string; isError: boolean }, ctx: { cwd: string }) => void;
	const active = new Set(["read", "bash", "edit", "write"]);
	const pi = {
		on: vi.fn((_event: string, registeredHandler: typeof handler) => {
			handler = registeredHandler;
		}),
		registerTool: vi.fn((tool: { name: string }) => active.add(tool.name)),
	};
	enableReadonlyTools(pi as any);
	return { active, handler, pi };
}

describe("enable-readonly-tools", () => {
	it("does not activate readonly tools after failed or unrelated calls", () => {
		const { active, handler, pi } = setup();

		handler({ toolName: "read", isError: true }, { cwd: "/project" });
		handler({ toolName: "extension-tool", isError: false }, { cwd: "/project" });

		expect(pi.registerTool).not.toHaveBeenCalled();
		expect([...active]).toEqual(["read", "bash", "edit", "write"]);
	});

	it.each(["read", "bash", "edit", "write"])("activates once after a successful %s call", (toolName) => {
		const { active, handler, pi } = setup();

		handler({ toolName, isError: false }, { cwd: "/project" });
		expect(pi.registerTool).toHaveBeenCalledTimes(3);
		expect([...active]).toEqual(["read", "bash", "edit", "write", "grep", "find", "ls"]);

		handler({ toolName: "bash", isError: false }, { cwd: "/other" });
		expect(pi.registerTool).toHaveBeenCalledTimes(3);
		expect(createGrepToolDefinition).toHaveBeenCalledWith("/project");
	});
});
