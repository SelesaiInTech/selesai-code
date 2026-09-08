# Gates: Keyless web search default and Brave onboarding removal

OWNS: src/extensions/pi-web-agent/src/backends/config.ts, src/extensions/pi-web-agent/src/backends/factory.ts, src/extensions/pi-web-agent/src/backends/settings-reader.ts, src/extensions/pi-web-agent/src/presentation/config-store.ts, src/extensions/pi-web-agent/src/commands/web-agent-config.ts, src/extensions/pi-web-agent/src/extension.ts, src/extensions/pi-web-agent/README.md, src/extensions/package.json, src/extensions/agent-browser.ts, src/__tests__/tokenin-search.test.ts, src/__tests__/tokenin-onboarding.test.ts, src/extensions/web-agent-onboarding.ts, src/extensions/web-agent-onboarding.test.ts, doc-web/src/data/capabilities.ts, doc-web/src/data/extension-customization.json, doc-web/src/content/docs/capabilities/research/web-agent.mdx, doc-web/src/content/docs/id/capabilities/research/web-agent.mdx, doc-web/src/content/docs/capabilities/workspace/web-agent-onboarding.mdx, doc-web/src/content/docs/id/capabilities/workspace/web-agent-onboarding.mdx, doc-web/docs-maintenance/extension-reference-matrix.md, doc-web/scripts/validate-content.mjs, package.json, GATES.md

Scope: Default pi-web-agent search to TokenIn when an active TokenIn account exists, otherwise use keyless DuckDuckGo; retain the Brave onboarding removal and its documentation cleanup.

- [x] G1: active TokenIn selects TokenIn while no account selects DuckDuckGo
  CHECK: npx vitest run src/__tests__/tokenin-search.test.ts && echo CONDITIONAL_DEFAULT_OK
  EXPECT: CONDITIONAL_DEFAULT_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=932bb69c0bece6ce39890df859c2ee9e32fea5092bacecefb06a9ba8e91748e4; output-bytes=302

- [x] G2: TokenIn onboarding regression tests still pass
  CHECK: npx vitest run src/__tests__/tokenin-onboarding.test.ts && echo TOKENIN_REGRESSION_OK
  EXPECT: TOKENIN_REGRESSION_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=2d3165629874f973be5d9765e01fe20b094fb6f1810ff0a6c5433e39400db29e; output-bytes=659

- [x] G3: typecheck passes
  CHECK: npx tsgo --noEmit -p tsconfig.build.json && echo TYPECHECK_OK
  EXPECT: TYPECHECK_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=0d31cf08e125020004c508c562e62037cd1809c414d62a869bc1452c072c96f0; output-bytes=13

- [x] G4: build passes without the deleted extension
  CHECK: npm run build && echo BUILD_OK
  EXPECT: BUILD_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=18e93254c0d1b0f4e08b88deac68ab90fd6721492184d183b208d98262811c7e; output-bytes=1011

- [x] G5: web_explore registers through the runtime loader
  CHECK: npx vitest run src/__tests__/tokenin-search.test.ts && echo WEB_EXPLORE_RUNTIME_OK
  EXPECT: WEB_EXPLORE_RUNTIME_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=df600591c74a1a604a0c88cfb183503e590462718fe83c2bcdd197091e632852; output-bytes=302

- [x] G6: Brave onboarding is absent from the bundled manifest and docs
  CHECK: node -e "const fs=require('node:fs');const paths=['src/extensions/web-agent-onboarding.ts','src/extensions/web-agent-onboarding.test.ts','doc-web/src/content/docs/capabilities/workspace/web-agent-onboarding.mdx','doc-web/src/content/docs/id/capabilities/workspace/web-agent-onboarding.mdx'];const manifest=JSON.parse(fs.readFileSync('src/extensions/package.json','utf8'));const text=['doc-web/src/data/capabilities.ts','doc-web/src/data/extension-customization.json','doc-web/docs-maintenance/extension-reference-matrix.md','doc-web/scripts/validate-content.mjs','src/extensions/agent-browser.ts'].map(p=>fs.readFileSync(p,'utf8')).join('\n');if(paths.some(fs.existsSync)||manifest.pi.extensions.includes('./web-agent-onboarding.ts')||text.includes('web-agent-onboarding'))process.exit(1);console.log('BRAVE_ONBOARDING_REMOVED')"
  EXPECT: BRAVE_ONBOARDING_REMOVED
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=bb48d1993af0a806796987c4f234bcb9b7dbb28c6157fa1233b34b3937e1af06; output-bytes=25

- [x] G7: documentation manifest validation passes without the retired extension
  CHECK: npm --prefix doc-web run validate:content && echo DOCS_MANIFEST_OK
  EXPECT: DOCS_MANIFEST_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=967321c84cba5f33d79f79d5f36987565bee109cd1e046be73305ce98d14b817; output-bytes=115
