import { buildSearchPresentation } from '../presentation/search-presentation.js';
import { canonicalizeUrl } from '../orchestration/url.js';
import type { FanoutMetadata, FanoutMode, SearchProviderName, SearchResult, WebSearchResponse } from '../types.js';

export type FanoutProvider = {
  name: SearchProviderName;
  search: (input: { query: string }) => Promise<WebSearchResponse>;
};

const FANOUT_MIN_RESULTS = 3;

type RankedEntry = {
  result: SearchResult;
  providers: Set<SearchProviderName>;
  bestRank: number;
};

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function primaryLooksWeak(results: SearchResult[]): boolean {
  if (results.length < FANOUT_MIN_RESULTS) return true;
  const hosts = new Set(results.map((r) => hostOf(r.url)).filter(Boolean));
  return hosts.size <= 1;
}

function merge(lists: Array<{ name: SearchProviderName; results: SearchResult[] }>): SearchResult[] {
  const byKey = new Map<string, RankedEntry>();

  for (const { name, results } of lists) {
    const seenThisProvider = new Set<string>();
    results.forEach((result, index) => {
      const key = canonicalizeUrl(result.url) ?? result.url;
      if (seenThisProvider.has(key)) return; // ignore duplicates within a single provider's own list
      seenThisProvider.add(key);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { result: { ...result }, providers: new Set([name]), bestRank: index });
        return;
      }
      existing.providers.add(name);
      existing.bestRank = Math.min(existing.bestRank, index);
      if ((result.title?.length ?? 0) > (existing.result.title?.length ?? 0)) existing.result.title = result.title;
      if ((result.snippet?.length ?? 0) > (existing.result.snippet?.length ?? 0)) existing.result.snippet = result.snippet;
    });
  }

  return [...byKey.values()]
    .sort((a, b) => b.providers.size - a.providers.size || a.bestRank - b.bestRank)
    .map((entry) => entry.result);
}

function withPresentation(result: WebSearchResponse): WebSearchResponse {
  return { ...result, presentation: buildSearchPresentation(result) };
}

const FANOUT_PROVIDER_TIMEOUT_MS = 8000;

/** Resolve to undefined if the provider doesn't answer in time, so one slow/unreachable
 *  provider (e.g. a down self-hosted SearXNG) can't stall the whole fanout across passes. */
function withTimeout(
  promise: Promise<WebSearchResponse>,
  ms: number
): Promise<WebSearchResponse | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      }
    );
  });
}

export function createFanoutSearch({
  providers,
  mode,
  timeoutMs = FANOUT_PROVIDER_TIMEOUT_MS
}: {
  providers: FanoutProvider[];
  mode: Exclude<FanoutMode, 'off'>;
  timeoutMs?: number;
}) {
  return async function fanoutSearch({ query }: { query: string }): Promise<WebSearchResponse> {
    const [primary, ...rest] = providers;

    async function runSet(set: FanoutProvider[]) {
      const settled = await Promise.all(set.map((p) => withTimeout(p.search({ query }), timeoutMs)));
      const contributing: Array<{ name: SearchProviderName; results: SearchResult[] }> = [];
      const skipped: SearchProviderName[] = [];
      set.forEach((provider, i) => {
        const value = settled[i];
        if (value && value.status === 'ok' && value.results.length > 0) {
          contributing.push({ name: provider.name, results: value.results });
        } else {
          skipped.push(provider.name);
        }
      });
      return { contributing, skipped };
    }

    function finalize(
      lists: Array<{ name: SearchProviderName; results: SearchResult[] }>,
      skipped: SearchProviderName[],
      resolvedMode: Exclude<FanoutMode, 'off'>
    ): WebSearchResponse {
      if (lists.length === 0) {
        const fanout: FanoutMetadata = { mode: resolvedMode, providers: [] };
        if (skipped.length > 0) fanout.skipped = skipped;
        return withPresentation({
          status: 'error',
          results: [],
          metadata: { backend: primary.name, cacheHit: false, fanout },
          error: { code: 'FANOUT_NO_RESULTS', message: 'No fanout provider returned usable results.' }
        });
      }
      const fanout: FanoutMetadata = { mode: resolvedMode, providers: lists.map((l) => l.name) };
      if (skipped.length > 0) fanout.skipped = skipped;
      return withPresentation({
        status: 'ok',
        results: merge(lists),
        metadata: { backend: primary.name, cacheHit: false, fanout }
      });
    }

    if (mode === 'auto') {
      const primaryOutcome = await withTimeout(primary.search({ query }), timeoutMs);
      const primaryResults = primaryOutcome?.status === 'ok' ? primaryOutcome.results : [];
      if (primaryResults.length > 0 && !primaryLooksWeak(primaryResults)) {
        return withPresentation(primaryOutcome as WebSearchResponse); // strong primary: no fanout
      }
      const { contributing, skipped } = await runSet(rest);
      const lists = [
        ...(primaryResults.length ? [{ name: primary.name, results: primaryResults }] : []),
        ...contributing
      ];
      const allSkipped = [...(primaryResults.length ? [] : [primary.name]), ...skipped];
      return finalize(lists, allSkipped, 'auto');
    }

    const { contributing, skipped } = await runSet(providers);
    return finalize(contributing, skipped, 'on');
  };
}
