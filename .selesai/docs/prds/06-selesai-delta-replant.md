# PRD 6 — Selesai delta re-plant and regression sweep

## Problem Statement

PRDs 1 to 5 adopt upstream's code. Adoption is where this fork's value disappears quietly: when a
fork-owned behaviour and an upstream rewrite touch the same region, the resolution that makes the code
compile is usually upstream's shape, and the fork's behaviour has to be put back deliberately.

The fork owns a large amount of behaviour that lives inside upstream-origin files: its identity in the
assembled prompt, its skill and agent prompt sections, its capability gateway, its vision-caption
relay inside the read tool and the session runtime, its compaction-failure event, its automatic
handoff and length continuation, its terminal capability overrides, its TokenIn provider and model
catalogue, its RPC additions, and its extension-loader package aliasing, among others.

None of that is visible as a conflict after the port. It is a silent removal: the code compiles, the
tests the fork owns may still pass if they were not touched, and the behaviour is simply gone. The
maintenance record already warns about exactly this class of loss but only covers the vision feature.

## Solution

Treat the fork's delta as an explicit, enumerable inventory and re-plant it, then prove each item is
present by a check rather than by reading the diff. This phase is a sweep with a checklist, not a
feature phase: it changes nothing by design and exists to make "did we lose anything" answerable.

At the end of this phase every fork-owned behaviour is present on the new upstream base, every item has
a check that fails if it is removed, and the maintenance record states the new base and every delta the
next sync must preserve.

## User Stories

1. As a Selesai user, I want the agent to still identify itself as Selesai built on Pi rather than as
   Pi, so that the fork's identity survives a platform upgrade.
2. As a Selesai user, I want the prompt to still point at this repository's documentation rather than
   upstream's, so that the agent reads the right docs.
3. As a Selesai user, I want the available-agents section and the delegation-routing guideline to still
   be in the prompt, so that delegated work still routes the way this fork intends.
4. As a Selesai user, I want the available-skills section to still be in the prompt and to still reflect
   which file-reading tool is available, so that skill discovery is unchanged.
5. As a Selesai user, I want the capability gateway still to keep optional extension tools and skills
   out of the default model context while leaving them discoverable, so that prompt-cache stability and
   token economy are unchanged.
6. As a Selesai user, I want to be able to disable the capability gateway through its environment
   switch, so that the escape hatch is not lost either.
7. As a Selesai user whose main model cannot accept images, I want a configured vision model to caption
   pasted and read images, so that the fork's headline capability still works.
8. As a Selesai user, I want to configure the caption model and the caption context budget from the
   settings surface, so that the capability is tunable rather than fixed.
9. As a Selesai user, I want a visible indicator while an image is being captioned and a status when it
   fails, so that a blocking caption step does not look like a freeze.
10. As a Selesai user, I want the caption prompt to include the conversation tail and my current prompt,
    so that the description is relevant to what I asked.
11. As a **Bundled extension** author, I want to observe a compaction failure, so that fork-owned
    behaviour that reacts to a failed or cancelled compaction keeps working.
12. As a Selesai user, I want the automatic handoff to still fire above its threshold and to carry the
    overarching goal, so that a long session continues rather than ending.
13. As a Selesai user, I want a failed handoff to surface its error and retry on the next settled turn,
    so that a handoff failure is not reported as a cancellation.
14. As a Selesai user, I want a response truncated by the output-token limit to be continued
    automatically, so that a long answer is not silently cut in half.
15. As a Selesai user, I want the continuation to be bounded, so that a model that keeps hitting the cap
    does not loop forever.
16. As a Selesai user, I want context-pressure truncation to compact before continuing, so that
    continuation does not make an over-full context worse.
17. As a Selesai user, I want the terminal capability overrides for hyperlinks, images and true colour to
    still apply, so that my terminal renders correctly.
18. As a Selesai user, I want the fullscreen copy-on-select setting to still work, so that my terminal
    convenience is not lost.
19. As a Selesai user, I want the startup box and the fork's status line to still render, so that the
    fork's terminal identity is intact.
