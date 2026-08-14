import { buildSearchPresentation } from '../presentation/search-presentation.js';
import { canonicalizeUrl } from '../orchestration/url.js';
import type { FanoutMode, SearchProviderName, SearchResult, WebSearchResponse } from '../types.js';

export type FanoutProvider = {
  name: SearchProviderName;
  search: (input: { query: string }) => Promise<WebSearchResponse>;
};

const FANOUT_MIN_RESULTS = 3;

type RankedEntry = {
  result: SearchResult;
  providerCount: number;
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

  for (const { results } of lists) {
    results.forEach((result, index) => {
      const key = canonicalizeUrl(result.url) ?? result.url;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { result: { ...result }, providerCount: 1, bestRank: index });
        return;
      }
      existing.providerCount += 1;
      existing.bestRank = Math.min(existing.bestRank, index);
      if ((result.title?.length ?? 0) > (existing.result.title?.length ?? 0)) existing.result.title = result.title;
      if ((result.snippet?.length ?? 0) > (existing.result.snippet?.length ?? 0)) existing.result.snippet = result.snippet;
    });
  }

  return [...byKey.values()]
    .sort((a, b) => b.providerCount - a.providerCount || a.bestRank - b.bestRank)
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

    async function runAll(set: FanoutProvider[]) {
      const settled = await Promise.allSettled(set.map((p) => p.search({ query })));
      const contributing: Array<{ name: SearchProviderName; results: SearchResult[] }> = [];
      set.forEach((provider, i) => {
        const outcome = settled[i];
        if (outcome.status === 'fulfilled' && outcome.value.status === 'ok' && outcome.value.results.length > 0) {
          contributing.push({ name: provider.name, results: outcome.value.results });
        }
      });
      return contributing;
    }

    function finalize(
      lists: Array<{ name: SearchProviderName; results: SearchResult[] }>,
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
      return withPresentation({
        status: 'ok',
        results: merge(lists),
        metadata: {
          backend: primary.name,
          cacheHit: false,
          fanout: { mode: resolvedMode, providers: lists.map((l) => l.name) }
        }
      });
    }

    if (mode === 'auto') {
      const primaryOutcome = await primary.search({ query }).catch(() => undefined);
      const primaryResults = primaryOutcome?.status === 'ok' ? primaryOutcome.results : [];
      if (primaryResults.length > 0 && !primaryLooksWeak(primaryResults)) {
        return primaryOutcome as WebSearchResponse; // strong primary: no fanout; metadata.fanout stays undefined
      }
      const contributing = await runAll(rest);
      const all = [
        ...(primaryResults.length ? [{ name: primary.name, results: primaryResults }] : []),
        ...contributing
      ];
      return finalize(all, 'auto');
    }

    const contributing = await runAll(providers);
    return finalize(contributing, 'on');
  };
}
