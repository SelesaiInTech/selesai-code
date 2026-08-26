# Extension-Only Automatic Model Routing

## Status

**Feasible with two important boundaries:** a Selesai extension can classify and route each **serially submitted, idle top-level user prompt** to a user-selected model without changing core. It cannot safely attach a different model to an already queued steering/follow-up message because model selection is session-global and the public extension API has no “queued message is about to run” hook. It also cannot guarantee per-prompt routing under **concurrent prompt submission** (for example parallel RPC prompts): the `input` hook runs while the session is still idle, so two concurrent prompts can both enter the classifier before either reaches the agent; whichever `pi.setModel()` finishes last wins for both. Robust per-prompt routing in either case needs one narrow core seam — a model override carried with the prompt or a pre-dispatch queued-message event.

The recommended first version is deliberately smaller than LiteLLM: reuse its four-tier classifier shape and agentic calibration, but omit proxy-only deployment, spend, adaptive-bandit, and management machinery.

## Requested behavior

Expose a built-in-feeling `auto` routing mode with four canonical levels:

| Tier | Intended work | User setting |
| --- | --- | --- |
| `simple` | greetings, lookups, tiny obvious transformations | one available Selesai model |
| `medium` | routine coding, edits, installs, explanations, ordinary debugging | one available Selesai model |
| `complex` | semantic debugging, architecture, multi-step engineering, difficult search | one available Selesai model |
| `reasoning` | open-ended tradeoffs, proofs, optimization, decisions requiring extended deliberation | one available Selesai model |

The user configures the model assigned to each tier. On each eligible prompt:

```text
current prompt + bounded conversation context
  -> classifier
  -> simple | medium | complex | reasoning
  -> configured model
  -> pi.setModel(model)
  -> normal Selesai agent turn
```

## What LiteLLM currently does

### Core mechanism

LiteLLM implements this as a pre-routing strategy in:

- `/Users/andrewanggada/Documents/workdir/js_proj/litellm/litellm/router_strategy/complexity_router/config.py`
- `/Users/andrewanggada/Documents/workdir/js_proj/litellm/litellm/router_strategy/complexity_router/complexity_router.py`
- `/Users/andrewanggada/Documents/workdir/js_proj/litellm/litellm/router_strategy/complexity_router/classification_rubrics.py`

Its built-in severity ladder is `SIMPLE < MEDIUM < COMPLEX < REASONING` (`config.py`, `ComplexityTier` and `TIER_SEVERITY_ORDER`). `ComplexityRouterConfig.tiers` maps each tier to a model or pool of models. A per-tier object can also supply request parameters such as `reasoning_effort` (`config.py`, `ComplexityTierModel`, `_normalize_tier_entries`, `_normalize_tier_model_configs`).

The live request lifecycle is driven by `ComplexityRouter.async_pre_routing_hook()` and `_classify_and_route()` (`complexity_router.py`, approximately lines 2082–2490):

1. Normalize Chat Completions or Responses input into messages.
2. Extract the newest real human ask.
3. Remove tool-only turns and harness reminder blocks.
4. Apply session affinity when enabled.
5. Detect a current plan-mode floor.
6. Apply deterministic keyword overrides.
7. Run the configured classifier.
8. Apply explicit escalation and plan-mode minimum tier.
9. Map the tier to a model or model pool.
10. Attach tier-specific request parameters.
11. Return a `PreRoutingHookResponse` so the normal Router selects a deployment.
12. Record a routing decision containing cause, tier, model, score/signals, and applied overrides.

### Classifier options

`ComplexityRouterConfig.classifier_type` supports:

- `heuristic`: local weighted scoring with no model call.
- `llm`: a configured model returns a structured tier.
- `custom`: a trusted classifier plugin returns a tier.

The heuristic classifier (`ComplexityRouter._score_and_classify`) scores seven dimensions:

- token count
- code keywords
- reasoning markers
- technical terms
- simple indicators
- multi-step patterns
- question count

Default boundaries are `0.15`, `0.35`, and `0.60`. Two or more reasoning markers can promote a request to `REASONING`, but the prompt must normally clear the simple/medium score floor first. LiteLLM's README documents this as a local, deterministic, sub-millisecond path.

The LLM classifier uses:

- a trusted classifier system rubric;
- a generated structured response schema constrained to the active tier names;
- the caller's system prompt quoted as untrusted task context;
- a bounded prior-turn window;
- the current ask.

The trust-boundary instruction is important: quoted caller text may describe the task, but cannot instruct the classifier to choose a specific tier. See `classification_system_prompt()`, `_custom_tier_prompt()`, `_tier_classification_model()`, `_classify_with_llm()`, and `_build_classifier_user_payload()`.

