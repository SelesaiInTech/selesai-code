# PRD: Graft codebase-context extension

## Problem Statement

Selesai agents repeatedly reconstruct an understanding of a repository through `read`, `grep`, `find`, and import chasing. This increases tool calls, token use, latency, and the chance that an otherwise plausible change misses a coupled caller, sibling implementation, or blast-radius dependency. The work is repeated across Selesai sessions and delegated subagents even when the repository has not meaningfully changed.

Graft is an MIT-licensed TypeScript code-context system from Nanonets/Trail. It builds a local, regenerable graph from a working tree: deterministic tree-sitter structural data plus optional provider-backed deep summaries. It exposes semantic repository operations through a CLI and stdio MCP server, including code discovery, file API summaries, call tracing, regex discovery, repository maps, and freshness checks. Its graph reflects uncommitted working-tree changes when queried.

Graft's upstream `init` command is intentionally designed to wire several other coding agents. It can write agent-specific instructions, hooks, status-line configuration, MCP configuration, and—in some cases—user-level configuration. Running it from Selesai would be unsafe and would not create a native Selesai experience. Selesai needs a bundled extension that owns Graft's lifecycle, consent model, tool integration, TUI status, prompt strategy, and subagent availability without modifying configurations belonging to other agents.

## Solution

Ship a bundled Selesai Graft extension that integrates a user-installed, versioned Graft CLI as a project-local code-context provider. The extension provides a guided setup and health flow, project-scoped graph status, semantic Graft tools, controlled context injection, mutation-aware freshness feedback, and explicit subagent integration.

The extension supports three retrieval strategies:

- **Pull:** the agent calls precise Graft tools when it needs repository context.
- **Push:** before an eligible coding turn, the extension requests a bounded Graft source bundle and injects it into that turn's context. This is the default interactive mode.
- **Hybrid:** the extension injects only a small, bounded orientation result for eligible coding tasks while retaining the precise tools for follow-up.

The structural graph remains local and regenerable. Deep enrichment is separately opt-in because it sends source-derived content through a Graft-configured LLM provider. The extension never invokes Graft's upstream agent-wiring command automatically, never changes external agent configuration, and never silently installs or upgrades a floating executable.

## User Stories

