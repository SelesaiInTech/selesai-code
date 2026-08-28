# Changelog

All notable changes to `@selesai/code` will be documented in this file.

## [0.10.2] - 2026-08-28

### Added
- **Startup brand banner.** The interactive TUI now shows an ASCII logo banner on startup, followed by boxed listings of loaded skills (grouped by category) and active tools. The banner dismisses automatically on the first user message.
- **Skill categories.** Skills can declare a `category` frontmatter field; the startup skills box labels each skill with its category (e.g. `[design] brandkit`).

### Changed
- **`quietStartup` no longer hides the brand banner.** It now only suppresses the keybinding help and the loaded-resources listing; the logo banner always appears and is dismissed on the first user message.
- **Theme seeding.** Bundled themes now load directly from the installed package instead of being copied into `~/.selesai/agent/themes`. Copies left by older releases are removed at startup only when they are byte-identical to the bundled files, so user-edited themes survive. This also fixes the duplicate-theme name collisions on startup.

## [0.10.1] - 2026-08-28

### Fixed
- **Vision caption model picker in `/settings`.** Selecting a model (or `off`) in the "Vision caption model" submenu now updates the displayed value and closes the submenu correctly. Previously the selection was saved to `settings.json` but the settings row kept showing the old model, making the change appear to have no effect.

## [0.10.0] - 2026-08-27

### Added
- **Zentui TUI.** The bundled `pi-zentui` extension brings a Starship-inspired statusline, Opencode-style editor and user-message surfaces, working-line takeover, and a hidden zero-row footer option. Editor, user messages, working line, and selector borders have independent `enabled` fields; the footer uses one `style` (`native`, `starship`, or `hidden`). Configure live via `/zentui`, which persists to `~/.selesai/agent/zentui.json`.
- **TPS tracker.** The bundled `tps` extension shows live tokens-per-second for the main model and subagent runs in the status area. Final main-model TPS is gated against stalls, short streams, sparse updates, and implausible rates; tool-call-bound measurements are excluded.
- **Broader theme catalog.** Added 58 new terminal themes (including Catppuccin Mocha, Dracula, Gruvbox, Nord, Rose Pine, Solarized Dark, and Tokyo Night), shipped under `src/themes/`.
- **Design-reference skill.** The bundled `design-references` skill looks up `DESIGN.md` references from VoltAgent's awesome-design-md collection when asked for design references or a "feel like <site>" direction.

### Changed
- **Default thinking level** is now `high` (was `max`).
- **Default image caption model** is now `tokenin/qwen3.8-27b` (was `tokenin/gemma-4`).
- **Celestial Max and Celestial Ultra** now accept image input.
- **Default packages** no longer include `pi-markdown-preview`; `pi-tool-display` remains.
- **Docs redesign.** The documentation site now uses a ClickHouse-inspired black-and-yellow design language, and capability cards gained a "core differentiator" badge variant.

### Removed
- **`auto-model` extension.** Automatic model routing (added in 0.9.15) has been removed from the bundled manifest.
- **`pi-powerline-footer` extension.** The powerline footer, guide tour, queue/inbox, bash mode, and stash features were removed; Zentui and the TPS tracker cover the display surface.
- **`preview-tools-disabled` extension.**
- **`custom-provider-ollama` bundled provider.** The bundled Ollama provider was removed from the manifest; use the model-prompt-injector surface for provider plumbing or install the provider separately.
- **Orphaned `powerline` setting.** The `powerline` default setting, consumed only by the removed footer extension, was dropped.

## [0.9.15] - 2026-08-26

### Added
- **Bundled automatic model routing.** The new `auto-model` extension is disabled by default and can be configured with `/auto-model-settings`. It classifies eligible idle prompts into four tiers (`simple`, `medium`, `complex`, and `reasoning`), selects configured models limited to the current scope, and falls back to the current model when no target is available. Manual model selection suspends routing until explicitly enabled again; routing is serialized and does not run while the session is busy.

## [0.9.14] - 2026-08-26

