# PRD 7 — Verification, documentation and release

## Problem Statement

The port is complete and the fork's behaviour is back in place, but nothing about it is proven,
described or releasable. A reviewer cannot see what the upgrade changed for a user; a user cannot read
what changed; the documentation site still describes the previous platform; and the maintenance record
still states the old upstream base, so the next sync starts from a false position.

An unverified port is also a risk in the other direction: the port is a large diff by construction, and
without a recorded gate a maintainer cannot tell a later regression from a port defect.

## Solution

Close the port with a recorded gate, user-facing documentation, a maintenance record that states the new
base and the delta inventory, and a release.

At the end of this phase the fork is at the new upstream base, a reader can see what changed, every
claim in the port has captured evidence, and the published package reflects all of it.

## User Stories

1. As a Selesai user, I want a changelog entry describing what changed for me, so that I know what I got
   and what I need to review.
2. As a Selesai user, I want the changelog to separate adopted upstream behaviour from fork bug fixes, so
   that I can tell which changes are the platform's and which are this fork's.
3. As a Selesai user, I want a removed dependency called out, so that I understand why an install is
   smaller.
4. As a Selesai user, I want a fixed bug called out on its own line, so that I know a behaviour I may have
   worked around is now correct.
5. As a Selesai user, I want the platform base version named in the release notes, so that I know which
   upstream release this fork is on.
6. As a Selesai user reading the documentation site, I want the platform base version stated, so that the
   docs match the release.
7. As a Selesai user, I want any newly user-visible setting documented in both languages the site ships,
   so that I can find it in the language I read.
8. As a Selesai user, I want the settings reference to include the new settings with their accepted
   values and defaults, so that I can change them without reading source.
9. As a Selesai user, I want the capability documentation to stay accurate where a capability's behaviour
   changed, so that the docs do not describe the previous behaviour.
10. As a Selesai user, I want the extension reference matrix to stay consistent with the bundled extension
    set, so that the docs do not list an extension that is not shipped.
11. As a Selesai contributor, I want the documentation content validation and link checks to pass, so that
    a broken page is caught before publish.
12. As a Selesai maintainer, I want the maintenance record to state the new upstream base commit and date,
    so that the next sync measures its delta from the right point.
13. As a Selesai maintainer, I want the maintenance record's re-apply guide to reflect the new file layout
    and the new delta inventory, so that the next sync is mechanical rather than archaeological.
14. As a Selesai maintainer, I want every phase's gate file to remain in the repository, so that the
    evidence for each claim is inspectable after the fact.
15. As a Selesai maintainer, I want one consolidated release gate that references the phase gates, so that
    the release decision is auditable without reading seven files.
16. As a Selesai maintainer, I want the full test script to pass on the released tree, so that the release
    is not cut from a partially verified state.
17. As a Selesai maintainer, I want the build to pass and the built CLI to report its version, so that the
    packaged artifact is verified rather than assumed.
18. As a Selesai maintainer, I want the published package's file set to include the bundled extensions,
    skills, themes and defaults, so that an installed CLI behaves like a source checkout.
19. As a Selesai user installing the published package, I want a global install to start and to load its
    bundled extensions, so that the release is actually usable.
20. As a Selesai maintainer, I want the version bump to follow the project's convention for a sync
    release, so that the release is distinguishable from a feature release.
21. As a Selesai maintainer, I want a tagged release and a published package, so that the release is
    consumable.
22. As a Selesai maintainer, I want a dry-run publish that shows the artifact contents before the real
    publish, so that a packaging mistake is caught before it is public.
23. As a Selesai maintainer, I want the release verified from a clean install rather than from the
    development tree, so that a missing runtime dependency is caught.
24. As a Selesai maintainer, I want any check that could not be automated recorded as an explicit manual
    observation with its command and result, so that "we tested it" means something specific.
25. As a Selesai maintainer, I want a stated rollback position — the tag and the backup branch to return
    to — so that a defective release can be reverted without forensics.
26. As a Selesai maintainer, I want a note about which phases produced the largest diffs, so that a
    bisect is directed rather than brute-force.
27. As a Selesai user, I want the security guidance to remain accurate after a dependency removal, so that
    the documented supply-chain posture matches reality.
28. As a Selesai maintainer, I want the vendored extension versions recorded as current at this base, so
    that the next sync knows no extension work is pending.
