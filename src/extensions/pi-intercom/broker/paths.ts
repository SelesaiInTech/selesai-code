import { join } from "path";
import { getAgentDir } from "@selesai/code";

function sanitizePipeSegment(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "default";
}

/** selesai config dir (~/.selesai/agent on the selesai fork, ~/.pi/agent upstream). */
export function getIntercomDir(): string {
  return join(getAgentDir(), "intercom");
}

export function getBrokerSocketPath(
  platform: NodeJS.Platform = process.platform,
  intercomDir: string = getIntercomDir(),
): string {
  if (platform === "win32") {
    return `\\\\.\\pipe\\pi-intercom-${sanitizePipeSegment(intercomDir)}`;
  }

  return join(intercomDir, "broker.sock");
}