### Changed
- **Adaptive workflow skill.** Replaced fixed `/workflow-*` commands with the bundled `$workflow` skill, which selects only the required pi-subagents planning, research, writing, review, and fix stages.
- **Workflow artifacts.** Built-in workflow roles persist named reports for the next stage, while the parent keeps one writer and final acceptance.
- **Question flexibility.** Select and multi-select questions now permit an Other answer by default; set `allowOther: false` to restrict choices.
- **Tool bootstrap.** The standard read-only tool catalog activates after the first durable tool call. Preview-export tools remain hidden without disabling Markdown preview rendering.

## [0.9.13] - 2026-08-26

### Changed
- **Selesai documentation refresh.** Reworked the documentation homepage with sharper hero typography, concise installation and capability copy, and reduced-motion-safe capability reveals.
- **Default implementation agents.** The built-in `architect` and `builder` roles now default to `tokenin/celestial-max:max` instead of `tokenin/celestial-pro:max`.

## [0.9.12] - 2026-08-25

### Added
- **Configurable built-in tools.** Use `defaultTools` to select the built-in tools enabled by default, or SDK `tools` and `excludeTools` to allowlist and remove individual tools; `powershell`, `grep`, `find`, and `ls` now participate in this unified tool configuration.
- **Upgraded collaboration extensions.** Bundled pi-subagents 0.56.0 adds fast OpenAI-Codex child runs, extension bindings, model selection controls, external-job follow-ups, child-scoped stops, durable workflow receipts, and improved workflow safeguards. Bundled pi-intercom 0.12.0 adds consent-aware extension outbox sends, scoped session routing, safer endpoint-bound delivery/retries, pending-ask records, and optional after-first-use tool visibility.
- **Design and output skills.** Added bundled skills for higher-quality frontend, brand, image-to-code, and image-generation workflows, plus complete-output enforcement and web-design reviews.
- **Unlazy skill.** Added the bundled `unlazy` skill for completion discipline — acceptance gates, depth-tree decomposition, reverified checks, and evidence-backed reporting via scripts/templates/tests shipped under `src/skills/unlazy`.

### Changed
- **Pi 0.84.3 runtime update.** Updated the embedded Pi runtime and selected agent-session behavior.

## [0.9.11] - 2026-08-25

### Fixed
- **Pi-compatible automatic skill discovery.** Skills under `~/.agents/skills/` and project/ancestor `.agents/skills/` directories, plus automatic skills from `.pi/skills/` and the Selesai agent skill directory, are now enabled by default — matching the Pi coding agent. Explicit `skills` patterns still control overrides and exclusions.

## [0.9.10] - 2026-08-25

### Fixed
- **Handoff from RPC hosts.** `/handoff-new` now generates and starts a child session in RPC/non-TUI hosts such as VS Code instead of requiring the terminal loader.
- **Terminal copy markers.** The `copy-turn` extension now adds its `/cp` markers only in the TUI, preventing terminal-only transcript rows from leaking into RPC host conversations and handoffs.

## [0.9.9] - 2026-08-25

### Fixed
- **Bundled `/handoff-new` extension.** Use packaged `.js` core module paths so the extension loads from `dist/extensions` without missing-module errors.

## [0.9.8] - 2026-08-25

### Added
- **RPC session handoff.** RPC clients can now use `handoff_new` to summarize the current session and start a clean child session seeded with the generated handoff, optionally tailored to a goal.

### Changed
- **Shared handoff generation.** Handoff context and summary generation now live in reusable core code shared by the TUI extension and RPC mode.

## [0.9.7] - 2026-08-25

### Added
- **RPC queue state and replacement.** RPC `get_state` now exposes pending steering and follow-up messages, and the new `replace_queue` command replaces both queues while preserving their routing. Parent sessions created through RPC are now passed directly to the session manager.

## [0.9.6] - 2026-08-23

### Fixed
- **Vision caption model selector.** Opening the selector from `/settings` now shows the available image-capable models instead of filtering the list by the configured model ID, highlights the current caption model, and preserves the Disabled option when switching model scopes.

## [0.9.5] - 2026-08-23