20. As a Selesai user, I want the TokenIn provider registration, multi-account failover and usage command
    to still work, so that my configured model access is unaffected by the port.
21. As a Selesai user, I want the bundled default model catalogue to still be the fork's catalogue, so
    that a fresh install offers the models this fork intends.
22. As a Selesai user, I want the programmatic interface's fork-added commands and options to still be
    present, so that a host integrating Selesai does not lose capability.
23. As a **Bundled extension** author, I want in-tree extensions that import the fork's package name,
    the upstream package name and the legacy names to all resolve, so that a port does not break
    extension loading.
24. As a Selesai user, I want the bundled research, delegation, memory, context, recovery and question
    extensions to still load and still behave, so that the fork's packaged experience is unchanged.
25. As a Selesai user, I want the fork's agent-directory layout — user and project directories — to still
    be the only place state is read from and written to, so that a port does not resurrect upstream
    paths.
26. As a Selesai user, I want the bundled memory extension to route through the host agent-directory
    resolver rather than an upstream environment variable, so that memory does not split across two
    directories.
27. As a Selesai user, I want the bundled terminal extension's patches to be re-applied on upstream's new
    editor and footer layout, so that the fork's terminal rendering is intact.
28. As a Selesai user, I want the bundled code-context extension's retrieval tools and lifecycle commands
    to still work, so that code context retrieval is unaffected.
29. As a Selesai user, I want the subagent extension's host-facing contract to still be satisfied, so
    that delegation, supervision and parallel work keep working.
30. As a Selesai user, I want the recovery extensions — rewind, undo and handoff — to still work, so that
    the fork's recovery story is intact.
31. As a Selesai user, I want the built-in skills to still be discovered and invocable, so that a port
    does not drop the packaged skill set.
32. As a Selesai maintainer, I want every fork-owned delta to have a check that fails if the behaviour is
    removed, so that "did we lose anything" stops being a reading exercise.
33. As a Selesai maintainer, I want a single inventory listing each delta, the upstream-origin file it
    lives in, why it matters on upgrade, and its check, so that the next sync is mechanical.
34. As a Selesai maintainer, I want the inventory to be the maintenance record's source of truth going
    forward, so that the next sync does not rediscover the same deltas.
35. As a Selesai maintainer, I want this phase to make no behavioural change by design, so that a
    regression found later can be attributed to the port rather than to the re-plant.
36. As a Selesai maintainer, I want a diff review pass over the ported overlapping files that looks for
    fork-owned lines that disappeared, so that the sweep is not only check-driven.
37. As a Selesai user, I want the fork's environment-variable prefixes and directory names to be the only
    ones in the shipped code, so that no upstream name leaks into user-facing configuration.
38. As a Selesai maintainer, I want a documented decision for every fork delta that was *dropped* rather
    than re-planted, so that a deliberate removal is distinguishable from an accidental loss.
39. As a Selesai maintainer, I want the vendored extension version table recorded as "already current",
    so that the next sync does not re-check versions unnecessarily.
40. As a Selesai user, I want all of the above to hold simultaneously with the ported upstream behaviour,
    so that adopting the platform did not cost me any fork capability.

## Implementation Decisions

**Inventory before edits.** The maintenance record gains a consolidated delta inventory, one row per
fork-owned behaviour, naming the upstream-origin file(s) it lives in, why an upgrade can lose it, the
observable behaviour, and the check that proves it survived. The existing record's vision-feature
section is folded into this inventory rather than kept beside it.

**Check per delta, not a reading.** Each inventory row gets a check: a test assertion where a test can
observe the behaviour, and a content or grep-based check where the behaviour is a constant, a string or
a registration. A check that only greps for a symbol is acceptable for identity and registration
behaviour but not for behavioural deltas, which get a test.

**Ordering.** Re-plant in dependency order: prompt content first (it is consumed by the prompt phase),
then the session-runtime deltas (consumed by the runtime phase), then the interactive deltas, then the
extension-level deltas. The vendored extension compatibility pass runs last, because it depends on the
final internal shapes.

