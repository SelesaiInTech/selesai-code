# Gates: Release 0.13.27 — Pi v0.86.1 sync (consolidated)

OWNS: CHANGELOG.md, package.json, package-lock.json, doc-web/src/content/docs/changelog.mdx, doc-web/src/content/docs/id/changelog.mdx, selesai-in-doc/reapply.md, scripts/verify-clean-install.mjs, GATES.pi-0861-sync.md

Scope: Cut a sync release that moves Selesai from upstream base Pi v0.85.1 to v0.86.1, proves every
release claim with captured evidence, and leaves the maintenance record pointing at the new base.

## Phase gates referenced

| Phase | Artifact | Where its evidence lives |
|---|---|---|
| 1–5 | commits `4c3e2722a`, `a95a6de0b`, `ac2228665`, `f146296e2` | `GATES.pi-0861-sync.md` §"Phase order and phase-gate map", §"Deliberate alterations", §"Known pre-existing failures" |
| 6 | commit `793a7f7b2` | `GATES.pi-0861-sync.md` checks S1–S10 (delta inventory, agent-dir audit, zentui A/B, vendored suites, no-behavioural-change) |
| 7 | this file | the checks below |

**Phases 1 and 2 landed in one commit deliberately** — PRD 1's typecheck is unreachable without PRD 2's
session-entry union, so splitting them would have produced a commit that does not compile. Recorded in
`GATES.pi-0861-sync.md`.

## Release-level claims

- [x] L1: the full focused test script passes on the release tree, unmodified
  CHECK: npm test && echo FOCUSED_SUITE_OK
  EXPECT: FOCUSED_SUITE_OK
  EVIDENCE: exit=0; 53 test files / 1008 tests passed. Two ported-test alterations are visible in the port diff rather than folded in, and both are recorded in `GATES.pi-0861-sync.md` §"Deliberate alterations": `test/clipboard-image-native-errors.test.ts` gains `showWarning` because this fork surfaces paste failures, and the fork's system-prompt test asserts on prompt sections rather than upstream's flat string.

- [x] L2: the tree typechecks and builds against Pi 0.86.1
  CHECK: npx tsgo -p tsconfig.build.json --noEmit && npm run build && echo BUILT
  EXPECT: BUILT
  EVIDENCE: exit=0; typecheck clean, build green, `dist/` complete

- [x] L3: the built CLI reports the release version
  CHECK: node dist/cli.js --version | grep -qx '0.13.27' && echo VERSION_OK
  EXPECT: VERSION_OK
  EVIDENCE: exit=0; `0.13.27`

- [x] L4: the published file set contains the bundled extensions, skills, themes and defaults
  CHECK: npm pack --dry-run 2>&1 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const need=['dist/extensions/','dist/skills/','dist/themes/','dist/defaults/'];const miss=need.filter(p=>!s.includes(p));if(miss.length){console.error('missing:',miss);process.exit(1)}console.log('PACKAGING_OK')})"
  EXPECT: PACKAGING_OK
  EVIDENCE: exit=0; 2086 files packed — dist/extensions 1306, dist/skills 67, dist/themes 72, dist/defaults 2

- [x] L5: a clean install outside the development tree starts and loads its bundled extensions
  CHECK: node scripts/verify-clean-install.mjs /tmp/cleaninstall/node_modules/@selesai/code
  EXPECT: CLEAN_INSTALL_OK
  EVIDENCE: exit=0; installed from `npm pack` into /tmp/cleaninstall; 22 bundled extensions loaded with 0 diagnostics (agent-browser, auto-session-name, capability-gateway, context-compaction-reminder, copy-turn, cost-reconcile, grep-app, handoff-new, herdr-agent-state, inline-skills, pi-graft, pi-hermes-memory, pi-intercom, pi-subagents, pi-tool-display, pi-zentui, ponytail, question, rtk, tokenin-onboarding, tps, undo). This is the seam a source checkout cannot exercise, and it is where pi-zentui's host-alias patch resolves — the thing its own compliance suite cannot test from source.

- [x] L6: the clean-installed CLI starts and completes a turn
  CHECK: cd /tmp/cleaninstall && node node_modules/@selesai/code/dist/cli.js -p "reply with exactly: SMOKE_OK" > /tmp/port/clean-smoke.out 2>&1 && grep -q SMOKE_OK /tmp/port/clean-smoke.out && echo INSTALL_SMOKE_OK
  EXPECT: INSTALL_SMOKE_OK
  EVIDENCE: exit=0; the installed binary answered `SMOKE_OK` end-to-end. Output is redirected to a file rather than piped into `grep -q`, because grep's early exit closes the pipe and makes the CLI's output guard report a spurious EPIPE.

- [x] L7: the documentation site validates its content, builds both languages, and its built links resolve
  CHECK: cd doc-web && npm run validate:content && npm run build && npm run check:links && echo DOCS_OK
  EXPECT: DOCS_OK
  EVIDENCE: exit=0; validate-content OK; 71 pages built across 2 indexed languages (70 content pages); check-built-links OK

