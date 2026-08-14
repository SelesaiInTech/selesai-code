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

export function createFanoutSearch({
  providers,
  mode
}: {
  providers: FanoutProvider[];
  mode: Exclude<FanoutMode, 'off'>;
}) {
  return async function fanoutSearch({ query }: { query: string }): Promise<WebSearchResponse> {
    const [primary, ...rest] = providers;

    async function runSet(set: FanoutProvider[]) {
      const settled = await Promise.allSettled(set.map((p) => p.search({ query })));
      const contributing: Array<{ name: SearchProviderName; results: SearchResult[] }> = [];
      const skipped: SearchProviderName[] = [];
      set.forEach((provider, i) => {
        const outcome = settled[i];
        if (outcome.status === 'fulfilled' && outcome.value.status === 'ok' && outcome.value.results.length > 0) {
          contributing.push({ name: provider.name, results: outcome.value.results });
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
        return withPresentation({
          status: 'error',
          results: [],
          metadata: { backend: primary.name, cacheHit: false },
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
      const primaryOutcome = await primary.search({ query }).catch(() => undefined);
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
