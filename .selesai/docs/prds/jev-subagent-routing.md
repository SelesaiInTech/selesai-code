## Problem Statement

The subagent system exposes specialized, configurable agents, but the parent model must currently decide both whether delegation is worthwhile and which agent to use from advertised descriptions or a later capability list. This can produce unnecessary delegation, choose a generic agent where a specialist exists, or miss useful parallel work. Users with Token-In access to Jev want a bounded decision over the currently executable subagent catalog using the latest request and recent user context. Users without Jev access must retain the present subagent behavior and all existing launch, capability-ceiling, permission, and preflight safeguards.

## Solution

Add an opt-in Jev-assisted subagent routing stage that classifies each eligible top-level request as `none` or one currently executable advertised subagent. The route is recommendation-first: a high-confidence decision is supplied to the parent agent as a concise, structured delegation recommendation. The parent retains control of whether to call `subagent`; it can refine the task, list capabilities, and follow the existing execution contract. Jev does not launch a child, create a workflow, select a model, select tools, grant permissions, or override an explicit user or parent-agent subagent selection.

The Jev question will contain the current user request, a bounded history of prior user turns, and a compact description of selectable subagents. The choice set includes `none`; candidate agents are derived from the same discovery, disabled-agent, capability-ceiling, advertisement, and executable-runner checks used by the existing subagent system. All supplied conversation and agent descriptions are material to classify, not instructions.

The feature is disabled by default. On no Token-In subscription or credentials, unavailable Jev provider/model, timeout, malformed/low-confidence answer, no eligible candidates, or any routing failure, it emits no recommendation and the parent receives today’s normal subagent prompt/catalog behavior.

## User Stories

1. As an agent user, I want the system to recognize when my request does not need delegation, so that simple work remains in the parent agent.
2. As an agent user, I want multi-step research, review, investigation, or isolated implementation work directed toward an appropriate specialist, so that delegated work fits the task.
3. As an agent user, I want a normal parent response when Jev selects `none`, so that delegation is not forced.
4. As an agent user, I want the current request and recent user follow-ups considered together, so that a follow-up is routed in the context of what I asked previously.
5. As an agent user, I want only bounded user-authored context sent to Jev, so that the decision is fast and does not expose arbitrary tool output or hidden prompts.
6. As an agent user, I want an explicit request to use a named subagent to win over automatic routing, so that I keep direct control.
7. As an agent user, I want the parent agent to retain responsibility for composing the delegated task, so that the child receives clear, current instructions rather than a raw classifier payload.
8. As an agent user, I want the parent to verify executable capabilities before delegation, so that a recommendation cannot launch a disabled or unavailable agent.
9. As an agent user, I want subagent routing to respect project and inherited capability ceilings, so that a classifier cannot escape the parent’s permitted agent set.
10. As an agent user, I want external CLI agents offered only when their runner is currently available, so that recommendations remain actionable.
11. As an agent user, I want no automatic child process created solely by a classifier decision, so that uncertain classification does not create unexpected cost or side effects.
12. As an agent user, I want the existing `subagent` tool, agent listing, and advertised-agent prompt to continue working when Jev is unavailable, so that a Token-In subscription is not a requirement for delegation.
13. As an agent user, I want a low-confidence route withheld, so that the parent decides normally when the specialist match is unclear.
14. As a project owner, I want project-specific agents and overrides represented in the candidate list, so that routing uses the project’s actual agent configuration.
15. As a project owner, I want disabled, restricted, runtime-only, and non-advertised agents excluded from automatic recommendations, so that Jev cannot surface an agent outside its discovery contract.
16. As a subagent author, I want my advertised description to be the compact routing description, so that the same specialization metadata drives both human/model discovery and Jev selection.
17. As a security-conscious user, I want conversation and agent metadata treated as data, so that embedded instructions cannot coerce a subagent choice.
18. As an operator, I want to know whether a recommendation came from Jev, whether it was used, and why it was unavailable, so that routing quality and Token-In availability can be evaluated without retaining prompts.
19. As a maintainer, I want an invalid, stale, restricted, or unavailable Jev-selected agent treated as `none`, so that discovery and preflight remain authoritative.
20. As a maintainer, I want the classifier to share provider resolution, timeout, parsing, confidence, and fallback behavior with other Jev features, so that availability fixes are consistent.
21. As a maintainer, I want a large agent installation to remain safe, so that an oversized candidate catalog falls back to normal delegation rather than truncating canonical agent identities.
22. As a maintainer, I want one recommendation at most per eligible top-level request, so that the classifier cannot create fan-out or nested-delegation pressure.

## Implementation Decisions