- [x] L8: the maintenance record states the new upstream base and the delta inventory the next sync must preserve
  CHECK: grep -q 'v0.86.1' selesai-in-doc/reapply.md && grep -q 'scripts/verify-deltas.sh' selesai-in-doc/reapply.md && grep -q 'verify-agent-dir.mjs' selesai-in-doc/reapply.md && echo MAINTENANCE_RECORD_OK
  EXPECT: MAINTENANCE_RECORD_OK
  EVIDENCE: exit=0; `selesai-in-doc/reapply.md` §0a now states base v0.86.1 (was v0.85.1), the exact-pin set, `engines.node >= 22.19.0`, the sync *method* (per-file three-way reconciliation, since there is no merge base), the delta inventory as two runnable scripts, the decisions not to re-litigate, the vendored-extension table with pi-zentui's baseline-red measurement, and the three deferred open questions

- [x] L9: the changelog separates adopted upstream behaviour from fork fixes and names the base version
  CHECK: node -e "const c=require('node:fs').readFileSync('CHANGELOG.md','utf8');const i=c.indexOf('## [0.13.27]');const e=c.indexOf('## [0.13.26]');const s=c.slice(i,e);const need=['v0.86.1','**Adopted from upstream**','**Fork fixes carried in this release**','**Dependency removed**','**Deliberately not adopted**','@mariozechner/clipboard'];const miss=need.filter(n=>!s.includes(n));if(miss.length){console.error('missing:',miss);process.exit(1)}console.log('CHANGELOG_OK')"
  EXPECT: CHANGELOG_OK
  EVIDENCE: exit=0; the 0.13.27 section names base Pi v0.86.1 and groups changes into adopted upstream behaviour, fork fixes, a dependency removal (the retired `@mariozechner/clipboard`), and deliberate non-adoptions

- [x] L10: the changelog is present in both languages the site ships
  CHECK: grep -q '0.13.27 — Pi v0.86.1 sync' doc-web/src/content/docs/changelog.mdx && grep -q '0.13.27 — Sinkronisasi Pi v0.86.1' doc-web/src/content/docs/id/changelog.mdx && echo BILINGUAL_OK
  EXPECT: BILINGUAL_OK
  EVIDENCE: exit=0; English and Indonesian entries both present, both naming the base version, both covering adopted upstream / fork fixes / dependency removal / non-adoptions

- [x] L11: the vendored extension versions are recorded as current at this base
  EVIDENCE: recorded 2026-09-21: pi-zentui 0.23.0, pi-subagents v0.66.0, pi-intercom v0.13.0, pi-hermes-memory v0.9.8 are the newest upstream tags; PRD 6 scoped version bumps out and exercised each instead (pi-subagents 2917/0 unit + 986/0 integration, pi-hermes-memory 52/52 files, pi-zentui A/B in `GATES.pi-0861-sync.md`). Stated in `reapply.md` §"Vendored extensions: already current at this base".

- [x] L12: the release is a platform sync, not a behaviour redesign, and no check was fixed inside it
  EVIDENCE: reviewed 2026-09-21: this phase changed only documentation, version metadata and one new check script. No production code changed — PRD 7's out-of-scope rule ("a release phase that starts fixing things is a signal that an earlier phase was not finished") is satisfied; the one source fix found during PRD 6 (an upstream path leak in a session-manager doc comment) landed in PRD 6's own commit, not here.

## Manual checks, recorded with their command and result

- **Interactive TUI smoke** — not automated in this port. The terminal workspace (PRD 4) was gated by `npm test`, the build and L6's clean-install start; the vendored pi-zentui patch chain that decorates that workspace is baseline-red on this machine independent of the port (measured A/B in `GATES.pi-0861-sync.md`). **Deferred**, with the host-skew measurement recorded rather than asserted away.
- **Paste smoke** — PRD 5's ported clipboard suites pass in L1 (`test/clipboard*.test.ts`). A live paste into a real terminal was not reproduced headlessly; the failure-surfacing path it would exercise is pinned by `test/clipboard-image-native-errors.test.ts` (whose one deliberate alteration is recorded above).
- **Model-access usage command** — not exercised here; it needs live TokenIn credentials and was out of scope for a sync release.

## Rollback position

- **Revert to tag `v0.13.26`** (`f69901414ff384330f2fff83af4bdfe574027560`), or to branch
  **`pre-0861-port`** (`bfb256d7e`), which is HEAD before any port commit.
- **Bisect hypothesis — largest diffs first:**
  | Commit | Phase | Files | Lines |
  |---|---|---|---|
  | `a95a6de0b` | 3 — session runtime rebase | 16 | 4877+/57− |
  | `4c3e2722a` | 1+2 — floor, prompt sections, compaction | 69 | 3758+/1290− |
  | `f146296e2` | 5 — clipboard replacement | 10 | 705+/443− |
  | `793a7f7b2` | 6 — delta inventory sweep | 4 | 249+/1− |
  | `ac2228665` | 4 — interactive surfaces | 2 | 326+/87− |
  A bisect should start at `a95a6de0b` (the session runtime, where most of the fork's own behaviour
  lives) and then `4c3e2722a` (the widest mechanical adoption).

## Open questions deferred, recorded rather than dropped

1. Whether the fork adopts Mermaid rendering and its optional dependency.
2. Whether the newly added usage entries are surfaced anywhere in the terminal.
3. Whether the platform's new prompt-section model should be exposed to skill and prompt-template authors as a documented extension point.
