/**
 * tool-error-autofix — POC auto-fix for tool call errors.
 *
 * When a built-in tool call fails, this extension asks the current model to
 * distill a single general best-practice rule that would have prevented the
 * error, appends it to AGENTS.md (under a managed section), and injects the
 * lesson into the system prompt for the next turn so it takes effect live.
 *
 * Goal: turn "the agent didn't know the best practice" into a documented,
 * self-improving instruction the agent reads before its next tool call.
 *
 * ponytail: POC — one extension file, no framework, no config surface. Ceiling:
 * the generated lesson is only as good as the error text the model sees; noisy
 * lessons could bloat AGENTS.md. Upgrade path: per-tool lesson caps + a
 * /autofix command to review/prune the lesson ledger.
 */
import type { ExtensionAPI, ExtensionContext, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { completeSimple, type Context, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai/compat";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

const SECTION_START = "<!-- tool-error-autofix -->";
const SECTION_END = "<!-- /tool-error-autofix -->";

const SYSTEM_PROMPT = `You convert a single tool-call error into one concise, general best-practice rule the agent should follow forever to avoid it.

Rules:
- Output ONE line: an imperative instruction addressed to "you" (the agent).
- Generalize. No file names, no session-specific paths, no exact strings from the failed call.
- Name the tool and the concrete mistake class, then the fix.
- Max 220 chars. No preamble, no markdown, no quotes.

Examples (style only):
- edit: when oldText must match exactly, read the file first and copy whitespace/indentation verbatim; never retype from memory.
- edit: never JSON-stringify the edits array — send edits as a real array of {oldText,newText} objects, not a string.`;

interface Lesson {
  hash: string;
  text: string;
}

// In-memory lessons generated this session, injected into the system prompt
// before they are persisted/reloaded. Survives until reload.
const sessionLessons: Lesson[] = [];
const seenHashes = new Set<string>();

function errorText(event: ToolResultEvent): string {
  return event.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();
}

/** Stable signature for dedupe: tool name + first meaningful line of the error. */
function signature(toolName: string, text: string): string {
  const firstLine = text
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  return createHash("sha1").update(`${toolName}\u0000${firstLine ?? text}`).digest("hex").slice(0, 12);
}

async function authFor(
  model: Model<any>,
  modelRegistry: ExtensionContext["modelRegistry"],
): Promise<{ apiKey?: string; headers?: Record<string, string>; env?: Record<string, string> } | undefined> {
  const r = await modelRegistry.getApiKeyAndHeaders(model);
  if (!r.ok || !r.apiKey) return undefined;
  return { apiKey: r.apiKey, headers: r.headers, env: r.env };
}

async function generateLesson(
  model: Model<any>,
  toolName: string,
  error: string,
  auth: { apiKey?: string; headers?: Record<string, string>; env?: Record<string, string> } | undefined,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  const userPrompt = `Tool: ${toolName}\nError:\n${error}\n\nOutput the one-line rule.`;
  const context: Context = {
    systemPrompt: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: userPrompt }],
        timestamp: Date.now(),
      },
    ],
  };
  const options: SimpleStreamOptions = {
    maxTokens: Math.min(256, model.maxTokens > 0 ? model.maxTokens : 256),
    apiKey: auth?.apiKey,
    headers: auth?.headers,
    env: auth?.env,
    signal,
  };
  try {
    const res = await completeSimple(model, context, options);
    if (res.stopReason === "error") return undefined;
    const text = res.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join(" ")
      .trim();
    const oneLine = text
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean);
    return oneLine ? oneLine.replace(/^["'`]|["'`]$/g, "").trim().slice(0, 300) : undefined;
  } catch {
    return undefined;
  }
}

const AGENTS_CANDIDATES = ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];

/**
 * Candidate AGENTS.md paths, in priority order:
 * 1. global agent dir (~/.selesai/agent/AGENTS.md) — these are generalized
 *    best-practice rules (no file names / session specifics), so they belong
 *    cross-project by default.
 * 2. project-local (cwd) — fallback when a project file exists but a global
 *    one doesn't yet.
 *
 * Returns the first existing path, else the global path so a new file is
 * created there. The extension writes only to ONE file per lesson (the first
 * existing one, or global if none exist yet).
 */
function agentsMdCandidates(cwd: string): string[] {
  const projectCandidates = AGENTS_CANDIDATES.map((name) => join(cwd, name));
  try {
    const globalDir = getAgentDir();
    const globalCandidates = AGENTS_CANDIDATES.map((name) => join(globalDir, name));
    return [...globalCandidates, ...projectCandidates];
  } catch {
    return projectCandidates;
  }
}

