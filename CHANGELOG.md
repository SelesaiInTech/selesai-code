# Changelog

All notable changes to `@selesai/code` will be documented in this file.

## [Unreleased]

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
