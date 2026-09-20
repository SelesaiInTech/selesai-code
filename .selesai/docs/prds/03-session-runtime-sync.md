# PRD 3 — Session runtime sync

## Problem Statement

PRDs 1 and 2 move the fork onto the new platform and give it the new prompt and compaction shapes.
The session runtime — the object that owns a running agent turn — is still on the older flow.

That older flow has consequences a user can hit. Credential resolution that hangs cannot be
cancelled, because the auth path does not accept a cancellation signal. Automatic compaction has its
own abort handling that bypasses the shared cancellation path, so a cancelled compaction can leave
the session reporting one thing and doing another, and a cancellation that arrives while compaction
is still obtaining credentials is ignored outright. A turn that is already streaming when a second
prompt arrives can be raced instead of queued. A long transient provider outage can back off for
minutes at a time because the agent-level retry cap is not configurable. And provider request
settings — timeouts, retries, headers — are assembled at more than one call site, so they do not
uniformly apply to a main turn, a compaction request and an extension's model call.

For a maintainer, the runtime is also where most of the fork's own behaviour lives: automatic
handoff, length continuation, vision captioning and the fork's compaction-failure event all sit in
this file's regions, which is why the runtime must be rebased deliberately rather than merged.

## Solution

Rebase the session runtime on upstream's flow: prompt and tool loadout prepared as an explicit step
with the resulting state retained for the run, one shared abort controller per operation with
cancellation expressed by throwing, auth helpers that accept a signal and return the base-URL-resolved
request model, a single request-options builder, and a configurable cap on agent retry backoff.
Re-plant the fork's own runtime behaviour onto that flow.

At the end of this phase a Selesai user can cancel a compaction or a credential lookup, can queue a
prompt that arrives mid-stream without racing it, and cannot be held for minutes by a transient
provider outage; and the fork's own continuation and captioning behaviour still works.

## User Stories

1. As a Selesai user, I want cancelling a compaction to actually cancel it and report the
   cancellation once, so that the session never claims a compaction is running after it stopped.
2. As a Selesai user, I want a credential lookup that hangs to be cancellable, so that a bad network
   or a stuck auth endpoint does not freeze my turn.
3. As a Selesai user, I want cancellation during credential resolution to abort the operation rather
   than be swallowed as "no credentials", so that a cancel is not reported as an auth failure.
4. As a Selesai user, I want a cancellation that arrives while a compaction is still resolving
   credentials to take effect, so that cancelling always cancels rather than being ignored until the
   credential lookup happens to finish.
5. As a Selesai user, I want a summarization request to use the same base URL the credentials came
   from, so that an authenticated endpoint that differs from the configured one is actually used.
6. As a Selesai user, I want a summarization failure to remain non-fatal and continue without
   credentials when that is the only option, so that compaction is best-effort.
7. As a Selesai user, I want a prompt that arrives while a turn is streaming to be queued rather than
   raced, so that my message is never silently dropped.
8. As a Selesai user, I want the choice between steering the current turn and queueing a follow-up to
   be honoured for a prompt that arrives after preflight, so that the behaviour I configured is what
   happens.
9. As a Selesai user, I want a prompt that was accepted during preflight to be reported as accepted,
   so that the client is not told it failed while the message actually runs.
10. As a Selesai user, I want a transient provider outage to stay responsive, so that retries do not
    back off for minutes during a short outage.
11. As a Selesai user, I want to configure the maximum agent retry delay, so that I can trade
    responsiveness against provider load.
12. As a Selesai user, I want the retry cap to apply only to agent-level retries, so that provider
    transport retries keep their own policy and its own settings.
13. As a Selesai user, I want provider timeouts, retry counts and request headers to be assembled in
    one place, so that a setting applies identically to my main turn, to a compaction request, and to
    a model call made by an extension.
14. As a Selesai user, I want request headers contributed by extensions to be applied to every one of
    those calls, so that an attribution or gateway header is not present on some requests and absent
    on others.
15. As a Selesai user, I want input handlers to run for a queued message too, so that an extension
    intercepting my input is not bypassed by the queue.
16. As a Selesai user, I want a direct steering or follow-up command over the programmatic interface
    to run input handlers, so that the two entry points behave identically.
17. As a Selesai user, I want a mid-run threshold compaction to include an oversized trailing tool
    result rather than skipping it, so that compaction actually reduces what it claims to reduce.
