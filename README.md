# Selesai

Selesai is a maintained, extension-first fork of the [Pi coding agent](https://github.com/earendil-works/pi). It keeps Pi's small, hackable coding harness and ships a coordinated set of extensions, skills, and display improvements as part of the application.

The goal is simple: make a capable coding agent useful out of the box, maximize token utilization, and get better or comparable results with fewer tokens and lower cost—without making every user install and trust a long list of unrelated extensions.

## Install

```bash
npm install -g @selesai/code
selesai
```

For a one-off run using the latest published package:

```bash
npx @selesai/code
```

To install directly from the public repository (builds the latest `main` from source):

```bash
npm install -g github:SelesaiInTech/selesai-code
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

### Adaptive implementation workflow

Selesai's `workflow` skill is a parent-directed implementation policy, not a fixed slash-command pipeline. It chooses the smallest useful flow for the task: direct implementation for a trivial change; optional reconnaissance or research for uncertainty; one writer; then only the review, fix, and validation passes the risk warrants.

The parent remains the decision-maker and keeps one writer per checkout. Reviewers inspect the shared working-tree diff directly, while the parent selectively passes synthesized findings to a scoped fix worker. A handoff artifact is optional—use one only for cross-session continuity, a milestone boundary, or a durable user-facing record.

Invoke it inline with `$workflow`, or ask Selesai to orchestrate an implementation. Material architecture or product decisions are resolved before implementation, using an oracle or Council Mode when appropriate.

### Web research

The bundled web-agent provides one high-level `web_explore` tool for research that needs current sources. It handles bounded search and fetch passes, source ranking, readable extraction, and targeted headless-browser escalation. It is intended for current documentation, technical discussions, comparisons, and recommendations—not for silently making arbitrary network calls from shell commands.

DuckDuckGo works as the default search path. Optional first-run onboarding can configure Brave Search with DuckDuckGo fallback. To register for Brave Search API access, visit the [Brave Search API page](https://brave.com/search/api/) and then create a key in the [Brave API dashboard](https://api-dashboard.search.brave.com/app/keys). `/web-agent` exposes backend and presentation settings plus diagnostics.

### Interactive questions

The bundled `question` tool gives the agent a real UI for decisions instead of forcing every clarification through plain text. It supports:

- single- and multi-select options
- descriptions and context summaries
- freeform answers and optional comments
- keyboard navigation, filtering, cancellation, and image/info question types

This is the interaction layer used by the workflow modes and available to normal agent requests too.

### A richer terminal workspace

The interactive terminal runs Pi's native **fullscreen TUI mode** by default: the chat scrolls inside an alternate-screen viewport while the input editor, status line, and widgets stay fixed in a dock at the bottom. Choose `regular` (inline output) at any time with `--tui-mode regular`, the `tuiMode` setting, or the `TUI mode` entry in `/settings`.

The bundled `pi-zentui` and TPS tracker improve the interactive display with:

- a Starship-inspired statusline or a hidden zero-row footer, plus Opencode-style editor and user-message surfaces, configured live via `/zentui` (saved to `~/.selesai/agent/zentui.json`)
- independent `enabled` controls for the editor, user messages, working line, and selector borders, so each surface can be styled or turned off without coupling to the others
- live tokens-per-second status for the main model and subagent runs, with reliability gates against stalls and tool calls
- a compact footer format template covering cwd, git state, runtime, context, and token segments

### Coordination between sessions

`pi-intercom` is an agent tool for local 1:1 session coordination, not a skill or part of the quicktype guide. Ask Selesai to use it when another local session should review an idea, receive progress, or answer a question. Agents can `send`, `ask`, `reply`, inspect pending messages, and share attachments; delegated agents can use the native supervisor channel to request decisions or report meaningful progress.

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
- **RTK integration** — provisions the Rust Token Killer binary when needed and rewrites compatible shell commands to reduce noisy output and token use

### Built-in skills

Skills are shipped with Selesai and loaded at boot. They include:

- `ponytail` for minimal implementation mode and review helpers
- `grill-me` for requirement and design stress-testing
- `agent-browser` for browser-automation setup and CLI workflows
- `planger` and `implanger` for decomposed planning and execution
- `handoff` and `handoff-text` for session continuity
- `improve-codebase` for architecture and maintainability reviews
- `ponytail-review`, `ponytail-audit`, `ponytail-gain`, `ponytail-debt`, and `ponytail-help`
- `workflow` for adaptive implementation orchestration

Invoke one inline with `$skill-name` (for example, `$grill-me`).

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