1. As a Selesai user, I want an integrated codebase context layer, so that my agent starts from repository understanding instead of repeatedly rediscovering it.
2. As a Selesai user, I want Graft presented as a native Selesai extension, so that its capabilities fit the Selesai TUI, session lifecycle, tools, and project-trust model.
3. As a Selesai user, I want a clear `/graft doctor` result, so that I know whether the repository, Graft executable, graph, and optional deep provider are ready.
4. As a Selesai user, I want setup to explain every local file that a graph build can change, so that I can consent before `graft/` or `.gitignore` changes are made.
5. As a Selesai user, I want the extension never to run Graft's upstream agent-wiring command automatically, so that it cannot alter Claude, Codex, Cursor, or machine-wide configuration unexpectedly.
6. As a Selesai user, I want to use a versioned Graft executable that I installed or pinned, so that upgrades are deliberate and reproducible.
7. As a Selesai user, I want the extension to report a missing or incompatible executable without breaking a session, so that ordinary Selesai work remains available.
8. As a Selesai user, I want to build the local structural graph without an LLM key, so that I can use deterministic repository navigation without sending code to a provider.
9. As a Selesai user, I want deep graph enrichment to require explicit opt-in, so that source-derived summaries are not sent to a provider by surprise.
10. As a Selesai user, I want a visible distinction between structural and deep-enriched graph state, so that I understand the quality and privacy properties of the active context.
11. As a Selesai user, I want the status line to show whether Graft is unavailable, unbuilt, fresh, changed, refreshing, or failed, so that repository context is observable without opening a command.
12. As a Selesai user, I want the agent to find relevant code from a natural-language question, so that it can start implementation from likely systems and source locations.
13. As a Selesai user, I want the agent to inspect a file's API surface without loading every implementation body, so that routine orientation costs fewer tokens.
14. As a Selesai user, I want the agent to trace callers and dependencies of a symbol, so that it can assess change blast radius before modifying a shared behavior.
15. As a Selesai user, I want the agent to perform symbol-grouped regex discovery, so that broad repository searches retain semantic context.
16. As a Selesai user, I want the agent to request a repository map, so that it can orient quickly in an unfamiliar codebase.
17. As a Selesai user, I want the agent to check graph freshness, so that it does not reason from stale repository information.
18. As a Selesai user, I want tool results to be compact by default and expandable in the TUI, so that Graft helps the model without flooding the transcript.
19. As a Selesai user, I want Graft result output bounded before it enters model context, so that an unusually broad query cannot cause context overflow.
20. As a Selesai user, I want a pull mode, so that the model retrieves only the context needed for the current question.
21. As a Selesai user, I want a push mode, so that clear coding tasks can begin with relevant source-backed context already available.
22. As a Selesai user, I want a hybrid mode, so that the agent receives modest orientation while retaining precise retrieval for difficult follow-up questions.
23. As a Selesai user, I want context injection to be visibly recorded in the session, so that I can distinguish user input, agent work, and extension-provided repository context.
24. As a Selesai user, I want context injection to be bounded, task-aware, and disabled for non-coding prompts, so that it does not create latency or irrelevant prompt noise.
25. As a Selesai user, I want edits and writes to mark Graft context changed, so that the status UI accurately reflects that the working tree moved.
26. As a Selesai user, I want Graft queries to remain correct after unstaged and uncommitted changes, so that I do not have to commit or manually rebuild before asking an agent to continue.
27. As a Selesai user, I want refresh work to be debounced and idle-aware, so that a sequence of edits does not block agent progress with redundant graph builds.
28. As a Selesai user, I want the extension to expose only read-oriented Graft tools, so that retrieving context cannot mutate my repository.
29. As a Selesai user, I want Graft commands invoked with structured executable arguments and a resolved repository root, so that paths with spaces and task text cannot become shell injection.
30. As a privacy-conscious Selesai user, I want extension-spawned Graft telemetry disabled by default, so that anonymous telemetry is not enabled merely by adopting the integration.
31. As a privacy-conscious Selesai user, I want deep-build setup to show the configured Graft provider boundary, so that I can decide whether provider-backed summaries are acceptable for this repository.
32. As a Selesai user, I want missing graph, no Git repository, unsupported source, command failure, cancellation, and timeout states explained with actionable recovery commands, so that a failed context lookup does not leave the agent guessing.
33. As a Selesai user, I want project-local behavior to load only after Selesai project trust is established, so that untrusted repositories cannot cause unapproved configuration or command behavior.
34. As a Selesai user, I want a Graft-aware scout agent, so that delegated reconnaissance can use repository maps, code discovery, file APIs, and call traces before reporting findings.
35. As a Selesai user, I want a Graft-aware impact reviewer, so that a delegated review can identify callers, dependencies, and likely sibling changes before accepting a patch.
36. As a Selesai user, I want a Graft-aware worker to receive only the necessary context and tools, so that implementation subagents remain focused and follow Selesai capability ceilings.
37. As a Selesai user, I want foreground and background subagents to receive Graft only when their profiles explicitly load and allow it, so that strict child tool contracts remain truthful.
38. As a Selesai maintainer, I want the extension to work in interactive, print, JSON, and RPC modes without assuming a TUI, so that automation and integrations remain safe.
39. As a Selesai maintainer, I want stable native tool contracts rather than exposing arbitrary Graft shell execution, so that models have a focused and auditable context interface.
40. As a Selesai maintainer, I want compatibility checks against a supported Graft CLI version range, so that upstream CLI changes fail clearly rather than silently producing wrong context.
41. As a Selesai maintainer, I want structured diagnostics and session-visible status entries, so that support reports can identify availability, graph state, command failures, and selected retrieval mode.
42. As a Selesai maintainer, I want the integration to coexist with Rewind, Undo, tool display, subagents, and existing read/search tools, so that code-context retrieval does not disrupt recovery or normal agent behavior.
43. As a team member, I want the graph treated as a local regenerable cache rather than a required committed artifact, so that source control does not accumulate derived graph data.
44. As a team member, I want optional project guidance to document the chosen Graft workflow without modifying unrelated agent instructions, so that teammates can adopt the same workflow intentionally.