18. As a Selesai user, I want automatic compaction to be cancellable without being restarted by a
    stale retry state, so that a cancelled compaction stays cancelled.
19. As a **Bundled extension** author, I want to start a stream or a completion through the model
    registry, so that I do not have to reimplement authentication and provider resolution.
20. As a **Bundled extension** author, I want that registry streaming to resolve credentials at
    request time, so that a refreshed credential is used without a reload.
21. As a **Bundled extension** author, I want registry streaming to accept the same provider-neutral
    request options as the main turn, so that an extension call is not restricted to a subset.
22. As a Selesai user, I want the session runtime to expose the cache warmer as a host-owned
    collaborator, so that cache warming can be cancelled and reported without the runtime knowing its
    internals.
23. As a **Bundled extension** author, I want an extension event that lets me decline or adjust a
    cache-warming decision, so that I can bound cost without disabling the feature.
24. As a Selesai maintainer, I want the session factory to construct the cache warmer and pass it in,
    so that the warmer has exactly one construction point and the runtime stays free of the warmer's
    timers and policy.
25. As a Selesai user, I want the SDK's session factory to accept the same runtime collaborators the
    CLI passes and to build the same request options, so that an embedded session behaves like an
    interactive one.
26. As a Selesai user embedding Selesai, I want the SDK's default tool set, no-tools semantics and
    thinking-level resolution to match the interactive runtime, so that an embedded session is not a
    second-class citizen.
27. As a Selesai maintainer, I want the fork's automatic-handoff and length-continuation behaviour to
    still trigger from the new flow, so that a port does not silently drop fork features.
28. As a Selesai maintainer, I want the fork's compaction-failure event to be emitted from the new
    cancellation path, so that the fork's own extension surface survives the rebase.
29. As a Selesai user, I want a cancelled compaction to still notify interested extensions, so that
    fork-owned extensions observing compaction failure keep working.
30. As a Selesai maintainer, I want the runtime port validated by the fork's existing runtime suites
    plus upstream's session suites, so that both fork and upstream behaviour is pinned.
31. As a Selesai user, I want the runtime change to be invisible in normal use except for the
    cancellability and responsiveness improvements, so that this phase is safe to ship alone.

## Implementation Decisions

### Owned surfaces

This phase resolves the fork-owned overlap in these files, and no other phase touches them:

