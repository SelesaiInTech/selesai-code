## Problem Statement

Optional extension tools are intentionally dormant behind the capability gateway so the agent does not pay the prompt cost of every tool schema on every turn. The current deterministic router only activates tools when an exact, alias, typo, or token-overlap match is uniquely strong. Requests expressed by intent rather than tool vocabulary can therefore require the agent to discover the catalog manually. Users with Token-In access to the Jev decisions deployment want the gateway to select the relevant optional tool from the live catalog using the current ask and bounded recent context, while users without that access retain today’s deterministic gateway behavior.

## Solution

Add an opt-in Jev-assisted routing stage to the capability gateway. The gateway will first keep its present deterministic route for uniquely identifiable optional tools. When that route cannot safely activate a tool, it will ask Jev a single constrained choice question over the currently eligible catalogued tools plus `none`.

The request will contain the latest user request and a bounded window of recent user turns. Conversation and catalog text are data to classify, never instructions. Jev may only select `none` or one tool from the supplied catalog. The host will validate the response, confidence, eligibility, and current activation state before activating the selected tool for the current run. Jev will never invoke a tool, alter built-in-tool availability, load a skill, or override trust and permission policy.

The feature is disabled by default. If Jev cannot be called—including no Token-In subscription or credentials, provider/model resolution failure, timeout, malformed response, low confidence, oversized decision payload, or network failure—the gateway will use its current deterministic behavior and remain non-blocking.

## User Stories

1. As an agent user, I want intent-based requests to activate the relevant optional tool, so that I do not need to know its exact tool name.
2. As an agent user, I want explicit tool-name and alias requests to retain the existing deterministic activation path, so that obvious requests stay fast and predictable.
3. As an agent user, I want the routing decision to account for my immediately preceding user requests, so that follow-up requests can select the right capability.
4. As an agent user, I want only a bounded amount of recent context sent to Jev, so that routing remains low-latency and avoids unnecessary prompt disclosure.
5. As an agent user, I want tool schemas to remain dormant until a tool is selected, so that routine turns retain the gateway’s prompt-size benefit.
6. As an agent user, I want the chosen optional tool activated only for the current agent run, so that a routing decision does not leak into unrelated work.
7. As an agent user, I want built-in tools and the gateway’s always-active code-context tools unaffected, so that normal coding and repository investigation remain available.
8. As an agent user, I want skills to remain behind their explicit loading boundary, so that tool routing cannot silently inject a skill’s full instructions.
9. As an agent user, I want a request that does not need an optional tool to select `none`, so that Jev does not introduce gratuitous tool use.
10. As an agent user, I want an unavailable Jev subscription to be invisible to my workflow, so that the capability gateway continues to work with its current deterministic routing and catalog tools.
11. As an agent user, I want timeouts, provider failures, and invalid Jev answers to fail closed, so that a classifier outage never blocks or destabilizes my request.
12. As an agent user, I want low-confidence Jev answers ignored, so that uncertain classifications do not activate unrelated capabilities.
13. As an extension author, I want my tool’s discovery summary, aliases, and category reflected in the Jev candidate catalog, so that routing uses the same public discovery metadata as the manual catalog.
14. As an extension author, I want only currently eligible gateway tools offered to Jev, so that it cannot select gateway internals, built-ins, excluded tools, or stale names.
15. As a security-conscious user, I want user conversation and catalog descriptions treated as classification material rather than executable instructions, so that prompt-injection text cannot choose a tool.
16. As an operator, I want telemetry to identify which routing path was taken without recording prompt text, so that routing quality can be measured without creating a conversation log.
17. As an operator, I want to distinguish deterministic activation, Jev activation, Jev abstention, and Jev fallback, so that subscription and classifier reliability can be diagnosed.
18. As a maintainer, I want all Jev consumers to share the same provider resolution, bounded-context, timeout, response-validation, and confidence semantics, so that a fix to Jev handling applies consistently.
19. As a maintainer, I want a catalog that exceeds the decision payload limit to retain the current gateway behavior, so that a large extension installation cannot make prompt startup unreliable.
20. As a maintainer, I want existing explicit `capability_catalog` and `capability_discover` operations to remain authoritative, so that users and agents always have a deterministic escape hatch.

## Implementation Decisions

