# Gates: Fork pi-hermes-memory into Selesai bundled extension

OWNS: src/extensions/pi-hermes-memory/**, src/extensions/package.json, package.json, package-lock.json, scripts/verify-hermes-load.ts, GATES.hermes-fork.md

Scope: Vendor pi-hermes-memory v0.9.7 as a bundled Selesai extension in src/extensions/pi-hermes-memory/, adapting its config-dir resolution to the Selesai host (CONFIG_DIR_NAME + SELESAI_CODING_AGENT_DIR), its child-process CLI from `pi` to `selesai`, registering it in src/extensions/package.json, adding required runtime deps (better-sqlite3, strip-ansi) to the root package, and proving it loads and runs its own focused tests.

- [x] G1: extension source vendored under src/extensions/pi-hermes-memory/
  CHECK: test -f src/extensions/pi-hermes-memory/src/index.ts && test -f src/extensions/pi-hermes-memory/src/paths.ts && test -f src/extensions/pi-hermes-memory/package.json && echo VENDOR_OK
  EXPECT: VENDOR_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=28b71cc80624c34767771b95945de7cc6ba31fc81642bcf81217648e9018317d; output-bytes=10

- [x] G2: registered in bundled extensions manifest
  CHECK: node -e "const p=require('./src/extensions/package.json');const ok=p.pi.extensions.some(e=>String(e).includes('pi-hermes-memory'));console.log(ok?'REGISTERED_OK':'REGISTERED_MISSING');process.exit(ok?0:1)"
  EXPECT: REGISTERED_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=2c7c9afe24945886ca630970b78dcc8fb65a369e004e8b2c879a524bbe8d9103; output-bytes=14

- [x] G3: no `~/.pi/agent` hardcoded agent-root fallback in vendored src
  CHECK: node -e "const fs=require('fs');const t=fs.readFileSync('src/extensions/pi-hermes-memory/src/paths.ts','utf8');const bad=/\\.pi[\"']?\\)?\s*,\s*[\"']agent/.test(t)||t.includes('path.join(os.homedir(), \".pi\", \"agent\")');console.log(bad?'PI_LEAK_FOUND':'PI_LEAK_CLEAR');process.exit(bad?1:0)"
  EXPECT: PI_LEAK_CLEAR
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=685103492a491a5b6f2b21c11de26aa72bc3c7311631da93491b383d420c0765; output-bytes=14

- [x] G4: config-dir resolved through Selesai host resolver
  CHECK: node -e "const src=require('fs').readFileSync('src/extensions/pi-hermes-memory/src/paths.ts','utf8');const ok=/getAgentDir|CONFIG_DIR_NAME|SELESAI_CODING_AGENT_DIR/.test(src)&&!/\\.pi[\"']\\)?\s*,\s*[\"']agent/.test(src);console.log(ok?'HOST_RESOLVER_OK':'HOST_RESOLVER_MISSING');process.exit(ok?0:1)"
  EXPECT: HOST_RESOLVER_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=51ba0d61f8262b269d1841ba3d80f3575ca62f13a477b497f53e4bb0981a5966; output-bytes=17

- [x] G5: root deps include better-sqlite3 and strip-ansi
  CHECK: node -e "const p=require('./package.json');const ok=!!p.dependencies['better-sqlite3']&&!!p.dependencies['strip-ansi'];console.log(ok?'DEPS_OK':'DEPS_MISSING');process.exit(ok?0:1)"
  EXPECT: DEPS_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=97619ba86a2e37b0d065e1e111235294a72aa2bebca6921bae28bd01496004d4; output-bytes=8

- [x] G6: vendored extension loads through Selesai extension loader
  CHECK: npx tsx scripts/verify-hermes-load.ts && echo HERMES_LOAD_OK
  EXPECT: HERMES_LOAD_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=77859a2caea9933f2588a5fb22625168caecb5e067c9a8872c32c4bf782dcee6; output-bytes=63

- [x] G7: focused vendored unit tests pass
  CHECK: npx tsx --test src/extensions/pi-hermes-memory/tests/paths.test.ts src/extensions/pi-hermes-memory/tests/config.test.ts && echo HERMES_TESTS_OK
  EXPECT: HERMES_TESTS_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=d058d9b94bf81b010ff12e7113113c567cc77ef1195875190309b03be737980b; output-bytes=2622

- [x] G8: root build ships the vendored extension
  CHECK: npm run build && test -f dist/extensions/pi-hermes-memory/src/index.ts && echo BUILD_EXT_OK
  EXPECT: BUILD_EXT_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=b3c5fe79707ea20ef8ffbb936384e8cc44b8835d4118e034c48399a5c9c14343; output-bytes=1012
