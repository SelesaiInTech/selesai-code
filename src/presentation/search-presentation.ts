import type { WebSearchResponse } from '../types.js';
import type { PresentationEnvelope } from './types.js';

function fanoutNote(result: WebSearchResponse): string {
  const f = result.metadata.fanout;
  if (!f) return '';
  if (f.providers.length) {
    return ` (fanout: ${f.providers.join(', ')}${f.skipped?.length ? `; skipped: ${f.skipped.join(', ')}` : ''})`;
  }
  if (f.skipped?.length) {
    return ` (fanout; skipped: ${f.skipped.join(', ')})`;
  }
  return '';
}

function formatCompact(result: WebSearchResponse): string {
  const fallbackPrefix = result.metadata.fallbackFrom
    ? `${result.metadata.fallbackFrom} failed; used ${result.metadata.backend} fallback. `
    : '';

  if (result.status === 'error') {
    return `${fallbackPrefix}Search failed: ${result.error?.message ?? 'Unknown search failure.'}${fanoutNote(result)}`;
  }

  const suffix = result.results.length === 1 ? 'result' : 'results';
  return `${fallbackPrefix}Found ${result.results.length} ${suffix}${fanoutNote(result)}`;
}

export function buildSearchPresentation(result: WebSearchResponse): PresentationEnvelope {
  const preview = result.results
    .slice(0, 3)
    .map((item, index) => `${index + 1}. ${item.title}`)
    .join('\n');

  const verbose = result.results
    .slice(0, 5)
    .map((item, index) => `${index + 1}. ${item.title}\n   ${item.url}\n   ${item.snippet}`)
    .join('\n');

  return {
    mode: 'compact',
    views: {
      compact: formatCompact(result),
      preview: preview || undefined,
      verbose: verbose || undefined
    },
    metrics: {
      resultCount: result.results.length,
      cacheHit: result.metadata.cacheHit
    },
    sources: result.results.map((item) => ({ title: item.title, url: item.url }))
  };
}
