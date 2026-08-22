# Extension documentation maintenance matrix

This worksheet is an internal reference for keeping Selesai's bilingual
extension documentation accurate. It is not published as user-facing content.

## Inventory

| Slug | Bundled | Manifest entry | Runtime surface | EN guide | ID guide | Source focus |
|------|---------|----------------|-----------------|----------|----------|--------------|
| copy-turn | bundled | `./copy-turn.ts` | command | continuity/copy-turn.mdx | id/continuity/copy-turn.mdx | copy-turn.ts |
| context-compaction-reminder | bundled | `./context-compaction-reminder.ts` | automatic | continuity/context-reminder.mdx | id/continuity/context-reminder.mdx | source + test |
| pi-intercom | bundled | `./pi-intercom/index.ts` | mixed | continuity/intercom.mdx | id/continuity/intercom.mdx | README/config/index |
| ponytail | bundled | `./ponytail/index.js` | skill-backed | skills/ponytail.mdx | id/skills/ponytail.mdx | extension + skills |
| question | bundled | `./question` | tool | research/question.mdx | id/research/question.mdx | index.ts, schemas.ts, tests |
| grep-app | bundled | `./grep-app` | tool | research/grep-app.mdx | id/research/grep-app.mdx | index.ts |
| handoff-new | bundled | `./handoff-new.ts` | command | continuity/handoff-new.mdx | id/continuity/handoff-new.mdx | handoff-new.ts + skills |
| inline-skills | bundled | `./inline-skills.ts` | skill-backed | skills/inline-skills.mdx | id/skills/inline-skills.mdx | inline-skills.ts, core/skills.ts |
| rtk | bundled | `./rtk.ts` | automatic | skills/rtk.mdx | id/skills/rtk.mdx | rtk.ts |
| tokenin-onboarding | bundled | `./tokenin-onboarding.ts` | command | workspace/tokenin-onboarding.mdx | id/workspace/tokenin-onboarding.mdx | tokenin-onboarding.ts |
| undo | bundled | `./undo.ts` | command | continuity/undo.mdx | id/continuity/undo.mdx | undo.ts |
| workflow | bundled | `./workflow` | mixed | delegation/workflow.mdx | id/delegation/workflow.mdx | extension.ts, adapter.ts, modes |
| pi-subagents | bundled | `./pi-subagents` | mixed | delegation/pi-subagents.mdx | id/delegation/pi-subagents.mdx | README, slash-commands, config |
| pi-web-agent | bundled | `./pi-web-agent` | mixed | research/web-agent.mdx | id/research/web-agent.mdx | extension.ts, commands, backends |
| web-agent-onboarding | bundled | `./web-agent-onboarding.ts` | command | workspace/web-agent-onboarding.mdx | id/workspace/web-agent-onboarding.mdx | web-agent-onboarding.ts |
| pi-powerline-footer | bundled | `./pi-powerline-footer` | mixed | workspace/powerline-footer.mdx | id/workspace/powerline-footer.mdx | README, index, config, tests |
| pi-rewind-hook | optional | (not in manifest) | automatic | continuity/rewind.mdx | id/continuity/rewind.mdx | README + source |

## Extension-by-extension maintenance fact sheets

### copy-turn

- **Startup behavior**: Loaded automatically at boot via `./copy-turn.ts`; registers `/cp` command.
- **Prerequisites**: Bundled; requires a valid session hash to copy.
- **Config / settings / env**: None.
- **Commands / tools / shortcuts**: `/cp <hash>`.
- **Persistence scope**: Session command only; does not persist copied content.
- **Test / source evidence**: `src/extensions/copy-turn.ts`.
- **Limits / failure behavior**: Only copies content addressable by the provided hash; no undo for copied content.

### context-compaction-reminder

- **Startup behavior**: Loaded automatically at boot via `./context-compaction-reminder.ts`; warns on large context.
- **Prerequisites**: Bundled; interactive TUI session.
- **Config / settings / env**: None.
- **Commands / tools / shortcuts**: Automatic; suggests `/handoff-new`.
- **Persistence scope**: Stateless notification.
- **Test / source evidence**: `src/extensions/context-compaction-reminder.ts` and its tests.
- **Limits / failure behavior**: Only warns; does not force compaction. Does not estimate cost directly.

