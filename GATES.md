# Gates: Token-In search provider as default web search backend

OWNS: src/extensions/pi-web-agent/src/types.ts, src/extensions/pi-web-agent/src/search/tokenin.ts, src/extensions/pi-web-agent/src/backends/config.ts, src/extensions/pi-web-agent/src/backends/factory.ts, src/extensions/pi-web-agent/src/backends/settings-reader.ts, src/extensions/pi-web-agent/src/commands/web-agent-config.ts, src/__tests__/tokenin-search.test.ts, GATES.md

Scope: Add a `tokenin` search provider to the bundled pi-web-agent extension that calls the LiteLLM `/v1/search/firecrawl` endpoint with the active Token-In account key, make it the default search backend (with DuckDuckGo fallback) so both web_explore and web_search use it automatically, and degrade to DuckDuckGo when no Token-In account is configured.

- [x] G1: tokenin search provider unit tests pass
  CHECK: npx vitest run src/__tests__/tokenin-search.test.ts && echo TOKENIN_SEARCH_OK
  EXPECT: TOKENIN_SEARCH_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=2ed1a89a008e3d7a48c112ff242479affaf2fb6331344d1552074fe6e9652be8; output-bytes=697

- [x] G2: existing tokenin + web-agent onboarding tests still pass (regression)
  CHECK: npx vitest run src/__tests__/tokenin-onboarding.test.ts src/extensions/web-agent-onboarding.test.ts && echo REGRESSION_OK
  EXPECT: REGRESSION_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=31b16c146f6a8c9dc80abe96678a13772692f041f501c1ba6dc91675c09f4807; output-bytes=3071

- [x] G3: typecheck passes
  CHECK: npx tsgo --noEmit -p tsconfig.build.json && echo TYPECHECK_OK
  EXPECT: TYPECHECK_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=0d31cf08e125020004c508c562e62037cd1809c414d62a869bc1452c072c96f0; output-bytes=13

- [x] G4: build passes (extensions copied into dist)
  CHECK: npm run build && echo BUILD_OK
  EXPECT: BUILD_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=caaf1ffc60b46f4b83bd7a489859427c9f664fdca222e796713c92d035992591; output-bytes=1011
