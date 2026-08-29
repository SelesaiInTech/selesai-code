# Gates: /tokenin usage subcommand

OWNS: src/extensions/tokenin-onboarding.ts, src/__tests__/tokenin-onboarding.test.ts, GATES.tokenin-usage.md

Scope: Add a /tokenin usage subcommand that queries the LiteLLM /key/info endpoint with the active Token-In token and reports spend/budget/remaining/reset to the user, with unit and command tests.

- [x] G1: typecheck passes
  CHECK: npx tsgo --noEmit -p tsconfig.build.json && echo TYPECHECK_OK
  EXPECT: TYPECHECK_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=0d31cf08e125020004c508c562e62037cd1809c414d62a869bc1452c072c96f0; output-bytes=13

- [x] G2: tokenin test suite passes including the new usage tests
  CHECK: npx vitest run src/__tests__/tokenin-onboarding.test.ts && echo TOKENIN_TESTS_OK
  EXPECT: TOKENIN_TESTS_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=4727efdbfc3280181b149ee0409c70ccf73b42b75dca8ef62c8ea25e674f31ad; output-bytes=2301