### pi-intercom

- **Startup behavior**: Loaded automatically at boot via `./pi-intercom/index.ts`.
- **Prerequisites**: Bundled; named local Selesai sessions for `ask`/`reply` routing.
- **Config / settings / env**: Session naming must be stable across processes. No separate credentials.
- **Commands / tools / shortcuts**: `ask`, `reply`, attachment APIs; not exposed as slash commands.
- **Persistence scope**: Messages are local to the machine and session-pair namespace.
- **Test / source evidence**: `src/extensions/pi-intercom/index.ts`, README, config.
- **Limits / failure behavior**: Cannot reach remote/network peers; both endpoints must run Selesai locally.

### ponytail

- **Startup behavior**: Loaded automatically at boot via `./ponytail/index.js`; skill-backed compression.
- **Prerequisites**: Bundled; companion skill files in `src/skills/ponytail*/`.
- **Config / settings / env**: No dedicated config.
- **Commands / tools / shortcuts**: `/skill:ponytail*`, `/ponytail` (when registered), review helpers.
- **Persistence scope**: Skill invocation only; no persistent state beyond session artifacts.
- **Test / source evidence**: `src/extensions/ponytail/`, `src/skills/ponytail/`.
- **Limits / failure behavior**: Compressed mode reduces detail; switch back to normal mode for teaching or step-by-step discussion.

### question

- **Startup behavior**: Loaded automatically at boot via `./question`; registers question tool (TUI wizard or host dialogs in RPC/VS Code).
- **Prerequisites**: Bundled; a UI surface (TUI session or RPC/VS Code host).
- **Config / settings / env**: None.
- **Commands / tools / shortcuts**: Question tool calls for single, multi-select, freeform, image, and info prompts.
- **Persistence scope**: Can restore saved answers; per-session state.
- **Test / source evidence**: `src/extensions/question/index.ts`, schemas, tests.
- **Limits / failure behavior**: Requires a UI surface; headless sessions may skip prompts.

### grep-app

- **Startup behavior**: Loaded automatically at boot via `./grep-app`; registers `grep-app` search tool.
- **Prerequisites**: Bundled; network access to grep.app.
- **Config / settings / env**: None.
- **Commands / tools / shortcuts**: `grep-app` tool for public code search.
- **Persistence scope**: Stateless; fetches matching source.
- **Test / source evidence**: `src/extensions/grep-app/index.ts`.
- **Limits / failure behavior**: Results depend on grep.app availability; may not find private repositories.

### handoff-new

- **Startup behavior**: Loaded automatically at boot via `./handoff-new.ts`; registers `/handoff-new`.
- **Prerequisites**: Bundled; git repository recommended for context reset clarity.
- **Config / settings / env**: None required.
- **Commands / tools / shortcuts**: `/handoff-new`; companion skills in `src/skills/handoff/` and `src/skills/selesai-handoff/`.
- **Persistence scope**: Creates a new session/branch; continuation prompt is editable.
- **Test / source evidence**: `src/extensions/handoff-new.ts`, `src/skills/handoff/`.
- **Limits / failure behavior**: Does not auto-backup files; reset conversation only within the new session context.

### inline-skills

- **Startup behavior**: Loaded automatically at boot via `./inline-skills.ts`.
- **Prerequisites**: Bundled; `src/core/skills.ts` loader.
- **Config / settings / env**: None.
- **Commands / tools / shortcuts**: Inline `[[skill:...]]` invitations in prompts.
- **Persistence scope**: Invitation is per prompt; no persistent registration beyond the loader.
- **Test / source evidence**: `src/extensions/inline-skills.ts`, `src/core/skills.ts`.
- **Limits / failure behavior**: Only lightweight invitations; full skill behavior still requires matching skill files.

### rtk

- **Startup behavior**: Loaded automatically at boot via `./rtk.ts`; rewrites compatible shell commands when `rtk` is installed.
- **Prerequisites**: Bundled; external `rtk` tool must be on PATH.
- **Config / settings / env**: None in Selesai.
- **Commands / tools / shortcuts**: Automatic shell command rewriting.
- **Persistence scope**: Stateless per command.
- **Test / source evidence**: `src/extensions/rtk.ts`.
- **Limits / failure behavior**: Only rewrites compatible commands; does nothing if `rtk` is absent.