### Agentic calibration worth reusing

`classification_rubrics.py` contains an `agentic` preset specifically calibrated for coding-agent traffic. Its important boundary is:

- ordinary installs, builds, routine multi-file edits, and standard debugging are `MEDIUM`;
- non-trivial search, semantic/root-cause debugging, and optimization are `COMPLEX`;
- tradeoff-heavy decisions and genuinely difficult reasoning are `REASONING`.

This prevents “contains code” from automatically meaning “use the most expensive model.” That calibration is more valuable to Selesai than copying LiteLLM's proxy plumbing.

### Features not needed in the extension

Do not replicate these initially:

- model-group deployment health and load balancing;
- spend logs and savings-baseline accounting;
- API key/team authorization;
- FastAPI management endpoints and dashboard forms;
- adaptive Thompson sampling;
- embedding-based semantic keyword routing;
- deployment affinity;
- alias response restamping;
- arbitrary runtime classifier/routing plugins;
- user-defined tier taxonomies.

They solve proxy-scale concerns, not the requested local “choose a model for each of four levels” behavior.

## Selesai extension seams

### Prompt interception

Use the public `input` event documented in `/opt/homebrew/lib/node_modules/@selesai/code/docs/extensions.md` and implemented in `src/core/agent-session.ts`.

The `input` hook runs before skill/template expansion and, critically, before current-model authentication preflight. That makes it safer than `before_agent_start`: if the current model has missing or expired credentials, a `before_agent_start` router may never execute, while an `input` router can switch to an authenticated configured target first.

Eligibility rule:

```ts
if (event.streamingBehavior !== undefined) return { action: "continue" };
```

This intentionally skips queued `steer` and `followUp` input. Direct `steer()`/`followUp()` calls also bypass both `input` and `before_agent_start`. Since `pi.setModel()` changes session-global state, switching during streaming could affect the active request instead of only the queued request.

### Model discovery

The picker and router should use:

```ts
const candidates = ctx.scopedModels.length
  ? ctx.scopedModels.map(({ model }) => model)
  : ctx.modelRegistry.getAvailable();
```

`ctx.scopedModels` preserves the user's `--models` or `enabledModels` policy. An empty list means all available models are in scope. Store model identities as exact `provider/modelId` pairs and resolve them again before every switch with `ctx.modelRegistry.find(provider, id)`.

### Model switching

Use the public API:

```ts
const ok = await pi.setModel(model);
```

`pi.setModel()` changes the active session model, appends a model-change entry, adjusts/clamps thinking level, and emits `model_select`. It returns `false` when configured authentication is unavailable and may throw on a live authentication/provider failure.

Automatic selection should **not** persist the routed model as the global default. The public extension binding already avoids default persistence. The final auto-selected model will still survive session resume through ordinary session model-change entries.

### User configuration UI

The built-in `/settings` menu is not extensible. Its interactive entries are assembled as a fixed list in `src/modes/interactive/interactive-mode.ts` and `src/modes/interactive/components/settings-selector.ts`, with no extension contribution hook.

Therefore the extension should provide:

```text
/auto-model-settings
```

TUI behavior:

- Enable/disable automatic routing.
- Choose classifier mode.
- Select one model for each of the four tiers.
- Select fallback behavior.
- Show current mappings and last routing decision.
- Optionally run “test prompt” without submitting it.

Use `ctx.ui.custom()`/`SettingsList`, following:

- `/opt/homebrew/lib/node_modules/@selesai/code/examples/extensions/preset.ts`
- `/opt/homebrew/lib/node_modules/@selesai/code/examples/extensions/tools.ts`
- `src/extensions/pi-web-agent/src/commands/web-agent-config.ts`

Non-TUI behavior should be argument-based because `ctx.ui.custom()` is TUI-only:

```text
/auto-model-settings show
/auto-model-settings enable
/auto-model-settings disable
/auto-model-settings set simple anthropic/claude-haiku-4-5
/auto-model-settings set medium openai-codex/gpt-5.3-codex
/auto-model-settings test "fix this parser bug"
```

### Configuration storage

Use an extension-owned file, not the host's closed settings schema.

Recommended paths:

```text
Global:  getAgentDir()/extensions/auto-model/config.json
Project: <cwd>/<CONFIG_DIR_NAME>/extensions/auto-model/config.json
```

