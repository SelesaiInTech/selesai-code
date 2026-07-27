## Research: Upstream version comparison for `@mariozechner/pi-coding-agent` → `@selesai/code`

You've hit the soft turn budget, so I'm finalizing from the authoritative local evidence gathered. The web research tooling did not return verifiable upstream tag/version URLs; I'm explicitly flagging that gap.

## Summary

The local fork at `/Users/andrewanggada/Documents/workdir/js_proj/selesai` is `@selesai/code@0.5.9`. It consumes three `@earendil-works/*` core packages (the apparent successor scope to the legacy `@mariozechner/pi-coding-agent`), all pinned at `0.80.6`:
- `@earendil-works/pi-agent-core@0.80.6`
- `@earendil-works/pi-ai@0.80.6`
- `@earendil-works/pi-tui@0.80.6`

All three declare their upstream repository as `git+https://github.com/earendil-works/pi.git` (monorepo; directory keys `packages/agent`, `packages/ai`, `packages/tui`). I could **not** verify the exact latest upstream tag/version via the available web tooling — this is the primary gap. The fork's current upstream baseline is therefore `0.80.6` (the pinned dependency version), **not** the fork's own `0.5.9` version number.

## Findings

1. **Fork identity is fully fork-rebranded.** `package.json` sets `name: "@selesai/code"`, `bin: { "selesai": "dist/cli.js" }`, and `piConfig: { name: "selesai", configDir: ".selesai" }`. Any porting work must preserve these fork-specific identifiers and never restore upstream `.pi` paths or `@mariozechner` aliases. — `package.json:1-4,89-93`

2. **Upstream baseline = 0.80.6 across three monorepo packages.** All three `@earendil-works/*` dependency pins are exactly `0.80.6` (no caret/tilde — hard-pinned). — `package.json:28-30`

3. **Upstream monorepo URL confirmed from installed package metadata.** Each `node_modules/@earendil-works/*/package.json` declares `"url": "git+https://github.com/earendil-works/pi.git"` with a `directory` sub-key (`packages/agent`, `packages/ai`, `packages/tui`). Author is Mario Zechner, MIT license. This is the authoritative upstream repository for diffs.

4. **No CHANGELOG.md or README.md at the fork root.** `CHANGELOG.md` is listed in `package.json` `files` (line ~18) but the file does not exist locally, so version-progression notes are absent from the fork. Porting a regenerated CHANGELOG from upstream is therefore not directly comparable.

5. **Fork uses `tsgo` (the typescript native preview) as the build compiler** (`"build": "tsgo -p tsconfig.build.json"`), devDep `@typescript/native-preview@^7.0.0-dev.20260120.1`. Upstream package metadata shows the same `tsgo` script — so compiler baseline appears aligned at `0.80.6`.

6. **`@earendil-works/pi-ai` drags in heavy LLM SDK deps** (`@anthropic-ai/sdk@0.91.1`, `openai@6.26.0`, `@google/genai@1.52.0`, `@aws-sdk/client-bedrock-runtime@3.1048.0`, `@mistralai/mistralai@2.2.6`). Any upstream version bump to `pi-ai` will pull newer SDK majors — this is the highest-blast-radius upgrade vector.

7. **Web verification of the latest upstream tag did not succeed** through `web_explore` (returned synthesized summaries but no trustworthy, citable version number or release-URL). Authoritative verification must be done locally via npm/git (see commands below).

## Prioritized porting candidates (to verify once upstream latest is confirmed)

Priority is by blast radius × expected payoff. Each assumes a target upstream version `X.Y.Z` to be confirmed locally (see commands).

1. **P0 — Confirm and bump the three `@earendil-works/*` pins in lockstep.** All three core packages must move together (they cross-depend; `pi-agent-core` depends on `pi-ai@^0.80.6`). Bump only when the target upstream tag is verified. Touch only lines `package.json:28-30`. Risk: a non-lockstep bump breaks the monorepo's internal SemVer contract.
   - Verify: `npm view @earendil-works/pi-agent-core versions --json` and match against `npm view @earendil-works/pi-ai versions --json` / `pi-tui`.

2. **P1 — Re-diff the fork's `src/cli.ts` and entry points against upstream `packages/agent/src/cli.ts`** at the target tag. The fork renamed `pi` → `selesai` and `configDir: .pi` → `.selesai`; these are the highest-risk merge sites. Any upstream change touching argv parsing, config-dir resolution, or the bin/boot sequence needs manual reconciliation, never a blind apply.
   - Verify local current state: `grep -rn "\.pi\b\|configDir\|\"pi\"" src/` — confirm zero residual upstream paths before porting.

3. **P2 — Re-sync `src/defaults/*` and `src/extensions/*`.** `package.json` `copy-assets` ships `src/defaults/`, `src/extensions/`, `src/themes/`, `src/skills/`. Upstream changes to default prompts/skills/themes are low-risk to port (additive) but must keep fork-specific `selesai` naming and skill dirs. 
   - Verify: `ls -la src/defaults src/extensions src/skills src/themes` and `git -C <upstream-clone> diff 0.80.6..<target-tag> -- 'packages/agent/src/defaults' 'packages/agent/src/skills'`.