### tokenin-onboarding

- **Startup behavior**: Loaded automatically at boot via `./tokenin-onboarding.ts`; first-run onboarding.
- **Prerequisites**: Bundled; interactive first session.
- **Config / settings / env**: Writes active credential to `~/.selesai/agent/tokenin-auth.json`; legacy path `providers.tokenin.apiKey` in models.json is removed. `SELESAI_SKIP_TOKENIN_ONBOARDING=1` disables first-run prompt.
- **Commands / tools / shortcuts**: `/tokenin add|switch|remove`.
- **Persistence scope**: Multi-account storage in `tokenin-auth.json`.
- **Test / source evidence**: `src/extensions/tokenin-onboarding.ts`.
- **Limits / failure behavior**: Only manages TokenIN credentials; does not validate them against a live API.

### undo

- **Startup behavior**: Loaded automatically at boot via `./undo.ts`; registers undo command.
- **Prerequisites**: Bundled; tracks edits, writes, and mutating shell commands.
- **Config / settings / env**: None.
- **Commands / tools / shortcuts**: Undo one tracked turn at a time.
- **Persistence scope**: Per-session undo stack.
- **Test / source evidence**: `src/extensions/undo.ts`.
- **Limits / failure behavior**: Only undoes tracked mutating actions; non-tracked changes may not be reversible.

### workflow

- **Startup behavior**: Loaded automatically at boot via `./workflow`; state-machine-driven project workflows.
- **Prerequisites**: Bundled; model API key.
- **Config / settings / env**: None. Workflow modes, phases, prompts, validators, loop caps, artifact base path, and mode-owned behavior are defined in source. Users choose a mode and pass a goal/resume argument; they do not edit workflow behavior through user configuration files.
- **Commands / tools / shortcuts**: `/prototype`, `/quick`, `/task`, phase lifecycle APIs.
- **Persistence scope**: Resumable state files and artifacts per workflow run.
- **Test / source evidence**: `src/extensions/workflow/extension.ts`, `adapter.ts`, `modes/`, tests.
- **Limits / failure behavior**: State machine may keep a phase armed after a failed gate; review phase output before proceeding.

### pi-subagents

- **Startup behavior**: Loaded automatically at boot via `./pi-subagents`; registers `subagent` tool and slash commands.
- **Prerequisites**: Bundled; model API key; optional permission-system integration.
- **Config / settings / env**: `~/.selesai/agent/extensions/subagent/config.json` or `~/.selesai/agent/settings.json` under `subagents`. Keys include `subagents.defaultModel`, `subagents.agentOverrides.<agent>`, `subagents.modelScope`, `subagents.watchdog`, `maxSubagentDepth`, `asyncByDefault`, `SELESAI_SUBAGENT_PARENT_SESSION` forwarded to children.
- **Commands / tools / shortcuts**: `subagent({...})`, `/run`, `/chain`, `/parallel`, `/run-chain`, `/subagents-doctor`, `/subagents-fleet`, `/subagents-stop`, `/subagent-cost`, `/subagents-models`, `/subagents-profiles`, `/parallel-review`, `Ctrl+Alt+F`.
- **Persistence scope**: Async run artifacts in the Selesai subagent results directory.
- **Test / source evidence**: `src/extensions/pi-subagents/`, slash commands, config, README.
- **Limits / failure behavior**: Nested depth capped by `maxSubagentDepth`; permission-system integration requires `@gotgenes/pi-permission-system`.

### pi-web-agent

