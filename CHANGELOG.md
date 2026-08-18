# Changelog

All notable changes to `@selesai/code` will be documented in this file.

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
