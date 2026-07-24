import { createRequire } from "module";
import { describe, expect, it } from "vitest";
import { getBrokerLaunchSpec, getWindowsBrokerCommandLine } from "./spawn.ts";

const require = createRequire(import.meta.url);
const brokerPath = "C:\\broker dir\\broker.ts";
const extensionDir = "C:\\published-package\\dist\\extensions\\pi-intercom";
const nodePath = "C:\\Program Files\\nodejs\\node.exe";

describe("intercom broker launch", () => {
  it("resolves default Windows tsx launcher from installed dependencies", () => {
    const tsxCliPath = require.resolve("tsx/cli");

    expect(getWindowsBrokerCommandLine(brokerPath, extensionDir, nodePath)).toBe(
      `"${nodePath}" "${tsxCliPath}" "${brokerPath}"`,
    );
    expect(getWindowsBrokerCommandLine(brokerPath, extensionDir, nodePath)).not.toContain(extensionDir);
  });

  it("preserves custom broker commands on Windows and other platforms", () => {
    expect(getWindowsBrokerCommandLine(brokerPath, extensionDir, nodePath, "broker-command", ["--port", "1234"])).toBe(
      `"broker-command" "--port" "1234" "${brokerPath}"`,
    );

    expect(getBrokerLaunchSpec(brokerPath, "broker-command", ["--port", "1234"], extensionDir, "linux")).toEqual({
      kind: "direct",
      command: "broker-command",
      args: ["--port", "1234", brokerPath],
    });
  });
});