4. **P3 — Port `pi-ai` provider/model-list updates.** `pi-ai` carries generated model registries (`scripts/generate-models.ts`, `scripts/generate-image-models.ts` — visible in installed package `package.json:scripts.build`). Upstream bumps here refresh LLM model IDs and provider OAuth; low code-merge risk, high correctness payoff (new models), but drags newer SDK majors (see finding 6).
   - Verify: `git -C <upstream-clone> log 0.80.6..<target-tag> --oneline -- packages/ai/src/providers packages/ai/scripts`.

5. **P4 — Port `pi-tui` rendering/terminal fixes.** Pure terminal-rendering library; rarely fork-touched. Low-risk cherry-picks, but depends on confirming the upstream diff between `0.80.6` and target.
   - Verify: `git -C <upstream-clone> diff 0.80.6..<target-tag> -- packages/tui`.

6. **P5 — Regenerate root `CHANGELOG.md`.** Upstream may have one; the fork's is absent. Port only as a fresh file; do not import upstream sections that reference `.pi` config paths or `@mariozechner/pi-coding-agent` package names.

## Compatibility risks

- **Config-dir clobbering (highest).** Every upstream diff that reads/writes `~/.pi/` must be re-anchored to `~/.selesai/` and the `piConfig.name`/`piConfig.configDir` keys in `package.json:4-6`. A blind cherry-pick restoring `.pi` paths is a data-safety bug (would silently write to/read from the wrong directory).
- **Package-name re-aliasing.** Upstream imports any `@mariozechner/pi-coding-agent` self-references or `pi` bin names must be filtered; the fork uses `@selesai/code` and `selesai` bin.
- **SemVer lockstep across three monorepo packages.** `pi-agent-core` → `pi-ai` is a caret dep internally; bumping one without the others can resolve to mismatched majors in the dependency tree.
- **SDK major bumps.** `pi-ai` ≥ next minor likely bumps `@anthropic-ai/sdk`, `openai`, `@google/genai`, `@aws-sdk/*` — node-engine and bundle-size impact; confirm against `engines.node >=22.19.0`.
- **Compiler/runtime alignment.** Fork uses `tsgo` (`@typescript/native-preview@^7.0.0-dev.20260120.1`); upstream at the same `0.80.6` baseline does too, but later upstream tags may switch back to stock `tsc`. Verify the target tag's `tsconfig.build.json` and build script before assuming `tsgo` still applies.
- **Native prebuilds.** `pi-tui` ships prebuilt `.node` files for `win32`/`darwin` (`node_modules/@earendil-works/pi-tui/package.json:files`). A bump may change native ABI; confirm prebuilt artifacts exist for the target version before upgrading on non-darwin platforms.

## Suggested verification commands (run locally; I could not execute them)

```bash
# 1) Authoritative latest upstream versions (npm registry):
npm view @earendil-works/pi-agent-core version
npm view @earendil-works/pi-ai version
npm view @earendil-works/pi-tui version
npm view @mariozechner/pi-coding-agent version            # legacy alias, if still published

# 2) Full version history to locate the gap above 0.80.6:
npm view @earendil-works/pi-agent-core versions --json
npm view @earendil-works/pi-ai versions --json
npm view @earendil-works/pi-tui versions --json

# 3) Upstream monorepo tags/changes (git):
git clone https://github.com/earendil-works/pi.git /tmp/pi-upstream
cd /tmp/pi-upstream
git tag --list --sort=-v:refname | head -40
git log --oneline 0.80.6..<latest-tag> -- packages/agent packages/ai packages/tui

# 4) Confirm fork has zero residual upstream .pi / @mariozechner references:
grep -rIn '\.pi\b\|@mariozechner/pi-coding-agent\|"pi"\|'"'"'pi'"'"'' /Users/andrewanggada/Documents/workdir/js_proj/selesai/src /Users/andrewanggada/Documents/workdir/js_proj/selesai/package.json

# 5) Confirm fork pinned versions are coherent after any bump:
cd /Users/andrewanggada/Documents/workdir/js_proj/selesai && npm ls @earendil-works/pi-agent-core @earendil-works/pi-ai @earendil-works/pi-tui
```

## Sources

- Kept: `package.json` (local) — fork identity, dependency pins, build scripts. `/Users/andrewanggada/Documents/workdir/js_proj/selesai/package.json`
- Kept: `node_modules/@earendil-works/pi-agent-core/package.json` — version `0.80.6`, upstream repo `git+https://github.com/earendil-works/pi.git`, directory `packages/agent`.
- Kept: `node_modules/@earendil-works/pi-ai/package.json` — version `0.80.6`, LLM SDK deps, upstream directory `packages/ai`.
- Kept: `node_modules/@earendil-works/pi-tui/package.json` — version `0.80.6`, native prebuild layout, upstream directory `packages/tui`.
- Not retained (unverified by URL): multiple `web_explore` synthesizations about `@mariozechner/pi-coding-agent` / `earendil-works/pi` versions. None returned a citable version number or release-page URL; treat all upstream-version statements above `0.80.6` as unverified pending local `npm view` / `git tag` runs.

