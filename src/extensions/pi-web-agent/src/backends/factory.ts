import { createFirecrawlFetcher } from '../fetch/firecrawl-fetch.js';
import { createBraveSearchTool } from '../search/brave.js';
import { createYouComSearchTool } from '../search/youcom.js';
import { createExaSearchTool } from '../search/exa.js';
import { createTavilySearchTool } from '../search/tavily.js';
import { createTokenInSearchTool } from '../search/tokenin.js';
import { createSearxngSearchTool } from '../search/searxng.js';
import { createFanoutSearch } from '../search/fanout.js';
import { buildFetchPresentation } from '../presentation/fetch-presentation.js';
import { buildSearchPresentation } from '../presentation/search-presentation.js';
import { createWebFetchHeadlessTool } from '../tools/web-fetch-headless.js';
import { createWebFetchTool } from '../tools/web-fetch.js';
import { createWebSearchTool } from '../tools/web-search.js';
import { readBraveKeyFromSettings } from './settings-reader.js';
import type { SearchProviderName, WebFetchHeadlessResponse, WebFetchResponse, WebSearchResponse } from '../types.js';
import { DEFAULT_BACKEND_CONFIG, type BackendConfig, usableSearchProviders } from './config.js';
import { createSpecialContentResolver } from '../readers/resolver.js';
import { createGithubReader } from '../readers/github-reader.js';
import { createPdfReader } from '../readers/pdf-reader.js';
import { createYoutubeReader } from '../readers/youtube-reader.js';

export type BackendSet = {
  search: (input: { query: string }) => Promise<WebSearchResponse>;
  fetchPage: (input: { url: string }) => Promise<WebFetchResponse>;
  headlessFetch: (input: { url: string }) => Promise<WebFetchHeadlessResponse>;
};

export type BackendFactoryDeps = {
  createDuckDuckGoSearch?: typeof createWebSearchTool;
  createSearxngSearch?: typeof createSearxngSearchTool;
  createBraveSearch?: typeof createBraveSearchTool;
  createYouComSearch?: typeof createYouComSearchTool;
  createExaSearch?: typeof createExaSearchTool;
  createTavilySearch?: typeof createTavilySearchTool;
  createTokenInSearch?: typeof createTokenInSearchTool;
  createHttpFetch?: typeof createWebFetchTool;
  createFirecrawlFetch?: typeof createFirecrawlFetcher;
  createHeadlessFetch?: typeof createWebFetchHeadlessTool;
};

function invalidSearxngSearch() {
  return async function search() {
    const result: WebSearchResponse = {
      status: 'error',
      results: [],
      metadata: { backend: 'searxng', cacheHit: false },
      error: {
        code: 'BACKEND_CONFIG_INVALID',
        message: 'SearXNG search requires backends.search.baseUrl.'
      }
    };

    return { ...result, presentation: buildSearchPresentation(result) };
  };
}

function invalidFirecrawlFetch() {
  return async function fetchPage(url: string): Promise<WebFetchResponse> {
    const result: WebFetchResponse = {
      status: 'error',
      url,
      metadata: { method: 'firecrawl', cacheHit: false },
      error: {
        code: 'BACKEND_CONFIG_INVALID',
        message: 'Firecrawl fetch requires backends.fetch.baseUrl.'
      }
    };

    return { ...result, presentation: buildFetchPresentation(result) };
  };
}

function withSearchFallback(
  primary: BackendSet['search'],
  fallback: BackendSet['search'],
  fallbackFrom: 'searxng' | 'brave' | 'youcom' | 'exa' | 'tavily' | 'tokenin' | 'duckduckgo'
): BackendSet['search'] {
  return async (input) => {
    const first = await primary(input);
    if (first.status !== 'error') return first;

    const second = await fallback(input);
    const result: WebSearchResponse = {
      ...second,
      metadata: {
        ...second.metadata,
        fallbackFrom,
        fallbackReason: first.error?.message ?? `${fallbackFrom} search failed.`,
        // Keep the primary's fanout provenance (which providers were tried/skipped) even though
        // the answer came from the fallback backend.
        ...(first.metadata.fanout ? { fanout: first.metadata.fanout } : {})
      }
    };
    return { ...result, presentation: buildSearchPresentation(result) };
  };
}

function withFetchFallback(
  primary: BackendSet['fetchPage'],
  fallback: BackendSet['fetchPage']
): BackendSet['fetchPage'] {
  return async (input) => {
    const first = await primary(input);
    if (first.status !== 'error' && first.status !== 'needs_headless') return first;

    const second = await fallback(input);
    const result: WebFetchResponse = {
      ...second,
      metadata: {
        ...second.metadata,
        fallbackFrom: 'firecrawl',
        fallbackReason: first.error?.message ?? 'Firecrawl fetch failed.'
      }
    };
    return { ...result, presentation: buildFetchPresentation(result) };
  };
}