Only load project configuration when `ctx.isProjectTrusted()` is true. Merge defaults, global config, then trusted project config. Use `getAgentDir()` and `CONFIG_DIR_NAME` from `@selesai/code`; never hardcode `.pi`, `.selesai`, or a home-directory path.

Suggested minimal schema:

```json
{
  "enabled": false,
  "classifier": {
    "type": "llm",
    "model": "provider/model-id",
    "timeoutMs": 3000,
    "contextTurns": 3,
    "contextCharsPerTurn": 300
  },
  "tiers": {
    "simple": "provider/model-id",
    "medium": "provider/model-id",
    "complex": "provider/model-id",
    "reasoning": "provider/model-id"
  },
  "fallback": "current",
  "manualSelection": "suspend-until-enabled"
}
```

Keep the schema fixed to four tiers for version one. User-defined taxonomies, model pools, tier-specific thinking levels, and project/global UI scope toggles can wait until there is a demonstrated need.

## Recommended classifier design

### Decision

Start with an **LLM classifier using LiteLLM's agentic rubric**, plus a deterministic fallback. A heuristic-only classifier is cheaper, but keyword scoring is fragile for coding-agent prompts: repository context is technically dense even when the actual request is simple. The LLM rubric explicitly judges intellectual difficulty rather than length or technical vocabulary.

The classifier model is user-configurable and separate from the four routed models. It should normally be a fast inexpensive model.

### Classifier input

The classifier runs through the low-level provider-aware model path described in the runtime sequence below. Use only bounded data:

1. Current raw idle prompt.
2. Up to three prior human turns from the current branch.
3. Optionally prior assistant turns when enabled, capped per turn.
4. A short approximate conversation-depth signal.

Exclude:

- tool results;
- extension-injected messages;
- complete harness reminder blocks;
- raw secrets or entire large context files;
- images in v1 classification (presence of an image can enforce a vision-capable target check instead).

For raw `/skill:name` or prompt-template commands, `input` sees the unexpanded command. Route conservatively to at least `medium`, or classify the command name plus raw arguments. Do not move the main router to `before_agent_start` solely to see expanded content because that reintroduces the old-model authentication preflight failure.

### Structured output

Require exactly one JSON value:

```json
{"tier":"simple"}
```

Allowed values are `simple`, `medium`, `complex`, and `reasoning`. Reject free-text extraction. On timeout, provider failure, malformed JSON, or an unknown tier, use the configured fallback.

### Deterministic fallback

The minimum fallback should be conservative and small:

- explicit planning/architecture/tradeoff/proof/optimization markers -> `reasoning`;
- root-cause debugging, multi-system or substantial multi-file work -> `complex`;
- routine coding/edit/build/test requests -> `medium`;
- greetings/lookups/tiny transformations -> `simple`;
- otherwise -> `medium`.

Do not copy LiteLLM's full configurable seven-dimension scorer into v1. The LLM classifier is primary; a small fallback is easier to audit and only handles classifier failure.

## Runtime sequence

For every idle top-level `input` event:

1. Return unchanged when routing is disabled.
2. Return unchanged when `event.streamingBehavior` is `steer` or `followUp`.
3. Return unchanged for extension-injected messages to prevent recursion.
4. Load the effective merged configuration if it changed.
5. Build the eligible model catalogue from `ctx.scopedModels` or `ctx.modelRegistry.getAvailable()`.
6. Validate the four configured targets against that catalogue.
7. Extract a bounded classifier payload from the current prompt and session branch.
8. Run the configured classifier model with timeout and structured tier output using the low-level provider-aware path: resolve credentials through `ctx.modelRegistry.getApiKeyAndHeaders()`, prefer an extension-registered provider's effective `streamSimple` when applicable, and wrap headers/environment into the request exactly like `src/extensions/pi-subagents/src/runs/shared/llm-intent-arbiter.ts` does. There is no high-level classifier/completion API on `ExtensionAPI`; a direct low-level call without this provider plumbing can fail for custom extension-registered APIs.
9. If classification fails, run the deterministic fallback.
10. Resolve the selected tier's exact model.
11. If the model is missing, out of scope, or unauthenticated, apply fallback behavior:
    - `current`: keep the current model;
    - later optional mode: try the next lower configured tier.
12. If the target differs from `ctx.model`, set a short suppression flag and call `pi.setModel(target)`.
13. Record an extension session entry with tier, target, cause, and timestamp; do not include prompt text.
14. Update a compact status item such as `auto:medium -> gpt-5-mini`.
15. Return `{ action: "continue" }` without changing the prompt.

On `model_select`:

- ignore the event while the extension's suppression flag is set;
- otherwise treat `/model` or model cycling as manual intent;
- recommended policy: suspend auto routing for the session until the user explicitly re-enables it.