- **Startup behavior**: Loaded automatically at boot via `./pi-web-agent`; registers `web_explore` and `/web-agent`.
- **Prerequisites**: Bundled; optional Brave API key, optional SearXNG/Firecrawl endpoints, optional Playwright-compatible browser for headless escalation.
- **Config / settings / env**: Layered config from `~/.selesai/agent/extensions/pi-web-agent/config.json` and `.selesai/extensions/pi-web-agent/config.json`. Brave API key: `webAgent.braveApiKey` in `~/.selesai/agent/settings.json` (preferred) or `PI_WEB_AGENT_BRAVE_API_KEY`. Firecrawl key: `backends.fetch.apiKey` or `PI_WEB_AGENT_FIRECRAWL_API_KEY`. SearXNG/Firecrawl base URLs in config.
- **Commands / tools / shortcuts**: `web_explore({ query: "..." })`, `/web-agent [settings|show|doctor|changelog|reset project|reset global]`.
- **Persistence scope**: Config files only; searches are not persisted.
- **Test / source evidence**: `src/extensions/pi-web-agent/extension.ts`, commands, backends (`factory.ts`, `settings-reader.ts`).
- **Limits / failure behavior**: Output depends on third-party sources; headless escalation fails without a supported browser; SearXNG/Firecrawl need valid endpoints.

### web-agent-onboarding

- **Startup behavior**: Loaded automatically at boot via `./web-agent-onboarding.ts`; first-run Brave setup.
- **Prerequisites**: Bundled; interactive first session.
- **Config / settings / env**: Writes `webAgent.braveApiKey` to `~/.selesai/agent/settings.json`; writes Brave backend config to `~/.selesai/agent/extensions/pi-web-agent/config.json` with DuckDuckGo fallback.
- **Commands / tools / shortcuts**: First-run prompt; onboarding marker `.webAgentOnboardingComplete`.
- **Persistence scope**: User-level settings and global config.
- **Test / source evidence**: `src/extensions/web-agent-onboarding.ts`.
- **Limits / failure behavior**: Skippable; falls back to DuckDuckGo if Brave is declined.

### pi-powerline-footer

- **Startup behavior**: Loaded automatically at boot via `./pi-powerline-footer`; renders status bar and fixed-editor layout.
- **Prerequisites**: Bundled; interactive TUI session; Nerd Font optional.
- **Config / settings / env**: Optional config for themes, layout, persistent bash, stashes.
- **Commands / tools / shortcuts**: Status-bar indicators, recurring guide tour.
- **Persistence scope**: UI state per session; some layout/theme settings may persist in config.
- **Test / source evidence**: `src/extensions/pi-powerline-footer/`, `src/core/footer-data-provider.ts`, tests.
- **Limits / failure behavior**: Visual-only; does not persist file changes on its own.

### pi-rewind-hook (optional)

- **Startup behavior**: Not loaded automatically; install separately with `pi install npm:pi-rewind-hook` or load explicitly.
- **Prerequisites**: Optional; git repository; compatible Pi/Selesai version.
- **Config / settings / env**: Optional `rewind` key in `~/.selesai/agent/settings.json` (or `~/.pi/agent/settings.json` upstream): `rewind.silentCheckpoints`, `rewind.retention.maxSnapshots`, `rewind.retention.maxAgeDays`, `rewind.retention.pinLabeledEntries`, `rewind.retention.scanMode`, `rewind.retention.startupBudgetMs`.
- **Commands / tools / shortcuts**: No standalone `/rewind` command. Triggered automatically during `/fork` and `/tree` navigation.
- **Persistence scope**: Snapshot reachability via `refs/pi-rewind/store`; authoritative metadata in hidden `rewind-turn`/`rewind-op` session entries.
- **Test / source evidence**: `src/extensions/pi-rewind-hook/README.md`, source.
- **Limits / failure behavior**: Only works in git worktrees; restores tracked and untracked non-ignored files; ignored files, empty directories, and tool/bash nodes lack exact checkpoints; retention only trims git reachability.

## Verification checklist

- [ ] Every manifest entry in `src/extensions/package.json` maps to one slug
      in this matrix.
- [ ] Every slug has an EN and ID MDX guide with the six required operational
      headings.
- [ ] No guide mentions stale commands such as `/rewind` or `/tokenin-onboard`.
- [ ] Commands, paths, environment variables, JSON keys, and tool names are
      identical across English and Indonesian.
- [ ] Optional extensions (currently `pi-rewind-hook`) are not described as
      bundled.

## Notes

- The `src/extensions/package.json` is the authoritative bundled-extension
  manifest. If an extension is present on disk but absent from that list, it is
  optional/unbundled.
- Use `npm --prefix doc-web run validate:content` to check heading contracts,
  manifest-to-guide inventory parity, and metadata coherence.
- Use `npm --prefix doc-web run verify` after any structural change.
