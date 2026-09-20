# PRD 5 — Clipboard replacement

## Problem Statement

Selesai reads and writes the system clipboard — for image paste in the prompt, and for the copy
commands in the terminal — through an external native clipboard package declared as an optional
dependency.

That dependency brings three problems. It ships a per-platform native binary, so an install on an
unsupported platform silently loses clipboard support entirely. It is an extra third-party native
artifact in the install path of a tool that runs with the user's full permissions, which is the
supply-chain surface this fork explicitly tries to reduce. And the platform now ships its own bundled
asynchronous clipboard helpers for the three desktop platforms with platform-command and OSC 52
fallbacks, so the external package is redundant.

Two correctness gaps also exist in the fork's current path, independent of the package: text written
through a Windows-side clipboard from a Linux environment is decoded through a console code page and
mangles non-ASCII text, and an environment with no usable display silently reports a successful copy.

## Solution

Retire the external native clipboard dependency and adopt the platform's bundled clipboard helpers and
platform-command fallbacks. Take upstream's clipboard utilities wholesale rather than merging them,
because upstream's rewrite already includes the Linux display handling, the Windows-subsystem-for-Linux
interop path, the OSC 52 fallback and the UTF-8-correct Windows write.

At the end of this phase a Selesai user can paste an image and copy text on macOS, Linux, Windows and
the Windows subsystem for Linux, gets a correct error when no clipboard backend works, and installs a
package with one fewer native third-party artifact.

## User Stories

1. As a Selesai user on macOS, I want image paste and text copy to work without an extra native
   package, so that the install has fewer moving parts.
2. As a Selesai user on Linux with a display server, I want clipboard access to work through the
   display tooling that is present, so that I do not need to know which of several tools to install.
3. As a Selesai user on Linux without a display, I want the terminal's own clipboard escape sequence to
   be used as a fallback, so that copy still works in a container or over a bare terminal.
4. As a Selesai user on Linux without a display and without a terminal that supports the escape
   sequence, I want to be told that no clipboard backend worked, so that a silent failure does not look
   like a successful copy.
5. As a Selesai user on Linux, I want the setup guidance for a missing clipboard backend when none is
   available, so that I can fix it.
6. As a Selesai user under the Windows subsystem for Linux without a graphical session, I want text to
   be copied to the Windows clipboard, so that I can paste into Windows applications.
7. As a Selesai user under the Windows subsystem for Linux, I want non-ASCII text to survive the copy,
   so that pasting does not mangle accented or non-Latin characters.
8. As a Selesai user under the Windows subsystem for Linux, I want image paste to work by reading the
   Windows clipboard through its own tooling, so that pasting a screenshot works the same as on
   Windows.
9. As a Selesai user on Windows, I want a native clipboard path rather than shelling out to a scripting
   host, so that copy and paste are fast.
10. As a Selesai user in a terminal that supports only text, I want to be told that images are not
    available rather than getting a broken paste, so that the failure is understandable.
11. As a Selesai user, I want the platform's bundled clipboard helper to be used when it is available
    and the platform commands to be used when it is not, so that clipboard support degrades rather than
    disappearing.
12. As a Selesai user, I want a clipboard failure to be surfaced to the terminal rather than swallowed,
    so that I can act on it.
13. As a Selesai user, I want the paste flow to distinguish "no image on the clipboard" from "clipboard
    access is unavailable", so that the two are not reported identically.
14. As a Selesai user, I want the Windows-subsystem path to not leave temporary files behind, so that
    repeated use does not litter my disk.
15. As a Selesai user, I want the temporary file used for the Windows-subsystem path to be restricted to
    my user, so that clipboard content is not world-readable while it is on disk.
16. As a Selesai user, I want a paste that produces an image whose format is not natively displayable to
    be converted, so that the image is not rejected.
17. As a Selesai maintainer, I want the external native clipboard package removed from the package's
    dependency declarations, so that a fresh install does not fetch it.
18. As a Selesai maintainer, I want the fork's clipboard utility files replaced rather than merged, so
    that the port does not carry two implementations of the same platform logic.
19. As a Selesai maintainer, I want a check that the removed module and dependency are gone, so that a
    partially completed removal cannot ship.
20. As a Selesai maintainer, I want the platform's clipboard suites ported as the proof, so that the
    replacement is validated by upstream's own tests rather than only by a manual paste.
21. As a Selesai maintainer, I want the image-resize and image-conversion paths to keep working through
    the clipboard change, so that the fork's image handling does not regress.
22. As a Selesai user, I want clipboard behaviour to be identical whether I run the published package or
    from a source checkout, so that development and use match.
23. As a Selesai maintainer, I want the vendored extensions that declare their own clipboard dependency
    left alone, so that this phase does not reach into vendored package manifests.
