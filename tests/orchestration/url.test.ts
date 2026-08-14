import { describe, it, expect } from 'vitest';
import { canonicalizeUrl } from '../../src/orchestration/url.js';

describe('canonicalizeUrl', () => {
  it('strips tracking params, fragment, trailing slash, and www', () => {
    expect(canonicalizeUrl('https://www.example.com/a/?utm_source=x#frag')).toBe('https://example.com/a');
    expect(canonicalizeUrl('https://example.com/a')).toBe('https://example.com/a');
  });

  it('lowercases the host but keeps the path case', () => {
    expect(canonicalizeUrl('https://Example.COM/Path')).toBe('https://example.com/Path');
  });

  it('treats trailing-slash and non-slash as the same', () => {
    expect(canonicalizeUrl('https://example.com/a/')).toBe(canonicalizeUrl('https://example.com/a'));
  });

  it('returns undefined for non-http(s) or unparseable urls', () => {
    expect(canonicalizeUrl('mailto:x@y.com')).toBeUndefined();
    expect(canonicalizeUrl('not a url')).toBeUndefined();
  });

  it('preserves www when canonicalizeHost is false (host still lowercased by URL parser)', () => {
    expect(canonicalizeUrl('https://www.Example.com/A/?utm_source=x', { canonicalizeHost: false }))
      .toBe('https://www.example.com/A');
  });
});
