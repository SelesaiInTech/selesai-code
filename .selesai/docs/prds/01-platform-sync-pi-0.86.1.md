# PRD 1 — Platform sync to Pi 0.86.1

## Problem Statement

Selesai is a maintained fork of the Pi coding agent. Its session runtime, model integration and
terminal UI are built on three upstream runtime packages pinned to an exact version, plus a
flattened in-tree copy of upstream's coding-agent source. Upstream has released v0.86.0 and v0.86.1,
which include a package-wide breaking change to the custom-provider streaming contract plus several
smaller contract changes.

A maintainer cannot simply merge: the fork and upstream share no common commit, so no merge base
exists and `git merge` is unusable. A user cannot simply upgrade the pins either, because the
vendored source is written against the older contract and would fail to typecheck.

The result today is that a Selesai user is stuck on the older platform: they do not get upstream's
provider and transport fixes, and every future sync gets more expensive the longer it is deferred.

## Solution

Bring the platform to Pi 0.86.1 in ordered phases. **This first phase** is the platform floor: move
the dependency pins, land the changes that are shaped by the new platform's contracts, and port the
upstream files the fork has never modified. It deliberately stops before any prompt, session or
terminal-UI semantics change, so that later phases have a compiling, testable base to build on.

At the end of this phase a Selesai maintainer can run the existing test script and build the CLI
against Pi 0.86.1, and a user gets the platform's transport, retry and provider behaviour with no
change to how they use Selesai.

The provider contract change is the phase's only genuinely invasive item, and it is smaller than it
first reads. The platform normalizes the request context internally at its public streaming entry
points, so the branded transcript only appears at the boundary where a provider is called; the fork's
own provider code never reads the request context at all. This phase therefore treats the contract
change as a boundary adjustment — signature and type identity at a handful of forwarding sites —
rather than a request-building migration, and it settles explicitly which provider layers stay in
core and which are already extensions.

## User Stories

1. As a Selesai maintainer, I want the three runtime packages pinned to the new upstream release
   exactly, so that the fork's platform version is unambiguous and a stray caret cannot drift it.
2. As a Selesai maintainer, I want the port to land in phases with a green typecheck at each
   boundary, so that a partially completed upgrade is never left in a state that cannot build.
3. As a Selesai maintainer, I want upstream files the fork has never touched to be taken verbatim
   before any fork-owned file is reconciled, so that conflicts stay limited to the files that
   genuinely conflict.
4. As a Selesai user, I want the `selesai` command, its flags and its configuration surface to be
   unchanged by this phase, so that a platform upgrade costs me no relearning.
5. As a Selesai user, I want my installed **Bundled extensions** to keep loading in the compiled
   binary distribution, so that a module-resolution change made for the platform does not silently
   break extension **Extension loading**.
6. As a Selesai user, I want extensions that import either the upstream package name or this fork's
   package name to resolve, so that third-party Pi extensions and in-tree Selesai **Extensions**
   both keep working.
7. As a **Bundled extension** author, I want to import the platform's AI and TUI packages by their
   documented names without registering them anywhere, so that extension source stays portable.
8. As a Selesai user, I want built-in tools to prefer strict JSON-schema sampling by default, so
   that tool calls are more reliably well-formed without me setting an environment variable.
9. As a Selesai user, I want the default active tool set to include the search and listing tools,
   so that a fresh session can explore a repository without me enabling tools manually.
10. As a Selesai user, I want the search and listing tools to still be individually disableable, so
    that the widened default does not remove my ability to narrow the set.
11. As a **Bundled extension** author, I want to be able to opt a tool out of strict sampling, so
    that a tool whose schema is not expressible in strict JSON schema still registers.
12. As a Selesai user, I want my shell-hook **Extensions** to keep working, and to fail loudly
    rather than silently when a shell hook returns something malformed, so that an intercepted
    command never executes in a half-handled state.
13. As a **Bundled extension** author, I want an event subscription to hand me a way to unsubscribe,
    so that a reload or a session replacement does not leave a stale handler behind.
14. As a **Bundled extension** author, I want tool-call arguments and tool-result details restricted
    to JSON-compatible values, so that a value I pass is guaranteed to survive session persistence.
15. As a **Bundled extension** author writing a custom provider, I want one documented way to read
    the prompt and the tool declarations — from the normalized transcript's system messages — so
    that my provider behaves identically to a built-in one.
16. As a **Bundled extension** author writing a custom provider, I want a documented hook to inspect
    or replace the outgoing payload and to observe the response, so that request rewriting and
    cost/telemetry capture are supported rather than reimplemented per provider.
17. As a Selesai user with a custom provider configured through `models.json`, I want it to keep
    working through the contract change, so that my provider configuration is not invalidated by a
    platform release.
