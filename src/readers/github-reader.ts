import type { WebFetchResponse } from '../types.js';
import type { SpecialContentReader } from './types.js';

type GithubReaderDeps = {
  fetchImpl?: typeof fetch;
  token?: string;
};

function parseGithub(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function isGithubHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'github.com' || h === 'gist.github.com';
}

function fail(url: string, message: string): WebFetchResponse {
  return {
    status: 'error',
    url,
    metadata: { method: 'github', cacheHit: false },
    error: { code: 'GITHUB_FETCH_FAILED', message }
  };
}

function okResponse(url: string, title: string, text: string): WebFetchResponse {
  const capped = text.slice(0, 4000);
  return {
    status: 'ok',
    url,
    content: { title, text: capped },
    metadata: { method: 'github', cacheHit: false, truncated: text.length >= 4000 }
  };
}

export function createGithubReader({ fetchImpl = fetch, token = process.env.GITHUB_TOKEN }: GithubReaderDeps = {}): SpecialContentReader {
  function headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = { 'User-Agent': 'pi-web-agent' };
    if (json) h.Accept = 'application/vnd.github+json';
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  async function getText(target: string): Promise<string> {
    const res = await fetchImpl(target, { headers: headers(false) });
    if (!res.ok) throw new Error(`GitHub returned ${res.status} for ${target}`);
    return res.text();
  }

  async function getJson<T>(target: string): Promise<T> {
    const res = await fetchImpl(target, { headers: headers(true) });
    if (!res.ok) throw new Error(`GitHub API returned ${res.status} for ${target}`);
    return res.json() as Promise<T>;
  }

  async function readBlob(url: string, owner: string, repo: string, ref: string, path: string): Promise<WebFetchResponse> {
    const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
    const text = await getText(raw);
    return okResponse(url, `${owner}/${repo}/${path}`, text);
  }

  async function readThread(url: string, owner: string, repo: string, kind: 'issues' | 'pulls', num: string): Promise<WebFetchResponse> {
    const base = `https://api.github.com/repos/${owner}/${repo}/${kind}/${num}`;
    const item = await getJson<{ title?: string; body?: string }>(base);
    const comments = await getJson<Array<{ body?: string }>>(`${base}/comments`);
    const body = [item.body ?? '', ...comments.map((c) => c.body ?? '')].filter(Boolean).join('\n\n---\n\n');
    return okResponse(url, item.title ?? `${owner}/${repo} ${kind} #${num}`, body);
  }

  async function readRepoRoot(url: string, owner: string, repo: string): Promise<WebFetchResponse> {
    const readmeMeta = await getJson<{ download_url?: string }>(`https://api.github.com/repos/${owner}/${repo}/readme`);
    const readme = readmeMeta.download_url ? await getText(readmeMeta.download_url) : '';
    const tree = await getJson<Array<{ name: string; type: string }>>(`https://api.github.com/repos/${owner}/${repo}/contents`);
    const listing = tree.map((entry) => `${entry.type === 'dir' ? '[dir] ' : ''}${entry.name}`).join('\n');
    return okResponse(url, `${owner}/${repo}`, `${readme}\n\nTop-level contents:\n${listing}`);
  }

  return {
    name: 'github',
    canHandle(url: string): boolean {
      const parsed = parseGithub(url);
      return parsed ? isGithubHost(parsed.hostname) : false;
    },
    async read(url: string): Promise<WebFetchResponse> {
      const parsed = parseGithub(url);
      if (!parsed) return fail(url, 'Unparseable GitHub URL.');
      const segments = parsed.pathname.split('/').filter(Boolean);
      try {
        const [owner, repo, type, ...rest] = segments;
        if (owner && repo && type === 'blob' && rest.length >= 2) {
          const [ref, ...pathParts] = rest;
          return await readBlob(url, owner, repo, ref, pathParts.join('/'));
        }
        if (owner && repo && (type === 'issues' || type === 'discussions') && rest[0]) {
          return await readThread(url, owner, repo, 'issues', rest[0]);
        }
        if (owner && repo && type === 'pull' && rest[0]) {
          return await readThread(url, owner, repo, 'pulls', rest[0]);
        }
        if (owner && repo && !type) {
          return await readRepoRoot(url, owner, repo);
        }
        return fail(url, 'Unsupported GitHub URL shape for the reader.');
      } catch (err) {
        return fail(url, err instanceof Error ? err.message : 'GitHub read failed.');
      }
    }
  };
}
