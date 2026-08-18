import { describe, expect, test } from "vitest";
import { parseArgs } from "./args.ts";

describe("parseArgs --use-theme", () => {
	test("parses --use-theme with a theme name", () => {
		const result = parseArgs(["--use-theme", "nord-border", "hello"]);
		expect(result.useTheme).toBe("nord-border");
		expect(result.messages).toEqual(["hello"]);
	});

	test("accepts light/dark slash form", () => {
		const result = parseArgs(["--use-theme", "light/dark"]);
		expect(result.useTheme).toBe("light/dark");
	});

	test("reports an error when --use-theme is missing a theme name", () => {
		const result = parseArgs(["--use-theme"]);
		expect(result.useTheme).toBeUndefined();
		expect(result.diagnostics.some((d) => d.type === "error")).toBe(true);
	});

	test("reports an error when --use-theme precedes a flag", () => {
		const result = parseArgs(["--use-theme", "--no-session"]);
		expect(result.useTheme).toBeUndefined();
		expect(result.noSession).toBe(true);
		expect(result.diagnostics.some((d) => d.type === "error")).toBe(true);
	});
});