- Introduce a small shared Jev decision client for the existing auto-model router and the two new routing consumers. It will own synthetic Jev model resolution through the configured provider, authentication, the normal chat-completions transport, timeout handling, JSON parsing, choice validation, confidence checking, and safe failure as an absent decision. It is a transport and validation primitive, not a generic policy engine.
- Add a gateway-specific opt-in configuration beneath the existing capability-gateway settings surface. It will reuse the established Jev provider/model defaults and support an enable flag, timeout, minimum confidence, recent-user-turn count, and character budget. Default configuration leaves current routing unchanged.
- Preserve the deterministic catalog router as the first and cheapest rung. A unique high-confidence deterministic tool route activates immediately and does not call Jev. Jev is considered only when that route does not activate an optional tool.
- Build Jev candidates from the same live eligible tool catalog used by `capability_catalog`. Each candidate carries its canonical tool name and compact discovery metadata. Gateway tools, built-ins, always-active Graft tools, and skills are not selectable candidates.
- Send a bounded newest-first selection of user-authored conversation, rendered oldest-first with the current request last. Do not send assistant messages, tool calls, tool results, hidden system prompt text, or arbitrary token history. The current request, previous user turns, and candidate descriptions are explicitly marked as untrusted material to classify.
- Ask one choice question whose legal answers are `none` and the canonical names of supplied candidates. Accept only an exact candidate name with numeric confidence at or above the configured threshold. Missing, malformed, duplicate, stale, ineligible, or low-confidence answers are abstentions.
- Validate the accepted choice again against the live catalog immediately before activation. Activation reuses the existing temporary active-tool mechanism and existing `agent_settled` reset; Jev never receives a tool schema or executes the tool.
- Bound the serialized candidate catalog and decision request. If the candidate set cannot fit the fixed safe payload budget without omitting a reliable choice set, skip Jev and use the present deterministic/no-auto-activation behavior rather than inventing a lossy ranking policy.
- Treat all Jev failures, including a missing Token-In subscription, as a normal fallback. The existing deterministic router, capability catalog, discover tool, skill-show tool, session lifecycle, and active-tool restoration remain available and do not wait for a retry.
- Emit non-content telemetry on the capability-gateway event channel: routing source, outcome, selected canonical tool when any, confidence bucket, candidate count, and duration/error class. Never emit prompt text, conversation turns, credentials, or raw Jev output.
- Do not change the capability gateway’s existing rule that skills are recommended or loaded only through explicit mechanisms. Jev-assisted routing applies only to optional extension-tool activation.

## Testing Decisions

- Good tests assert externally observable routing outcomes: which optional tools are active before the agent starts, whether the normal run continues, and whether the active-tool baseline is restored after settlement. They must not assert private prompt wording or incidental helper call order.
- Test the pure catalog decision seam with a mocked Jev response: deterministic unique matches bypass Jev; a valid high-confidence candidate activates; `none`, unknown candidates, low confidence, malformed JSON, and duplicate/stale candidates do not activate anything.
- Test the shared Jev-client seam with injected model registry/authentication and completion transport: no provider template, absent Token-In credential/subscription, timeout, transport rejection, and invalid response all return an absent decision without throwing.
- Test the bounded-context seam: current user request is retained, only the configured number and character budget of prior user turns is included, and assistant/tool/system content is absent. Include conversation and candidate prompt-injection strings to prove they remain data in the decision request.
- Test the extension lifecycle seam using the existing gateway session harness: Jev-selected activation is temporary, built-ins and always-active Graft tools remain active, and `agent_settled` restores the baseline.
- Test candidate construction against live catalog eligibility, including exclusion of built-ins, gateway tools, always-active tools, skills, disabled capabilities, and catalog entries that exceed the payload budget.
- Test telemetry at the event boundary for shape and absence of content, including deterministic, Jev-selected, abstained, and unavailable-Jev outcomes. Telemetry failure itself must not affect routing.
- Follow the existing capability-gateway unit tests for catalog semantics, integration tests for session lifecycle, and auto-model tests for Jev payload parsing, provider fallback, bounded user-turn context, timeout, and safe degradation.

## Out of Scope

- Executing a selected tool, choosing arguments for it, or bypassing the tool’s native schema and permission checks.
- Routing built-in tools, Graft tools, gateway tools, MCP direct tools, or skills through Jev.
- Automatically loading a skill or injecting fuzzy recommendations into the model context.
- Replacing the manual capability catalog or discover workflow.
- Persisting route decisions across runs or sessions.
- Training, fine-tuning, billing, or managing Token-In subscriptions.
- Adding semantic search, embeddings, a vector store, or a custom routing model.

## Further Notes

The proposed testing seams are the existing pure catalog router, the shared Jev decision boundary, and the capability-gateway session lifecycle. They preserve the present architecture: deterministic routing is still the first choice, and Jev is an optional best-effort classifier.

The existing auto-model extension already demonstrates the required fallback behavior: it resolves Jev through a provider template and returns a normal fallback when authentication, transport, parsing, confidence, or subscription access is unavailable. This feature must provide the analogous gateway fallback rather than blocking a turn.
