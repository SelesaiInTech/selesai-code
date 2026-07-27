---
name: knowledge-capture
description: Creates compact, evidence-backed Markdown knowledge notes from completed research, investigations, and decisions, then makes them discoverable in a repo-local index. Use when user says "capture knowledge", "save research", "make context", "document findings", "save this for later", or asks to preserve research/conversation context for future agents.
---

# Knowledge Capture

Turn completed work into a durable, retrievable note. Do not redo research unless evidence is missing or contradicted.

## Workflow

1. Read `docs/knowledge/README.md` and search `docs/knowledge/` for matching topic, aliases, and sources.
2. Reuse/update the matching topic note; otherwise create `docs/knowledge/<kebab-slug>.md`.
3. Distill evidence already gathered: facts, mechanisms, decisions, limits, and exact source URLs. Separate verified facts from inferences.
4. Write the note using template below. Omit empty sections; keep high-level but technically specific.
5. Update `docs/knowledge/README.md` with title, one-line scope, tags, path, and updated date.
6. Re-read rendered Markdown, verify every material factual claim has a source or is labelled `Inference`, and report paths.

## Rules

- Default to repo-local `docs/knowledge/`; do not store credentials, private prompts, tokens, or unnecessary transcript text.
- Prefer one topic per note. Add dated `## Updates` entries for new material; do not duplicate notes.
- Cite sources inline for non-obvious claims and also list canonical sources under `## Sources` with access dates.
- Capture local evidence as `path:line-range` or commit hash. Cite public evidence with stable URLs.
- State unknowns, conflicts, assumptions, version limits, and expiry risks in `## Caveats`.
- Quote code/evidence only when it establishes a key mechanism; cap each excerpt at 10 lines.
- Do not invent citations, dates, results, or certainty. Mark derived conclusions as **Inference**.
- Use `date +%F` for metadata dates. Tags: 2–6 lowercase kebab-case terms.

## Note template

```md
---
title: <topic>
tags: [<tag>, <tag>]
created: YYYY-MM-DD
updated: YYYY-MM-DD
reviewed: YYYY-MM-DD
---

# <Topic>

## TL;DR
<3–6 bullets: durable answer and why it matters.>

## Findings
<High-level facts and behavior; cite material claims inline.>

## How it works
<Mechanism, flow, interface, or decision logic.>

## Decisions / implications
<What to reuse, avoid, or do next. Mark deductions **Inference**.>

## Caveats
<Limits, unknowns, stale-version risk, conflicts.>

## Sources
- [Name](URL) — accessed YYYY-MM-DD; relevance
- `path/to/file.ts:12-34` — relevance

## Updates
- YYYY-MM-DD — <what changed>
```

## Index format

Create index if absent:

```md
# Knowledge index

| Topic | Scope | Tags | Updated |
|---|---|---|---|
| [Title](slug.md) | One-line scope | `tag`, `tag` | YYYY-MM-DD |
```

Keep rows alphabetical by topic.

## Completion check

```sh
find docs/knowledge -maxdepth 1 -name '*.md' -print
```
