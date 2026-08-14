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
  let originalHostname: string | undefined;

  try {
    url = new URL(raw);
    // Preserve original hostname case if we're not canonicalizing
    if (!canonicalizeHost) {
      const match = raw.match(/^(?:https?:\/\/)?([^/?\#]+)/i);
      if (match) {
        originalHostname = match[1];
      }
    }
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;

  if (canonicalizeHost) {
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  }
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.hash = '';
  let result = url.toString().replace(/\/$/, '');

  // Replace with original hostname if we preserved it
  if (originalHostname && !canonicalizeHost) {
    result = result.replace(/^(https?:\/\/)([^/]+)/, `$1${originalHostname}`);
  }

  return result;
}

export { TRACKING_PARAMS };
