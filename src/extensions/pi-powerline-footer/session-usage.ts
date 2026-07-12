import type { UsageStats } from "./types.ts";

type RecordLike = Record<string, unknown>;

function isRecord(value: unknown): value is RecordLike {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Extract the aggregate usage reported by a completed foreground subagent run.
 * Child agents use separate sessions, so their assistant messages are not in
 * the parent session branch. The parent records this aggregate on its
 * `subagent` tool result instead.
 */
function readUsage(value: unknown): UsageStats | null {
  if (!isRecord(value)) return null;

  const { input, output, cacheRead, cacheWrite, cost } = value;
  if (![input, output, cacheRead, cacheWrite, cost].every(finiteNumber)) return null;

  return { input, output, cacheRead, cacheWrite, cost };
}

export function readSubagentToolResultUsage(message: unknown): UsageStats | null {
  if (!isRecord(message) || message.role !== "toolResult" || message.toolName !== "subagent") {
    return null;
  }

  const details = isRecord(message.details) ? message.details : null;
  return readUsage(details?.totalChildUsage);
}

/** Read usage emitted when an asynchronous subagent run completes. */
export function readAsyncSubagentUsage(event: unknown): { runId: string; sessionId: string; usage: UsageStats } | null {
  if (!isRecord(event) || typeof event.sessionId !== "string") return null;

  const runId = typeof event.runId === "string" ? event.runId : typeof event.id === "string" ? event.id : null;
  const usage = readUsage(event.totalChildUsage);
  return runId && usage ? { runId, sessionId: event.sessionId, usage } : null;
}