18. As a Selesai maintainer, I want upstream's own tests for the behaviour this phase adopts to be
    ported, so that "upstream behaviour landed" is proven rather than assumed.
19. As a Selesai maintainer, I want the fork's maintenance record to note the new platform base, so
    that the next sync starts from an accurate statement of where the fork sits.
20. As a Selesai maintainer, I want the diff of this phase to be reviewable as "mechanical adoption",
    so that a reviewer can distinguish adopted upstream code from fork-owned decisions.
21. As a Selesai user on the compiled binary distribution, I want the persistent compile cache and
    module-resolution behaviour of the new platform, so that repeat launches are not slower than
    before.
22. As a Selesai user, I want extension load failure to remain a reported, non-fatal error, so that
    one broken extension does not prevent a session from starting.
23. As a Selesai maintainer, I want a gate ledger for this phase, so that the evidence for "the floor
    is in place" is captured in the repository rather than in a chat transcript.
24. As a Selesai user with a custom provider registered as an **Extension**, I want its registration
    shape unchanged by the platform upgrade, so that my provider configuration keeps working.
25. As a **Bundled extension** author, I want the fork's model runtime to keep accepting the ordinary
    request context on its public streaming entry points, so that code calling the runtime does not
    have to construct the platform's branded transcript itself.
26. As a Selesai maintainer, I want the provider contract change confined to the boundary where the
    fork forwards into a platform adapter, so that the port stays a type-level adjustment rather than
    a request-building rewrite.
27. As a **Bundled extension** author shipping a provider through the declarative registration form,
    I want a credential-scoped wrapper to forward newly required request options automatically, so
    that multi-account rotation does not silently drop a hook.
28. As a **Bundled extension** author, I want the outgoing-payload and response hooks to keep being
    driven by the fork's existing request and response events, so that request rewriting and response
    observation work without every provider reimplementing them.
29. As a Selesai maintainer, I want it recorded and enforced that the composition layer and the
    synchronous registry facade remain core, so that a future "move it into an extension" attempt
    does not re-litigate a settled boundary.
30. As a Selesai maintainer, I want a test at the provider boundary, so that a future platform release
    cannot silently change the shape the fork forwards without a failing check.
31. As a **Bundled extension** author, I want the two provider registration forms to remain available
    and documented, so that a simple declarative provider and a complete custom provider are both
    expressible.

## Implementation Decisions

**Dependencies.** The three runtime packages move to the new release as exact pins, matching the
fork's existing exact-pin convention. They move together: upstream releases the three as a
coordinated set and the vendor source is written against that set, so moving a subset is not a
supported state. The package's declared Node engine floor is adopted from upstream.

**Module resolution.** Upstream extracted the embedded-module map into its own module and changed
resolution to branch on runtime kind: embedded modules for compiled binaries and the bundled Node
distribution, TypeScript-source options when running from source, and path aliases for unbundled
Node builds. The fork adopts upstream's map verbatim as the single source of truth and adds exactly
one entry for the fork's own package name, so in-tree **Extensions** that import the fork package
continue to resolve. The fork's duplicate in-loader copy of the map is deleted, not merged.

**Tool sampling.** Upstream removed the experimental gate and moved strict-prefer sampling onto the
built-in tool definitions themselves as a default. The fork adopts this and deletes its own
experimental gate helper. Extensions retain the existing escape hatch: re-registering a tool with
strict sampling disabled is still honoured. Adopting upstream here also corrects a fork-side
inconsistency where the default-active-tools fallback array and its documenting comment disagreed.

**Event subscription contract.** Upstream changed the extension event subscription API to return an
unsubscribe function instead of nothing. The fork adopts the new return type. Existing fork and
vendored **Extension** handlers that ignore the return value keep compiling.

**Shell-hook failure mode.** Upstream made the user-shell-hook event fail closed: a handler that
throws, or that returns an invalid defined result, aborts the command instead of letting it fall
through to local execution. A handler returning nothing continues propagation. The accepted result
shape is a union with exactly one arm present — either an `operations` arm carrying an executable
`exec`, or a `result` arm carrying a string `output`, an optional numeric `exitCode`, and boolean
`cancelled` and `truncated` flags with an optional `fullOutputPath`. The fork adopts this validator
and its semantics; the fork currently declares no shell-hook handlers of its own, so this is
adoption rather than migration.

**Value-domain tightening.** Tool-call arguments and tool-result details become JSON-compatible only,
the tool-result message type becomes conditional, and the JSON value type's arrays become readonly.
Fork and vendored code that passes non-JSON values is corrected at the call site rather than being
cast around.