### Added
- **Questions in non-TUI modes.** The bundled `question` tool now works outside the terminal TUI (e.g. RPC/VS Code hosts): questions are answered through the host's `extension_ui_request` dialogs (`select`/`input`) instead of throwing, mirroring Cline/Kilo. Multi-select questions preserve full multi-selection when the host supports the new `multiselect` UI method, with single-select fallback for older hosts.
- **`multiselect` extension UI method.** `ExtensionUIContext.multiselect()` prompts for multiple choices and returns `string[] | undefined`. In RPC mode it emits an `extension_ui_request` with `method: "multiselect"` and accepts an `extension_ui_response` with a `values` array.

## [0.9.4] - 2026-08-22

### Changed
- **Extensible pi-subagents workflows.** The bundled `/workflow-*` extension is now a thin registry-based adapter over pi-subagents orchestration. Modes can use ordered runs, parallel discovery, or scripted conditional loops without adding command plumbing. The prototype workflow now runs external research and codebase exploration in parallel.
- **Workflow completion contract.** Build/review/fix loops now finish only when the reviewer reports `clean` with no remaining work, preventing a clean review of one slice from ending an incomplete plan.
- **Workflow documentation.** Replaced stale durable-state-machine documentation with the current pi-subagents launch, recovery, and extension model.

## [0.9.3] - 2026-08-22

### Fixed
- **Token-In model identifiers.** Replace the provider's removed `auto`/`auto-premium` identifiers with the bundled `celestial-pro`, `celestial-max`, and `celestial-ultra` models, and point factory defaults and model-specific prompt injection at the supported Celestial IDs.

## [0.9.2] - 2026-08-20

### Fixed
- **Token-In premium model availability.** Restore the bundled `auto-premium` model so existing premium model selections continue to resolve while the default remains the supported `tokenin/auto:max`.

## [0.9.1] - 2026-08-20

### Fixed
- **Token-In model defaults.** Use the supported `auto` model for the main session and core subagent roles, remove the unsupported `auto-premium` default, and update its bundled context window to 384K.

## [0.9.0] - 2026-08-20

### Added
- **Bundled Ollama provider.** Selesai now ships and tests an OpenAI-compatible local Ollama provider, and includes it in the bundled extension manifest.
- **Vision model selection.** `/settings` reuses the model selector for image-caption models, filters to image-capable models, supports disabling captioning, and keeps the choice separate from the main default model. Bundled Token-In defaults include `gemma-4` captioning and a 16,384-token context budget; `Qwen3-VL` is also available.

### Changed
- **Smarter vision caption recovery.** Image captions now get up to four attempts with fresh 60-second timeouts and backoff, instead of failing after one 15-second attempt.
- **Model defaults refreshed.** Token-In `auto`/`auto-premium` context windows are 256K; the bundled default is `auto-premium` for the main session and core subagent roles, while exploration/research roles use `auto`. The model prompt injector also covers `auto`.
- **Workflow auto-relaunch diagnostics.** Relaunch rounds reset projected workflow state cleanly, track launches/state writes/budget blocks/fan-out rejection, and stop with a precise reason when another round cannot make progress.
- **Bundled skills enabled by default.** Explicit user overrides still win, but additional bundled skills are now active unless disabled.
- **Pi Subagents surface simplified.** Removed FleetView/fleet inspector, durable schedules, and watchdog model recommendation/configuration actions; run status, missions, watchdog status/check, and ordinary async controls remain. Corresponding runtime code, schemas, tests, and references were removed or updated.
- **Documentation and test maintenance.** Updated the subagent API/configuration/observability/workflow references and added the Ollama provider to the standard test command.

## [0.8.12] - 2026-08-20

### Added
- **Token-In `auto-premium` model default.** The Token-In provider now bundles an `auto-premium`
  model alongside `auto` (reasoning, 512K context window, 64K max tokens, `max` thinking level
  mapped through), letting the provider pick the best premium model for each request.

## [0.8.11] - 2026-08-19

