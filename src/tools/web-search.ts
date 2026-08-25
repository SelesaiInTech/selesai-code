import { createCacheKey, createTtlCache } from '../cache/ttl-cache.js';
import { buildSearchPresentation } from '../presentation/search-presentation.js';
import { fetchDuckDuckGoHtml, parseDuckDuckGoResults } from '../search/duckduckgo.js';
import type { WebSearchResponse } from '../types.js';

function classifySearchFailure(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : 'Unknown search failure.';
  const normalized = rawMessage.toLowerCase();

  if (
    normalized.includes('blocked') ||
    normalized.includes('rate limit') ||
    normalized.includes('rate-limit') ||
    normalized.includes('403') ||
    normalized.includes('429') ||
    normalized.includes('captcha') ||
    normalized.includes('challenge')
  ) {
    return {
      code: 'BLOCKED',
      message: 'DuckDuckGo search appears to be blocked or rate limited.'
    };
  }

  return {
    code: 'FETCH_FAILED',
    message: `DuckDuckGo search request failed: ${rawMessage}`
  };
}

function htmlLooksBlocked(html: string) {
  const normalized = html.toLowerCase();

  return (
    normalized.includes('captcha') ||
    normalized.includes('challenge') ||
    normalized.includes('verify you are human') ||
    normalized.includes('are you a robot') ||
    normalized.includes('unusual traffic') ||
    normalized.includes('automated requests') ||
    normalized.includes('automated queries') ||
    normalized.includes('detected unusual') ||
    normalized.includes('too many requests')
  );
}

export function createWebSearchTool({
  searchHtml = fetchDuckDuckGoHtml,
  cache = createTtlCache<WebSearchResponse>({ ttlMs: 30_000 })
}: {
  searchHtml?: (query: string) => Promise<string>;
  cache?: {
    get(key: string): WebSearchResponse | undefined;
    set(key: string, value: WebSearchResponse): void;
  };
} = {}) {
  return async function webSearch({ query }: { query: string }): Promise<WebSearchResponse> {
    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      const result: WebSearchResponse = {
        status: 'error',
        results: [],
        metadata: { backend: 'duckduckgo', cacheHit: false },
        error: { code: 'INVALID_QUERY', message: 'Query must not be empty.' }
      };
      return {
        ...result,
        presentation: buildSearchPresentation(result)
      };
    }

    const cacheKey = createCacheKey(['web_search', normalizedQuery]);
    const cached = cache.get(cacheKey);
    if (cached) {
      const result: WebSearchResponse = {
        ...cached,
        metadata: { ...cached.metadata, cacheHit: true }
      };
      return {
        ...result,
        presentation: buildSearchPresentation(result)
      };
    }

    try {
      let html = await searchHtml(normalizedQuery);
      let parsed = parseDuckDuckGoResults(html);

      // A 200-OK bot-wall reads as a successful fetch, so the fetch-layer retry never sees it.
      // Give a page that looks blocked one more shot here before we classify it.
      if (parsed.results.length === 0 && htmlLooksBlocked(html)) {
        html = await searchHtml(normalizedQuery);
        parsed = parseDuckDuckGoResults(html);
      }

      if (parsed.results.length > 0) {
        const result: WebSearchResponse = {
          status: 'ok',
          results: parsed.results,
          metadata: { backend: 'duckduckgo', cacheHit: false }
        };
        cache.set(cacheKey, result);
        return {
          ...result,
          presentation: buildSearchPresentation(result)
        };
      }

      // Check for a bot-wall before "no results": a page can carry both markers, and BLOCKED is
      // the honest call since it routes to the fallback instead of a dead end.
      if (htmlLooksBlocked(html)) {
        const result: WebSearchResponse = {
          status: 'error',
          results: [],
          metadata: { backend: 'duckduckgo', cacheHit: false },
          error: {
            code: 'BLOCKED',
            message: 'DuckDuckGo search appears to be blocked or rate limited.'
          }
        };
        return {
          ...result,
          presentation: buildSearchPresentation(result)
        };
      }

      if (parsed.noResults) {
        const result: WebSearchResponse = {
          status: 'error',
          results: [],
          metadata: { backend: 'duckduckgo', cacheHit: false },
          error: {
            code: 'NO_RESULTS',
            message: 'DuckDuckGo returned no usable results for this query.'
          }
        };
        return {
          ...result,
          presentation: buildSearchPresentation(result)
        };
      }

      const result: WebSearchResponse = {
        status: 'error',
        results: [],
        metadata: { backend: 'duckduckgo', cacheHit: false },
        error: {
          code: 'PARSE_FAILED',
          message: 'DuckDuckGo returned a page, but it did not match the expected results format.'
        }
      };
      return {
        ...result,
        presentation: buildSearchPresentation(result)
      };
    } catch (error) {
      const result: WebSearchResponse = {
        status: 'error',
        results: [],
        metadata: { backend: 'duckduckgo', cacheHit: false },
        error: classifySearchFailure(error)
      };
      return {
        ...result,
        presentation: buildSearchPresentation(result)
      };
    }
  };
}
