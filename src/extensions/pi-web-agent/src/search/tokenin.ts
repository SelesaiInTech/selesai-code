import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAgentDir } from '@selesai/code';
import { buildSearchPresentation } from '../presentation/search-presentation.js';
import type { SearchResult, WebSearchResponse } from '../types.js';

export const TOKENIN_SEARCH_TOOL_NAME = 'firecrawl';
export const TOKENIN_DEFAULT_BASE_URL = 'https://lite.andlet.me/v1';

type TokenInAccount = { id: string; label: string; apiKey: string; baseUrl?: string };
type TokenInAuth = { accounts: TokenInAccount[]; activeId: string | null };

type LiteLLMSearchResult = { title?: unknown; url?: unknown; snippet?: unknown };
type LiteLLMSearchResponse = { results?: LiteLLMSearchResult[] };

/**
 * Read the active Token-In account from tokenin-auth.json (written by the
 * tokenin-onboarding extension). Returns undefined when no account is saved.
 * Never throws.
 */
export function readActiveTokenInAccount(
  authPath: string = join(getAgentDir(), 'tokenin-auth.json')
): TokenInAccount | undefined {
  try {
    if (!existsSync(authPath)) return undefined;
    const parsed = JSON.parse(readFileSync(authPath, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const auth = parsed as TokenInAuth;
    if (!Array.isArray(auth.accounts) || typeof auth.activeId !== 'string') return undefined;
    return auth.accounts.find((a) => a && typeof a === 'object' && a.id === auth.activeId && typeof a.apiKey === 'string');
  } catch {
    return undefined;
  }
}

function resultWithPresentation(result: WebSearchResponse): WebSearchResponse {
  return { ...result, presentation: buildSearchPresentation(result) };
}

function normalizeResults(response: LiteLLMSearchResponse): SearchResult[] {
  return (response.results ?? []).flatMap((item) => {
    if (typeof item.title !== 'string' || typeof item.url !== 'string') return [];
    return [
      {
        title: item.title,
        url: item.url,
        snippet: typeof item.snippet === 'string' ? item.snippet : ''
      }
    ];
  });
}

export function createTokenInSearchTool({
  readAccount = readActiveTokenInAccount,
  fetchImpl = fetch
}: {
  readAccount?: () => TokenInAccount | undefined;
  fetchImpl?: typeof fetch;
} = {}) {
  return async function tokenInSearch({ query }: { query: string }): Promise<WebSearchResponse> {
    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      return resultWithPresentation({
        status: 'error',
        results: [],
        metadata: { backend: 'tokenin', cacheHit: false },
        error: { code: 'INVALID_QUERY', message: 'Query must not be empty.' }
      });
    }

    const account = readAccount();
    if (!account) {
      return resultWithPresentation({
        status: 'error',
        results: [],
        metadata: { backend: 'tokenin', cacheHit: false },
        error: {
          code: 'BACKEND_CONFIG_INVALID',
          message: 'Token-In search requires an active Token-In account. Run /tokenin add first.'
        }
      });
    }

    const baseUrl = (account.baseUrl ?? TOKENIN_DEFAULT_BASE_URL).replace(/\/+$/, '');
    const url = `${baseUrl}/v1/search/${TOKENIN_SEARCH_TOOL_NAME}`;

    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${account.apiKey}`
        },
        body: JSON.stringify({ query: normalizedQuery, max_results: 10 })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const parsed = (await response.json()) as LiteLLMSearchResponse;
      const results = normalizeResults(parsed);

      if (results.length === 0) {
        return resultWithPresentation({
          status: 'error',
          results: [],
          metadata: { backend: 'tokenin', cacheHit: false },
          error: { code: 'NO_RESULTS', message: 'Token-In search returned no usable results for this query.' }
        });
      }

      return resultWithPresentation({
        status: 'ok',
        results,
        metadata: { backend: 'tokenin', cacheHit: false }
      });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      return resultWithPresentation({
        status: 'error',
        results: [],
        metadata: { backend: 'tokenin', cacheHit: false },
        error: { code: 'FETCH_FAILED', message: `Token-In search request failed: ${rawMessage}` }
      });
    }
  };
}
