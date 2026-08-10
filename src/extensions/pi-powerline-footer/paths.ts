import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@selesai/code";

export function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

export function getAgentPath(...segments: string[]): string {
  return join(getAgentDir(), ...segments);
}

export function getLegacyPiPath(...segments: string[]): string {
  return join(getHomeDir(), CONFIG_DIR_NAME, ...segments);
}

export function getAgentSessionDirs(): string[] {
  const primary = getAgentPath("sessions");
  const legacy = getLegacyPiPath("sessions");
  return existsSync(legacy) && legacy !== primary ? [primary, legacy] : [primary];
}
