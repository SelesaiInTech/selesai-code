# PRD 4 — Interactive workspace sync

## Problem Statement

PRDs 1 to 3 put the fork on the new platform. The terminal workspace the user actually looks at is
still on the older surface.

Three consequences are visible to a user. First, an account whose model catalogue is discovered from
the network — a gateway or subscription provider — can fail to select a model immediately after
signing in, because the picker reads the catalogue before discovery has finished. Second, a
credential or catalogue refresh failure is silent, so a user sees an empty or stale model list with no
explanation. Third, the new platform behaviour — cache warming, prompt and tool changes mid-session,
the retry cap, per-model compaction budgets — has no setting, no diagnostics and no status surface, so
it exists but is invisible and untunable.

A fourth consequence is that a crash leaves nothing behind: the platform records crash data, but the
fork never surfaces it and offers no way to report a problem with the session's diagnostics attached.

## Solution

Adopt upstream's interactive changes that the user perceives — the model-catalogue refresh and
selection flow, the crash notice, the bug-report flow, the settings items for the new behaviour, the
cache-warming status and diagnostics, and the spinner placement and transcript toggles — while
preserving the fork's terminal additions: the capability overrides, the fullscreen copy-on-select
setting, the vision-caption settings and indicator, the startup box and the fork's status line.

At the end of this phase a Selesai user sees the model they expect immediately after signing in,
is told when a catalogue refresh fails, can report a crash with diagnostics, and can reach every new
behaviour from the terminal.

## User Stories

1. As a Selesai user signing in to a provider whose catalogue is discovered from the network, I want
   model selection to wait for discovery rather than failing prematurely, so that signing in actually
   leaves me on a working model.
2. As a Selesai user, I want a catalogue refresh that is slow or fails to tell me it used the cached
   models, so that I understand why my list looks the way it does.
3. As a Selesai user, I want a selection made while a refresh was running not to be overwritten by the
   refresh's result, so that my explicit choice wins.
4. As a Selesai user signing in to a gateway where the preferred model is unavailable, I want a
   sensible fallback within that provider, so that I am not left without a model.
5. As a Selesai user signing in to a local model runtime, I want guidance specific to that runtime when
   it reports no loaded models, so that I know what to do next.
6. As a Selesai user, I want the selected thinking level to default from my settings rather than from
   the previous session's transient state, so that a new session starts the way I configured it.
7. As a Selesai user, I want the available thinking levels to be the platform's declared set, so that
   a level the platform supports is not hidden by stale state.
8. As a Selesai user, I want a crash to be recorded and announced once on my next start, so that I
   know a previous session failed rather than silently vanished.
9. As a Selesai user, I want a crash to be attached to the next problem report I send, so that a
   report reflects the failure that actually happened.
10. As a Selesai user, I want to report a problem with a description, so that I do not have to
    reconstruct the environment by hand.
11. As a Selesai user, I want the report to bundle environment, model, provider, extension and
    settings metadata with secrets redacted, so that reporting does not leak credentials.
12. As a Selesai user, I want to optionally include the session transcript or a model-written summary
    instead, so that I choose how much of my conversation leaves my machine.
13. As a Selesai user, I want the report either uploaded or exported as an archive, so that I can
    report from an environment with no network.
14. As a Selesai user, I want a report identifier recorded in the session, so that I can reference it
    later.
15. As a Selesai user, I want unexplained errors and exhausted retries to point me at the reporting
    command once per session, so that I know the option exists without being nagged.
16. As a Selesai user, I want the report hint not to appear for my own cancellations or for retryable
    provider failures, so that a transient blip does not prompt me to file a report.
17. As a Selesai user pasting a multi-line diagnostic into a report description, I want the line
    breaks preserved, so that the report is readable.
18. As a Selesai user, I want a setting for cache warming with the modes off, while streaming, and
    while idle, so that I can bound the cost of keeping a prompt cache warm.
19. As a Selesai user, I want to see cache-warming usage and status, so that I can tell whether warming
    is doing anything and what it costs.
20. As a **Bundled extension** author, I want a decision event for cache warming, so that I can decline
    warming under a policy of my own without disabling the feature.
21. As a Selesai user, I want a visible notice when the prompt or tool set changes mid-session, so
    that I understand why the agent's behaviour changed.
22. As a Selesai user, I want to click a branch summary, a compaction summary or a skill invocation
    entry to toggle it, so that I can expand what I need without leaving the transcript.
23. As a Selesai user, I want the compaction, branch-summarization and retry progress rows embedded in
    the editor border alongside the working indicator, so that the status area does not jump around.
24. As a Selesai user with a custom editor, I want the same embedding behaviour available to me, so
    that a custom editor is not left with a standalone indicator.