**Dropped deltas are decisions.** Any fork delta found to be obsolete — superseded by upstream or made
unnecessary — is recorded as dropped with a one-line reason, in the same inventory, not deleted
silently. The known candidate for this is the fork's own module-alias map, superseded by upstream's
extracted map.

**No behavioural change by design.** This phase must not introduce new behaviour. If a delta needs new
behaviour to survive, that is a finding: either the delta is re-expressed in the ported code's own
idiom, or the finding is escalated rather than solved here.

**Agent-directory discipline.** Every path the port touched is checked against the fork's user and
project directories and the fork's environment-variable prefixes. A resurrected upstream path or
environment variable is a failure, not a cosmetic issue, because it splits user state.

**Vendored extensions.** Every vendored upstream-backed extension is already at its newest upstream tag,
so no version bump is performed. Instead each is exercised: its own focused suite where one exists, and
its load path otherwise. Where an extension patches upstream internals, an upstream layout change is
expected to fail its compliance suite; the failure is resolved as part of this phase.

## Testing Decisions

A good test for a fork delta asserts the *user-observable behaviour*: the prompt text an agent receives,
the event a fork-owned observer receives, the follow-up message queued after a truncation, the caption
text substituted for an image, the setting that round-trips, the directory that state is written to. It
does not assert that a particular fork-authored function still exists by name — that is what the
inventory's registration checks are for.

**Highest seam: end-to-end behavioural checks per delta.** For each behavioural delta, drive the
smallest flow that exhibits it and assert the outcome. Prefer the existing fork test for the behaviour
and extend it, so that the check and the feature stay together.

**Second seam: the full test script.** Run the repository's complete focused test script. This is the
phase's primary regression net, because it already enumerates the fork's own suites; a delta lost in the
port shows up as a failure in the suite that owns it.

**Third seam: content and registration checks.** For identity strings, documentation pointers,
environment switches, directory names, package aliasing and registration calls, add explicit checks
into the phase gate. They are cheap, they fail loudly when a line is lost, and they cover the deltas a
behavioural test cannot see.

**Fourth seam: vendored extension suites.** The terminal extension's compliance and
responsive-dependency suites, the memory extension's suites, and the subagent extension's smoke
harness. These are the seams that catch a vendored patch displaced by an upstream private-layout
change.

**Fifth seam: manual smoke per user-visible delta.** Caption a pasted image; trigger a handoff; trigger a
length continuation; render the terminal with hyperlinks and images enabled; run the model-access usage
command. Record each observation in the gate evidence.

**Prior art in this codebase.** The existing per-behaviour fork suites (handoff, length continuation,
skill block, prompt content, TokenIn onboarding, model-registry defaults, startup box) are the model:
each owns one fork behaviour, constructs its module with stubs, drives the trigger and asserts the
outcome. The inventory should map one-to-one onto these suites where they already exist, and add a suite
only where a delta has none.

**Gate ledger.** One phase gate file whose checks are derived from the inventory: a check per delta
group, the full test script, the build, the vendored extension suites, the agent-directory discipline
check, the registration/content checks, and the manual smoke records.

## Out of Scope

- Any new feature, any new setting, any behavioural improvement.
- Upgrading vendored extension versions; they are already current.
- Documentation-site content, changelog entries and versioning (PRD 7).
- Rewriting the fork's behaviour to match upstream's idiom where the behaviour itself is unchanged and
  already fits; that is opportunistic refactoring and is explicitly not this phase.

## Further Notes

The risk this phase exists to address is not a compile error or a failing test. It is a green build with
a missing behaviour. The fork's automatic handoff, compaction-failure event and prompt sections all sit
in regions upstream rewrote, and all three would compile away without a type error if the re-plant were
skipped.

The maintenance record is the durable artifact of this phase. A future sync should be able to take the
inventory and the gate file and reconcile the fork without re-deriving which behaviours are the fork's —
that derivation is the expensive part of every upstream sync, and it has been done twice already.
