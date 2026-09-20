# PRD 2 — Core prompt, session-format and compaction sync

## Problem Statement

After the platform floor of PRD 1 is in place, Selesai's system prompt is still a single assembled
string, its session files still describe a conversation without a durable record of *which*
instructions and *which* tools were in effect, and its compaction budgets are still one global
setting.

That has three user-visible consequences. A user who resumes a long session or navigates to another
branch of the session tree silently gets today's prompt and today's tool set applied to a
conversation that started under a different one. An extension that wants to change the prompt for one
turn can only append text, never replace the instruction, so a preset or a persona cannot actually
take effect. And a user whose model has a very large context window cannot express compaction
budgets per model, so a global setting that suits a small model wastes a large one.

Separately, upstream added a whole-prompt replacement escape hatch and a sectioned prompt model;
without adopting them, the fork's prompt-assembly code diverges further from upstream on every
release, which is exactly the maintenance burden this fork exists to avoid.

## Solution

Adopt upstream's sectioned system-prompt model, its transcript-backed record of prompt and tool
changes, its per-model compaction budgets, and its forced-prompt escape hatch — while preserving
every piece of Selesai's prompt content: the fork's identity, its skill and agent sections, its
delegation-routing guideline, and its documentation pointers.

At the end of this phase a Selesai user who resumes a session or walks the session tree sees the
instructions and tools that were actually in effect, an extension can replace the prompt for a turn,
and compaction budgets can be tuned per model.

## User Stories

1. As a Selesai user, I want a resumed session to keep the instructions and tool set it was running
   under, so that resuming does not silently change how the agent behaves.
2. As a Selesai user, I want navigating to an earlier branch of the session tree to restore that
   branch's instructions and tools, so that a branch stays reproducible.
3. As a Selesai user, I want my prompt cache to stay warm across resume and branch navigation, so
   that restoring instructions does not cost me the cached prefix.
4. As a **Bundled extension** author, I want to see the prompt as an ordered set of named sections
   rather than one opaque string, so that I can change one section without rebuilding the whole
   prompt.
5. As a **Bundled extension** author, I want each section to be individually replaceable, so that a
   preset or persona changes only the part it owns.
6. As a **Bundled extension** author, I want a whole-prompt replacement escape hatch for handlers
   that genuinely cannot work by section editing, so that I do not have to reconstruct the prompt
   string by string.
7. As a **Bundled extension** author, I want a forced prompt to be sent as the leading system prompt
   even on models that accept system messages mid-conversation, so that a forced prompt is never
   appended after the original as a patch.
8. As a **Bundled extension** author, I want the same normalized, complete options object my handler
   edits to be the object the prompt is built from, so that a field I set is not dropped by a later
   normalization step.
9. As a **Bundled extension** author, I want changes I make to the selected tool set in a prompt
   handler to be respected, so that a handler that activates a capability is not overwritten by the
   session's pre-handler tool list.
10. As a Selesai user, I want the model to be told when instructions or tools changed mid-session, so
    that it does not keep following an instruction that no longer applies.
11. As a Selesai user, I want session entries recording a prompt or tool change to survive resume, so
    that the record is durable rather than in-memory only.
12. As a Selesai user, I want a prompt-free session entry to still be readable, so that an entry
    written by an older Selesai or Pi version does not break session loading.
13. As a Selesai user, I want the Selesai identity and documentation pointers preserved in the
    assembled prompt, so that the agent still describes itself correctly and still finds this
    repository's docs.
14. As a Selesai user, I want the delegation-routing guideline and the available-agents section
    preserved, so that delegated work still routes the way this fork intends.
15. As a Selesai user, I want the available-skills section preserved, so that skill discovery is
    unchanged by the prompt rewrite.
16. As a Selesai user, I want the skill section to reflect whether a file-reading tool is actually
    available, so that a session with tools narrowed still gets usable skill instructions.
17. As a Selesai user whose shell tool is PowerShell rather than bash, I want the file-exploration
    guidance to mention the tool I actually have, so that the prompt is not telling me to use a tool
    I do not have.
18. As a Selesai user, I want both shell flavors to be named when both are available, so that the
    prompt is accurate rather than arbitrarily picking one.
19. As a Selesai user, I want compaction budgets configurable per model, so that a small-context and
    a large-context model can each be tuned without fighting over one setting.