25. As a Selesai user, I want a fullscreen footer that renders no rows to reserve no blank row, so that
    the layout is tight.
26. As a Selesai user, I want tree navigation and compaction not to fight over the progress display, so
    that navigating during a compaction does not leave a stuck indicator.
27. As a Selesai user, I want resuming a session to show results progressively, so that a large session
    list is usable before every transcript is read.
28. As a Selesai user, I want continuing the most recent session to be fast, so that starting work does
    not wait on scanning every session.
29. As a Selesai user, I want an exact session-id lookup to read session headers rather than whole
    transcripts, so that resuming by identifier is fast on a large history.
30. As a Selesai user pasting text with non-ASCII characters, I want the clipboards that decode bytes
    through a console code page to receive UTF-8 correctly, so that pasted text is not mangled.
31. As a Selesai user, I want clipboard copy to tell me when no backend worked and how to fix it, so
    that a silent failure does not waste my time.
32. As a Selesai user, I want a stale terminal image not to be replaced by an older partial tool output,
    so that what I see matches what the tool produced.
33. As a Selesai user, I want the skill slash-command autocomplete to rank the bare skill name, so that
    typing a skill name finds it.
34. As a Selesai user, I want file autocomplete boundaries and quoting to behave correctly around
    punctuation in non-Latin scripts, so that completing a path does not corrupt my input.
35. As a Selesai user, I want fuzzy search in long lists to stay responsive, so that browsing a large
    catalogue does not stall.
36. As a Selesai user, I want the fork's terminal capability overrides, fullscreen copy-on-select,
    startup box and status line to keep working, so that adopting upstream's workspace does not remove
    what makes this fork's terminal pleasant.
37. As a Selesai user, I want the fork's vision-caption setting and its captioning indicator to keep
    working, so that captioning an image with a vision model is still visible and configurable.
38. As a **Bundled extension** author whose extension patches the editor border, footer or working
    line, I want the compliance suite to catch an upstream layout change, so that a displaced patch is
    a failed check rather than a mystery rendering bug.
39. As a Selesai maintainer, I want an explicit decision recorded about whether the fork adopts Mermaid
    rendering, so that the port does not pull in an optional dependency by accident.
40. As a Selesai user, I want the new settings reachable from the settings surface, so that a feature
    with no setting is effectively absent.

## Implementation Decisions

**Model-catalogue refresh on sign-in.** Post-login selection becomes a deferred flow: selection is
attempted from the current snapshot, and if the preferred model for a provider is not yet present, the
flow refreshes that provider's catalogue with a bounded timeout, then completes selection only if the
session and model are unchanged since the flow began. Refresh failure or timeout is reported as a
warning stating that cached models are being used, and is not fatal. For a provider whose preferred
model is unavailable, a provider-scoped fallback is applied before the "model not available" error.
The fork keeps its fork-specific guidance for a provider that reports no usable models, and restores
the guidance helper it had removed for the local model runtime.

**Settings defaults.** The thinking level shown in a new session comes from settings rather than the
live session, and the selectable level set comes from the platform's declared set. This changes how
the settings surface reads its defaults and must be consistent between the settings item, the
thinking selector and the footer.

**Crash recording and reporting.** A crash log under the **Agent directory** records crashes, is
pruned, and is announced once on the next start. The next problem report attaches it. The report is a
first-class flow in the terminal: a command taking an optional description, bundling redacted
environment, model, provider, extension and settings metadata, assistant diagnostics, and optionally
the transcript or a model-written summary; uploaded when a gateway is reachable, exported as an
archive otherwise; with the report identifier recorded as a session entry. The hint that points at the
command appears at most once per session and is suppressed for user cancellations and for retryable
provider failures. Multi-line description input preserves line breaks.

**Cache warming surfaces.** A settings item for the warming mode, a status/usage readout, and the
extension decision event. The runtime collaborator surface is added in the session-runtime phase; this
phase owns the host wiring: constructing the warmer, mapping the extension decision event, and the
readouts.

**Mid-session change notice.** The prompt/tool-change message from the prompt phase is rendered as a
visible notice in the transcript.

**Transcript interaction.** Branch summaries, compaction summaries and skill invocations become
click-toggleable; progress rows for compaction, branch summarization and retry move into the editor
border alongside the working indicator, with the same embedding option exposed to custom editors;
a fullscreen footer rendering zero rows reserves no row; tree navigation no longer races compaction's
progress display.

**Session-picker performance.** Resume shows results progressively using modification times to
prioritize; continue stops after the newest matching session; exact session-id lookup reads headers
rather than transcript bodies.

**Clipboard correctness in the terminal layer.** The UTF-8-through-the-Windows-clipboard path, the
no-backend-worked diagnostic, the stale-image ordering fix, and the autocomplete ranking and boundary
fixes land here. The clipboard *implementation* replacement is a separate phase; this phase only takes
the interactive-layer corrections that do not depend on it.

