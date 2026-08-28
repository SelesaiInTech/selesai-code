export interface WriteCallSummaryOptions {
  hasContent: boolean;
  hasDetailedResultHeader: boolean;
}

export function splitWriteContentLines(content: string): string[] {
  if (!content) {
    return [];
  }

  const normalized = content.replace(/\r/g, "");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

export function countWriteContentLines(value: unknown): number {
  return typeof value === "string" ? splitWriteContentLines(value).length : 0;
}

export function getWriteContentSizeBytes(value: unknown): number {
  return typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0;
}

export function shouldRenderWriteCallSummary(
  options: WriteCallSummaryOptions,
): boolean {
  return options.hasContent && !options.hasDetailedResultHeader;
}
