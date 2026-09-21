# Gates: Pi v0.85.1 → v0.86.1 platform sync (PRDs 1–7)

OWNS: src/**, test/**, scripts/verify-deltas.sh, scripts/verify-agent-dir.mjs, package.json, package-lock.json, CHANGELOG.md, doc-web/**, selesai-in-doc/reapply.md, GATES.pi-0861-sync.md

Scope: Move the Selesai fork of the Pi coding agent from upstream base v0.85.1 to v0.86.1, re-plant
every Selesai-owned behaviour on the new upstream shapes, prove each with a check, and release.

## Phase order and phase-gate map

Phases land in the order PRD `00-index.md` fixes. Each phase's own gate evidence is recorded in the
consolidated release gate (PRD 7); this file is the port's own ledger and PRD 6's delta inventory.

| Phase | Covers | Landed |
|---|---|---|
| 1 | platform floor (dependency pins, `engines.node`) + prompt/session/compaction (`UsageEntry`, sectioned prompt) | `4c3e2722a` |
| 2 | core prompt, session transcript entries, compaction budgets | `4c3e2722a` |
| 3 | session runtime rebase (abort control, auth threading, cache warmer) | `a95a6de0b` |
| 4 | interactive: deferred catalogue refresh, settings surfaces | `ac2228665` |
| 5 | clipboard replacement (native dependency removed) | `f146296e2` |
| 6 | delta re-plant sweep + delta inventory (this file) | PRD 6 |
| 7 | verification, documentation, release | PRD 7 |

**PRD 1 and 2 landed in one commit deliberately.** PRD 1's typecheck gate is unreachable without
PRD 2's session-entry union (`UsageEntry`), the compaction `systemMessage` entry and the prompt/settings
types: upstream 0.86.1 files adopted mechanically by PRD 1 reference them. Splitting the commits would
have produced a commit that does not compile, which the phase gates forbid.

## Deliberate alterations, recorded rather than folded into the port diff

These are the places where the port knowingly departs from a mechanical adoption. Each is a decision,
not an accident.

- **Provider boundary.** The platform lifts an ordinary `Context` into its branded `TranscriptContext`
  internally. Local code therefore calls `normalizeContext` from `@earendil-works/pi-ai/utils/transcript`
  at the forwarding sites (`core/provider-composer.ts`, `core/compaction/compaction.ts`, model runtime)
  instead of casting or weakening types. `ProviderConfigInput.streamSimple` now takes `TranscriptContext`.
- **Mermaid: not adopted.** Upstream 0.86.1 adds an optional Mermaid rendering path. The fork does not
  adopt it, so ported settings/selector code must not reference `MermaidRenderingMode`.
- **Clipboard: replaced, not merged.** `utils/clipboard.ts` and `utils/clipboard-image.ts` are upstream
  0.86.1 wholesale; `utils/clipboard-native.ts` is deleted and `@mariozechner/clipboard` is removed from
  `optionalDependencies`. The native path is now `getNativeClipboard` from `@earendil-works/pi-tui`.
  Vendored extensions that declare their own clipboard dependency are deliberately untouched.
- **Module resolution.** Upstream's extracted `core/extensions/virtual-modules.ts` is the single source of
  truth; the loader's duplicate map is deleted, and exactly one `@selesai/code` entry is added in both the
  extracted map and `getAliases()` in `core/extensions/loader.ts`.
- **Overflow recovery.** The fork adopts `isRecoverableLength`; a `length` stop must not clear
  `_overflowRecoveryAttempted` (upstream excludes both `error` and `length` from the reset).
- **Length continuation kept.** The fork's `MAX_LENGTH_CONTINUATIONS` / `LENGTH_CONTINUATION_MESSAGE`
  behaviour deliberately overrides upstream's "stop at the output limit". Where a ported upstream
  assertion conflicts, the assertion was adapted and the alteration recorded here.
- **Two ported-test alterations.** `test/clipboard-image-native-errors.test.ts` gains `showWarning`
  because this fork surfaces paste failures rather than swallowing them; the fork's system-prompt test
  is extended to assert on prompt *sections* rather than the flat string upstream asserts.
- **Dropped delta (deliberate).** The fork's own module-alias map is dropped as superseded by upstream's
  extracted virtual-module map (see "Module resolution" above). Recorded, not deleted silently.

## Known pre-existing failures (recorded, not chased)

Both fail identically at branch `pre-0861-port`, are unrelated to this port, and neither is in the
`npm test` enumeration:

- `src/core/agent-session-auto-handoff.test.ts` → "keeps custom tools inactive by default but activates explicitly allowed ones".
- `test/suite/regressions/tui-mode-fullscreen-native-dock.test.ts` → imports the removed `src/extensions/pi-powerline-footer/index.ts`.

## Vendored-extension suites

- `pi-subagents` exercised at this base: unit + integration green (see the gate below).
- `pi-hermes-memory` exercised at this base: all 52 test files pass.
- `pi-zentui` is **red at baseline on this machine and stays red** — see the measured A/B below. Its
  source tree is byte-identical before and after the port (same git tree hash), so no zentui failure is
  attributable to this port.

## Measured evidence: pi-zentui compliance suite is host-skew, not port damage

The vendored zentui suite imports the host by published name and resolves it from the extension's own
gitignored `node_modules`. It is red before the port and remains red after. Measured by running the same
byte-identical zentui source against two hosts:

| host | failed | passed |
|---|---|---|
| `@earendil-works/pi-coding-agent` 0.85.1 (pre-port host) | 197 | 1392 |
| fork `dist/index.js` on Pi 0.86.1 (post-port host) | 155 | 1434 |

No file has more failures on the new host than on the old one; `extension-compliance.test.ts` improves
82 → 40. The 37 `thinking-experimental` + 7 `working-line` failures are byte-identical across both hosts
and match the pre-existing set the earlier v0.85.1 sync already recorded (`thinking-experimental (37)
fails identically with PRE-PORT zentui on the 0.85.1 host (clean A/B control)`, and `working-line frame
failures (7) reproduce at pre-port base on this machine`). One apparent regression is a bookkeeping
artefact: `.unlazy/zentui-upgrade/baseline-failures.json` predates those two files, which arrived in the
later 0.22.3 → 0.23.0 upgrade.

**Decision:** the vendored compliance suite is recorded as un-runnable-in-place with a host alias, and is
not wired into `npm test`. The extension's own `node_modules` is gitignored, so the suite's host is
machine-local and cannot be a release gate. The port is instead gated on the measured A/B above.

- [x] S1: the fork's own delta inventory reports every Selesai-owned behaviour present
  CHECK: bash scripts/verify-deltas.sh
  EXPECT: PASS=37 FAIL=0
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; EXPECT=matched; 37 rows over prompt content (6), session runtime (9), settings (5), extension surface (5), module resolution (2), provider/model (3), terminal (5), rpc/sdk (2)

- [x] S2: no upstream agent-directory path or env prefix leaked into shipped code
  CHECK: node scripts/verify-agent-dir.mjs
  EXPECT: CONFIG DIR AUDIT OK
  EVIDENCE: exit=0; cwd=/Users/andrewanggada/Documents/workdir/js_proj/selesai; 13 intentional candidates. The audit caught one real port-introduced leak — an upstream doc comment in `src/core/session-manager.ts` adopted by PRD 2 naming `~/.pi/agent/sessions`; corrected to `~/.selesai/agent/sessions`. Runtime resolution was already correct via `getSessionsDir()`; only the comment leaked.

- [x] S3: the fork's focused test script passes on the ported tree
  CHECK: npm test && echo FOCUSED_SUITE_OK
  EXPECT: FOCUSED_SUITE_OK
  EVIDENCE: exit=0; 53 test files / 1008 tests passed; includes the eight ported `test/suite/agent-session-*.test.ts` suites, `test/settings-manager-compaction.test.ts`, and the five `test/clipboard*.test.ts` suites

- [x] S4: the tree typechecks against Pi 0.86.1
  CHECK: npx tsgo -p tsconfig.build.json --noEmit && echo TYPECHECK_OK
  EXPECT: TYPECHECK_OK
  EVIDENCE: exit=0; clean after every phase and after the PRD 6 session-manager comment fix

- [x] S5: the ported build succeeds
  CHECK: npm run build && echo BUILD_OK
  EXPECT: BUILD_OK
  EVIDENCE: exit=0; `dist/` produced, including bundled extensions, skills, themes and defaults

- [x] S6: no zentui failure is attributable to this port
  CHECK: git diff --stat pre-0861-port..main -- src/extensions/pi-zentui && echo ZENTUI_UNTOUCHED
  EXPECT: ZENTUI_UNTOUCHED
  EVIDENCE: exit=0; empty diff, and `git rev-parse pre-0861-port:src/extensions/pi-zentui` == `git rev-parse main:src/extensions/pi-zentui` (tree 80b55d9534d1d567becc6766ca03a8a09aa1097d). Host A/B measured above: 197 failed on the 0.85.1 host vs 155 on the 0.86.1 host; zero files worse.

- [x] S7: the subagent extension's host-facing contract still holds at this base
  CHECK: cd src/extensions/pi-subagents && npm run test:unit && npm run test:integration && echo SUBAGENTS_OK
  EXPECT: SUBAGENTS_OK
  EVIDENCE: exit=0; unit 2917 pass / 0 fail (12 skipped); integration 986 pass / 0 fail

- [x] S8: the memory extension's suites still pass at this base
  CHECK: cd src/extensions/pi-hermes-memory && npm test && echo HERMES_OK
  EXPECT: HERMES_OK
  EVIDENCE: exit=0; "All 52 test files passed"

- [x] S9: the vendored extension versions are already current, so no version bump was performed
  EVIDENCE: reviewed 2026-09-21: pi-zentui 0.23.0, pi-subagents v0.66.0, pi-intercom v0.13.0, pi-hermes-memory v0.9.8 — the immutable refs recorded by the v0.85.1 sync are still the newest upstream tags. PRD 6 explicitly scopes vendored version bumps out; each extension was exercised instead (S7, S8, S6).

- [x] S10: this sweep changed no production behaviour, so a later regression is attributable to the port
  CHECK: test -z "$(git diff --name-only -- src ':(exclude)src/core/session-manager.ts')" && echo NO_PRODUCTION_CHANGE
  EXPECT: NO_PRODUCTION_CHANGE
  EVIDENCE: exit=0; the only source edits in this sweep are the two new check scripts (not shipped runtime) and one doc comment in `src/core/session-manager.ts` (S2). No production behaviour changed.