**Vendored terminal extension compliance.** The fork's terminal extension patches the editor border,
status line and layout. Upstream changed the editor, footer, status-indicator and editor-border code,
so this phase must run the vendored terminal extension's compliance suite and treat a failure as a
blocking gate rather than a follow-up.

**Mermaid decision.** This phase decides explicitly whether the fork adopts Mermaid rendering. If
adopted, the rendering dependency and the settings item are added here; if not adopted, the ported
settings code must not reference the mode. Leaving it ambiguous is what caused the ported file to
reference a mode the fork does not have.

**Fork terminal surface preserved.** Capability overrides, fullscreen copy-on-select, the startup box,
the status line, the vision-caption settings items and the captioning indicator are preserved and
re-planted on the new interactive shapes. Their existing tests are the regression net.

**Not decided here.** Documentation-site and changelog updates are PRD 7. The clipboard backend
replacement is PRD 5.

## Testing Decisions

A good test in this phase drives the observable surface: given settings and a stubbed catalogue, what
model ends up selected; given a refresh failure, what warning is shown; given a crash record, what is
announced; given a report request, what is bundled and what is redacted. It does not assert on private
methods of the interactive class, on the internal step sequence of the refresh flow, or on the
rendering byte stream beyond the existing snapshot-style assertions the fork already uses.

**Highest seam: the interactive entry point with injected collaborators.** The fork already tests the
interactive mode this way. Cover: post-login selection defers until the catalogue resolves; a refresh
failure warns and keeps the cached selection; a selection made during the refresh is not overwritten;
and a cancellation does not produce a report hint.

**Second seam: settings surface → resolved values.** Assert that the thinking-level default comes from
settings, that the available levels are the platform set, that the new items are present and round-trip
through the callbacks, and that the fork's existing items are still present.

**Third seam: redaction.** A redaction test that asserts secrets absent from a generated report is a
security boundary and must exist; this is the one place where a narrow unit test is the right seam
because the behaviour is a pure transformation.

**Ported upstream suites.** Upstream ships tests for the bug report, the bug-report hint suppression,
the crash log, the cache warmer, the clipboard command helper, the clipboard image paths, the
interactive fullscreen/footer behaviour, the session-selector path handling and the settings manager's
compaction and cache-warming settings. Port them; they encode the contracts precisely against the
target version.

**Vendored extension compliance suites.** Run the terminal extension's compliance and
responsive-dependency suites and the subagent extension's smoke harness. These are the seams that
catch an upstream private-layout change displacing a vendored patch; a failure here is the intended
outcome of the phase, not an obstacle.

**Manual TUI smoke.** Some of this phase is only provable interactively: sign in and confirm the model
is selected; open the settings surface and confirm both new and fork-owned items; trigger a summary
and confirm the editor-border progress row; click a summary to toggle it; trigger a cache-warming
readout. Record the commands and observations in the gate evidence.

**Prior art in this codebase.** The interactive-mode suite is the model for the entry-point seam
(construct the mode with stubs, drive a flow, assert the calls). The settings-manager and registry
suites are the model for the settings and catalogue seams.

**Gate ledger.** One phase gate file: owners (the interactive mode and its components, the settings
manager and selector, the crash log and report modules, the cache-warmer wiring, the session picker,
the fork's interactive and settings tests, the ported upstream suites, the vendored extension suites,
the gate file), scope statement, and checks for typecheck, build, the focused test script, the ported
upstream suites, the vendored compliance suites, the redaction check, and the manual smoke record.

## Out of Scope

- Replacing the clipboard backend and removing the external native clipboard dependency (PRD 5).
- Prompt section content, session entry shapes and compaction budget resolution (PRD 2).
- The session runtime's loadout, abort-control and auth threading (PRD 3).
- The full fork re-plant sweep across every extension (PRD 6).
- Documentation site, changelog and versioning (PRD 7).
- Any change to the fork's bundled research, delegation, memory or context extensions beyond keeping
  them loading.

## Further Notes

The fork's terminal surface is a patch layer over the platform's editor, footer and status code. That
makes this phase the most likely place for a silent regression: upstream changed exactly those files,
and a patch that no longer applies can degrade to a misplaced element rather than an error. The
vendored compliance suite exists for this reason and should be run as a gate, not as a courtesy.

One fork-side behaviour worth an explicit check: the fork's editor-border and footer patches were laid
over the previous spinner placement. Upstream moved progress rows into the editor border. Where the
fork's patch and upstream's placement disagree, upstream's placement is the base and the fork's
visual intent is re-expressed on top of it, in the same style as the rest of the re-plant work.
