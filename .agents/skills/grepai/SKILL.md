---
name: grepai
description: Semantic codebase search and symbol tracing with grepai. Use instead of grep when searching the codebase for meaning — "where is X", "how does X work", "find code that does Y" — or when tracing which functions call a symbol / which functions a symbol calls. grepai returns ranked snippets and costs ~93% fewer tokens than raw grep output.
---

# grepai

grepai is a privacy-first semantic code-search daemon. It indexes the *meaning*
of the project (vector embeddings) and answers natural-language queries, and it
can trace symbol callers/callees. It is the preferred code-search path in this
repo: cheaper (~93% token savings vs raw grep, see `grepai stats`) and faster to
consume because results are ranked and include only relevant chunks.

## When to use it (and when not to)

- **Use grepai for code discovery**: "where is the session config handled",
  "find code that validates tokens", "how does the watcher get started".
- **Use grepai instead of grep whenever the question is about meaning or
  location**, not literal text. Prefer the registered `grepai` tool over
  shelling out — it handles setup, the watcher, and result formatting.
- **Use plain grep only for exact literal/regex matches** that semantic search
  cannot express: error strings, UUIDs, import paths, structured patterns.

## How to use it

### Tool (preferred)

Call the `grepai` tool: `mode=search|callers|callees`, `query`, optional
`limit` (default 10) and `path` prefix.

### CLI

```sh
grepai search "natural language query" -n 10 --json   # ranked hits: file_path, start_line, end_line, score, content
grepai search "query" --path src/core                 # restrict to a path prefix
grepai trace callers "SymbolName" --json              # who calls it
grepai trace callees "SymbolName" --json              # what it calls
grepai status                                         # index + watcher health
grepai stats                                          # token savings report
```

Use `--json` (parseable) or `--toon` (token-efficient for AI agents) when
feeding output back to an agent.

## Prerequisites

- `grepai` on PATH (`grepai version`). Install from https://github.com/yoanbernabeu/grepai.
- The embedding proxy must be running for searches/watching:
  `node .selesai/extensions/grepai/nomic-embedding-proxy.mjs`
  (endpoint `http://127.0.0.1:8787/v1`). The extension configures this on first
  use and starts the watcher automatically per project.
- First search per project initializes `.grepai/config.yaml`.

## Troubleshooting

- Search fails with a connection error → start the embedding proxy (above), then retry.
- Empty results → rephrase with different terms; check `grepai status` for index health and last update time.
- Stale results → ensure the watcher is running (`grepai status`; `grepai watch --background`).