export function createBackendSet(
  config: BackendConfig = DEFAULT_BACKEND_CONFIG,
  deps: BackendFactoryDeps = {}
): BackendSet {
  const createDuckDuckGoSearch = deps.createDuckDuckGoSearch ?? createWebSearchTool;
  const createSearxngSearch = deps.createSearxngSearch ?? createSearxngSearchTool;
  const createBraveSearch = deps.createBraveSearch ?? createBraveSearchTool;
  const createYouComSearch = deps.createYouComSearch ?? createYouComSearchTool;
  const createExaSearch = deps.createExaSearch ?? createExaSearchTool;
  const createTavilySearch = deps.createTavilySearch ?? createTavilySearchTool;
  const createTokenInSearch = deps.createTokenInSearch ?? createTokenInSearchTool;
  const createHttpFetch = deps.createHttpFetch ?? createWebFetchTool;
  const createFirecrawlFetch = deps.createFirecrawlFetch ?? createFirecrawlFetcher;
  const createHeadlessFetch = deps.createHeadlessFetch ?? createWebFetchHeadlessTool;

  function buildProviderSearch(name: SearchProviderName): BackendSet['search'] {
    switch (name) {
      case 'searxng':
        return config.search.baseUrl
          ? createSearxngSearch({ baseUrl: config.search.baseUrl, options: config.search.options })
          : invalidSearxngSearch();
      case 'brave':
        return createBraveSearch({ apiKey: process.env.PI_WEB_AGENT_BRAVE_API_KEY ?? readBraveKeyFromSettings() });
      case 'youcom':
        return createYouComSearch({ apiKey: process.env.YDC_API_KEY });
      case 'exa':
        return createExaSearch({ apiKey: process.env.EXA_API_KEY });
      case 'tavily':
        return createTavilySearch({ apiKey: process.env.TAVILY_API_KEY });
      case 'tokenin':
        return createTokenInSearch();
      case 'duckduckgo':
      default:
        return createDuckDuckGoSearch();
    }
  }

  let search = config.search.provider === 'searxng'
    ? config.search.baseUrl
      ? createSearxngSearch({ baseUrl: config.search.baseUrl, options: config.search.options })
      : invalidSearxngSearch()
    : config.search.provider === 'brave'
      ? createBraveSearch({ apiKey: process.env.PI_WEB_AGENT_BRAVE_API_KEY ?? readBraveKeyFromSettings() })
      : config.search.provider === 'youcom'
        ? createYouComSearch({ apiKey: process.env.YDC_API_KEY })
        : config.search.provider === 'exa'
          ? createExaSearch({ apiKey: process.env.EXA_API_KEY })
          : config.search.provider === 'tavily'
            ? createTavilySearch({ apiKey: process.env.TAVILY_API_KEY })
            : config.search.provider === 'tokenin'
              ? createTokenInSearch()
              : createDuckDuckGoSearch();

  if (config.search.provider === 'searxng' && config.search.fallback === 'duckduckgo') {
    search = withSearchFallback(search, createDuckDuckGoSearch(), 'searxng');
  }

  if (config.search.provider === 'brave' && config.search.fallback === 'duckduckgo') {
    search = withSearchFallback(search, createDuckDuckGoSearch(), 'brave');
  }

  if (config.search.provider === 'youcom' && config.search.fallback === 'duckduckgo') {
    search = withSearchFallback(search, createDuckDuckGoSearch(), 'youcom');
  }

  if (config.search.provider === 'exa' && config.search.fallback === 'duckduckgo') {
    search = withSearchFallback(search, createDuckDuckGoSearch(), 'exa');
  }

  if (config.search.provider === 'tavily' && config.search.fallback === 'duckduckgo') {
    search = withSearchFallback(search, createDuckDuckGoSearch(), 'tavily');
  }

  if (config.search.provider === 'tokenin' && config.search.fallback === 'duckduckgo') {
    search = withSearchFallback(search, createDuckDuckGoSearch(), 'tokenin');
  }

  const fanoutConfig = config.search.fanout;
  if (fanoutConfig && fanoutConfig.mode !== 'off') {
    const baseNames =
      fanoutConfig.providers && fanoutConfig.providers.length > 0
        ? fanoutConfig.providers
        : usableSearchProviders(config.search);
    // A configured DuckDuckGo fallback must still be honored under fanout: fold it into the set.
    const providerNames =
      config.search.fallback === 'duckduckgo' && !baseNames.includes('duckduckgo')
        ? [...baseNames, 'duckduckgo' as SearchProviderName]
        : baseNames;
    const ordered = [config.search.provider, ...providerNames.filter((n) => n !== config.search.provider)].filter(
      (n, i, arr) => arr.indexOf(n) === i
    );
    search = createFanoutSearch({
      providers: ordered.map((name) => ({ name, search: buildProviderSearch(name) })),
      mode: fanoutConfig.mode
    });
  }

  // Keep the keyless Tavily safety net for the no-key DuckDuckGo default, even under fanout —
  // it wraps whatever search ended up being (plain DDG or the fanout set) so a total failure
  // still has somewhere to go. Opt out with PI_WEB_AGENT_DISABLE_KEYLESS_FALLBACK=1.
  const keylessFallbackDisabled = process.env.PI_WEB_AGENT_DISABLE_KEYLESS_FALLBACK === '1';
  const usingDuckDuckGoDefault =
    config.search.provider === 'duckduckgo' || !config.search.provider;
  if (usingDuckDuckGoDefault && !keylessFallbackDisabled) {
    search = withSearchFallback(search, createTavilySearch({ keyless: true }), 'duckduckgo');
  }

  const httpFetch = createHttpFetch();
  let fetchPage = config.fetch.provider === 'firecrawl'
    ? config.fetch.baseUrl
      ? createHttpFetch({
          fetchPage: createFirecrawlFetch({
            baseUrl: config.fetch.baseUrl,
            apiKey: config.fetch.apiKey ?? process.env.PI_WEB_AGENT_FIRECRAWL_API_KEY,
            options: config.fetch.options
          })
        })
      : createHttpFetch({ fetchPage: invalidFirecrawlFetch() })
    : httpFetch;

  if (config.fetch.provider === 'firecrawl' && config.fetch.fallback === 'http') {
    fetchPage = withFetchFallback(fetchPage, httpFetch);
  }

  const fetchPageWithReaders = createSpecialContentResolver({
    readers: [createGithubReader(), createPdfReader(), createYoutubeReader()],
    fallback: fetchPage
  });

  return {
    search,
    fetchPage: fetchPageWithReaders,
    headlessFetch: createHeadlessFetch()
  };
}
