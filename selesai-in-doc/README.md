# Selesai-in-doc — fork-maintenance record

This folder records only Selesai modifications to original Pi/upstream code that must be reconsidered when updating the upstream base. It is the input record for fork upgrades, not a general feature log.

## Files

| File | Purpose |
|------|---------|
| [`vision-feature.md`](vision-feature.md) | The main feature: **image captioning relay** (vision-capable model describes images so a text-only main model can see them). Full spec, file-by-file changes, config, and rationale. |
| [`reapply.md`](reapply.md) | Step-by-step re-apply guide after updating the upstream base (which files to touch, what to copy, order of operations, tests to run). |
| [`env-and-setup.md`](env-and-setup.md) | Local environment / run setup notes (how we run, build, test, and the "stale global build" gotcha). |

## When to update this log

Add or update an entry only when a Selesai-owned behavior modifies an original upstream/Pi file and that modification could conflict with, be replaced by, or require reconciliation against a future upstream change. Do not record Selesai-only new files, ordinary documentation, generated output, or changes with no upstream-upgrade maintenance burden.

Each entry names the behavior, modified upstream-origin files/symbols, why the delta matters during an upgrade, focused validation, and any upstream surface to inspect.

## How this fork is rooted

- `upstream` remote → `https://github.com/earendil-works/pi.git`
- `origin` remote → the Selesai fork (`git@github.com:SelesaiInTech/selesai-code.git`)
- To diff against upstream: `git diff upstream/main...origin/main` (or per-file).
