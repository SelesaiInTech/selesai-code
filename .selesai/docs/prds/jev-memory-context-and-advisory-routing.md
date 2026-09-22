## Problem Statement

The agent already has persistent memory, Graft repository context, compaction, workflows, skills, and verification mechanisms, but deciding when each is useful currently relies on fixed heuristics or the parent model’s general judgment. That creates two costs: unnecessary context/tool use on routine requests, and missed durable context or specialized workflows when a request is phrased indirectly. Users with Token-In access to Jev want a low-cost decisions model to make bounded, validated recommendations over these existing systems. Users without a Token-In subscription must retain current behavior with no loss of memory, repository-context, compaction, workflow, skill, or verification safety.

## Solution

Add opt-in Jev advisory routing for three decision types that are safe, finite, and use existing seams:

1. **Memory lookup routing**: choose `none` or a valid `memory_search` scope/filter combination for the current request.
2. **Repository-context routing**: resolve only ambiguous repository-task prompts to `inject` or `skip`, while the configured Graft pull/push/hybrid mode remains authoritative.
3. **Workflow, skill, and verification recommendations**: recommend one discovered workflow or skill, or a verification level, to the parent agent without loading a skill, running a workflow, executing a command, or suppressing required checks.

Each Jev request contains the current user ask, a bounded window of prior user turns, and a small validated candidate catalog where needed. Conversation, candidate descriptions, and memory metadata are untrusted material to classify rather than instructions. Jev may produce only an allowlisted choice with sufficient numeric confidence. The host revalidates every accepted choice and then uses the existing memory search, Graft injection, skill/workflow discovery, verification, and policy mechanisms.

The feature is disabled by default. Jev unavailability—including no Token-In subscription or credential, no provider template, timeout, invalid output, low confidence, no candidate, or payload overflow—returns control to existing deterministic behavior. Compaction triggering, permission, project trust, memory writes, command execution, and workflow launch remain deterministic host responsibilities.

## User Stories

1. As an agent user, I want relevant persistent memories considered for requests that depend on prior preferences, conventions, or known failures, so that I do not need to restate durable context.
2. As an agent user, I want generic questions and one-off explanations to avoid memory retrieval, so that irrelevant recalled context does not distract the response.
3. As an agent user, I want memory lookup to select an appropriate existing target such as user, project, failure, or general memory, so that searches are narrow and useful.
4. As an agent user, I want the current project used when Jev recommends a project-scoped memory lookup, so that project conventions do not bleed across repositories.
5. As an agent user, I want memory contents withheld from Jev, so that a routing decision does not disclose my durable records to the classifier.
6. As an agent user, I want standing instructions to remain active regardless of a Jev result, so that pinned rules never depend on a classifier choosing memory search.
7. As an agent user, I want Graft context injected for indirectly phrased repository work, so that code tasks do not miss relevant source-backed orientation solely because they lack a lexical keyword.
8. As an agent user, I want non-repository requests to avoid a Graft query, so that normal conversation does not pay repository-context latency.
9. As an agent user, I want my selected Graft retrieval mode to remain in force, so that an automatic classifier cannot override my pull, push, or hybrid preference.
10. As an agent user, I want Graft’s source-backed context and precise tools to remain the evidence path, so that Jev decides only whether context is useful rather than inventing repository facts.
11. As an agent user, I want a relevant available skill recommended when it fits my request, so that I can use specialized instructions without memorizing every skill name.
12. As an agent user, I want a workflow recommended when it matches my request, so that existing orchestration can be discovered without exposing every workflow in every prompt.
13. As an agent user, I want recommendations to remain advisory, so that I can decline a skill, workflow, or delegated operation that does not fit my intent.
14. As an agent user, I want a verification recommendation after a code-affecting task, so that I can run a proportionate existing check rather than guessing the right level of validation.
15. As an agent user, I want mandatory project or workflow verification requirements preserved even when Jev recommends a lighter path, so that a classifier can never weaken a required gate.
16. As an agent user, I want no shell command, workflow, skill body, or child process to run merely because Jev selected it, so that routing does not create unexpected cost or side effects.
17. As an agent user, I want the latest request and a short user-turn history considered together, so that follow-ups receive appropriate retrieval and recommendation decisions.
18. As an agent user, I want assistant messages, tool results, credentials, and hidden system prompts excluded from Jev routing input, so that noisy or sensitive context is not exported unnecessarily.
19. As an agent user, I want a low-confidence or unavailable Jev result to be invisible, so that my normal agent workflow continues when I have no Token-In subscription.
20. As a project owner, I want only active, discovered, and policy-eligible skills and workflows presented as Jev choices, so that project configuration and trust boundaries remain authoritative.
21. As a project owner, I want verification suggestions constrained to registered or documented project checks, so that routing cannot invent destructive or unsupported commands.
22. As a memory user, I want a Jev recommendation to invoke only read-only `memory_search`, so that the classifier cannot create, replace, remove, or consolidate durable memory.
23. As a security-conscious user, I want user turns, memory metadata, and catalog descriptions treated as data rather than instructions, so that prompt injection cannot control a routing decision.
24. As an operator, I want non-content telemetry for Jev requests, abstentions, fallbacks, and adopted recommendations, so that usefulness and subscription reliability can be measured without retaining prompts.
25. As a maintainer, I want all Jev consumers to share provider resolution, bounded context, timeout, confidence, response validation, and fallback behavior, so that the same Token-In outage cannot fail differently in each feature.
26. As a maintainer, I want fixed token or byte budgets for each candidate catalog, so that a large memory, skill, workflow, or repository setup cannot make prompt startup unreliable.
27. As a maintainer, I want compaction thresholds and checkpoint persistence to remain unchanged, so that a best-effort classifier cannot cause data loss or context-window overflow.
28. As a maintainer, I want current deterministic routes to run before Jev where they already produce a safe answer, so that obvious cases remain fast and no paid decision call is wasted.

