# Upstream Pi 0.86.1 sync — phased implementation plan

Selesai is a maintained, extension-first fork of the Pi coding agent. This plan moves the fork
from its current upstream base (Pi v0.85.1) to Pi v0.86.1 in ordered phases, each of which is the
subject of one PRD in this directory.

Run the phases **in order**. Each phase ends green before the next one starts.

| # | PRD | Goal | Depends on | Gate |
|---|---|---|---|---|
| 1 | [`01-platform-sync-pi-0.86.1.md`](01-platform-sync-pi-0.86.1.md) | Move the runtime dependency pins and land the platform/API-shaped changes so the tree compiles against Pi 0.86.1. Also settles the provider-as-extension boundary: providers and storage are already extensions, composition and the runtime stay core | — | typecheck + build + provider-boundary test |
| 2 | [`02-core-prompt-and-compaction-sync.md`](02-core-prompt-and-compaction-sync.md) | Adopt the new system-prompt section model, session transcript entries, and compaction budgets | 1 | typecheck + build + ported prompt/session tests |
| 3 | [`03-session-runtime-sync.md`](03-session-runtime-sync.md) | Rebase the session runtime on upstream's prompt/tool loadout, abort-control and auth threading | 2 | typecheck + build + session/compaction suites |
| 4 | [`04-interactive-tui-sync.md`](04-interactive-tui-sync.md) | Land the interactive workspace changes: settings surfaces, catalog refresh, crash notice and bug report | 3 | typecheck + build + interactive suites + TUI smoke |
| 5 | [`05-clipboard-replacement.md`](05-clipboard-replacement.md) | Retire the external native clipboard dependency in favour of the bundled platform helpers | 1 | ported clipboard suites + paste smoke |
| 6 | [`06-selesai-delta-replant.md`](06-selesai-delta-replant.md) | Re-plant every Selesai-owned behaviour on top of the new upstream shapes | 3, 4, 5 | full `npm test` + build + manual smoke |
| 7 | [`07-verification-gates-and-release.md`](07-verification-gates-and-release.md) | Prove the whole port, update the maintenance record and documentation, cut the release | 6 | full gate ledger green |

## File ownership rule

Every file the port touches has exactly one owning phase, and no phase reopens a file another phase
already resolved. Upstream-changed files divide into three kinds, and all three are assigned:

| Kind | Count | Owner |
|---|---|---|
| Files the fork never modified | 45 | PRD 1, taken verbatim |
| Files the fork modified, upstream's change merges cleanly | 23 | PRD 1, taken as the merged result — unless the phase table below names the file |
| Files the fork modified, upstream's change conflicts | 14 | the phase named in that file's PRD |

Clean-merge files are the PRD 1 default, with three exceptions reassigned because a later phase's
gate depends on their ported shape: the session manager goes to PRD 2 (it carries the new session
entries), and the session factory and the extension runner go to PRD 3 (the factory constructs the
cache warmer and the runner owns the cache-warming decision emit).

Conflict files are assigned as follows by exact path, and this assignment is the contract between
phases. Paths are relative to the flattened source root.

| File | Kind | Owning phase |
|---|---|---|
| `core/system-prompt.ts` | conflict | 2 |
| `core/settings-manager.ts` | conflict | 2 |
| `core/compaction/compaction.ts` | conflict | 2 |
| `core/extensions/types.ts` | conflict | 2 |
| `core/extensions/index.ts` | conflict | 2 |
| `index.ts` | conflict | 2 |
| `core/session-manager.ts` | clean-merge, reassigned | 2 |
| `core/agent-session.ts` | conflict | 3 |
| `core/model-registry.ts` | conflict | 3 |
| `core/provider-composer.ts` | conflict | 3 |
| `core/sdk.ts` | clean-merge, reassigned | 3 |
| `core/extensions/runner.ts` | clean-merge, reassigned | 3 |
| `core/extensions/loader.ts` | conflict | 1 |
| `modes/interactive/interactive-mode.ts` | conflict | 4 |
| `modes/interactive/components/settings-selector.ts` | conflict | 4 |
| `utils/clipboard.ts` | conflict | 5 |
| `utils/clipboard-image.ts` | conflict | 5 |

Named files total 17: all 14 conflict files plus 3 reassigned clean-merge files. The remaining 65
files (45 never-touched plus the 20 remaining clean-merge overlaps) default to PRD 1. That accounts
for all 82 upstream-changed files.

Two entries were missing from an earlier draft and are the reason this table uses exact paths: the
extension loader, whose virtual-module map is both a conflict and a PRD 1 deliverable, and the
provider composer, which holds the forwarding boundary that PRD 1's provider-contract decision
describes and that PRD 3 owns. A table that names files in prose cannot be checked, and both omissions
survived a prose revision.

To re-derive and check this assignment against the tree, reconcile each upstream-changed file with a
three-way merge against the fork's copy and count the conflict hunks. Any file with conflict hunks
that is absent from the table above is an assignment gap, and any file present in the table without
conflict hunks is either a deliberate reassignment or a mistake.

A phase may edit a file it owns. A phase that finds it needs to edit a file another phase owns must
add that edit to its own prerequisite list instead of performing it, and the prerequisite is stated in
that phase's Implementation Decisions. The settings module is the worked example: PRD 2 resolves it to
upstream's complete accessor surface, and PRDs 3 and 4 consume those accessors.

One residual exception, recorded rather than implied: if PRD 1's typecheck shows the branded transcript
is not structurally assignable from the old context type, PRD 1 owns the resulting cast at the
forwarding sites in `core/model-registry.ts` and `core/provider-composer.ts` for that edit alone, and
the exception expires once PRD 3 owns those files. PRD 1 states this in its provider-contract decision.

A clean merge is not a guarantee of correctness — it means two edits did not overlap textually, not
that they are semantically compatible. That is why the clean-merge files still need to be walked in
PRD 6, and why PRD 1's gate is a build rather than a diff review.

## Test seams used by every phase

1. **Typecheck + build** — the highest seam available and the port's single most valuable check.
2. **`npm test`** — the repository's existing focused vitest script, which already enumerates the
   Selesai-owned suites.
3. **Ported upstream suites** — upstream ships focused tests for the behaviour it added. Porting
   them is the cheapest proof that upstream behaviour actually landed, and beats writing new tests.
4. **Vendored extension compliance suites** — the `pi-zentui` compliance and responsive-dependency
   suites, the `pi-subagents` smoke harness, and the `pi-hermes-memory` suites. These are what catch
   an upstream private-layout change displacing a vendored extension's patch.
5. **CLI smoke from source** — end-to-end behaviour no unit test covers.
6. **`GATES.<slug>.md`** — the repository's existing per-change gate ledger (OWNS + CHECK + EXPECT +
   captured EVIDENCE). Each phase writes one.

## Settled during planning, not to be re-litigated

- **Providers are already extensions.** Two registration forms exist (declarative config, native
  provider object) and the fork's two in-tree providers use one each; credential storage and catalog
  caching already implement the platform's own store interfaces. No extraction work is pending.
- **Composition and the model runtime stay core.** The platform exposes no composition hook for
  merging a user model-configuration file over the built-in catalog, and the runtime implements the
  platform's model-collection interface that the host boots on. Full reasoning is in PRD 1.
- **The provider contract change is a boundary adjustment.** The platform lifts an ordinary request
  context into its branded transcript internally, and the fork's provider code never reads the
  context. Only the forwarding sites at the provider boundary change.

## Confirm before starting

The seams above are the ones this plan is built on. If a phase should be verified through a
different seam — or the phase order should change — say so before implementation starts; every PRD
is written against these.
