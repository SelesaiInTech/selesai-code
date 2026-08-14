import type { WebFetchResponse } from '../types.js';
import type { SpecialContentReader } from './types.js';
import { READER_TEXT_CAP } from './limits.js';

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

type GithubShape = 'blob' | 'issue' | 'pull' | 'repo-root';

function classifyGithubShape(url: string): { shape: GithubShape; owner: string; repo: string; ref?: string; path?: string; num?: string } | undefined {
  const parsed = parseGithub(url);
  if (!parsed || parsed.hostname.toLowerCase() !== 'github.com') {
    return undefined;
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  const [owner, repo, type, ...rest] = segments;

  // blob: [owner, repo, 'blob', ref, ...path] with rest.length >= 2
  if (owner && repo && type === 'blob' && rest.length >= 2) {
    const [ref, ...pathParts] = rest;
    return { shape: 'blob', owner, repo, ref, path: pathParts.join('/') };
  }

  // issue: [owner, repo, 'issues', N]
  if (owner && repo && type === 'issues' && rest[0]) {
    return { shape: 'issue', owner, repo, num: rest[0] };
  }

  // pull: [owner, repo, 'pull', N]
  if (owner && repo && type === 'pull' && rest[0]) {
    return { shape: 'pull', owner, repo, num: rest[0] };
  }

  // repo-root: exactly [owner, repo]
  if (owner && repo && !type) {
    return { shape: 'repo-root', owner, repo };
  }

  return undefined;
}

function encodeSegment(segment: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    decoded = segment;
  }
  return encodeURIComponent(decoded);
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
  const capped = text.slice(0, READER_TEXT_CAP);
  return {
    status: 'ok',
    url,
    content: { title, text: capped },
    metadata: { method: 'github', cacheHit: false, truncated: text.length >= READER_TEXT_CAP }
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
    const encodedPath = path.split('/').map(encodeSegment).join('/');
    const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeSegment(ref)}/${encodedPath}`;
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
      return classifyGithubShape(url) !== undefined;
    },
    async read(url: string): Promise<WebFetchResponse> {
      const shape = classifyGithubShape(url);
      if (!shape) return fail(url, 'Unsupported GitHub URL shape for the reader.');

      try {
        switch (shape.shape) {
          case 'blob':
            return await readBlob(url, shape.owner, shape.repo, shape.ref!, shape.path!);
          case 'issue':
            return await readThread(url, shape.owner, shape.repo, 'issues', shape.num!);
          case 'pull':
            return await readThread(url, shape.owner, shape.repo, 'pulls', shape.num!);
          case 'repo-root':
            return await readRepoRoot(url, shape.owner, shape.repo);
        }
      } catch (err) {
        return fail(url, err instanceof Error ? err.message : 'GitHub read failed.');
      }
    }
  };
}