## Implementation Decisions

- Extend the shared Jev decision client used by auto-model and the earlier Jev routing features. The shared client owns provider-template and base-URL resolution, Token-In authentication, decisions-model transport, bounded request serialization, timeout, JSON parsing, allowlisted choice validation, numeric confidence thresholding, and absence-of-decision fallback. It remains a narrow transport/validation primitive rather than a policy engine.
- Add one opt-in configuration area for these advisory routes, with per-route enablement and shared Jev provider/model defaults. Each route has a timeout, confidence threshold, recent-user-turn count, character budget, and fixed candidate-payload budget. All routes default to disabled.
- Memory routing may select only `none` or a validated read-only search plan: target, optional failure/lesson category, and whether the active project filter applies. The host derives the `memory_search` query from the current request and supplies the current project identity; Jev does not see memory entries, produce free-form queries, write memory, or change standing instructions.
- Preserve the existing memory policy as the authority. The Jev plan is an additional trigger for `memory_search`, not a replacement for explicit user requests, standing instructions, memory-mode behavior, or the parent agent’s existing policy-guided lookup. Current request, repository evidence, and tool output continue to override recalled memory.
- Extend Graft’s present cheap lexical task classification with an `ambiguous` result. Clear coding and non-coding requests preserve their existing outcomes with no Jev call. Only an ambiguous request is offered to Jev as `inject` or `skip`; if accepted, `inject` uses the user-selected push or hybrid budget and the existing query, coverage, freshness, injection guard, and source-authority wording. Pull mode remains an unconditional no-injection choice.
- Build workflow and skill candidates from their existing discovery/catalog interfaces. A Jev result may recommend `none` or exactly one canonical discovered item. It cannot load a skill body, execute a prompt workflow, grant a workflow resource permit, bypass script/preflight validation, or surface an item excluded by its discovery or model-invocation policy.
- Make verification a recommendation-only decision over a fixed host-defined level set such as `none`, `targeted`, and `project-required`. Jev can identify the likely proportional level but never choose a raw command or waive an already required project/workflow gate. The parent and existing validation workflows map the recommendation to known checks.
- Render accepted workflow, skill, and verification decisions as compact advisory context to the parent agent. The context states its source, selected canonical item or level, confidence, and the existing explicit validation/loading/execution boundary. It never contains raw Jev output or acts as an instruction to execute.
- Run each route only on eligible idle top-level interactive input, and make each route idempotent per turn. Skip extension-injected input, slash commands, queued steering, user-explicit choices, unavailable integrations, and oversized candidate payloads.
- Treat no Token-In subscription, missing credentials, provider/model resolution failure, timeout, cancellation, malformed response, low confidence, unknown/stale candidate, catalog overflow, and telemetry failure as ordinary abstention. Fallback is route-specific: normal memory policy, existing Graft lexical/pull behavior, and no advisory workflow/skill/verification recommendation.
- Do not add Jev to compaction triggering, cut-point selection, summary persistence, retry policy, or overflow recovery. Those existing deterministic mechanisms protect session integrity; the only permitted compaction-adjacent outcome is an advisory recommendation to preserve key decisions in a later summary, handled by the current compaction path.
- Emit privacy-safe route telemetry only: route name, eligible/skipped reason, deterministic versus Jev versus fallback outcome, candidate count, confidence bucket, elapsed/error class, and whether a parent adopted a recommendation. Do not emit prompts, history, memory contents, raw classifier output, commands, credentials, or child/workflow output.