### Added
- **Image captioning relay for text-only models.** When the active model cannot accept images
  (e.g. DeepSeek `deepseek-v4-*` / `auto`) and a vision model is configured
  (`images.imageCaptionModel`), images pasted into chat or read via the `read` tool are described
  by the vision model (e.g. Gemma/Kimi) and the caption text is used by the main model in place of
  the raw image. Configure the vision model and its context budget from `/settings` ("Vision caption
  model" / "Vision context tokens").
- **Gemma 4 31B (Vision) as a bundled default** on the Token-In provider (`tokenin/gemma-4`,
  `input: ["text", "image"]`) — usable both as a captioner and as a main model.
- **Context-aware captioning.** The caption request now includes the user's current prompt and a
  bounded slice of the most recent user/assistant conversation (whole messages, tool output
  excluded), capped by `images.imageCaptionContextTokens` (default 16384). Full history is never
  sent, so the caption model's smaller context window is never overloaded.
- **Captioning status indicator.** While an image is being described, the TUI shows a "Reading image
  with vision model..." spinner (with a per-image 15s timeout and a brief notice on total failure),
  so captioning no longer looks like a frozen screen.
- **Skill enablement overrides** are now honored for built-in and additional skill resources
  (package-manager/resource-loader), and `getResolvedSkills()` is exposed on the resource loader.

### Changed
- **Model-prompt-injector** rule for the Token-In provider now matches `deepseek-v4-*` (was
  `deepseek-v4-pro`).

### Added (context)
- `images.imageCaptionContextTokens` sets the max recent-conversation token budget sent to the
  caption model (`0` disables context).

## [0.8.10] - 2026-08-18

### Changed
- **Higher default agent retry budget.** `src/defaults/settings.json` raises `retry.maxRetries` from 7 to 10, so transient provider failures get more automatic retry attempts before surfacing to you.
- **Powerline footer shows cache-read tokens and hit rate by default.** The bundled settings now set `powerline.cache_read.format` to `"both"` (tokens + cache-hit percentage), instead of relying on the extension's `"tokens"` fallback.

## [0.8.9] - 2026-08-18

### Added
- **`auto` model for the Token-In provider.** `src/defaults/models.json` gains an `auto` entry on the Token-In provider, a reasoning-capable model with a 512K context window and 64K max tokens. Its thinking-level map forwards the available thinking budgets (`minimal`–`xhigh` resolve to provider defaults, `max` → `"max"`) using the deepseek thinking format, so the provider can auto-select the best available model.

## [0.8.8] - 2026-08-18

### Added
- **`--use-theme <name>` CLI flag.** Sets the initial interactive theme for a run; the fullscreen theme controller applies an invocation-level theme before settings load, so the flag wins until you change the theme in `/settings`.
- **Transcript search highlighting.** The fullscreen TUI now highlights search matches live in the transcript, themeable via new optional `searchMatchBg`/`searchMatchText` colors (falling back to `selectedBg`/`text`).
- **Fullscreen exit output option.** `/settings` gained a **Fullscreen exit output** entry: exiting fullscreen can print the transcript as before (`"transcript"`) or only a session resume hint (`"resume-hint"`) via the new `fullscreenExitOutput` setting.
- **`defaultTools` setting.** Seeds the initial built-in tool selection for `createAgentSession`; when set, new sessions start with only the listed tools instead of the `read`/`bash`/`edit`/`write` default.
- **`sendUserMessage` template expansion.** Extensions can pass `expandPromptTemplates: true` to dispatch extension commands and expand skill commands/prompt templates from a sent user message.
- **Experimental strict tool sampling.** Under `PI_EXPERIMENTAL=1`, the built-in read/edit/write/bash tools request `json_schema` tool output with `strict: "prefer"`.

### Changed
- **Managed-tool downloads moved off the startup path.** The TUI mounts and stays responsive while `fd`/`rg` install; download progress and warnings are reported as chat status lines (with an `app.tools.expand` hint) instead of raw `console.log` output, and the interactive startup accepts input (with interrupt/exit/submit feedback) while it completes.
- **Collapsed large tool output.** Tool components now preview only the first 10 lines with an inline `... (N more lines)` expand hint instead of dumping the whole block.
- **Shared model-catalog refreshes.** Concurrent interactive all-catalog refreshes reuse one in-flight refresh while keeping each caller's cancellation independent, and refreshes are bounded by a short timeout.
- **Runtime dependencies updated to Pi 0.84.2.** `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, and `@earendil-works/pi-agent-core` moved to 0.84.2; `openAIResponses` model config gained an optional `supportsAdditionalTools` flag; `exportToHtml` accepts a `themeName` option.

## [0.8.7] - 2026-08-17

### Added
- **Pi Subagents updated through upstream 0.50.0.** The bundled extension advances through upstream 0.49/0.50 (single-child `{ agent, task }` runs, per-tool-call `toolTimeoutMs` with config/env precedence, `debug.run` inspection, builtin role overrides with `tools: "inherit"`, resumable retained-child listings, indexed async result inboxes) with the Selesai fork layers on top: branding, `.selesai` config routing, `SELESAI_SUBAGENT*` env vars, declarative `chain`/`tasks`/`clarify` modes, workflow auto-relaunch wiring, and same-model retry for transient provider errors.
- **`model-prompt-injector` extension.** Bundled and registered in the extensions manifest, it injects model-specific prompts into the system prompt when the active model matches a configured rule (provider/model globs, bare id/name patterns, first-match-wins, enabled toggle). Modes: `prepend`, `append`, or `replace`.
- **Wire-level tool schema pruning.** `pruneToolDescriptions` (default `true`) strips every per-field `description` from tool input schemas before they reach the model, keeping one-line tool descriptions. Stripped schemas are memoized and never mutated; UI/docs definitions keep full descriptions; `keepParameterDescriptions` opts a tool out.
- **Compact subagent tool description by default.** `toolDescriptionMode` now defaults to `"compact"` (~3.2 KB vs ~6.3 KB per model turn), and a missing/invalid custom description file falls back to compact.

### Changed
- **Slimmer default system prompt.** The always-on Pi-docs block shrank from 8 lines to 2 (paths only); docs are still read on demand when the user asks about pi.
- **Bundled defaults** now set `pruneToolDescriptions: true`.
- **Test coverage.** `src/extensions` (pi-* excluded) now enforces 100% stmt/branch/func/line coverage via vitest thresholds; `safeMaxTokens()` clamps missing/oversized context-window metadata to a sane default.

### Fixed
- **Subagent prompt-runtime suite passes inside subagent child environments.** The watchdog-lifecycle test now scrubs the steer env vars (`SELESAI_SUBAGENT_STEER_*`) before registering, so the steering inbox's extra `agent_end` handler cannot skew the handler count.

## [0.8.6] - 2026-08-15

### Added
- **Auto-relaunching workflows.** The four `/workflow-*` modes (task, prototype, quicktype, loop) now run fully unattended: when a scripted workflow exhausts its per-run fan-out budget before the goal is clean, the async executor mints a fresh budget and re-runs the same script with the same mission and progress file, up to `config.maxWorkflowAutoRelaunches` (default 12; `0` = unlimited). Only `budget` results relaunch — real child failures still surface immediately. `AsyncStatus` gained `workflowRelaunchCount`.
- **Packaged prompts now load.** The pi-subagents extension registers `resources_discover`, so the bundled prompts (`review-loop.md`, `parallel-*.md`, `gather-context-and-clarify.md`) are actually discoverable. The `workflow-drive.md` prompt was removed as superseded by auto-relaunch.
- **Goal visibility on workflow launches.** Each `/workflow-*` launch emits its goal at start (visible in `subagent status` workflow emits) and names the auto-created mission after the goal (`mission.list` / `mission.show`).

### Changed
- **Bounded build→review→fix rounds.** The workflow auto-loop now instructs the builder to implement one small, self-contained slice per round ("do not attempt the whole plan") instead of the entire plan at once, with per-run timeouts (build/fix 45m, review 15m).
- **Progress-file scoped reviews.** Builder appends a `## Round N` ledger entry (files, summary, validation) to `.pi-subagents/progress/<mode>.md`; the commentator scopes its review to the latest round entry plus the immediately preceding fix entry, falling back to the full uncommitted diff when the file is missing or empty. Blocking reviews must list a `Remaining work:` section; the next build round picks up from it.
- **Previous review feedback now reaches the next builder round** (previously it was dropped).

## [0.8.5] - 2026-08-14

### Added
- **`/settings-factory-reset` slash command.** Restores `~/.selesai/agent/settings.json` to the bundled factory defaults after a warning and confirmation. A backup is saved as `settings.json.bak` before the reset, credentials (`auth.json`), sessions, extensions, skills, and themes are untouched, and settings reload live without a restart.
- **Install from the public repository.** `npm install -g github:SelesaiInTech/selesai-code` now works: the package gained a `prepare` script that builds `dist` from source on install.

### Changed
- **Simplified install guide.** The documented install command is now plain `npm install -g @selesai/code`. The previous `--ignore-scripts` advice was actively harmful: `@ast-grep/cli` (a runtime dependency) requires its `postinstall` to fetch its platform binary. Quickstart, README, and doc-web install pages updated, and quickstart no longer references the upstream `pi` binary or `~/.pi` paths.
- **Bumped default `retry.maxRetries` from 5 to 7** in bundled defaults.

## [0.8.4] - 2026-08-13

### Fixed
- **Slash-launched workflows now surface live progress.** The pi-subagents slash bridge was dropping the workflow trace and chat-progress projection, so foreground scripted workflows (`/run` without `--bg`, `/chain`, `/parallel`, `/run-chain`) showed a static "Running…" card until completion. The bridge now forwards `details.workflow` and `details.chatProgress`, and the slash live-state holds a workflow-shaped snapshot, so the in-chat card shows per-child status, phases, and durations as children run.

## [0.8.3] - 2026-08-12

### Added
- **Pi v0.84.1 migration with fullscreen TUI by default.** Selesai now runs Pi's native fullscreen TUI mode (`tuiMode: "fullscreen"`) by default, with an alternate-screen viewport, a fixed dock for the input editor/status/widgets/footer, a scrollable transcript, and fullscreen-specific keybindings. `--tui-mode regular`, the `tuiMode` setting, or the `TUI mode` entry in `/settings` opt back into regular mode. The powerline extension's unsupported terminal-split compositor and mouse-scroll/chat-jump machinery were removed; its status, editor, and widgets now live in Pi's native dock through the standard extension APIs.

### Changed
- **Runtime dependencies updated to Pi v0.84.1.** `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, and `@earendil-works/pi-agent-core` moved to 0.84.1 and `undici` to 8.9.0, matching upstream `@earendil-works/pi-coding-agent` 0.84.1. The model-runtime/refresh APIs were ported to the new pi-ai publication model, and the interactive renderer now selects between Pi's `TuiMainScreen` (regular) and `TuiAltScreen` (fullscreen).

## [0.8.2] - 2026-08-11

### Fixed
- **Guide version-marking no longer locks in the implicit mode.** When the recurring guide marks a new version as seen, Selesai no longer writes the fallback `compact` mode into `settings.json` as if it were a user choice. An explicit `full`, `compact`, or `off` mode is still preserved across version-only writes, so the guide keeps following the current default until you choose otherwise.

## [0.8.1] - 2026-08-11

### Fixed
- **Powerline guide defaults to compact mode.** When `selesaiGuide.mode` is not set, the recurring `/guide` tour now opens in compact mode instead of the full tour. An explicit `full`, `compact`, or `off` setting is still honored.

## [0.8.0] - 2026-08-11

### Added
- **Powerline footer upgraded through upstream 0.12.3.** The bundled workspace now has a file-backed queue/inbox (`# <idea>`, `/idea`, `/ideas`, and `/queue`), compaction-safe prompt delivery, session-aware `/cd`, configurable layout/placement/separators, currency and subagent cost display, git-host icons, and faster cached token statistics.
- **Inline agent mentions work wherever they are intentional.** A known `#agent-name` can invoke an agent at the start, middle, or end of a message; ordinary mid-message hashes such as `issue #42` still pass through.
- **Agent Browser setup is bundled.** Selesai can guide and, after confirmation, provision the external browser-automation CLI without blocking startup.

### Fixed
- **Reliable `#`/`$` inline autocomplete (also fixes WSL).** The `#` agent picker no longer runs full agent discovery (builtin/user/project/package dirs plus node_modules walks) synchronously on every keystroke — results are cached per cwd with a short TTL. This matters especially under WSL: running from a Linux-side directory gives the app a `\\wsl.localhost\...` UNC cwd, where the discovery walk costs ~1s per keystroke and the editor's serialized request pipeline then drops/delays `#` (and queued `$`/`@`) suggestions while typing. A failed discovery or `getCommands` error now also falls back to the base provider instead of rejecting the editor's shared autocomplete request chain, which previously permanently disabled `#`, `$`, `@`, and Tab completion for the rest of the session.
- **No startup-blocking tool downloads.** The `rtk` extension previously ran `ensureTool("rtk")` inside its extension factory, so a missing/mismatched rtk binary triggered a GitHub download (with 120s timeouts) that blocked the entire startup — repeated every launch while the managed binary failed to install. Provisioning now runs after startup completes; bash commands issued before the hook is ready pass through un-rewritten. `fd`/`rg` provisioning at interactive init (pre-existing) remains the only awaited download.

## [0.7.0] - 2026-08-07

### Added
- **Inline skills via `$` tokens.** The `inline-skills` extension now triggers autocomplete and expands skill tokens with `$skill-name` (e.g. `$grill-me`, `$pdf-tools extract`) instead of `#skill-name`; typing `$` in interactive chat opens the skill picker. Text after the token stays in the user message, so arguments follow the skill normally.
- **Inline subagents via `#` tokens.** Typing `#agent-name` at the start of a message runs that agent directly (like `/run agent-name <task>`), and typing `#` in the editor autocompletes installed agents. Unknown or ambiguous agent names produce a notification and consume the input without sending anything to the main agent.
- **Managed RTK binary provisioning.** The bundled `rtk` extension now reuses a valid system binary (`>= 0.23.0`, probed with `rtk --version` and `rtk gain` to reject the unrelated Rust Type Kit binary) or provisions the pinned official release (`0.42.4`) into Selesai's managed binary directory with checksum verification. `PI_OFFLINE=1` disables downloads; `RTK_DISABLED=1` bypasses rewriting and managed installation. The generic tools manager now covers `fd`, `rg`, and `rtk` with optional pinned versions and checksum assets.
- **Subagents engine upgraded to upstream 0.41.0.** The bundled `pi-subagents` extension advances through 0.41.0: live status streaming for `subagent_wait`, durable project-scoped schedules, an observational external-runs provider, non-blocking `subagent_wait` subscriptions, inline one-row result summaries, FleetView model/thinking display, and restored workflow chat progress. The Selesai fork keeps config-dir routing through host resolvers and defaults debug artifacts on (`artifacts: false` opts out).
- **Bundled default subagent models updated to Token-In thinking budgets** (`kimi-k3:high`, `deepseek-v4-flash:max`), with `kimi-k3` accepting `max` thinking.

### Changed
- **Skills no longer register as `/skill:name` commands.** Skills are invoked inline via `$skill-name`; the `/` command list now shows only extensions, prompt templates, and built-in commands. Removed the skill-commands autocomplete registration (interactive and RPC `get_commands`), the `enableSkillCommands` setting/toggle, and related docs. The internal `/skill:` text expansion is retained for extension use (e.g. the ponytail `/ponytail-*` aliases).

## [0.6.3] - 2026-08-05

### Fixed
- **Repair package install by pinning Readability to the available 0.6.0.** The 0.6.2 release declared `@mozilla/readability` `^0.6.1` in the root and bundled `pi-web-agent` manifests, but the npm registry offers no 0.6.1 (latest published is 0.6.0), so fresh installs failed with `ETARGET`. Both manifests now declare the published `^0.6.0` and the root lockfile re-resolves the available 0.6.0 release, restoring clean `npm ci` and fresh installs.

## [0.6.2] - 2026-08-05

### Added
- **Top-level `pi-subagents` skill.** The delegation guidance skill now also ships as a bundled top-level skill under `skills/pi-subagents/` (with its four reference documents), loaded from the package at boot alongside the other bundled skills and seeded into the agent dir on first run — so parent-orchestration guidance is available without relying on the extension's internal copy.

### Changed
- **Reference-first foreground output.** The terminal renderer for delegated results no longer re-reads or re-inlines saved child output files: settled file-only results show the saved-output reference (path/size/lines) instead of replayed child prose, legacy/foreign results carrying only `savedOutputPath` get a synthesized path-only reference (the file is never read), and explicit `outputMode: "inline"` results keep their full text.
- **Safe bundled skill and settings seeding.** First-run bootstrap now adds a missing top-level `subagents` key to an existing user `settings.json` via byte-preserving textual insertion (user formatting, unknown keys, and unrelated settings survive verbatim), leaves any user-configured `subagents` untouched, and installs newly added bundled skills (like `pi-subagents`) while never overwriting user-edited skill files. The bundled subagent defaults now map each builtin agent to an explicit model.
- **Web-agent Readability range alignment.** The bundled `pi-web-agent` extension manifest now declares `@mozilla/readability` `^0.6.1`, matching the version resolved in the root package.

## [0.6.1] - 2026-08-05

### Added
- **Delegation contract and dynamic agent catalog.** `subagent({ action: "list" })` now exposes the runtime-resolved catalog as human text — executable/restricted status, source, aliases, role, normalized context, declared tools, and description — and as versioned machine metadata (`details.catalog` with `version`, `agents`, and `chains`). Delegation targets are selected from live discovery, not static prompt text.
- **Task-aware advisory routing.** An optional `task` on `action: "list"` appends a text-only recommendation for one canonical agent (implementation or read-only) based on the task intent, declared/inferred roles, and write-tool safety, or recovery guidance when intent is unknown or no safe candidate exists. The advice never launches, schedules, or persists work; execution remains an explicit separate call with the recommended canonical agent name.
- **Reference-first delegated results.** Normal completion now returns saved-output references plus status/lifecycle information instead of child prose. Full output is inspected through the saved output path, async status/transcript, or `resume`. Explicit `outputMode: "inline"` restores legacy full-output delivery, `output: false` disables durable output persistence with a bounded fallback, and per-child debug artifacts remain opt-in via `artifacts: true`.
- **Always-visible delegation guidance.** Default and custom system prompts now carry the active-tool delegation contract: inspect the delegation catalog before selecting, keep tiny targeted reads and simple answers local, delegate broad local investigation, external research, and mutation/implementation work, and keep the parent as decision-maker and normally the sole writer.

### Changed
- The parent `subagent` tool description now requires catalog-first, executable-only agent selection and no longer hardcodes bundled agent names in management examples; the routing contract is embedded in mandatory safety guidance so custom descriptions cannot remove it.
- Bundled agents now declare accurate descriptions and `acceptanceRole` (`writer` for `builder`, `read-only` for the advisory roles) so catalog output communicates routing capability without granting tools.

### Fixed
- Corrected impossible and stale bundled-agent contracts: the architect no longer relies on unavailable question/subagent tools, the builder's `contact_supervisor` use is conditional on bridge-injected instructions, and the researcher's grep.app tools are declared as MCP tools.
- Aligned bundled-agent documentation with runtime: exactly six builtin roles with accurate fresh/fork context defaults (only `architect` and `recapper` fork; `builder`, `commentator`, `explorer`, and `researcher` are fresh) and `.selesai` discovery paths instead of stale `.pi` references.

### Not included
- Phase 4 of the subagent-delegation program (optional enforcement of delegation policy) is intentionally omitted from 0.6.1. Routing remains advisory, and launch-time preflight remains the enforcement point.
