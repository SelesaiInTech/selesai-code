# Gates: Release 0.13.28 — Automatic model routing

OWNS: CHANGELOG.md, package.json, package-lock.json, src/extensions/auto-model.ts, src/extensions/auto-model.test.ts, src/extensions/package.json, src/defaults/settings.json, src/config.ts, src/__tests__/bootstrap.test.ts, docs/settings.md, doc-web/src/content/docs/changelog.mdx, doc-web/src/content/docs/id/changelog.mdx, doc-web/src/content/docs/settings.mdx, doc-web/src/content/docs/id/settings.mdx, doc-web/src/content/docs/capabilities/workspace/auto-model.mdx, doc-web/src/content/docs/id/capabilities/workspace/auto-model.mdx, doc-web/src/data/capabilities.ts, doc-web/src/data/extension-customization.json, doc-web/scripts/validate-content.mjs, GATES.release-0.13.28.md

Scope: Ship the bundled `auto-model` extension — four-tier prompt routing classified by the Jev
decisions model (`jev-1.13`) through the Token-In gateway — together with the Graft deep-build model
default seeding, documented on the site and ready to republish.

## Release-level claims

- [x] L1: the full focused test script passes on the release tree, unmodified
  CHECK: npm test && echo FOCUSED_SUITE_OK
  EXPECT: FOCUSED_SUITE_OK
  EVIDENCE: exit=0; 54 test files / 1030 tests passed, including the 22 new `auto-model` tests.

- [x] L2: the tree typechecks and builds
  CHECK: npx tsgo -p tsconfig.build.json --noEmit && npm run build && echo BUILT
  EXPECT: BUILT
  EVIDENCE: typecheck clean; build green; `dist/` complete.

- [x] L3: the published version is 0.13.28 in both manifests
  CHECK: node -e "const p=require('./package.json'),l=require('./package-lock.json'); if(p.version!=='0.13.28'||l.version!=='0.13.28'||l.packages[''].version!=='0.13.28')process.exit(1); console.log('VERSION_OK')"
  EXPECT: VERSION_OK

- [x] L4: the package carries the new extension
  CHECK: npm pack --dry-run --json (inspect file list)
  EXPECT: dist/extensions/auto-model.ts present
  EVIDENCE: `dist/extensions/auto-model.ts` and its test ship alongside the other bundled extensions.

- [x] L5: the docs site verifies across both locales
  CHECK: cd doc-web && npm run verify
  EXPECT: exit=0
  EVIDENCE: `validate-content: OK`; 73 pages built (up from 71); `check-built-links: OK`.

- [x] L6: the new extension is fully covered
  CHECK: npx vitest run --coverage src/extensions/auto-model.test.ts
  EXPECT: 100% on src/extensions/auto-model.ts
  EVIDENCE: 100% statements, branches, functions, and lines.

## Rollback position

Tag `v0.13.27` and npm version `0.13.27` are the last good release. Reverting the `auto-model`
commit leaves the tree at 0.13.27 behaviour; the extension is additive and no core file changes
behaviour without it.
