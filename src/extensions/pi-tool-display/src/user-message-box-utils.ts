import { ANSI_SGR_PATTERN, sanitizeAnsiForThemedOutput } from "./ansi-utils.js";

const OSC_PROMPT_CONTROL_SEQUENCE_PATTERN = /\x1b\](?:133|633);[A-Z](?:;[^\x07\x1b]*)?(?:\x07|\x1b\\)/g;
const USER_MESSAGE_BACKGROUND = "userMessageBg";
const ANSI_BG_RESET = "\x1b[49m";
const USER_MESSAGE_VERTICAL_PADDING_LINES = 1;

export interface UserMessageBackgroundTheme {
  bg?(color: string, text: string): string;
  getBgAnsi?(color: string): string;
}

function hasPromptControlOscSequence(text: string): boolean {
  return text.includes("\x1b]133;") || text.includes("\x1b]633;");
}

function stripOscPromptControlSequences(text: string): string {
  if (!text || !hasPromptControlOscSequence(text)) {
    return text;
  }

  // Strip prompt-control OSC sequences only. OSC 8 hyperlinks are intentionally
  // preserved because they carry renderable terminal hyperlink metadata.
  return text.replace(OSC_PROMPT_CONTROL_SEQUENCE_PATTERN, "");
}

function sanitizeUserMessageAnsi(text: string): string {
  return sanitizeAnsiForThemedOutput(stripOscPromptControlSequences(text));
}

export function applyUserMessageBackground(
  theme: UserMessageBackgroundTheme | undefined,
  text: string,
): string {
  if (!text) {
    return text;
  }

  const sanitized = sanitizeUserMessageAnsi(text);
  if (!theme) {
    return sanitized;
  }

  try {
    if (typeof theme.getBgAnsi === "function") {
      return `${theme.getBgAnsi(USER_MESSAGE_BACKGROUND)}${sanitized}${ANSI_BG_RESET}`;
    }
  } catch (themeError) {
    void themeError;
  }

  try {
    if (typeof theme.bg === "function") {
      return theme.bg(USER_MESSAGE_BACKGROUND, sanitized);
    }
  } catch (themeError) {
    void themeError;
  }

  return sanitized;
}

function isVisuallyEmptyLine(line: string): boolean {
  const withoutControlSequences = stripOscPromptControlSequences(line)
    .replace(ANSI_SGR_PATTERN, "");
  return withoutControlSequences.trim().length === 0;
}

function trimEdgePadding(lines: string[]): string[] {
  let start = 0;
  while (start < lines.length && isVisuallyEmptyLine(lines[start] ?? "")) {
    start++;
  }

  let end = lines.length;
  while (end > start && isVisuallyEmptyLine(lines[end - 1] ?? "")) {
    end--;
  }

  return lines.slice(start, end);
}

export function normalizeUserMessageContentLines(lines: string[]): string[] {
  const normalizedLines = trimEdgePadding(lines);
  if (normalizedLines.length === 0) {
    return [];
  }

  return normalizedLines;
}

export function normalizeUserMessageContentLine(line: string): string {
  if (isVisuallyEmptyLine(line)) {
    return "";
  }

  return sanitizeUserMessageAnsi(line);
}

export function addUserMessageVerticalPadding(lines: string[]): string[] {
  const padding = Array.from(
    { length: USER_MESSAGE_VERTICAL_PADDING_LINES },
    () => "",
  );
  return [...padding, ...lines, ...padding];
}