function agentsMdPath(cwd: string): string {
  for (const p of agentsMdCandidates(cwd)) {
    if (existsSync(p)) return p;
  }
  // Default to global when nothing exists yet, so a fresh checkout doesn't
  // create a project AGENTS.md just to hold one generalized rule.
  try {
    return join(getAgentDir(), "AGENTS.md");
  } catch {
    return join(cwd, "AGENTS.md");
  }
}

function readAgentsMd(cwd: string): string {
  const path = agentsMdPath(cwd);
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

/** Parse existing persisted lesson hashes out of AGENTS.md so we don't dup across reloads. */
export function persistedLessonHashes(content: string): Set<string> {
  const start = content.indexOf(SECTION_START);
  if (start === -1) return new Set();
  const end = content.indexOf(SECTION_END, start);
  if (end === -1) return new Set();
  const block = content.slice(start, end);
  const hashes = new Set<string>();
  for (const m of block.matchAll(/hash="([a-f0-9]+)"/g)) hashes.add(m[1]);
  return hashes;
}

/** Returns the file content after inserting the lesson. Exported for self-checks. */
export function appendLessonContentToAgentsMd(cwd: string, lesson: Lesson): string {
  const path = agentsMdPath(cwd);
  let content = "";
  try {
    content = readFileSync(path, "utf-8");
  } catch {
    content = "";
  }
  const dir = dirname(path);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });

  const entry = `- [ ] ${lesson.text} <!-- hash="${lesson.hash}" -->`;

  if (content.includes(SECTION_START)) {
    const startIdx = content.indexOf(SECTION_START);
    const endIdx = content.indexOf(SECTION_END, startIdx);
    if (endIdx === -1) {
      content =
        content.slice(0, startIdx) +
        `${SECTION_START}\n\n### Tool Autofix Lessons\n\nRules learned from tool-call failures. Auto-managed by tool-error-autofix.\n\n${entry}\n\n${SECTION_END}` +
        content.slice(startIdx + SECTION_START.length);
    } else {
      content = content.slice(0, endIdx) + `${entry}\n` + content.slice(endIdx);
    }
  } else {
    content =
      content.trimEnd() +
      `\n\n${SECTION_START}\n\n### Tool Autofix Lessons\n\nRules learned from tool-call failures. Auto-managed by tool-error-autofix.\n\n${entry}\n\n${SECTION_END}\n`;
  }

  try {
    writeFileSync(path, content, "utf-8");
  } catch {
    /* non-fatal: in-memory lesson still applies this session */
  }
  return content;
}

const KNOWN_TOOLS = new Set(["edit", "write", "read", "bash", "grep", "find", "ls"]);

export default function toolErrorAutofixExtension(pi: ExtensionAPI): void {
  pi.on("tool_result", async (event: ToolResultEvent, ctx: ExtensionContext) => {
    if (!event.isError) return undefined;
    if (!KNOWN_TOOLS.has(event.toolName)) return undefined;

    const text = errorText(event);
    if (!text) return undefined;

    const hash = signature(event.toolName, text);
    if (seenHashes.has(hash)) return undefined;
    seenHashes.add(hash);

    // Skip if already persisted in AGENTS.md.
    if (persistedLessonHashes(readAgentsMd(ctx.cwd)).has(hash)) return undefined;

    const model = ctx.model;
    if (!model) return undefined;

    const auth = await authFor(model, ctx.modelRegistry);
    const lessonText = await generateLesson(model, event.toolName, text, auth, ctx.signal);
    if (!lessonText) return undefined;

    const lesson: Lesson = { hash, text: lessonText };
    sessionLessons.push(lesson);
    appendLessonContentToAgentsMd(ctx.cwd, lesson);

    ctx.ui?.notify?.(`Autofix lesson saved to AGENTS.md: ${lessonText}`, "info");
    return undefined;
  });

  // Live injection: prepend this session's lessons to the system prompt for the next turn.
  pi.on("before_agent_start", async (event: any) => {
    if (sessionLessons.length === 0) return undefined;
    const block = sessionLessons.map((l, i) => `${i + 1}. ${l.text}`).join("\n");
    const addition = `\n\n### Tool Autofix Lessons (learned this session)\n\nFollow these rules to avoid repeating past tool-call failures:\n${block}\n`;
    return { systemPrompt: event.systemPrompt + addition };
  });
}
