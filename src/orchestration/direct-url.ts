import { canonicalizeUrl } from './url.js';

function stripTrailingPunctuation(raw: string): string {
  let next = raw.trim();

  while (/[),.;!?\]]$/.test(next)) {
    const last = next.at(-1);
    if (last === ')' && next.includes('(') && next.lastIndexOf('(') > next.lastIndexOf(')')) break;
    next = next.slice(0, -1);
  }

  return next;
}

function normalizeDirectUrl(raw: string): string | undefined {
  return canonicalizeUrl(stripTrailingPunctuation(raw));
}

export function extractDirectUrls(query: string): string[] {
  const matches = query.match(/https?:\/\/\S+/gi) ?? [];
  const urls = new Set<string>();

  for (const match of matches) {
    const normalized = normalizeDirectUrl(match);
    if (normalized) urls.add(normalized);
  }

  return [...urls];
}