## Implementation Decisions

- Introduce one bundled Graft extension package. It owns Graft availability checks, repository resolution, command execution, status rendering, settings resolution, semantic tool registration, prompt strategy, mutation tracking, and session cleanup. It must be registered with the bundled-extension loader and distributed with the normal Selesai extension assets.

- Treat Graft as an external executable integration, not a vendored library and not a floating `npx` command. The extension resolves a user-installed executable, probes its version, and enforces a documented compatible range. This avoids silently introducing Graft's tree-sitter and provider dependency graph into Selesai's runtime and makes upgrades user-controlled.

- Use the Graft CLI as the initial execution boundary. Graft's documented MCP server remains an interoperability option, but Selesai does not ship built-in MCP and direct MCP tools require the optional adapter ecosystem. A native extension gives Selesai control over lifecycle, TUI rendering, prompt injection, project trust, and subagent profiles without making MCP adapter installation a prerequisite.

- Do not invoke the upstream Graft agent-integration command. Selesai setup is limited to probing, explaining local effects, and executing explicit graph build operations after consent. It does not modify external-agent instruction files, MCP configurations, hooks, status lines, or user-level configuration.

- Resolve the repository root before each project-scoped operation and pass it as the command working directory through the extension execution API. Commands are executable-plus-argument arrays; no user prompt, path, regex, or symbol is interpolated into a shell string.

- Register six native, read-only semantic tools aligned to Graft's public MCP surface: code discovery, file API inspection, call tracing, grouped regex discovery, repository mapping, and freshness checking. Tool schemas validate question text, repository-relative paths, symbols, trace direction, depth, and regex input. Tool descriptions instruct the model to prefer Graft for orientation and blast-radius analysis while retaining Selesai `read` for exact source verification.

- Adapt documented Graft CLI operations behind those stable Selesai tools and normalize their output into a structured result contract. The adapter retains raw command diagnostics only in structured details, returns bounded model-facing text, and surfaces command exit failures as tool errors.

- Use Selesai's standard output truncation utilities for every Graft result. The default view is a concise answer, summary, and source references; expanded TUI rendering shows command metadata and additional matches. Full output must not be silently discarded: truncation reports the limit and a safe recovery path.

- Maintain a project/session graph state machine with at least: unsupported, unavailable, incompatible, unbuilt, building, fresh-structural, fresh-deep, changed, refreshing, and failed. The state drives the status bar, command availability, diagnostic messages, and automatic retrieval eligibility.

- Start only session-scoped activity from session lifecycle handlers. Do not create timers, watchers, or child processes in the extension factory. Dispose debounced refresh work and clear status on session shutdown and on session replacement.

- Provide explicit setup, build, deep-build, refresh, status, doctor, and mode commands. Setup and build command flows require interactive confirmation before an operation that may create the graph cache or update ignore rules. In non-interactive modes, mutation-capable setup/build commands fail with the exact manual command instead of prompting.

- Support pull, push, and hybrid retrieval modes as a genuine behavioral choice, not an undocumented flag. Push is the default. Push invokes a bounded source-backed Graft query before eligible agent turns. Hybrid performs a bounded orientation query only when a task classifier identifies repository implementation, debugging, review, refactor, or verification intent; it never injects context for simple chat, command, or explicitly disabled turns.

- Persist the selected retrieval mode and extension-originated injection metadata as session-native custom entries. The persisted data records the mode, graph state, bounded source references, and truncation facts, but not unbounded raw graph output. This preserves branch and resume observability without treating extension metadata as ordinary user context.

