# Gates: Selesai port to upstream pi v0.84.4

OWNS: package.json, package-lock.json, src/**, scripts/verify-upgrade.mjs, selesai-in-doc/**, GATES.md

Scope: Bump @earendil-works/pi-* runtime deps to 0.84.4 and port the upstream v0.84.3→v0.84.4 coding-agent source changes into the Selesai fork, preserving Selesai-local divergences (branding, config-dir rename, vision caption relay, multiselect, etc.).

- [x] G1: runtime deps pinned to 0.84.4
  CHECK: node -e "const p=require('./package.json');const ok=['@earendil-works/pi-agent-core','@earendil-works/pi-ai','@earendil-works/pi-tui'].every(k=>p.dependencies[k]==='0.84.4');console.log(ok?'deps-pinned-0.84.4':'deps-not-pinned');process.exit(ok?0:1)"
  EXPECT: deps-pinned-0.84.4
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=fe3ca961784503c1757804f8a1ae246cae43338b8f19848c8ecb127338cd7f73; output-bytes=19

- [x] G2: typecheck passes
  CHECK: npx tsgo --noEmit -p tsconfig.build.json && echo TYPECHECK_OK
  EXPECT: TYPECHECK_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=0d31cf08e125020004c508c562e62037cd1809c414d62a869bc1452c072c96f0; output-bytes=13

- [x] G3: build passes
  CHECK: npm run build && echo BUILD_OK
  EXPECT: BUILD_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=7c9c523ede3f2326a7221a24798cfacd7cea1eff4ca720493875feb82a8dd547; output-bytes=1008

- [x] G4: full test suite passes
  CHECK: npm test && echo TESTS_OK
  EXPECT: TESTS_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=0dccd47431688895d6de3a7765c45b6c9b51d331475d4a3eb42e31fb451b414c; output-bytes=12924

- [x] G5: focused regression tests pass
  CHECK: npx vitest run src/core/tools/read-vision.test.ts src/__tests__/model-registry-defaults.test.ts && echo FOCUSED_OK
  EXPECT: FOCUSED_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=0d0c3b5ad8d3bd347c629b40b1e6c2b7e82e31e49bb44e3ffe091f80dee0633a; output-bytes=689

- [x] G6: upgrade port verification script passes
  CHECK: node scripts/verify-upgrade.mjs && echo UPGRADE_OK
  EXPECT: UPGRADE_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=6ec1605f6db8bda5eb68f39240b90e8f859ddf067b374af064607107fc7e81b1; output-bytes=608

- [ ] G7: interactive smoke (brand banner, zentui footer, thinking toggle, UI prompt events, RPC clear_queue, llama autoload)
  EVIDENCE: pending

ABANDON: G7 requires an interactive terminal (npm run dev + manual brand-banner/zentui/thinking-toggle checks); not runnable in this headless session. Handoff: run the interactive smoke from selesai-in-doc/env-and-setup.md after `npm run build && npm i -g .`.