20. As a Selesai user, I want a model with no override to fall back to the global compaction settings,
    so that adding one override does not require configuring every model.
21. As a Selesai user, I want the reserved and kept-recent token budgets to be independently
    settable per model, so that I can tune headroom and recency separately.
22. As a Selesai user, I want an unknown or unconfigured model to behave exactly as before, so that a
    typo in an override does not silently disable compaction.
23. As a Selesai user, I want a compaction boundary recorded in the session to carry the prompt and
    tool state of that boundary, so that what follows a compaction is coherent with what came before.
24. As a Selesai user, I want usage entries with a category recorded in the session, so that
    non-conversational model calls are accounted for rather than invisible.
25. As a Selesai maintainer, I want the fork's existing prompt test to be extended rather than
    replaced, so that the Selesai-specific prompt content stays pinned by a test.
26. As a Selesai maintainer, I want upstream's session-format and compaction behaviour validated by
    the ported upstream tests, so that adoption is proven rather than asserted.
27. As a Selesai maintainer, I want the interactive settings changes for the new compaction and
    prompt behaviour deferred to the interactive phase, so that this phase stays a pure core change.
28. As a Selesai user, I want extension resource discovery to still work through the existing
    discovery event, so that a dynamically discovered resource set is not lost in the port.
29. As a **Bundled extension** author, I want the resource-discovery event to also report what should
    be contributed, so that discovery can adjust the contributed set rather than only observe it.
30. As a Selesai user, I want the prompt sections to be tagged in a way the model can match to a
    later update, so that a mid-session change is understood as a change to that section.

## Implementation Decisions

**Prompt model.** The prompt becomes an ordered map of named sections rather than one string. A
preamble is untagged free text; every other section is wrapped in a tag matching its section name so
the model can match a later update to the section it updates. Section names are validated against a
restricted lowercase identifier shape, so an invalid name is rejected rather than producing a
malformed prompt. The prompt-building module exposes three things: a normalizer that turns partial
input into the complete, mutable options object handlers receive; a section builder that returns the
ordered sections; and a state builder that returns either a forced prompt with no sections, or empty
content with the built sections. The distinction between "content" and "sections" is the contract
that lets a forced prompt be carried as opaque text.

**Handler-facing options.** Handlers receive the normalized options object and their edits are the
input to the final build, so a field set by a handler cannot be discarded by a re-normalization.
When a handler changes the selected tool set, that change wins over the session's pre-handler list.

**Fork prompt content.** The fork re-plants, inside the new section builder: the fork identity
preamble (the fork describes itself as Selesai built on Pi rather than as Pi), the documentation
pointer section with this repository's documentation locations, the skill section with its
file-reading-tool awareness, the agent section rendered only when a file-reading tool is available,
and the delegation-routing guideline as a prompt guideline. The fork keeps its existing practice of
rendering active-tool guidelines inside a clearly delimited appended section for custom-prompt
sessions.

**Shell guidance.** The file-exploration guidance becomes shell-aware: it names bash, PowerShell, or
both, according to which shell tools are actually selected, and keeps the existing behaviour of only
emitting the guidance when no dedicated search or listing tool is available.

**Session format.** Session files gain a system-message entry type carrying the complete prompt and
tool state at a boundary, and the per-entry context converter must tolerate a system entry whose
content is absent by treating it as empty rather than failing. The session version constant is
unchanged by upstream at this release, so no migration step is added; the converter's tolerance is
what keeps older entries readable.

**Compaction budgets.** The compaction settings accessor takes an optional model identity and
resolves an override for that model before falling back to the global settings. The override may set
the reserve budget, the kept-recent budget, or both, independently. The settings schema must accept
the override map and must ignore an override for a model that is not present rather than erroring.

**The settings module is resolved once, here.** The settings module is a conflict file in this port,
and it is resolved to upstream's complete accessor surface in this phase rather than re-opened by a
later one. That means, in addition to the compaction budget accessors above: the agent-level retry
settings accessor (enabled, maximum retries, base delay, maximum agent delay), the pre-existing
provider retry accessor left as-is, the HTTP idle timeout accessor, the web-socket connect timeout
accessor, and the cache-warming mode getter and setter together with the cache-warming mode type and
its allowed values. Two accessors describe retries and must stay distinct: the agent-level one is new
and carries the maximum agent delay, the provider one is pre-existing and describes transport
retries.