On `session_start`:

- load configuration;
- validate configured model references against the current catalogue;
- restore the last extension decision/status from custom session entries;
- use `ctx.model` as the reliable restored active model signal.

## Manual selection semantics

**Recommendation:** a manual `/model` selection suspends automatic routing for the remainder of the session. This avoids the frustrating behavior where a user explicitly picks a model and the next prompt immediately replaces it.

`/auto-model-settings enable` resumes routing. A later setting may offer `manualSelection: "next-prompt-only"`, but it is unnecessary for the initial implementation.

## Failure and fallback behavior

| Failure | Behavior |
| --- | --- |
| classifier timeout/error | deterministic fallback |
| invalid classifier JSON/tier | deterministic fallback |
| configured classifier model unavailable | deterministic fallback and one warning |
| routed model missing/out of scope | keep current model and warn |
| `pi.setModel()` returns `false` | keep current model and warn about auth |
| `pi.setModel()` throws | keep current model; record error without blocking prompt |
| non-interactive mode | route normally; no custom UI; errors go to logs/status where supported |
| streaming/queued message | do not route |
| no configuration | disabled by default |

Extension handler exceptions are logged and the prompt continues, but the extension should catch its own failures so the user receives a useful, bounded warning and routing state remains coherent.

## Proposed extension layout

```text
src/extensions/auto-model/
  index.ts             # event handlers and command registration
  config.ts            # schema, global/project load/save, validation
  classifier.ts        # rubric, payload construction, LLM call, deterministic fallback
  routing.ts           # tier/model resolution and failure policy
  settings-ui.ts       # /auto-model-settings TUI and argument subcommands
  state.ts             # session decision/manual-suspension state
  tests/
    classifier.test.ts
    config.test.ts
    routing.test.ts
    lifecycle.test.ts
```

This is a planning shape, not a mandate to create six abstractions immediately. If implementation stays small, combine `state.ts` into `index.ts` and `routing.ts` into `classifier.ts`. Keep only seams that are independently testable or stateful.

## Implementation phases

### Phase 1 — minimal extension and deterministic routing

1. Add the extension entry point and brand-aware config store.
2. Add fixed four-tier schema and validation.
3. Add `/auto-model-settings` with enable/disable/show/set commands and a TUI model picker.
4. Add a deterministic classifier/fallback.
5. Route idle top-level prompts through `input` and `pi.setModel()`.
6. Add session status and manual-selection suspension.

Exit criterion: users can configure four models, enable auto mode, and see deterministic prompts select the expected target without touching core.

### Phase 2 — LiteLLM-compatible agentic LLM classifier

1. Port the agentic four-tier rubric and trust-boundary instruction.
2. Add bounded prior-turn extraction from `ctx.sessionManager.getBranch()`.
3. Add structured JSON validation and timeout.
4. Add a separately configurable classifier model.
5. Preserve deterministic routing as fallback.
6. Add a `/auto-model-settings test <prompt>` preview that reports tier and target without changing the active model.

Exit criterion: the classifier handles short follow-ups, ordinary coding work, difficult semantic debugging, and tradeoff-heavy decisions consistently with the documented tier boundary.

### Phase 3 — hardening and product polish

1. Validate vision capability when a prompt includes images.
2. Add config file watching or reload-on-mtime if live edits matter.
3. Add privacy-safe decision history and optional debug display.
4. Measure classifier latency and route distribution.
5. Consider project overrides and scope selection in the UI.

Do not add model pools, adaptive routing, custom tiers, or spend dashboards until usage demonstrates a need.

## Verification

### Classifier checks

Use table-driven fixtures covering:

- greeting/lookup -> `simple`;
- routine one-file edit -> `medium`;
- normal package install/build -> `medium`;
- semantic root-cause bug hunt -> `complex`;
- architecture across systems -> `complex`;
- explicit tradeoff requiring a committed decision -> `reasoning`;
- trivial arithmetic wrapped in “think step by step” -> not automatically `reasoning`;
- short “yes/continue” after a difficult prior turn -> inherits the prior task;
- prompt injection requesting `reasoning` -> classified on merit;
- malformed/timeout classifier response -> deterministic fallback.

### Routing checks

- Scoped model catalogue is respected.
- Exact provider/model lookup is used.
- Missing model and missing auth preserve the current model.
- Automatic switches do not modify the global default.
- Manual `/model` selection suspends routing.
- Session resume restores the selected model and extension state.
- Extension-injected messages do not recurse.
- Streaming `steer`/`followUp` input never changes the active model.

