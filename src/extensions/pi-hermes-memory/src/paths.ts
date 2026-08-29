import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { DEFAULT_PROJECTS_MEMORY_DIR } from "./constants.js";

// Route through the host resolver only. The upstream `PI_CODING_AGENT_DIR`
// env var is deliberately NOT honored here: on the Selesai fork it would
// silently point memory at ~/.pi/agent while the host reads ~/.selesai/agent.
export const AGENT_ROOT = getAgentDir();

export function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

export function normalizeConfiguredMemoryDir(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  const expanded = expandHome(trimmed);
  if (path.isAbsolute(expanded)) return path.normalize(expanded);
  return path.resolve(AGENT_ROOT, expanded);
}

function isSafeRelativeDirectory(input: string): boolean {
  const segments = input.split(/[\\/]+/).filter(Boolean);
  return segments.length === 1 && segments[0] !== "." && segments[0] !== "..";
}

export function normalizeProjectsMemoryDir(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  const expanded = expandHome(trimmed);
  let relative = expanded;

  if (path.isAbsolute(expanded)) {
    const resolved = path.resolve(expanded);
    const relativeToAgentRoot = path.relative(AGENT_ROOT, resolved);
    if (
      relativeToAgentRoot === ""
      || relativeToAgentRoot.startsWith("..")
      || path.isAbsolute(relativeToAgentRoot)
    ) {
      return undefined;
    }
    relative = relativeToAgentRoot;
  }

  const normalized = path.normalize(relative).replace(/^[\\/]+|[\\/]+$/g, "");
  if (!isSafeRelativeDirectory(normalized)) return undefined;
  return normalized;
}

export function resolveProjectsRoot(projectsMemoryDir = DEFAULT_PROJECTS_MEMORY_DIR): string {
  const normalized = normalizeProjectsMemoryDir(projectsMemoryDir) ?? DEFAULT_PROJECTS_MEMORY_DIR;
  return path.join(AGENT_ROOT, normalized);
}