## Testing Decisions

- Good tests assert observable outcomes at the highest existing seam: whether `memory_search` is requested with valid filters, whether a Graft context pack is injected, whether advisory context is available to the parent, and whether normal operation survives every classifier failure. They must not assert Jev rubric prose, private prompt layout, or helper call order.
- Test the shared Jev-client seam with injected model registry, auth, and completion transport. Missing Token-In subscription/credential, absent provider template, timeout, rejection, malformed JSON, nonnumeric/low confidence, and unknown choices must yield an absent decision without throwing.
- Test memory routing at the registered memory-tool boundary. Valid scoped plans use only `memory_search`; `none` and invalid plans do not search; project and category filters are valid; memory entry contents never appear in the Jev payload; and standing instructions remain present independent of routing.
- Test Graft routing at the existing pure task-classification and injection-plan seam. Clear coding/non-coding cases bypass Jev, ambiguous accepted `inject` preserves configured push/hybrid behavior, pull stays non-injecting, and rejection/failure preserves the existing no-injection fallback. Existing coverage, byte-bound, freshness, and at-most-once guards remain effective.
- Test skill/workflow recommendation at their discovery and validation boundary. Only discovered, eligible canonical candidates can be recommended; disabled, hidden, malformed, or oversized candidates produce no recommendation; a recommendation neither reads a skill file nor invokes a workflow or a subagent executor.
- Test verification routing as advisory behavior: valid level recommendations reach the parent, raw commands are never emitted, required verification is not weakened, and unavailable Jev leaves existing verification behavior unchanged.
- Test input lifecycle behavior with current extension/session harnesses: only idle top-level user input is eligible, explicit user selection wins, extension/command/steering inputs are skipped, and a retry or concurrent input cannot duplicate routing context.
- Test telemetry at the event boundary for outcome shape and absence of content. Telemetry exceptions must not change memory, Graft, recommendation, or session behavior.
- Follow existing auto-model tests for decisions-model fallback and bounded user context; Hermes memory tool and prompt-context tests for scopes, policy, and standing instructions; Graft prompt tests for classification, injection planning, coverage, and guards; AgentSession compaction characterization tests for session integrity; and subagent workflow/preflight tests for discovery and execution boundaries.

## Out of Scope

- Memory writes, replacements, deletion, consolidation, user-profile inference, or automated creation of procedural skills.
- Sending persistent-memory contents, assistant/tool transcripts, system prompts, credentials, or raw repository content to Jev.
- Replacing the existing memory policy, standing instructions, Graft modes, Graft source-backed retrieval, or manual catalog/discovery tools.
- Automatically loading skills, starting workflows, spawning subagents, running shell commands, or selecting workflow arguments.
- Generating, executing, or suppressing verification commands; changing required project/CI/acceptance gates.
- Project trust, permission grants, capability ceilings, workflow permits, authentication, retry classification, or error-recovery decisions.
- Changing compaction thresholds, cut points, summary generation, checkpoint persistence, retry behavior, or overflow recovery.
- Embeddings, vector stores, semantic indexes, fine-tuning, billing, or Token-In subscription administration.

## Further Notes

The testing seams intentionally reuse the project’s highest existing boundaries: the memory search tool and prompt context, Graft task classification/injection plan, skill and workflow discovery, parent advisory context, and AgentSession lifecycle. No new executor or persistence authority is introduced.

Graft already labels its lexical classifier as a deliberate heuristic with a provider-backed classifier as the measured upgrade path. That makes ambiguous-request classification the clearest additional Jev opportunity. By contrast, compaction already has deterministic token, cut-point, retry, and persistence safeguards; it is deliberately excluded from Jev control.

All routes follow the same rule: a small finite choice, host revalidation, and deterministic fallback. Missing Token-In access results in the current behavior, not a degraded or blocked turn.
