# Changelog

All notable changes to `@selesai/code` will be documented in this file.

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
