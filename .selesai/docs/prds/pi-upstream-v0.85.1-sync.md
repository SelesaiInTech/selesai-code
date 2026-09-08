# PRD: Sync Selesai fork to Pi upstream v0.85.1

## Problem Statement

Selesai is a fork of `earendil-works/pi`. The fork's coding-agent source is currently aligned to
upstream **v0.84.4** (documented in `selesai-in-doc/reapply.md` and evidenced by the runtime
dependency pins `@earendil-works/pi-{ai,agent-core,tui}` at `0.84.4`). Upstream has since released
**v0.85.0** and **v0.85.1** (release URL:
`https://github.com/earendil-works/pi/releases/tag/v0.85.1`). Until the fork syncs, it misses
upstream bug fixes (broken tool `ctx.cwd` handling, proxy/CONNECT hangs, skills unavailable when
Bash is the only enabled tool, session import/fork corruption fixes, Codex SSE parsing, model
catalog corrections) and new features (GPT-6 Astra, persistent Anthropic per-turn thinking effort,
fullscreen transcript controls, faster Alt-wheel scrolling). Each release the fork lags, the
next upgrade grows riskier: the upstream delta accumulates on top of fork-owned modifications in
the same files.

## Solution

Perform a controlled upstream sync of the fork's vendored `src/` tree (originating from
`packages/coding-agent/src`) from upstream base `v0.84.4` to `v0.85.1`, plus a version bump of the
inherited runtime packages (`pi-ai`, `pi-agent-core`, `pi-tui`) from `0.84.4` to `0.85.1`. In the
same release, update every upstream-backed bundled extension to the highest fetched stable tag:
pi-subagents `v0.64.0`→`v0.66.0`, pi-intercom `v0.12.1`→`v0.13.0`, pi-zentui
`v0.22.3`→`v0.23.0`, and pi-hermes-memory `v0.9.7`→`v0.9.8`; pi-rewind-hook `v1.8.6`,
pi-tool-display `v0.5.0`, and pi-web-agent `v1.10.0` are already current and remain source-intact.
All fork-owned deltas — including the vision captioning relay, terminal-capability settings,
capability-gateway wiring, extension-specific behavior, and rebranding (`Pi`→`Selesai`,
`.pi`→`.selesai` config paths) — are re-applied on top of the new bases and verified before the
fork is released as the next `0.13.x` version.

## User Stories

1. As a Selesai user, I want the coding-agent core synced to upstream v0.85.1, so that I receive
   six weeks of upstream bug fixes without re-deriving them by hand.
2. As a Selesai user, I want tools (`bash`, `edit`, `find`, `grep`, `ls`, `read`, `write`) to
   honor `ctx.cwd`, so that tools operate in the directory the session actually runs in.
3. As a Selesai user behind an HTTP proxy, I want plain-HTTP provider requests tunneled with
   CONNECT, so that requests no longer hang after a tool call.
4. As a Selesai user with only the Bash tool enabled, I want skills to remain available, so that
   my workflow automations keep working.
5. As a Selesai user, I want imported sessions to never overwrite an existing session with the
   same filename, so that I cannot lose work by re-importing.
6. As a Selesai user, I want session forks to preserve their compaction boundary, so that a
   forked session does not re-expand an already-compacted history.
7. As a Selesai user, I want concurrent session shares not to overwrite one another, so that
   sharing a session twice does not corrupt the first share.
8. As a Selesai user, I want EXIF orientation detection to scan past non-EXIF APP1 segments, so
   that images from cameras that embed other metadata still render upright.
9. As a Selesai user on a Linux musl system, I want managed `fd`/ripgrep downloads to use static
   musl builds, so that the managed search tools actually run.
10. As a Selesai user, I want the Grok Build 0.1 model removed from the built-in catalog, so that
    `/model` does not offer a model that always fails.
11. As a Selesai user on Qwen's token plan, I want the catalog to include Qwen3.8 Flash, so that
    I can select the newest plan model.
