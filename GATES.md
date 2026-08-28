# Gates: auto-session-name extension

OWNS: src/extensions/auto-session-name.ts, src/extensions/auto-session-name.test.ts, src/extensions/package.json, package.json

Scope: bundled extension that names the session on each user message using the currently selected model, sending the current plus previous user messages (truncated) with a small system prompt, capped at 5 output tokens.

- [x] G1: extension file exists and is registered in the bundled manifest
  CHECK: node --input-type=commonjs -e "const fs=require('node:fs');const p=JSON.parse(fs.readFileSync('src/extensions/package.json','utf8'));if(!fs.existsSync('src/extensions/auto-session-name.ts'))process.exit(1);if(!p.pi.extensions.includes('./auto-session-name.ts'))process.exit(1);console.log('auto-session-name registered')"
  EXPECT: auto-session-name registered
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=c18cf8d0b540bef8ac5a91f0486f5f0b94a47b0c71fd192c2d91de18cf9c6cae; output-bytes=29

- [x] G2: unit tests pass: naming sends current + previous user messages (truncated) with a small system prompt, caps the name at 5 words, and sets the session name
  CHECK: npx vitest run src/extensions/auto-session-name.test.ts
  EXPECT: /8 passed/
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=8b71c91cb3310d8432d83a01e7a28a55c0dc35b65892d37a541e4fd7ec963a46; output-bytes=564

- [x] G3: new test is wired into the npm test script
  CHECK: node --input-type=commonjs -e "const fs=require('node:fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));if(!p.scripts.test.includes('src/extensions/auto-session-name.test.ts'))process.exit(1);console.log('test wired')"
  EXPECT: test wired
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; path=2610fb58ca00/52 entries; EXPECT=matched; output-sha256=635678866ce53965c1ec71d66489b2ce9f6a8cea1d15ff5c7514cf69900e66a3; output-bytes=11