This phase also adds the cache-warming settings *item* to the settings surface only if doing so is
required to keep the accessor and the type honest; the selector, the status readout and the usage
display for cache warming belong to the interactive phase. Whether the item is added here or there,
the accessors and the type are this phase's deliverable, because a later phase that reopens this file
would re-resolve the same conflict hunks.

**Usage accounting.** A usage entry type with a category is added to the session entry union so that
categorized non-conversational calls are recorded. Its consumer — the cache-warming feature — arrives
in the interactive phase; this phase guarantees the entry shape, its context conversion, and the
cache-warming settings the consumer reads.

**Resource discovery.** The discovery event gains a result carrying what should be contributed, so a
handler can adjust rather than only observe. The fork's existing dynamic-resources extension keeps
working because the no-result case remains a no-op.

**Not decided here.** Whether the fork exposes the new per-model compaction budgets as an interactive
setting is deferred to the interactive phase. Whether usage entries are surfaced anywhere in the
terminal UI is deferred to the same phase.

## Testing Decisions

A good test in this phase asserts the *prompt a model would receive* and the *context a resumed
session would rebuild* — not the internal helper that produced them. Concretely: build a prompt from
given options and assert the presence, order and tags of sections, the fork identity, and the
tool-dependent guidance; and round-trip a session's entries through the context builder and assert the
resulting message sequence. Tests must not assert on private field names or on the internal ordering
of upstream's helpers.

**Highest seam: prompt build input → assembled prompt output.** The fork already has a prompt test at
that seam; extend it with the Selesai-content assertions and the section-tag assertions. This is the
right seam because a section model's whole purpose is that an external caller can address a section
by name, so the observable contract *is* the section set.

**Second seam: session entries → rebuilt context.** Feed entries including a system entry, a
compaction boundary carrying a system message, a usage entry, and a system entry with absent content;
assert the rebuilt message sequence. This proves resume, branch navigation and backward tolerance in
one test.

**Third seam: settings input → resolved compaction budgets.** For a model with an override, assert the
override wins; for a model without, assert the global settings are used; for an unknown model, assert
no error.

**Ported upstream suites.** Upstream ships tests for the prompt-state builder, the system-prompt
update path, per-model compaction settings, and usage-entry conversion. Port them and keep their
assertions; they are written against the target version and encode the contract more precisely than a
rewritten test would.

**Prior art in this codebase.** The existing prompt test and the settings-manager test are the model
to follow: construct options inline, call the module, assert the returned string or resolved object,
with no network and no session files on disk. The test environment is offline by default.

**Interactive-behaviour tests are not written here.** Anything that requires a terminal, a selector
or a running session belongs to the interactive phase's suites.

**Gate ledger.** One phase gate file: owner list (the prompt module, the session manager, the
compaction settings surface, the fork's prompt test, the ported prompt/session tests, the gate file),
scope statement, and checks for typecheck, build, the focused test script, the ported upstream
suites, and specifically a check that the Selesai identity string, the delegation-routing guideline
and the agent section still appear in the assembled prompt.

## Out of Scope

- Any change to the session runtime's request flow, retry policy or auth threading (PRD 3).
- Any interactive settings item, selector, indicator or status line for the new behaviour (PRD 4).
- The cache-warming consumer of the usage entry, and the extension decision event that gates it.
- Adopting Mermaid rendering sections, if any, into the prompt.
- Changing the session version or adding a migration.
- Reworking TokenIn or any model catalogue content.
- Documentation-site and changelog updates (PRD 7).

## Further Notes

The conflict geometry for this phase is known: the session runtime and the system-prompt module
carry the largest share of the port's conflict hunks, and the system-prompt module is upstream's
largest single rewrite in this release at roughly 280 changed lines. That is why the prompt model is
its own phase rather than folded into the runtime phase: it can be landed, typechecked and verified
while the runtime is still on the old shape, because the runtime consumes the prompt module through a
small number of call sites.

The fork's existing maintenance note already lists which of these regions carry fork-owned deltas and
must be preserved; that note is the input for the re-plant work in PRD 6 and should be read before
touching the session runtime in PRD 3, not after.