24. As a Selesai user, I want the copy-on-select and copy-command behaviours of this fork's terminal to
    keep working through the replacement, so that the fork's terminal conveniences survive.
25. As a Selesai maintainer, I want this phase to land independently of the interactive phase, so that a
    clipboard regression can be bisected without unpicking terminal changes.

## Implementation Decisions

**Replace, do not merge.** The fork's clipboard utility and clipboard-image utility are replaced by
upstream's versions rather than three-way reconciled. Upstream's rewrite already contains the Linux
display handling, the Windows-subsystem interop path, the OSC 52 fallback, the UTF-8-correct Windows
write, and the empty-versus-unavailable distinction. The fork's two small deltas on these files are
re-expressed on top of the replacement if they are still meaningful, and dropped with a note if they
are superseded.

**One command runner.** All platform clipboard commands go through a single asynchronous command
runner with a timeout, rather than each call site spawning synchronously. That is what makes the
platform commands awaitable and the timeouts uniform.

**Native helper.** The platform's bundled clipboard helper is the preferred native path. Platform
commands and the terminal escape sequence remain as fallbacks so that a platform without a bundled
helper still has a path.

**Windows-subsystem path.** Text is written to a user-restricted temporary file and read from that
file by the Windows-side shell, because piping bytes through the Windows console code page corrupts
non-ASCII text. The temporary file is removed in all cases, including failure, and the path is
converted to a Windows path before use. Images use the same temporary-file technique with an image
path conversion, and the image read path preserves the distinction between an empty clipboard and an
unavailable clipboard.

**Dependency removal.** The optional native clipboard dependency is removed from the package manifest.
The platform's own clipboard helper is not added as a new direct dependency; it arrives with the
terminal library the fork already depends in.

**Untouched.** Vendored extensions that declare their own clipboard dependency in their own manifests
and lockfiles are not modified by this phase.

**Not decided here.** Whether any clipboard-related interactive setting changes (for example a copy on
select default) is decided in the interactive phase; this phase only guarantees the underlying
behaviour.

## Testing Decisions

A good test here asserts the *observable outcome of a clipboard operation*: which command or helper was
invoked for a given platform and environment, what was written to it, whether a temporary file was
cleaned up, and what the caller sees when no backend is available. It does not assert on module-private
helper names or on the exact argument order beyond what identifies the operation.

**Highest seam: the clipboard operation with a stubbed command runner and stubbed platform.** The
platform suites already work this way — inject the runner, present a platform and environment, assert
the invocation and the result. Cover: a Linux display session routes to the display tools; a Linux
session without a display routes to the fallback; a session where nothing works returns the
unavailable outcome rather than a success; and the Windows-subsystem text path writes UTF-8 to a
user-restricted temporary file and removes it.

**Second seam: image paste resolution.** Present each of the clipboard image states — image present,
clipboard empty, clipboard unavailable — and assert the three are distinguished, and that a
non-natively-displayable format is converted. The platform suites already cover this shape.

**Third seam: removal verification.** A check that the deleted utility module is absent, that no source
file imports it, and that the optional dependency is absent from the package manifest. This is a
negative check, not a behavioural test, and it is the check that catches a half-finished removal.

**Ported upstream suites.** Upstream ships tests for the clipboard command runner, the clipboard
utility across platforms, the clipboard image paths including the Windows-subsystem path and the
conversion case, and the no-backend diagnostic. Port them and keep their assertions.

**Manual smoke.** Paste an image into the prompt and copy a multi-line text selection in the terminal.
This is the only place the real native path is exercised, so record it in the gate evidence for at
least the platform this fork is developed on.

**Prior art in this codebase.** The existing clipboard-related tests in the repository are the model:
stub the process-spawning seam, present a platform, assert the invocation. There is no network and no
real clipboard access in the test environment.

**Gate ledger.** One phase gate file: owners (both clipboard utilities, the platform command runner,
the package manifest, the ported upstream clipboard suites, the removal check, the gate file), scope
statement, and checks for typecheck, build, the focused test script, the ported suites, the removal
check, and the manual smoke record.

## Out of Scope

- Terminal-layer clipboard presentation: the status/notification surface for a failed copy, the
  copy-on-select setting, and the stale-image ordering fix belong to the interactive phase.
- Any change to vendored extensions, including their own clipboard dependencies and lockfiles.
- Image resizing, image re-encoding and the vision-captioning path beyond keeping them working.
- Documentation-site and changelog updates (PRD 7).

## Further Notes

This phase is deliberately separable: it touches utility modules and one manifest entry, and the only
interaction with the rest of the port is that the interactive phase's clipboard presentation fixes
assume the new utilities exist. Landing it before the fork re-plant sweep means a clipboard problem is
bisectable on its own.

The UTF-8 Windows-subsystem fix is a user-visible bug fix, not just a dependency change, and belongs in
the user-facing changelog on its own line.