## Gaps

- **Exact latest upstream tag/version not verified.** The available web tooling could not resolve a trustworthy latest version of `@mariozechner/pi-coding-agent` or the successor `@earendil-works/pi` packages above `0.80.6`. Smallest next step: run `npm view @earendil-works/pi-agent-core version` and `git -C <upstream-clone> tag --list --sort=-v:refname | head` locally.
- **Local git history not inspected** — I had no shell access to run `git log` / `git remote -v` on the fork, so I cannot state the fork's last upstream sync commit or the exact merge base. Run `git -C /Users/andrewanggada/Documents/workdir/js_proj/selesai log --oneline -20` and `git -C … remote -v` to recover it; the upstream remote URL (if present) is the most reliable baseline pointer.
- **No `CHANGELOG.md` / `README.md` at fork root** — version-progression diff against upstream's own CHANGELOG is not possible from local files.
- **Upstream `@mariozechner/pi-coding-agent` ↔ `@earendil-works/*` rename boundary** unclear from the evidence on hand; the fork appears to consume only the `@earendil-works/*` packages, so the legacy `@mariozechner/pi-coding-agent` npm package may be deprecated or an alias. Confirm via `npm view @mariozechner/pi-coding-agent`.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete findings with exact local paths and line refs: package.json:1-4,28-30 (fork identity + @earendil-works/* pins @0.80.6, piConfig name=selesai/configDir=.selesai at lines 4-6), node_modules/@earendil-works/pi-{agent-core,ai,tui}/package.json confirming upstream repo git+https://github.com/earendil-works/pi.git and directory keys; severity by priority P0-P5; compatibility risks enumerated."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "read package.json",
      "result": "passed",
      "summary": "Fork is @selesai/code@0.5.9; dependencies @earendil-works/pi-agent-core,pi-ai,pi-tui pinned at 0.80.6; piConfig.configDir=.selesai; bin=selesai; build via tsgo."
    },
    {
      "command": "read node_modules/@earendil-works/pi-agent-core/package.json",
      "result": "passed",
      "summary": "Version 0.80.6; repository git+https://github.com/earendil-works/pi.git directory packages/agent; author Mario Zechner."
    },
    {
      "command": "read node_modules/@earendil-works/pi-ai/package.json",
      "result": "passed",
      "summary": "Version 0.80.6; same upstream repo, directory packages/ai; pulls @anthropic-ai/sdk@0.91.1, openai@6.26.0, @google/genai@1.52.0."
    },
    {
      "command": "read node_modules/@earendil-works/pi-tui/package.json",
      "result": "passed",
      "summary": "Version 0.80.6; directory packages/tui; ships native .node prebuilds for win32/darwin."
    },
    {
      "command": "read CHANGELOG.md, README.md",
      "result": "failed",
      "summary": "Neither CHANGELOG.md nor README.md exists at fork root despite CHANGELOG.md being listed in package.json files."
    },
    {
      "command": "web_explore (several) for upstream latest version",
      "result": "inconclusive",
      "summary": "No citable version number or release URL resolved; latest upstream tag above 0.80.6 remains unverified."
    }
  ],
  "validationOutput": [
    "Local upstream baseline confirmed as 0.80.6 via the three installed @earendil-works/* package.json files and the dependency pins in package.json.",
    "Upstream monorepo URL confirmed as https://github.com/earendil-works/pi from package.json repository fields of all three core packages.",
    "Latest upstream tag/version NOT verified — requires local `npm view` / `git tag` commands listed in the report."
  ],
  "residualRisks": [
    "Exact latest upstream release above 0.80.6 unverified; prioritized porting list above P0 is conditional on local confirmation.",
    "Local git merge-base / last-upstream-sync commit not inspected (no shell access); fork's precise divergence point unknown.",
    "Fork-vs-upstream source diff not performed; P1-P5 itemized by expected blast radius, not by verified diff hunks.",
    "Config-dir/package-name safety relies on the maintainer preserving piConfig name=selesai, configDir=.selesai, bin=selesai, name=@selesai/code in package.json — any upstream change touching those paths requires manual re-anchoring."
  ],
  "noStagedFiles": true,
  "diffSummary": "No file changes made (research-only task).",
  "reviewFindings": [
    "no blockers (research only) — but open question: latest upstream version above 0.80.6 must be confirmed locally with `npm view @earendil-works/pi-agent-core version` and `git -C <upstream-clone> tag --list` before any port begins."
  ],
  "manualNotes": "Fork upstream baseline is 0.80.6 (three locked @earendil-works/* deps), not the fork's own 0.5.9 version. Upstream package appears renamed from legacy @mariozechner/pi-coding-agent to the @earendil-works/* monorepo scope; the fork only consumes the new-scope packages. Any future port must hard-preserve the fork-specific piConfig (name=selesai, configDir=.selesai), bin=selesai, and package name @selesai/code — never restore .pi paths or @mariozechner aliases. No local files were modified."
}
```

⧉ copy assistant: /cp ac1c2c