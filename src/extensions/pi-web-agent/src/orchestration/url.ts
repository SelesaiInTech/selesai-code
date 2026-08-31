const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_name',
  'fbclid',
  'gclid'
]);

/** Canonical form for dedupe/comparison. Returns undefined for non-http(s) or unparseable input. */
export function canonicalizeUrl(raw: string, options: { canonicalizeHost?: boolean } = {}): string | undefined {
  const { canonicalizeHost = true } = options;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;

  if (canonicalizeHost) {
    url.hostname = url.hostname.replace(/^www\./, '');
  }
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export { TRACKING_PARAMS };
