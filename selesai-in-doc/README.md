# Selesai-in-doc — local changes backup log

This folder records **every change we add on top of the upstream base** (`earendil-works/pi`),
so that when we merge in / rebase on a new `pi-coding-agent` release we have a clean, re-applicable
record of our additions and don't lose them.

## Files

| File | Purpose |
|------|---------|
| [`vision-feature.md`](vision-feature.md) | The main feature: **image captioning relay** (vision-capable model describes images so a text-only main model can see them). Full spec, file-by-file changes, config, and rationale. |
| [`reapply.md`](reapply.md) | Step-by-step re-apply guide after updating the upstream base (which files to touch, what to copy, order of operations, tests to run). |
| [`env-and-setup.md`](env-and-setup.md) | Local environment / run setup notes (how we run, build, test, and the "stale global build" gotcha). |

## When to update this log

- Every time a feature is added or changed, update the relevant doc in this folder.
- Prefer **small, additive, re-appliable** captures over prose — the goal is that a future
  agent (or a human) can re-apply the delta cleanly onto a fresh upstream checkout.

## How this fork is rooted

- `upstream` remote → `https://github.com/earendil-works/pi.git`
- `origin` remote → the Selesai fork (`git@github.com:SelesaiInTech/selesai-code.git`)
- To diff against upstream: `git diff upstream/main...origin/main` (or per-file).
