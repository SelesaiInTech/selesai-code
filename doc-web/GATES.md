# Gates: doc-web Intercom redesign

OWNS: src/styles/**, src/components/**, src/content/docs/index.mdx, src/content/docs/capabilities.mdx, src/content/docs/id/index.mdx, src/content/docs/id/capabilities.mdx

Scope: Revamp the Selesai docs site (Astro Starlight) from the current ClickHouse yellow-on-black theme to the Intercom design language — warm cream canvas, charcoal ink, single Fin Orange accent, hairline-bordered white cards, no drop shadows — while keeping the existing stack and all functionality working.

- [x] G1: full verification pipeline passes (content validation, astro check, static build, built-link check)
  CHECK: npm run verify
  EXPECT: check-built-links: OK
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai/doc-web; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=69645d994eeb2083a14a3afccff853bcdbcd3ab3a9d2b7e2dc9962d20689d5e2; output-bytes=8453

- [x] G2: Intercom palette tokens are present in the theme
  CHECK: node scripts/verify-palette.mjs
  EXPECT: palette verification passed
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai/doc-web; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=28a5047a9d361c4e3ad8fead49462e3f4df45ed9193150aa9d8a9419ba8acf75; output-bytes=28

- [x] G3: Inter is no longer the primary UI font (banned by high-end skill)
  CHECK: node scripts/verify-font.mjs
  EXPECT: font verification passed
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai/doc-web; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=ed41af45f8369582f4de2e4871212599beb808992046539e612b41dd27a91906; output-bytes=25

- [x] G4: interactive elements carry hover, active, and focus-visible states
  CHECK: node scripts/verify-states.mjs
  EXPECT: states verification passed
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai/doc-web; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=e35eb791d9e44ccd5f208ebbf8d6e6b52b1e8b9f958566be28d9f25c571a72cd; output-bytes=27

- [x] G5: no generic drop shadows remain on cards (Intercom depth = surface lift, not shadow)
  CHECK: node scripts/verify-shadows.mjs
  EXPECT: shadows verification passed
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai/doc-web; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=5950b2c6f782a0daec4621351820febb07f92094600122ea60669b54cc893cb2; output-bytes=28

- [x] G6: light mode keeps accessible contrast (cream canvas with charcoal ink)
  CHECK: node scripts/verify-contrast.mjs
  EXPECT: contrast verification passed
  CWD: .
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai/doc-web; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=aeefb98d5284a0bcc30e53717bd90f0504f4b66866c81cfd6b71ea2e4bd8357d; output-bytes=29
