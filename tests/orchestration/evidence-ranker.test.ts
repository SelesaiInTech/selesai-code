import { describe, expect, it } from 'vitest';
import { rankEvidence } from '../../src/orchestration/evidence-ranker.js';
import type { ResearchEvidence } from '../../src/orchestration/research-types.js';

const evidence = (sourceKind: ResearchEvidence['sourceKind'], url: string): ResearchEvidence => ({
  title: url,
  url,
  sourceKind,
  method: 'http',
  summary: `${sourceKind} summary`,
  supports: [`${sourceKind} support`]
});

describe('rankEvidence', () => {
  it('ranks primary-content above all other sources', () => {
    const ranked = rankEvidence([
      evidence('official-docs', 'https://vitest.dev/guide/coverage.html'),
      evidence('primary-content', 'https://example.com/primary'),
      evidence('official-api', 'https://vitest.dev/config/')
    ]);

    expect(ranked.map((item) => item.sourceKind)).toEqual([
      'primary-content',
      'official-docs',
      'official-api'
    ]);
  });

  it('ranks official sources above community and package pages', () => {
    const ranked = rankEvidence([
      evidence('community', 'https://example.com/post'),
      evidence('package-page', 'https://www.npmjs.com/package/x'),
      evidence('official-api', 'https://vitest.dev/config/'),
      evidence('official-docs', 'https://vitest.dev/guide/coverage.html')
    ]);

    expect(ranked.map((item) => item.sourceKind)).toEqual([
      'official-docs',
      'official-api',
      'community',
      'package-page'
    ]);
  });

  it('dedupes evidence by url', () => {
    const ranked = rankEvidence([
      evidence('community', 'https://example.com/post'),
      evidence('official-docs', 'https://example.com/post')
    ]);

    expect(ranked).toHaveLength(1);
    expect(ranked[0].sourceKind).toBe('official-docs');
  });
});