12. As a Selesai user with a GPT-6 Astra key or Codex subscription, I want the model available,
    so that I can use it without custom model definitions.
13. As a Selesai user on Anthropic, I want my per-turn thinking effort preserved across the
    turn and safely recovered from signed-thinking mismatches, so that reasoning quality settings
    survive provider retries.
14. As a Selesai user of GPT-5.6+ Responses models, I want long prompt-cache requests to use the
    correct cache TTL parameter, so that caching works as the provider expects.
15. As a Selesai user on Baseten, I want GLM-5.2 models to be text-only, so that image inputs do
    not produce silent provider errors.
16. As a Selesai user behind `NO_PROXY` rules, I want root-domain and subdomain matching to work,
    so that internal endpoints bypass the proxy correctly.
17. As a Selesai user, I want in-memory session forks before an active turn settles to be safe,
    so that rapid fork-then-prompt sequences don't corrupt state.
18. As a Selesai user, I want RPC `abort` to actually cancel an in-progress manual compaction, so
    that an aborted compaction doesn't keep burning tokens.
19. As a Selesai user, I want signal-killed subprocesses mapped to non-zero exit codes, so that
    cancelled tool calls surface as failures instead of silent success.
20. As a Selesai user, I want the branch summary output cap raised, so that long branch
    summaries are not truncated.
21. As a Selesai user, I want the write tool to stop reporting UTF-16 code-unit counts as byte
    counts, so that file size feedback is accurate.
22. As a Selesai user in the fullscreen TUI, I want a clickable "jump to latest message"
    indicator, so that I can return to the live transcript in one click.
23. As a Selesai user in the fullscreen TUI, I want Alt-modified wheel scrolling to scroll five
    times faster, so that I can traverse long transcripts quickly.
24. As a Selesai user in the fullscreen TUI, I want the working indicator embedded in the editor
    border, so that the spinner matches my thinking-level color and consumes less screen space.
25. As a Selesai user on a terminal with a slow host, I want fullscreen transcript search to
    scale linearly, so that searching a long session doesn't freeze the UI.
26. As a Selesai user, I want mouse hover to stop changing list selection, so that clicks always
    target the item I aimed at.
27. As a Selesai user, I want configurable save keybindings in the model and thinking selectors,
    so that my keymap preferences are respected.
28. As a Selesai user, I want terminal startup to survive restricted seccomp policies that reject
    the `SIGWINCH` self-signal, so that Selesai runs in hardened containers.
29. As a Selesai user on Zed terminal, I want image capability detection fixed, so that image
    display works where supported.
30. As a Selesai user, I want the SDK import failure from leaked experimental packages fixed, so
    that programmatic use of the package resolves cleanly.
31. As a Selesai maintainer, I want the upgrade anchored to immutable refs
    (`upstream/v0.84.4` → `upstream/v0.85.1`), so that the delta is reproducible and auditable.
32. As a Selesai maintainer, I want the fork's vision captioning relay re-applied intact on the
    new base, so that the flagship fork feature survives the sync.
33. As a Selesai maintainer, I want the documented 0.84.4 fork deltas in overlapping files
    preserved through the merge, so that no fork behavior silently regresses.
34. As a Selesai maintainer, I want the fork branding (`.pi`→`.selesai` config paths, `Pi`→`Selesai`
    user-facing strings, `PI_*`→`SELESAI_*` env names) re-applied after taking upstream code, so
    that no upstream path literal leaks into the fork's runtime.
35. As a Selesai maintainer, I want the config-dir leak audit grepped after the port, so that no
    upstream `".pi"` literal silently reads or writes the dead upstream directory.
36. As a Selesai maintainer, I want every upstream-backed bundled extension updated to its pinned
    latest stable tag and its Selesai deltas re-applied, so that the release does not combine a new
    host runtime with stale extension code.
37. As a Selesai maintainer, I want each upstream behavioral change classified as inherited
    (runtime package), ported (vendored source), or irrelevant, so that the merge is deliberate
    rather than best-effort.
