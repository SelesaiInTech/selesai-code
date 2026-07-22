# Selesai

Selesai is a maintained, extension-first fork of the [Pi coding agent](https://github.com/earendil-works/pi). It keeps Pi's small, hackable coding harness and ships a coordinated set of extensions, skills, and display improvements as part of the application.

The goal is simple: make a capable coding agent useful out of the box, maximize token utilization, and get better or comparable results with fewer tokens and lower cost—without making every user install and trust a long list of unrelated extensions.

## Install

```bash
npm install -g --ignore-scripts @selesai/code
selesai
```

For a one-off run using the latest published package:

```bash
npx @selesai/code
```

The published npm package is **`@selesai/code`** and its executable is **`selesai`**. Selesai uses `~/.selesai/agent` for user state and `.selesai/` for project-local settings and resources.

Start with a prompt:

```bash
selesai "Explain this repository and tell me how to run its checks"
```

Or run a non-interactive request:

```bash
selesai -p "Review the current git diff without editing files"
```

## What Selesai adds to Pi

### Built-in delegation and orchestration

`pi-subagents` is bundled and adapted to the Selesai runtime. It provides:

- in-tree focused agent roles: `architect`, `builder`, `commentator`, `explorer`, `recapper`, and `researcher`
- extensible user, project, and package agent definitions with model/tool/skill controls
- foreground, background, parallel, and chained runs
- async status, transcripts, lifecycle artifacts, scheduling, interruption, steering, and resuming
- structured output, output files, tool/turn budgets, model overrides, fallbacks, and model scopes
- worktree isolation for parallel implementation tasks
- native supervisor communication, so a delegated agent can ask the main session for a decision instead of guessing
- reusable prompt workflows and agent management commands

Useful prompts:

```text
Ask the architect to challenge this plan before we implement it.
Run parallel commentator agents for correctness, tests, and unnecessary complexity.
Have the builder implement this plan, then review the result.
```

### Durable workflows

Selesai includes a workflow engine with three modes:

| Mode | Flow | Best for |
| --- | --- | --- |
| `prototype` | grill → research → plan → reuse → handoff → build/review loop → audit | New prototypes that need discovery and external research |
| `quick` | grill → plan → reuse → handoff → build/review loop → audit | Smaller prototypes with less ceremony |
| `task` | plan → reuse → handoff → build/review loop | Direct implementation work |

Workflows persist their state and phase artifacts on disk, can be resumed explicitly, and require an explicit close step. Use `/workflow-prototype`, `/workflow-quick`, or `/workflow-task`, or ask Selesai to start the appropriate workflow.

### Web research

The bundled web-agent provides one high-level `web_explore` tool for research that needs current sources. It handles bounded search and fetch passes, source ranking, readable extraction, and targeted headless-browser escalation. It is intended for current documentation, technical discussions, comparisons, and recommendations—not for silently making arbitrary network calls from shell commands.

DuckDuckGo works as the default search path. Optional first-run onboarding can configure Brave Search with DuckDuckGo fallback. To register for Brave Search API access, visit the [Brave Search API page](https://brave.com/search/api/) and then create a key in the [Brave API dashboard](https://api-dashboard.search.brave.com/app/keys). `/web-agent` exposes backend and presentation settings plus diagnostics.

### Interactive questions

The bundled `question` tool gives the agent a real TUI for decisions instead of forcing every clarification through plain text. It supports:

- single- and multi-select options
- descriptions and context summaries
- freeform answers and optional comments
- keyboard navigation, filtering, cancellation, and image/info question types

This is the interaction layer used by the workflow modes and available to normal agent requests too.

### A richer terminal workspace

The bundled `pi-powerline-footer` improves the interactive display with:

- a powerline status bar for model, thinking level, path, git state, context, tokens, cost, cache, and session data
- a fixed-editor layout that keeps the editor and status area visible while chat scrolls
- a recurring `/guide` tour with compact and remembered-dismissal modes, covering workflows, delegation/research prompts, skills, handoff, and recovery
- persistent bash mode with shell state, transcript output, history, and ghost suggestions
- editor stash/restore, prompt history, clipboard shortcuts, and message-jump shortcuts
- themed working-vibe messages, Nerd Font detection, and configurable presets

### Coordination between sessions

`pi-intercom` is an agent tool for local 1:1 session coordination, not a skill or part of the quick guide. Ask Selesai to use it when another local session should review an idea, receive progress, or answer a question. Agents can `send`, `ask`, `reply`, inspect pending messages, and share attachments; delegated agents can use the native supervisor channel to request decisions or report meaningful progress.

Give sessions clear names so humans and delegated agents can find the right conversation:

```text
/name CalculatorProject
/name DiscussionMaster
```

For example, run two sessions in the same folder with different models. Ask `DiscussionMaster` to critique an implementation idea, challenge its assumptions, and suggest improvements before you commit to it.

### Recovery and continuity

Selesai also bundles small extensions that solve common coding-agent failures:

- **Rewind** — exact git-backed file checkpoints across `/fork`, `/tree`, resumed sessions, and session lineage
- **Undo** — turn-level undo for tracked edits, writes, and detected mutating shell commands (`/undo`)
- **Handoff** — `/handoff-new` creates an editable continuation prompt in a clean session. Keeping context small improves result quality and reduces token consumption and cost
- **Context reminder** — warns when a conversation grows large and suggests a handoff before quality degrades
- **Copy turn** — copy a user or assistant result by hash with `/cp <hash>`
- **grep.app** — search public GitHub code and fetch the matching source without leaving the agent
- **RTK integration** — if `rtk` is installed, compatible shell commands can be rewritten to reduce noisy command output and token use

### Built-in skills

Skills are shipped with Selesai and loaded at boot. They include:

- `ponytail` and `caveman` for minimal and compressed communication modes
- `grill-me` for requirement and design stress-testing
- `planger` and `implanger` for decomposed planning and execution
- `handoff` and `handoff-text` for session continuity
- `improve-codebase` for architecture and maintainability reviews
- `ponytail-review`, `ponytail-audit`, `ponytail-gain`, `ponytail-debt`, and `ponytail-help`
- `workflow-creation` for building durable workflow modes

Invoke one with `/skill:<name>`.

## Why the extensions are bundled

Pi has a broad extension ecosystem, but installing many separate packages also means tracking their maintenance, compatibility, and supply-chain boundaries. Selesai carries the extensions that define its experience in `src/extensions/`, adapts them to the Selesai host, tests them with the application, and ships them with each release.

Selesai is a fork project, not a loose collection of upstream Pi plugins. Some in-tree components began as separate projects or forked code, but Selesai adapts, tests, versions, and maintains them as part of this repository. Keeping them in-tree makes the source visible, reviewable, and auditable in one place, and avoids requiring a fresh external extension install for core Selesai features.

This reduces extension supply-chain exposure; it does not eliminate risk. Selesai still has runtime dependencies, and users should review dependency and extension changes like any other code.

## Pi-compatible core

Selesai retains Pi's useful base capabilities:

- terminal-first interactive coding with `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`
- multiple model providers, API keys, OAuth, thinking levels, images, and retries
- persistent sessions with resume, fork, tree navigation, compaction, and export
- print, JSON event-stream, and RPC modes
- TypeScript extensions, skills, prompt templates, themes, packages, and an embeddable Node.js SDK
- project trust and configurable resource loading

See [`docs/`](docs/) for the Pi-compatible CLI, extension, SDK, settings, and session references. The Selesai-specific behavior and bundled resources are documented here and in `src/extensions/`.

## Repository map

```text
src/
  core/        agent runtime, sessions, tools, packages, and extension loading
  modes/       interactive TUI, print, JSON, and RPC modes
  extensions/  Selesai's bundled extensions and their tests
  skills/      Selesai's bundled skills
  themes/      bundled terminal themes
  defaults/    first-run defaults

docs/           CLI and SDK documentation
examples/       extension and SDK examples
test/           core tests
```

## Development

```bash
npm install
npm run build
node dist/cli.js --help
node dist/cli.js --version
```

Changes to bundled extensions belong in `src/extensions/`; the build copies them into `dist/extensions/` for the published package.

## Contributing

Selesai is maintained in this repository. When changing a bundled extension, keep its host integration, config paths, tests, and user-facing documentation aligned. Prefer the existing Selesai runtime and installed dependencies before adding another package.