**Custom-provider contract, and how little of it the fork actually touches.** Stream handlers now
receive a branded normalized transcript. Prompt and tool declarations live in that transcript's
system messages and are read with the platform's accessor functions rather than from top-level
fields, and a helper folds later system messages into the leading one for models that cannot accept
them mid-conversation. Handlers must also invoke the outgoing-payload hook before sending and the
response hook after receiving and before consuming the body.

Three verified facts make this far smaller than it reads:

- **The platform normalizes before dispatching.** The platform's model collection still accepts an
  ordinary request context at its public streaming entry points and lifts it into the branded
  transcript internally, immediately before calling the provider. The fork's model runtime implements
  that same collection interface, so **its public streaming surface does not change either**; the
  branded transcript only appears at the provider boundary.
- **The fork's provider code never reads the request context.** No provider module, provider
  registration, composition helper or runtime helper references the context's prompt or tool fields.
  The context is carried opaquely from the runtime to whichever platform adapter builds the request.
  This is therefore a signature-and-type-identity change at a handful of call sites, not a
  request-building migration.
- **The required hooks already exist.** The fork already supplies an outgoing-payload hook wired to
  its provider-request event and a response hook wired to its provider-response event. This phase
  verifies they survive the port; it does not add them.

The only real work is the boundary: the fork's two in-tree providers forward into platform adapters,
and that is where the shape must be correct. The credential-rotation wrapper rebuilds its per-account
options by spreading the caller's options, so newly required option fields forward without change and
it needs a type-level adjustment and nothing more.

**Provider-as-extension boundary.** The fork already expresses providers as extensions, and this
phase settles the boundary rather than moving it:

- **Two registration forms already exist** — a declarative config form that the composition layer
  merges with the built-in catalog and the user's model configuration, and a native form that
  registers a complete provider object. The fork's two in-tree providers already use one form each.
- **Storage and catalog caching are already plug-ins.** The credential storage and the catalog store
  already implement the platform's own store interfaces; they are hosted extension points, not
  fork-specific plumbing to be extracted.
- **The composition layer stays core.** It folds three sources — the platform's built-in catalog, the
  user's model configuration file, and extension registrations — and the platform exposes no
  composition hook: its model-collection factory accepts only credentials, a store and an auth
  context. The composition layer is the fork's policy, and there is no interface to hang it on.
- **The synchronous registry facade stays core.** It is part of the published extension API surface
  that this fork's bundled extensions and in-tree delegation code call into, and the runtime type it
  wraps is imported directly by more than a dozen core, mode and CLI modules.

Relocating the runtime or composition layers into a **Bundled extension** is explicitly rejected. The
host cannot boot without them, which is the definition of core, and it would not reduce the work this
phase performs.

**Port ordering inside the phase.** Upstream-changed files the fork has never modified are taken
verbatim first. Upstream-added files are taken verbatim second. Only then are the fork-owned
overlapping files reconciled. This keeps the reviewable diff forked-code-shaped and small, and
prevents a mechanical file from being hand-edited by accident.

**Files this phase owns.** The 45 never-touched files and the 20 remaining clean-merge overlaps default
to this phase, plus one named conflict file: the extension loader, whose virtual-module map is both a
conflict and this phase's deliverable — the fork's duplicate copy is deleted in favour of upstream's
extracted map with one added entry for the fork's package name. The conflict files this phase
deliberately does *not* touch are listed in the plan's ownership table and are resolved by later
phases; if this phase needs one of them, it records that in the gate rather than editing it.

**Residual exception, contingent on the typecheck.** Should the typecheck show that the platform's
branded transcript is not structurally assignable from the old context type, the forwarding sites in
the model registry and the provider composer need a cast. This phase owns that edit for that edit
alone — it is the minimal change that makes the floor compile — and the exception expires when the
session-runtime phase takes ownership of both files. The cast is recorded in the gate with the exact
sites, so a later phase can remove it rather than inheriting it silently.

**Not decided here.** The new optional Mermaid rendering dependency is deliberately *not* pulled in
by this phase even though one ported file references its types; the decision belongs to the
interactive phase, which must decide explicitly whether the fork adopts Mermaid rendering.
Likewise, provider-composition field merging keeps the fork's existing clamping of token and
context-window values rather than adopting upstream's unguarded spread, because the unguarded form
can hand a model an undefined limit; upstream's newly added fields are layered on top of the clamped
values.

## Testing Decisions

A good test here observes external behaviour: a tool definition as the model receives it, an event
handler's return contract, a resolved module identity, a rejected invalid handler result. It does
not assert on internal helper structure, private field names, or the order in which upstream happens
to arrange its code — those change again at the next release and would make the port brittle.