- Make task-context injection idempotent within a turn and respect the final chained Selesai system prompt. Inject Graft context through the turn lifecycle rather than mutating user text. The injection explicitly identifies its source and tells the model that source files remain authoritative.

- Observe successful built-in `edit`, `write`, and bash results to transition graph state to changed. Do not block a mutation while reindexing. Graft retrieval remains the correctness boundary because it refreshes against the working tree on query; optional proactive refresh is debounced, runs only while idle, and never starts after session shutdown.

- Default extension-spawned Graft commands to `DO_NOT_TRACK=1`. The extension does not call Graft's persistent telemetry-disable command or alter user-global Graft configuration. An explicit project/user setting may allow the user's existing Graft telemetry preference to pass through.

- Deep builds are an explicit privacy boundary. Before the first deep build, show that Graft uses its own provider environment configuration and that the source-derived work may leave the machine. Do not copy, infer, or expose Selesai provider credentials into Graft configuration.

- Keep graph data project-local and regenerable. The extension documents that the graph cache is not normally committed. It never deletes graph data or rewrites ignore rules outside an explicitly confirmed setup/build operation.

- When pi-graft is active, automatically augment the code-facing pi-subagents builtins with the required Graft tools and foreground-child provider. Foreground and background behavior follows Selesai's existing extension-loading and capability-ceiling rules; no child is assumed to inherit ambient extension tools.

- Keep all Graft tools read-only under Selesai's capability model. Any future Graft visualization, graph maintenance, or MCP management capability remains command-gated and is not exposed as an autonomous mutation tool.

- Provide mode-safe behavior: UI notifications and confirmations are guarded by `hasUI`; TUI-only status and rendering are guarded by TUI mode; print and JSON modes retain tool behavior and actionable textual diagnostics.

## Testing Decisions

- Tests verify externally observable extension behavior: registered commands and tools, command arguments and working directories, graph-state transitions, user-visible diagnostics, session metadata, context-injection boundaries, and subagent tool availability. They do not assert private helper layout, local variables, or internal timer implementation.

- Reuse the existing Vitest extension-test seam: construct a minimal ExtensionAPI stub, capture registered handlers/tools/commands, provide deterministic execution results, and invoke lifecycle handlers with a controlled extension context. Existing agent-browser tests are the prior art for executable probing, installation/confirmation flows, no-UI behavior, timeouts, and platform command handling.

- Add unit tests for executable discovery, semantic argument validation, version compatibility, repository-root resolution, command-array construction, output normalization, truncation, telemetry environment defaults, error normalization, and cancellation propagation.

- Add lifecycle tests for session start/reload/shutdown, status rendering, unavailable and incompatible states, unbuilt/fresh/changed/failed transitions, and cleanup of pending refresh work. Tests must prove that the extension factory itself starts no long-lived work.

- Add command-flow tests for doctor, status, setup, structural build, deep build, refresh, and retrieval-mode selection. Confirm that mutation-capable commands require UI confirmation and that non-interactive mode reports manual recovery instructions without issuing a build command.

- Add tool contract tests for each semantic Graft operation. Validate that inputs map to the intended documented Graft operation, failed commands throw tool failures, source/path output is bounded, and successful results preserve sufficient structured details for TUI expansion and session reconstruction.

- Add prompt-strategy tests at the `before_agent_start` seam. Verify pull injects nothing, push injects one bounded source-backed context entry for an eligible turn, hybrid skips non-coding prompts, repeated handlers do not double-inject, and injected context identifies Graft as non-authoritative relative to source files.

- Add mutation-observation tests at the existing `tool_result` seam. Verify successful edit/write and clearly mutating bash operations mark the graph changed; failed calls and read-only commands do not. Verify a later successful Graft query returns the status to fresh rather than forcing a synchronous build after each edit.

