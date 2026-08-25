import { describe, expect, test } from "vitest";
import { createPowerShellTool } from "./powershell.ts";
import { getPowerShellConfig, POWERSHELL_ARGS } from "../../utils/shell.ts";

describe("powershell tool", () => {
	test("uses a process-local execution policy bypass", () => {
		expect(POWERSHELL_ARGS).toEqual(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"]);
	});

	test.skipIf(process.platform !== "win32")("executes commands with UTF-8 output", async () => {
		expect(getPowerShellConfig().args).toEqual(POWERSHELL_ARGS);
		const result = await createPowerShellTool(process.cwd()).execute("test", {
			command: "Write-Output 'héllo €'; Get-ExecutionPolicy -Scope Process",
		});
		const output = result.content
			.filter((item) => item.type === "text")
			.map((item) => item.text ?? "")
			.join("\n");
		expect(output).toContain("héllo €");
		expect(output).toContain("Bypass");
	});
});