**Highest seam: typecheck and build.** This phase's primary evidence. Run the build-config typecheck
and then the package build; both must be clean. This single seam catches almost the entire
`TranscriptContext`, `UserBashEventResult`, readonly-array and unsubscribe-return surface.

**Second seam: the ported upstream suites.** Upstream ships focused tests for the behaviour adopted
here — strict tool sampling, module resolution, and the embedded-module map among them. These are
already written against the target version and assert external behaviour, so porting them is the
cheapest available proof and strictly better than authoring equivalent tests.

**Third seam: the repository's existing focused test script.** Run it unchanged; it already
enumerates the Selesai-owned suites that this phase must not regress, including the provider
composition, default model registry, extension loader and CLI argument suites.

**Prior art in this codebase.** The provider-composition suite and the model-registry-defaults suite
are the model to follow: narrow module-level tests that construct the module under test with a
stubbed runtime, assert resolved output, and make no network calls. Note the test environment runs
offline by default and requires an explicit opt-in for network, so any ported test that reaches the
network must be reviewed rather than enabled.

**Provider-boundary seam.** The one place the new contract is load-bearing is where the fork's
providers forward into a platform adapter. Test there rather than at the adapter: register a provider
through each of the two registration forms, stream through the fork's runtime with an ordinary
request context, and assert the request reaches the adapter with the prompt and tool declarations
intact and with the payload and response hooks invoked. Asserting at the adapter instead would only
re-test platform code. This is a new seam, proposed at the provider-registration level, and is the
cheapest place to catch a future release changing the shape the fork forwards.

**Gate ledger.** Write a phase gate file following the repository's existing convention for one
change: an owner list, a scope statement, and one numbered check per claim with the command, the
expected marker and the captured evidence. At minimum: typecheck, build, the focused test script,
the ported upstream suite, the provider-boundary test, and a negative check that the deleted
experimental gate helper and the duplicate module map are gone.

## Out of Scope

- Any system-prompt, session-format, compaction or session-runtime semantics change (PRD 2, PRD 3).
- Any interactive terminal, settings-surface or diagnostics change (PRD 4).
- Replacing the native clipboard dependency (PRD 5).
- Re-planting Selesai-owned behaviour on the new shapes (PRD 6).
- Adopting Mermaid rendering and its new dependency.
- Documentation site updates, changelog entries, and the published version bump (PRD 7).
- Upgrading any vendored upstream-backed **Bundled extension**; every vendored extension in the tree
  is already at the newest upstream tag, so this phase only verifies they still load.
- Chasing upstream's `main` beyond the tagged release; the release tag is the target.
- Relocating the model runtime, the provider composition layer, or the synchronous model registry
  into a **Bundled extension**. The in-tree providers are already extensions, the storage and catalog
  layers already implement platform store interfaces, and the composition and runtime layers are core
  because the host cannot boot without them. See the provider-as-extension boundary decision above.
- Extracting the model-resolution precedence module, which is large but is pure policy and is called
  from the interactive modes, the CLI listings and the SDK. It is a candidate for a later phase, not
  this one.

## Further Notes

Measured port geometry, which is what made this phase order possible: upstream changed 82 vendored
source files between the current base and the target, of which 45 were never touched by the fork
(mechanical), 37 overlap with fork modifications, and 14 of those overlap files have true conflicts —
53 conflict hunks in total, concentrated in the session runtime, the system-prompt module, the
interactive mode and the clipboard utilities.

The fork and upstream share no common commit, so `git merge` cannot be used at all. Every sync is a
per-file three-way reconciliation. This plan assumes that process and does not attempt to establish a
merge base.

This phase is the only phase where a large diff is expected and acceptable: it is adoption of
upstream code plus one deletion, not a design change. Later phases should produce small, behaviour-
shaped diffs.

Provider layer, measured: the fork's provider stack is roughly 4,300 lines across a dozen modules —
composition and runtime, a synchronous registry facade, plus configuration, model resolution,
attribution, catalog and credential-storage helpers. Composition and runtime account for about 1,230
of those lines, configuration and model resolution for about 1,640, and the two in-tree providers —
which are already extensions — for the remainder. Nothing in the stack reads the request context,
which is precisely what makes the platform's contract change a boundary adjustment rather than a
migration.

One alternative considered and rejected for this phase: keeping the fork's own request context type
at the two forwarding sites by adapting at the boundary, instead of adopting the platform's branded
transcript inward. It would shrink this phase's diff slightly and buy a second contract inside one
repository, which ages badly across releases. The adopting route is taken because the boundary is only
a handful of call sites. The alternative is recorded here as a considered option, not an oversight,
so that a future reviewer does not rediscover it as a novel idea.