- Add subagent configuration tests at the shared strict child tool-resolution seam used by foreground and background launches. Verify that active pi-graft automatically augments code-facing builtins with its provider and every Graft tool in the resolved child plan; pi-subagents' suite remains the launch-availability regression check.

- Add a small real Git fixture integration test, gated behind an installed compatible Graft executable. It builds a structural graph, makes an uncommitted source edit, then verifies a retrieval operation can locate the changed symbol. The regular test suite uses stubs so it stays deterministic and does not require provider credentials or network access.

- Run the extension's focused Vitest suite, the existing bundled-extension suite, type checking/build, and the relevant subagent tests before release. The integration test must remain opt-in so ordinary CI does not install packages, call external providers, or emit telemetry.

## Out of Scope

- Vendoring Graft's implementation, tree-sitter grammars, or provider clients into Selesai.
- Automatically installing, upgrading, or pinning Graft for the user.
- Automatically invoking Graft's upstream `init` command or editing configuration for Claude Code, Codex, Cursor, Gemini, Copilot, or other external agents.
- Shipping or requiring the optional MCP adapter solely for the first native Selesai integration.
- Implementing a generic MCP client inside the Graft extension.
- Replacing Selesai `read`, `grep`, `find`, or `bash` tools; Graft is a semantic context complement, not a filesystem-tool replacement.
- Automatically enabling provider-backed deep enrichment or transferring Selesai credentials to Graft.
- Synchronizing or committing the generated graph cache to version control.
- Building a visual graph explorer beyond concise status and normal tool-result rendering.
- Changing Rewind, Undo, project trust, subagent isolation, or existing core session semantics.
- Supporting languages Graft itself does not support.
- Guaranteeing Graft's benchmark results for Selesai models, providers, repositories, or tasks.

## Further Notes

- Primary external evidence is the Graft repository: https://github.com/trailhq/Graft. It documents the local structural graph, optional deep enrichment, local graph cache, working-tree freshness behavior, public MCP tool surface, supported languages, agent-wiring side effects, and telemetry controls.

- Selesai already has the extension seams needed for this feature: lifecycle events, custom tools, commands, prompt injection, tool-result observation, session custom entries, project trust, status widgets, output truncation, and structured command execution.

- Selesai does not include MCP in its core. Its subagent system can use direct MCP tools when the optional adapter is installed, but it requires explicit tool and extension policy. This PRD deliberately uses native extension tools first because native integration provides the full Selesai experience without expanding the MCP dependency surface.

- The existing Rewind extension is relevant prior art for project/session state that survives resume, fork, tree navigation, and compaction. Existing agent-browser tests are relevant prior art for a bundled extension that manages an external executable safely.

- Test seams are presumed to match the requested extension-first integration: ExtensionAPI registration, session lifecycle, `before_agent_start`, `tool_result`, strict subagent tool resolution, and a real Git fixture. The implementation should preserve these seams unless the public Selesai extension contract changes.

## Amendment: automatic subagent augmentation

Graft-aware behavior is an integration between loaded extensions, not a second
copy of pi-subagents profiles. `pi-graft` listens for pi-subagents' builtin-agent
augmentation request and contributes one additive patch for `scout`, `reviewer`,
`worker`, `delegate`, and `oracle`: the six read-only Graft tools and pi-graft's
own module path as the foreground child provider. `researcher` remains unchanged.

pi-subagents applies that patch only to selected builtins. User/project profiles
remain higher priority, and an explicit builtin override of `tools` or
`subagentOnlyExtensions` remains authoritative. The child plan still receives the
provider path because foreground children deliberately do not inherit the parent's
ambient extensions; background children already do.

No Graft-specific agent files, environment mutation, or sibling-relative extension
paths are shipped. `src/extensions/pi-subagents/agents/` remains upstream-shaped.
`scripts/verify-graft-integration.mjs profiles` runs the actual event handshake,
builtin discovery, augmentation, and shared strict child-plan resolver in source
and packaged trees. This is the shipping guarantee.