### Configuration checks

- Global config loads from `getAgentDir()`.
- Project config loads through `CONFIG_DIR_NAME` only for trusted projects.
- Project values override global values.
- Invalid JSON does not overwrite a valid config.
- Atomic write/rename is used for saves.
- No `.pi`, `.selesai`, or home-directory config path is hardcoded.

### User-flow check

In a real TUI session:

1. Open `/auto-model-settings`.
2. Assign four distinct visible models.
3. Enable routing.
4. Submit one fixture from each tier.
5. Confirm the footer/status and actual `model_select` event match the expected configured model.
6. Manually select a fifth model with `/model`.
7. Submit another prompt and confirm auto routing remains suspended.
8. Re-enable and confirm routing resumes.

## Risks

1. **Queued-message limitation:** full per-message routing for steering/follow-up is not extension-safe today. Solving it requires a core API that attaches a model to a queued message or fires immediately before that queued message starts.
2. **Concurrent-prompt race:** two concurrently submitted prompts can both run the classifier while the session is idle; whichever `pi.setModel()` finishes last wins for both. Serialize classifier switches per session (handler-local mutex) and document that the guarantee covers serially submitted prompts; robust concurrent routing needs a per-prompt model override in core.
3. **Classifier cost and latency:** an LLM classifier adds a request before every eligible turn. Keep the classifier fast, timeout aggressively, and retain the deterministic fallback.
4. **Prompt sensitivity:** classification context may cross providers. Bound and document what is sent; offer heuristic-only mode for private/offline workflows.
5. **Raw versus expanded input:** `/skill` and prompt-template commands are classified before expansion. Default them conservatively rather than moving the whole router later in the lifecycle.
6. **Stale model catalogue/auth:** providers can change during a session. Resolve and authenticate on every switch; never assume stored model IDs remain usable.
7. **Manual intent:** automatic routing that silently overrides `/model` will feel broken. Suspend after manual changes.
8. **Thinking level changes:** `pi.setModel()` clamps thinking to model capability. A later version may need per-tier thinking settings, but v1 should accept host clamping and display the result.
9. **Settings-menu expectation:** the extension cannot add an item to built-in `/settings`; it must offer its own command unless core later adds a settings-contribution API.

## Decisions

### Recommended defaults

- Extension-only: **yes**.
- Core modifications: **none**.
- Tier set: fixed `simple`, `medium`, `complex`, `reasoning`.
- Primary classifier: user-selected fast LLM with the agentic rubric.
- Fallback classifier: small deterministic rules.
- Routing event: idle `input`.
- Streaming input: skip.
- Built-in settings integration: not possible; use `/auto-model-settings`.
- Config storage: extension-owned global/project JSON using host resolvers.
- Manual model choice: suspend auto routing for the session.
- Model pools/adaptive routing: defer.

### One product decision before implementation

Choose the initial classifier policy:

1. **Recommended — LLM primary + heuristic fallback:** better semantic boundary, added latency/cost.
2. **Heuristic only:** instant/offline, but more false classifications on technical prompts.
3. **User-selectable from day one:** both modes in v1, slightly more UI and test surface.

The architecture supports all three. The smallest high-quality first release is option 1 with the classifier model configurable.

## Non-goals

- Exact parity with LiteLLM proxy routing.
- Routing already queued steering/follow-up messages.
- Adding an item to built-in `/settings` without a new core contribution API.
- Changing the global default model on each route.
- User-defined tier taxonomies.
- Model pools, adaptive learning, deployment health selection, budget accounting, or savings dashboards.
- Modifying LiteLLM or Selesai core.

## Feasibility verdict

Build it as an extension. The public APIs cover the requested top-level flow: intercept at `input`, discover allowed models with `ctx.scopedModels`/`ctx.modelRegistry`, switch with `pi.setModel`, present a custom settings command, and store configuration with brand-aware host resolvers. Classification is possible with the public **low-level** model APIs (`@earendil-works/pi-agent-core`/`@earendil-works/pi-ai` plus `ctx.modelRegistry.getApiKeyAndHeaders()`); there is no high-level classifier/completion method on `ExtensionAPI`, so the extension must implement the classifier call itself with provider-aware plumbing.

The material mismatches with the phrase “each user message” are queued steering/follow-up input and concurrently submitted prompts. Document v1 as **automatic routing for each serially submitted, idle top-level prompt**. If routing queued or concurrent messages is later required, add one narrow core seam rather than moving the whole feature into core: a per-prompt model override or a pre-dispatch queued-message event.