38. As a Selesai maintainer, I want a build/typecheck/test validation gate after the port, so
    that breakage is caught before release rather than in daily use.
39. As a Selesai maintainer, I want the sync done as a reviewable working-tree operation (no
    history rewrite), so that rollback is `git checkout -- .` plus a clean stash.
40. As a Selesai maintainer, I want `selesai-in-doc/reapply.md` updated to name v0.85.1 as the
    new base, so that the next upgrade starts from accurate facts.

## Implementation Decisions

- **Anchor**: base `upstream/v0.84.4` = `b79e4cc834970cca69daebffab7df1da7d1e52c4` (2026-08-28,
  matches `selesai-in-doc/reapply.md` §0a and the `0.84.4` dependency pins in `package.json`);
  target `upstream/v0.85.1` = `d981de1229ef899957bbe968bc8dcda02a21f477` (2026-09-05). The delta is 134 upstream commits.
- **No git merge**: this fork shares no commit ancestry with upstream (history was re-rooted), so
  the sync is a **per-file 3-way port**: for each changed file under the vendored tree, merge
  `base=v0.84.4` / `ours=fork HEAD` / `theirs=v0.85.1`, then re-apply fork deltas per
  `selesai-in-doc/reapply.md`.
- **Scope of the vendored port** is the ~47 files under `src/` that upstream changed between the
  two tags and that exist in the fork, plus new upstream files (64 added under
  `packages/coding-agent/src`, ~52 under `packages/{ai,agent,tui}/src`), adapted to the fork's
  flattened layout (`src/` instead of `packages/coding-agent/src/`).
- **Runtime packages** `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`,
  `@earendil-works/pi-tui` bump `0.84.4` → `0.85.1` in `package.json` + lockfile. This
  automatically inherits the `packages/ai`, `packages/agent`, `packages/tui`, `packages/protocol`,
  `packages/telemetry` upstream deltas without vendoring them.
- **Re-apply checklist** (from `selesai-in-doc/reapply.md`, order preserved):
  1. Keep `src/core/vision-caption.ts` and `src/core/tools/read-vision.test.ts` (fork-only files).
  2. `settings-manager.ts`: `ImageSettings.imageCaptionModel`/`imageCaptionContextTokens`,
     `TerminalSettings.hyperlinks/images/trueColor`, `getTerminalCapabilityOverrides()`,
     `fullscreenCopyOnSelect`.
  3. `interactive-mode.ts`: caption relay wiring, `setCapabilityOverrides`, `copyOnSelect`,
     `handleCopyCommand(preferSelection)`, `updateThinkingBlockVisibility`, working-indicator and
     theme ordering, capability-gateway init.
  4. `settings-selector.ts`: `image-caption-*` items + `fullscreen-copy-on-select` item/callbacks.
  5. `models.json` / `model-registry-defaults.test.ts` / `status-indicator.ts`: tokenin + vision
     registry deltas.
  6. Branding pass over newly ported files: user-facing `Pi`→`Selesai`, `PI_*`→`SELESAI_*` env
     names, `.pi`→`.selesai` **config-path literals only** (never property access or the
     `.pi-subagents` project-artifact dir; keep bare `".pi"` values in sets like
     `DISCOVERY_PRUNED_DIR_NAMES`).
  7. Known upstream v0.85.0 change to watch: the working indicator moved into the editor border —
     this overlaps the fork's working-indicator restructuring in `interactive-mode.ts`/
     `custom-editor.ts`; reconcile deliberately, fork ordering wins only where the fork's
     capability-gateway/theme ordering depends on it.