- the session runtime (the fork's largest conflict surface, and the file where fork behaviour and
  upstream's rewrite interleave most);
- the session factory that both the CLI and the SDK entry points route through;
- the model registry;
- the provider composer, which holds the forwarding boundary into the platform's adapters and is where
  the branded-transcript type identity must be correct;
- the extension runner's cache-warming decision emit;
- the programmatic mode's steering and follow-up path.

Fork-owned test suites this phase extends: the automatic-handoff suite and the
length-continuation suite.

Upstream test artifacts this phase brings across: the session-suite harness and the session suite
files it drives (runtime, prompt, queue, retry events, compaction, compaction model overrides, bash
persistence, model extension, tool-result images). The harness does not exist in this fork today;
bringing it across is in scope here, and later phases reuse it.

### Prerequisite from the settings module port

The settings module is resolved once, in PRD 2, and taken to upstream's full accessor surface rather
than re-opened here. This phase consumes, and does not add: the retry settings accessor (enabled,
max retries, base delay, maximum agent delay), the provider retry accessor that already exists, the
HTTP idle timeout accessor, the web-socket connect timeout accessor, and the cache-warming mode
getter and setter together with the cache-warming mode type and its allowed values.

Two accessors exist and must not be collapsed: the agent-level retry settings accessor is new and
carries the maximum agent delay; the provider retry accessor is pre-existing and describes transport
retries. The cap in this phase reads the former; transport behaviour continues to read the latter.

If PRD 2 does not land that accessor surface, this phase's gate is unreachable — the settings module
is the one file this phase deliberately does not own.

### Prompt and tool loadout

Preparing the prompt and the tool set for a turn becomes an explicit step whose resolved state is
retained for the run and consumed by the prompt build. The runtime keeps the resulting options for
the duration of the run and clears them when the run settles. A loadout change produces a message the
model is told about, rather than being applied silently.

### Cancellation model

Each cancellable operation owns exactly one abort controller. Cancellation is expressed by throwing,
not by returning a sentinel result, so a cancelled operation cannot be mistaken for a successful
empty one. Automatic compaction uses the same controller discipline as manual compaction. A
cancellation raised by an extension is distinguished from a cancellation raised by the user — by a
flag set in the same scope as the throw, so that the distinction survives the throw — and the session
reports which happened exactly once. Cancellation during credential resolution takes effect, and a
cancellation that arrives while credentials are still being obtained is not deferred until that
lookup completes.

### Auth threading

Both auth helpers accept an optional cancellation signal and pass it to the credential resolver. On
cancellation they rethrow rather than falling back, so an aborted lookup is never reported as missing
credentials. They return the base-URL-resolved request model alongside the credential material, so a
summarization request targets the endpoint the credentials belong to. The fork's existing
no-credential error messages and its OAuth-expiry guidance are preserved verbatim.

### One request-options builder

Provider request options are assembled in exactly one place, parameterized by the request model and
the caller's options, and used by the main turn, by compaction and summarization requests, and by
registry streaming. It resolves the provider retry settings, the HTTP idle timeout (with the
platform's maximum sentinel when the timeout is disabled), the web-socket connect timeout, and the
extension-contributed header transformation, then merges the caller's explicit overrides. A second
call site that assembles a partial version of these options is a defect, not a variation.

### Retry policy

Agent-level retry backoff is capped by the configurable maximum agent delay, defaulting to the
platform's value. Transport-level retries keep their existing policy and their existing accessor. The
cap applies only to the agent loop's retry delay.

### Queued input

A prompt that arrives after preflight while the turn is already streaming is queued according to the
requested behaviour (steer versus follow-up) and reported to the caller as accepted, because the
preflight contract already told the caller it succeeded. Input handlers run for queued messages and
for direct steering and follow-up commands, so the two entry points are indistinguishable to an
extension.

### Compaction correctness

Threshold compaction includes an oversized trailing tool result instead of skipping it. Automatic
compaction's cancellation path cannot be restarted by leftover retry state, and cannot be started
twice by a cancellation race.

### Registry streaming

The model registry gains streaming and completion entry points that resolve credentials at request
time, accept the same provider-neutral request options the main turn accepts, and share the single
request-options builder. A synchronous catalogue snapshot accessor already exists on the runtime and
is already delegated to by the registry; it is not added here.

### Cache warmer wiring

The runtime accepts an optional cache-warmer collaborator and never constructs it. The session
factory constructs it and passes it in, so the warmer has exactly one construction point and its
timers and cost policy stay out of the runtime. The collaborator surface is the warmer's lifecycle
and reporting callbacks only:

```ts
cacheWarmer?: Pick<CacheWarmer, "cancel" | "status" | "onAgentSettled" | "onModeChanged" | "onWarmed">
```

The extension *decision* callback is a constructor argument on the warmer, not a method the runtime
sees; it routes into the runner's cache-warming decision emit, which returns the action to take
after extensions have had their say. The runner's emit is added here because the runtime's call site
requires it.

### Session factory and SDK parity

The session factory accepts the same runtime collaborators the CLI passes, builds its request options
through the shared builder, and matches the interactive runtime on default active tools, no-tools
semantics and thinking-level resolution.

### Fork behaviour preserved

The fork's automatic handoff, length continuation, vision captioning and compaction-failure event are
re-planted on the new flow rather than re-derived: the handoff and continuation triggers keep their
existing conditions, and the compaction-failure event is emitted from the new cancellation path so
fork-owned observers see it. The re-plant is done in separate edits from the adoption, so a reviewer
can see which lines are upstream's and which are the fork's. Whether each re-planted behaviour is
still observably present end to end is verified by the re-plant sweep, not here.

### Not decided here

Interactive settings items and status readouts for the retry cap, the cache-warming mode and warming
usage belong to the interactive phase. The warmer's internals — its timers, its cost policy, its
refresh scheduling — also belong there or to the platform module that already provides them; this
phase only fixes its construction point and the surface the runtime sees.

## Testing Decisions

A good test in this phase observes runtime behaviour through a session-level or registry-level
interface: given a started session and an injected collaborator, assert what was requested, what was
queued, and which event was emitted. It does not assert on the runtime's private helper names, its
field layout, or the order in which the new loadout step happens to be called internally.

**Highest seam: a session built by the ported session-suite harness.** This fork has no reusable
session harness today; its two runtime suites construct a mock session object per file, which cannot
exercise the runtime's own flow. Porting upstream's session-suite harness — and the session suites it
drives — is therefore part of this phase's implementation, not a testing afterthought. That harness
is the seam: it builds a real session against stubbed providers and collaborators, which is what makes
cancellation, queueing and loadout observable at all. Cover: a prompt arriving mid-stream is queued
and reported accepted; a cancelled credential lookup throws instead of falling back; a summarization
request targets the resolved base URL; and the compaction-failure event is emitted once when
compaction is cancelled by an extension.

**Second seam: settings → resolved policy.** Assert that a configured maximum agent delay is applied
and that the platform default is used when unset, and that the cap does not change transport retry
policy. Assert that a request assembled through the shared builder carries the extension-contributed
headers.

**Third seam: registry → request.** Assert that a registry stream resolves credentials at request
time, that it accepts the provider-neutral options, and that it routes through the shared builder.

**Fork suites that must stay green.** The fork's automatic-handoff and length-continuation suites
assert behaviour that lives in the same regions as the ported code, so they are the regression net for
the re-plant. They are mock-session tests by construction, so they pin the trigger conditions rather
than the full flow; the harness seam covers the flow. Extend them only where the new flow makes an
existing assertion structurally impossible, and record that in the gate evidence rather than quietly
rewriting the assertion.

**Ported upstream suites.** Upstream ships tests for the retry cap, the queued-message input-handler
path, the cancellation races, the mid-run trailing-tool-result fix, the compaction model overrides
and the extension-provider streaming path. Port them with the harness; they encode the behaviour this
phase adopts against the target version and are strictly better than rewriting equivalents.

**Prior art in this codebase.** The auto-handoff and length-continuation suites are the model for
per-behaviour pinning: build a mock session with stubbed collaborators, drive the trigger, assert the
emitted events and the follow-up message. The registry defaults suite is the model for the
settings/registry seams. The test environment is offline by default and requires an explicit opt-in
for network, so any ported test that reaches the network must be reviewed rather than enabled.

**Gate ledger.** One phase gate file: owners (the session runtime, the session factory, the model
registry, the extension runner's cache-warming emit, the programmatic steering path, the fork runtime
suites, the ported session harness and suites, the gate file), scope statement, and checks for
typecheck, build, the focused test script, the ported session suites, and two negative checks — that
the old per-operation abort field is gone, and that no second call site assembles provider request
options independently.

## Out of Scope

- The settings module's accessor surface, including the cache-warming mode type and its accessors and
  the retry settings accessor; PRD 2 lands those and this phase consumes them.
- Interactive settings items, selectors, status surfaces and usage readouts for the retry cap or
  cache warming (PRD 4).
- The cache warmer's internals: timers, refresh scheduling, cost policy and its own model calls.
- Prompt section content and session entry shapes (PRD 2).
- Clipboard, bug report and crash-log surfaces (PRD 4, PRD 5).
- The full re-plant verification sweep across every Selesai-owned behaviour; this phase re-plants the
  runtime's own regions, and the sweep proves them (PRD 6).
- Published versioning and documentation (PRD 7).

## Further Notes

This phase carries the single largest conflict surface of the port: the session runtime alone accounts
for more conflict hunks than any other file, and the fork's own behaviour (automatic handoff, length
continuation, captioning, compaction failure reporting) is interleaved with exactly the regions
upstream rewrote. The mitigation is ordering: adopt upstream's loadout, cancellation and auth
threading shapes first and re-plant the fork behaviour afterwards, in separate edits.

One fork-side defect discovered during analysis is fixed here rather than deferred: the fork's auth
helpers had dropped the base-URL-resolved request model from their return shape, so summarization
paths could send credentials resolved for one endpoint to another. This takes upstream's corrected
shape; it is a bug fix, not a feature, and belongs in the changelog on its own line.

This phase inherits one possible edit from the platform phase rather than making it: if the platform
phase's typecheck required a cast at the forwarding sites to make the branded transcript assignable,
that cast is recorded in the platform phase's gate and is removed here, where the forwarding boundary
is actually owned. Removing it is part of this phase's work, not a follow-up.

Three claims in the first draft of this PRD were wrong against the tree and are corrected here: the
session already records model changes as first-class entries with an append path, so no work was
needed; the registry's synchronous catalogue snapshot already exists, so it is not added; and the
fork has no reusable session harness, so porting upstream's is now an explicit deliverable rather than
an assumed seam.