29. As a Selesai maintainer, I want the next sync's open questions recorded, so that a deferred decision is
    not silently dropped.
30. As a Selesai user, I want this release to be a platform sync and not a behaviour redesign, so that
    upgrading is low-risk.

## Implementation Decisions

**Version and release shape.** The release is a sync release. The version follows the fork's existing
convention for a sync of this size. The release notes name the upstream base version explicitly and group
changes into adopted upstream behaviour, fork bug fixes, dependency removals and any user-visible
behaviour change.

**Gate consolidation.** Each phase already wrote its own gate file. The release adds one consolidated
gate that lists the phase gates and the release-level checks (full test script, build, version output,
clean-install smoke, packaging contents, documentation verification), each with a command, an expected
marker and captured evidence. A release is cut only when the consolidated gate is fully green.

**Manual checks are recorded, not implied.** The interactive smoke, the paste smoke, and the
clean-install smoke are recorded with the exact command and the observed result, in the gate file, not
summarised as "tested".

**Maintenance record.** The re-apply guide's stated upstream base commit and date are updated, its
file-layout references are corrected to the post-port layout, and its delta list is replaced by the
inventory produced in the re-plant phase. The guide becomes the input for the next sync; the open
questions deferred during this port are recorded at its end.

**Documentation.** The bilingual documentation site is updated for the platform base, for any newly
user-visible setting or behaviour, and for the extension reference matrix. The content validation and
link checks are part of the gate, because the fork's contributing guide requires the documentation to be
updated when a public capability or setting changes. The security documentation is reviewed against the
dependency removal.

**Packaging verification.** Verify the published file set contains the bundled extensions, skills,
themes and default configuration, and verify a clean install outside the development tree starts and
loads its bundled extensions. Both are release-level checks because both are the failure modes a source
checkout cannot reveal.

**Rollback position.** Record the tag and the pre-sync backup branch as the rollback target, and record
which phases produced the largest diffs so that a bisect has a starting hypothesis.

## Testing Decisions

A good release check asserts an *externally observable* property of the released artifact: the built CLI
reports the expected version, a clean install starts and loads its bundled extensions, the package
contents include the expected directories, the test script passes, the documentation validates and its
links resolve. It does not assert on the repository's working state or on internal release tooling.

**Highest seam: the release gate ledger.** One file, one numbered check per release claim, each with the
command, the expected marker and captured evidence. This is the artifact that makes "verified" a claim a
reader can check.

**Second seam: clean-install smoke.** Install the produced package outside the development tree, start
it, and confirm the bundled extensions load and the version matches. This is the seam that catches a
runtime dependency that exists in the development tree but not in the package manifest.

**Third seam: documentation verification.** Run the documentation site's content validation and built-link
checks. Treat both as required, because the site ships in two languages and a one-language update is a
common failure.

**Fourth seam: the full test script.** Run it on the release tree, unmodified. If a phase's change made it
necessary to alter an existing assertion, that alteration must be visible in the gate evidence rather
than folded into the port diff.

**Prior art in this codebase.** The existing gate files are the model: a scope statement, an owner list,
and one numbered check per claim with its command, expected marker and captured evidence, including the
exit code, working directory and an output digest. Follow that format exactly so the release gate is
readable beside the phase gates.

## Out of Scope

- Any code change beyond what a failing release check requires. A release phase that starts fixing things
  is a signal that an earlier phase was not finished; the fix belongs in that phase's gate.
- Upgrading vendored extensions; they are already at the newest upstream tags.
- Adopting upstream's `main` branch beyond the release tag.
- Rewriting the fork's documentation beyond the pages the port actually invalidates.
- Any change to the fork's public capability set introduced by this port that was not already landed in
  phases 1 to 6.

## Further Notes

The release is the point at which the port becomes irreversible in practice, because users install it and
report against it. The consolidated gate is the only cheap defence: the port is a large diff across a
session runtime, a prompt builder, a terminal workspace and a clipboard layer, and the failure modes it
hides are the silent kind — a fork behaviour that compiled away, or a runtime dependency that existed
only in the development tree.

Open questions deliberately deferred during this port and to be recorded rather than dropped: whether the
fork adopts Mermaid rendering and its optional dependency; whether the newly added usage entries are
surfaced anywhere in the terminal; and whether the platform's new prompt-section model should be exposed
to skill and prompt-template authors as a documented extension point.