- **Bundled-extension targets** are pinned to immutable refs: pi-subagents `v0.66.0`
  (`0fc0eebb9604970c506708b7508d6aa38921fde2`), pi-intercom `v0.13.0`
  (`199279ae861bf53ce014809fb2a03337538ae13e`), pi-zentui `v0.23.0`
  (`49dc724ce3f801dd243bb9dd420f3d3b90c3f13b`), and pi-hermes-memory `v0.9.8`
  (`34c6fe49f832e6a0957ce517586158a8bdde71a4`). Each uses a per-file 3-way merge from its recorded
  current base. pi-rewind-hook `v1.8.6`, pi-tool-display `v0.5.0`, and pi-web-agent `v1.10.0`
  already match their highest fetched stable tags, so they receive compatibility tests but no
  source replacement. Fork-native capability-gateway, grep-app, ponytail, and question have no
  upstream tree and remain source-intact.
- **No experimental/client SDK surface** is exposed by the fork's `src/index.ts`; the v0.85.1
  "source-only experimental exports" fix affects upstream packaging only and is classified
  inherited/irrelevant for the fork.
- **Config-dir leak audit** runs as the final port step (grep `".pi"` path literals in
  `src/**`, route any new leaks through the host resolvers, classify the known intentional ones:
  `package-manager.ts` upstream-host probing and the subagents prune-set value are deliberate).

## Testing Decisions

- **Good tests** assert external behavior (command output, session files, settings round-trip),
  never implementation internals.
- **Inherited runtime packages** (`pi-ai`, `pi-agent-core`, `pi-tui`): trusted upstream; their
  behavior is exercised through the app-level suite, not re-tested.
- **Ported coding-agent core**: run the fork's existing vitest suites
  (`npm run test`, `src/__tests__/`), which already cover model-registry defaults, CLI args, and
  extension behavior; add/adjust cases only where the ported surface changed (e.g. tool
  `ctx.cwd`, session import collision, compaction-boundary on fork).
- **Vision feature**: `src/core/tools/read-vision.test.ts` must pass unchanged against the new
  base (guards the caption relay integration points).
- **pi-subagents** (upgraded to v0.66.0): `npx tsc --noEmit`, `npm run test:unit`,
  `npm run test:integration`, plus the fork-fix coexistence tests named in
  `selesai-in-doc/pi-subagents-upgrade.md`. Require zero failures and measure the new pass totals;
  do not assert the obsolete v0.64.0 totals.
- **Other bundled extensions**: run pi-intercom tests, pi-zentui verification against its measured
  pre-upgrade baseline, pi-hermes-memory check/tests, pi-tool-display check, rewind tests, and the
  root Token-In/web-agent/onboarding tests. Include a packed-install/background-runner smoke for
  the subagents host-package resolution seam.
- **Prior art**: previous upstream syncs used the unlazy gates discipline; this upgrade follows
  the same pattern (a `GATES.md` per leaf with runnable checks), with `.unlazy/subagents-upgrade/`
  as the reference layout for a vendored-extension port and `selesai-in-doc/reapply.md` §7 for
  the app-level checks.

## Out of Scope

- Taking any upstream feature beyond v0.85.1, or cherry-picking from `upstream/main`.
- Migrating user config/data layout; `.pi`→`.selesai` remains a source-level branding concern.
- Changing the fork's release process (`chore(release)` flow, global-install layout).
- Any behavior change to the vision captioning relay beyond re-applying it to the new base.

## Further Notes

- The Pi delta between the fork's base and target is bounded (134 commits, ~47 overlapping files;
  every overlap was already fork-adapted). The riskiest core reconciliation is the
  working-indicator restructure against the fork's own interactive-mode/custom-editor changes.
  The riskiest extension reconciliation is pi-subagents v0.66.0's child-session/runner redesign;
  it must preserve Selesai host resolution, removed external CLI adapters, and fork-owned APIs.
- The `v0.85.1` SDK packaging fix (experimental exports becoming source-only) does not apply:
  the fork never exposed those entry points.
- After the sync, bump the fork version (`chore(release)` pattern → next `0.13.x`) and rebuild
  the global install per `selesai-in-doc/env-and-setup.md` (restart any running `selesai`
  process; watch the stale-global-build gotcha).