- Reuse the shared Jev decision client introduced for Jev-assisted routing. It provides only the existing decisions-model transport and validation behavior: provider-template/base-URL resolution, auth, JSON choice request/response handling, timeout, confidence threshold, and an absent-decision result on every failure.
- Add opt-in subagent-routing configuration under the subagent extension’s settings. It supports enablement, Jev provider/model, timeout, minimum confidence, recent-user-turn count, character budget, and a fixed decision-payload budget. The default is disabled and leaves current delegation unchanged.
- Run classification only for idle, top-level interactive requests that are eligible to start an agent turn. Skip slash commands, extension-injected input, queued/steering input, and prompts with an explicit named-agent request. Serialize classification so concurrent prompts cannot publish a stale recommendation.
- Create a candidate catalog from existing agent discovery rather than a new registry. Candidates must be file-defined, advertised, not disabled, allowed by the resolved capability ceiling, and executable at decision time. External CLI candidates additionally require current runner availability. Canonical names are never truncated; descriptions reuse the existing compact advertised-agent normalization and byte limits.
- Ask one Jev choice question over `none` plus the candidate canonical names. Its rubric determines whether delegation is beneficial for the latest request and, only if it is, which supplied specialization best fits. It does not determine task text, context mode, model, thinking, tool budget, runner, permissions, acceptance, async behavior, workflow structure, or child count.
- Send the current request and a bounded window of prior user turns, ordered with the latest request last. Exclude assistant turns, tool calls and outputs, system prompts, credentials, and arbitrary token history. State and candidate metadata are explicitly declared to be data to assess rather than instructions to follow.
- Accept only an exact valid candidate or `none` with numeric confidence meeting the configured threshold. Re-resolve the chosen canonical agent and its execution eligibility immediately before publishing the recommendation. Any mismatch is an abstention.
- Publish a compact, non-authoritative recommendation to the parent’s active prompt context: selected agent name, confidence, and the instruction to use existing `subagent` capability listing and launch validation before execution. Do not expose the full Jev payload or raw response, and do not make the recommendation an instruction to delegate.
- A route is advisory and never invokes `subagent` automatically. The parent model remains responsible for deciding whether to delegate, calling `subagent` with an appropriate task, and complying with the existing agent-selection guidance. An explicit parent-selected agent or user-requested agent takes precedence.
- If Jev is unavailable, including because no Token-In subscription/credential exists, publish no recommendation. Continue the existing advertised-agent prompt, proactive skill-subagent recommendations, list-capabilities operation, launch preflight, capability ceilings, and executor behavior unchanged.
- Bound the candidate payload using a fixed byte limit compatible with the existing advertised-agent catalog. If the complete selectable candidate set cannot fit safely, skip classification rather than truncate an identity or introduce a lossy ranking algorithm.
- Emit privacy-safe routing telemetry: eligible/request-skipped reason, candidate count, decision source, selected agent when any, confidence bucket, recommendation-published status, and elapsed/error class. Do not record user prompt text, prior turns, descriptions, raw Jev data, tokens, credentials, or child output.

## Testing Decisions

- Good tests assert user-visible behavior: whether a recommendation is present for an eligible turn, its selected canonical agent when valid, and the preservation of existing subagent behavior when no recommendation is available. They must not couple to the classifier’s prose rubric or private helper sequence.
- Test the pure routing decision seam with supplied candidate catalogs and mocked Jev responses. A valid high-confidence `none` produces no recommendation; a valid high-confidence eligible agent produces one; malformed JSON, nonnumeric/low confidence, unknown name, duplicate/stale candidate, and unavailable runner produce none.
- Test candidate construction at the existing discovery and capability boundary: only advertised file-defined agents are offered; disabled, runtime, restricted, non-advertised, and external-CLI-unavailable agents are excluded; project overrides and canonical names are preserved.
- Test bounded-context behavior with realistic session branches. The current request remains present, configured user-turn and character limits hold, and assistant/system/tool data are excluded. Include injection-like text in a user turn and agent description and assert that the generated decision state labels both as material.
- Test the extension event seam using the existing input/session harness. Classification runs only for eligible idle top-level prompts, skips extension/command/steering/explicit-agent cases, and concurrent submissions cannot publish competing routes.
- Test the recommendation-to-parent seam: the recommendation is concise, does not include raw classifier output, tells the parent to re-run existing list/capability validation, and does not invoke the subagent executor or create a child process.
- Test normal-operation fallback with injected missing Token-In auth/subscription, missing provider template, completion rejection, timeout, invalid payload, no candidates, and payload overflow. Every case must leave the ordinary advertised-agent and direct subagent workflow usable.
- Test telemetry at the event boundary for routing outcomes and non-content guarantees. Telemetry exceptions must not suppress a recommendation or normal parent turn.
- Follow existing auto-model tests for Jev transport, parsing, bounded context, and unavailable-classifier fallback; follow existing advertised-agent prompt tests for catalog limits and capability ceilings; follow agent-management and preflight tests for executable-agent and launch-policy behavior.

## Out of Scope

- Automatically launching a subagent, workflow, or external runner based solely on Jev’s choice.
- Replacing the parent model’s existing decision to delegate or its responsibility to formulate the child task.
- Overriding explicit user or parent agent selection.
- Selecting child model, thinking level, tools, permissions, budgets, context mode, runner, output mode, acceptance contract, async mode, or workflow topology.
- Routing nested subagent turns, retained workflow children, slash commands, queued steering, or extension-generated input.
- Changing agent discovery precedence, capability ceilings, preflight, authorization, process isolation, or recovery behavior.
- Persisting recommendations across sessions, training Jev, or administering Token-In subscriptions.
- Embeddings, semantic indexes, vector databases, or multi-classifier orchestration.

## Further Notes

The intended seams are the existing agent discovery/capability-ceiling boundary, the shared Jev decision boundary, the advertised-agent prompt builder, and the existing subagent launch preflight. This deliberately uses recommendation-first routing: it gives Jev a focused, measurable classification role without making a low-cost decisions model a new authority over child processes.

The normal fallback for no Token-In subscription is absence of a recommendation, not a degraded launch. The parent continues to see the current advertised-agent guidance and can use the existing `subagent` list and execution flow exactly as it does today.
