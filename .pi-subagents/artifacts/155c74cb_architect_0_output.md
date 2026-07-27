# Implementation Plan: Sync Selesai Fork with Upstream pi v0.80.3

## Goal

Update the `@selesai/code` fork from upstream pi baseline `v0.80.2` to `v0.80.3`, preserving all local customizations. This is a patch-level bump (`0.80.2` → `0.80.3`), so the upstream diff should be small. The plan uses the repo's existing `scripts/upstream.sh` tooling to inspect and selectively apply upstream changes, then bumps the three pinned pi deps.

## Current State Summary

| Aspect | Local (selesai) | Upstream (pi) |
|--------|----------------|----------------|
| package.json deps | `pi-agent-core@0.80.2`, `pi-ai@0.80.2`, `pi-tui@0.80.2` | `pi-agent-core@^0.80.2`, `pi-ai@^0.80.2`, `pi-tui@^0.80.2` |
| package.json | `@selesai/code`, `piConfig.name="selesai"`, `piConfig.configDir=".selesai"`, bin=`selesai` | `@earendil-works/pi-coding-agent`, `piConfig.configDir=".pi"`, bin=`pi` |
| src/ layout | Flattened from `packages/coding-agent/src/` to repo root `src/` | Monorepo: `packages/coding-agent/src/` |
| config.ts | Has local additions: `getBundledExtensionsDir`, `getBundledSkillsDir`, `getBundledThemesDir`, `getBundledDefaultsDir`, `bootstrapAgentDir`, `seedDefaultExtensions`, `seedDefaultSkills`, `seedDefaultThemes`, `ensureAgentDir`, `getFirstRunMarkerPath`, `markFirstRunComplete`, `source` InstallMethod | No bundled-subdir functions, no bootstrapAgentDir, no source install method |
| main.ts | Loads bundled extensions/skills/themes via `getBundled*Dir()`, adds `additionalAgentPaths: []`, `EXTENSION_LOAD_FAILURE_HINT` says `"selesai -ne"` | No bundled path loading, `EXTENSION_LOAD_FAILURE_HINT` says `"pi -ne"` |
| core/agents.ts | **Local-only file** — agent persona loading, not in upstream | Does not exist |
| core/git-command.ts | **Local-only file** | Does not exist |
| utils/thinking-tags.ts | **Local-only file** | Does not exist |
| src/defaults/ | **Local-only dir** — settings.json, models.json | Does not exist |
| src/skills/ | **Local-only dir** — 13 custom skills (ponytail, caveman, handoff, etc.) | Does not exist |
| src/themes/ | **Local-only dir** — powerline-footer | Does not exist |
| src/extensions/ | **Local-only dir** — 10+ custom extensions (pi-subagents, workflow, question, pi-intercom, etc.) | Does not exist (upstream has no bundled extensions) |
| core/package-manager.ts | Has local `extensionHost` feature ("selesai" vs "pi" winner), hardcoded `.pi` path literal for pi-host ext dir | No extensionHost feature |
| core/resource-loader.ts | Has `additionalAgentPaths` support, `extensionHost` conflict resolution | No `additionalAgentPaths` |
| core/settings-manager.ts | Has `extensionHost` setting | No `extensionHost` |
| core/diagnostics.ts | Has local `winner?: "selesai" | "pi"` field | No winner field |
| scripts/upstream.sh | **Local-only** — sync/compare/pick tool | Does not exist |
| test/ dir | **Local-only** | Does not exist (upstream uses vitest at monorepo root) |
| __tests__/ | Local tests | N/A |

## Key Risk Areas (Must Preserve)

1. **`package.json`**: `@selesai/code` name, `piConfig.name="selesai"`, `piConfig.configDir=".selesai"`, bin=`selesai`, pinned deps (not `^`), local `copy-assets` script includes extensions/skills/themes/defaults dirs.
2. **`src/config.ts`**: All `getBundled*Dir()` functions, `bootstrapAgentDir()`, `seedDefault*()` functions, `source` InstallMethod, `getFirstRunMarkerPath`, `markFirstRunComplete`, `ensureAgentDir`.
3. **`src/main.ts`**: Bundled extension/skill/theme loading, `additionalAgentPaths`, `selesai` in hints.
4. **`src/core/agents.ts`**: Entire file is local-only.
5. **`src/core/git-command.ts`**: Entire file is local-only.
6. **`src/utils/thinking-tags.ts`**: Entire file is local-only.
7. **`src/core/package-manager.ts`**: `extensionHost` feature, hardcoded `.pi` path for pi-host ext loading (lines ~2397-2400).
8. **`src/core/resource-loader.ts`**: `additionalAgentPaths`, `extensionHost` conflict resolution.
9. **`src/core/settings-manager.ts`**: `extensionHost` setting.
10. **`src/core/diagnostics.ts`**: `winner` field on conflict diagnostics.
11. **All `src/extensions/` content**: 10+ custom extensions.
12. **All `src/skills/` content**: 13 custom skills.
13. **All `src/themes/` content**: powerline-footer themes.
14. **All `src/defaults/` content**: settings.json, models.json.
15. **All `src/__tests__/` content**: Local test suites.
16. **`scripts/upstream.sh`**: Local tooling.
17. **`test/` dir**: Local test infrastructure.

---

## Task 1: Refresh Upstream Cache to v0.80.3

### Discovery
The repo has `.upstream-cache/pi/` with a sparse checkout of `packages/coding-agent/`. It's currently at the `v0.80.2` tag (matching pinned deps). The `scripts/upstream.sh sync` command checks out the ref resolved from `package.json` deps.

### Change
Run:
```bash
./scripts/upstream.sh sync --ref v0.80.3
```

If the tag doesn't exist or fetch fails, the script falls back to fetching. Verify:
```bash
git -C .upstream-cache/pi rev-parse --short HEAD
git -C .upstream-cache/pi describe --tags
```

### Verification
- `.upstream-cache/pi/packages/coding-agent/package.json` shows `"version": "0.80.3"`.
- `.upstream-cache/pi/packages/coding-agent/src/` is accessible.

---

## Task 2: Generate Diff: Local vs Upstream v0.80.3

### Discovery
Use the existing `scripts/upstream.sh compare` to get a high-level file-only diff. Then produce a detailed content diff for files that differ.

### Change
Run:
```bash
./scripts/upstream.sh compare --ref v0.80.3
```

Then for each file flagged as "differ" (excluding local-only files), produce a unified diff:
```bash
diff -u .upstream-cache/pi/packages/coding-agent/src/<file> src/<file>
```

Produce the same diff for:
- `package.json` (compare `.upstream-cache/pi/packages/coding-agent/package.json` vs local `package.json`)
- `tsconfig.base.json`, `tsconfig.build.json`
- `vitest.config.ts`

### Verification
- A complete list of upstream-changed files (v0.80.2 → v0.80.3) is captured.
- Local-only files are identified and excluded from the merge set.

---

## Task 3: Review Upstream v0.80.3 Changelog

### Discovery
Read the upstream CHANGELOG to understand what changed between 0.80.2 and 0.80.3.

### Change
Read:
```
.upstream-cache/pi/packages/coding-agent/CHANGELOG.md
```
Focus on the section for `0.80.3` (or between 0.80.2 and 0.80.3).

Also check the upstream commit log:
```bash
./scripts/upstream.sh log --ref v0.80.3 30
```

### Verification
- Understand whether changes are bug fixes, new features, or breaking changes.
- Identify which upstream changes conflict with local customizations.

---

## Task 4: Selectively Apply Upstream Changes (File-by-File)

### Discovery
For each file that differs between upstream v0.80.3 and local, determine if the upstream change can be applied directly or needs manual integration.

### Categorization

**Category A — Pure upstream files with no local modifications** (safe to apply directly):
Check each file in the `differ` list against the local file. If the local version matches upstream v0.80.2 exactly (no selesai rebrand or additions), it's Category A.

Likely candidates (files that selesai doesn't customize):
- `src/utils/*.ts` (except `thinking-tags.ts` which is local-only)
- `src/modes/interactive/components/*.ts` (if no rebrand)
- `src/cli/*.ts` (if no rebrand)
- `src/core/tools/*.ts` (if no rebrand)

**Category B — Upstream files with local modifications** (manual merge needed):
- `src/config.ts` — has extensive local additions
- `src/main.ts` — has bundled loading, rebrand
- `src/core/package-manager.ts` — has extensionHost, .pi literal
- `src/core/resource-loader.ts` — has additionalAgentPaths, extensionHost
- `src/core/settings-manager.ts` — has extensionHost
- `src/core/diagnostics.ts` — has winner field

**Category C — Local-only files** (never touch):
- `src/core/agents.ts`
- `src/core/git-command.ts`
- `src/utils/thinking-tags.ts`
- `src/extensions/**` (all)
- `src/skills/**` (all)
- `src/themes/**` (all)
- `src/defaults/**` (all)
- `src/__tests__/**` (all)
- `scripts/upstream.sh`
- `test/**` (all)
- `context.md`

### Change

**For Category A files:**
Use `scripts/upstream.sh pick` for individual commits, or manually copy:
```bash
cp .upstream-cache/pi/packages/coding-agent/src/<file> src/<file>
```

**For Category B files:**
For each file, manually diff and apply only the upstream changes that are NOT local customizations. Steps per file:

1. `diff -u src/<file> .upstream-cache/pi/packages/coding-agent/src/<file>` — review every hunk
2. For each hunk: if it touches local-customized code, skip or manually adapt; if it touches shared code, apply
3. Re-apply the rebrand after merging (ensure `selesai` references, `.selesai` configDir, `getBundled*` calls remain)

Specific Category B merge notes:

- **`src/config.ts`**: Upstream v0.80.3 may have changes to `detectInstallMethod`, `getSelfUpdateCommand`, or path functions. Apply upstream changes to shared functions only. Preserve all `getBundled*Dir()`, `bootstrapAgentDir()`, `seedDefault*()`, `ensureAgentDir()`, `source` InstallMethod, `getFirstRunMarkerPath`, `markFirstRunComplete`.

- **`src/main.ts`**: Upstream may change session creation flow or CLI arg handling. Apply upstream changes to shared logic. Preserve: bundled path loading (`getBundledExtensionsDir/SkillsDir/ThemesDir` calls at ~line 609-611), `additionalAgentPaths: []`, `[...bundledExtensionPaths, ...resolvedExtensionPaths]` pattern, `"selesai -ne"` hint, `bootstrapAgentDir` import and calls.

- **`src/core/package-manager.ts`**: Upstream may change package resolution or extension loading. Apply upstream changes. Preserve: `extensionHost` feature (lines ~2397-2442), hardcoded `.pi` path for pi-host ext dir (lines ~2399-2400).

- **`src/core/resource-loader.ts`**: Upstream may change resource loading logic. Apply upstream changes. Preserve: `additionalAgentPaths` support, `extensionHost` conflict resolution, `selesai`/`pi` winner logic.

- **`src/core/settings-manager.ts`**: Preserve `extensionHost` setting definition.

- **`src/core/diagnostics.ts`**: Preserve `winner?: "selesai" | "pi"` field.

### Verification
After each file merge:
- `npx tsgo --noEmit` (or `npx tsc --noEmit`) passes with no type errors
- `grep -r '\.pi' src/` still shows only the intentional hardcoded `.pi` in package-manager.ts (for pi-host extension loading)
- `grep -r 'selesai' src/` shows expected rebrand references
- No upstream `pi` references accidentally introduced into local code

---

## Task 5: Bump Dependency Versions to 0.80.3

### Discovery
`package.json` pins three pi packages at `0.80.2`. Upstream v0.80.3 ships updated versions.

### Change
In `package.json`, update:
```json
"@earendil-works/pi-agent-core": "0.80.3",
"@earendil-works/pi-ai": "0.80.3",
"@earendil-works/pi-tui": "0.80.3"
```

Then:
```bash
npm install
```

### Verification
- `npm ls @earendil-works/pi-agent-core @earendil-works/pi-ai @earendil-works/pi-tui` shows `0.80.3`
- `npm run build` succeeds
- No peer dependency warnings for the three packages

---

## Task 6: Update Upstream Cache Ref Tracking

### Discovery
The `scripts/upstream.sh` resolves the ref from `package.json` deps. After bumping to `0.80.3`, `sync` will automatically use `v0.80.3`.

### Change
Refresh the cache to match the new pin:
```bash
./scripts/upstream.sh sync
```

### Verification
- `git -C .upstream-cache/pi describe --tags` shows `v0.80.3`
- `./scripts/upstream.sh compare` shows no diffs (all already merged)

---

## Task 7: Full Build and Test Verification

### Discovery
Verify the merged code builds and local tests pass.

### Change
Run:
```bash
npm run build
npx vitest --run
```

If `vitest` is configured at the repo level, also run extension tests:
```bash
cd src/extensions && npx vitest --run
```

### Verification

**Success cases:**
- `npm run build` completes with exit code 0
- `dist/cli.js` exists and is executable
- `dist/extensions/`, `dist/skills/`, `dist/themes/`, `dist/defaults/` all exist and contain expected files
- `npx vitest --run` passes all tests
- `npx selesai --version` outputs the correct version
- `npx selesai --help` shows `selesai` (not `pi`) in help text
- Config dir resolves to `~/.selesai/agent/` (verify by running `selesai` and checking `getAgentDir()` behavior)

**Failure cases:**
- If build fails: check for type errors from upstream API changes; the three pi deps at 0.80.3 may have breaking type changes that need adaptation
- If tests fail: check if upstream changed behavior that local tests depend on

**Regression checks:**
- All local extensions load: `selesai` (with no args) should boot and show extension-loaded state
- `extensionHost` setting still works: set `"extensionHost": { "some-ext": "pi" }` in settings.json and verify behavior
- Bundled extensions/skills/themes load from package dirs (not user dirs)
- `SELESAI_*` environment variables still function (pi-subagents, pi-intercom)
- `@selesai/code` package resolution in pi-subagents works (pi-spawn.ts)
- First-run bootstrap still creates `~/.selesai/agent/` with subdirs

---

## Task 8: Rebrand Audit Post-Merge

### Discovery
After merging upstream changes, verify no upstream `pi` references leaked into local code paths.

### Change
Run these greps:
```bash
# Check for leaked .pi config dir references (should only be the intentional one in package-manager.ts)
grep -rn '"\.pi"' src/ --include='*.ts'

# Check for leaked "pi" binary name (should be "selesai" everywhere)
grep -rn '"pi ' src/ --include='*.ts' | grep -v node_modules

# Check for leaked @earendil-works/pi-coding-agent references
grep -rn '@earendil-works/pi-coding-agent' src/ --include='*.ts'

# Check EXTENSION_LOAD_FAILURE_HINT still says selesai
grep -rn 'EXTENSION_LOAD_FAILURE_HINT' src/main.ts
```

### Verification
- `".pi"` literal only appears in `src/core/package-manager.ts` (intentional, for pi-host ext loading)
- No `"pi -ne"` or `"pi "` binary references outside package-manager.ts
- No `@earendil-works/pi-coding-agent` in source (should be `@selesai/code`)
- `EXTENSION_LOAD_FAILURE_HINT` says `"selesai -ne"`

---

## What "Done" Looks Like

1. `package.json` deps pin `0.80.3` for all three pi packages
2. `npm run build` passes
3. `npx vitest --run` passes
4. `./scripts/upstream.sh compare --ref v0.80.3` shows no unexpected diffs (only known local customizations)
5. All local extensions, skills, themes, and defaults still load
6. Config dir is `~/.selesai/agent/`
7. Binary name is `selesai`
8. No leaked `.pi`/`pi`/`@earendil-works/pi-coding-agent` references (outside the intentional pi-host extension loading)
9. `SELESAI_*` env vars work in pi-subagents/pi-intercom
10. `extensionHost` setting still functions

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| v0.80.3 has breaking API changes in pi-agent-core/pi-ai/pi-tui | Low (patch bump) | High | Check CHANGELOG first; if breaking, adapt types |
| Upstream changed `config.ts` significantly | Low | High | Manual file-by-file merge; preserve all local functions |
| Upstream changed `main.ts` session flow | Medium | High | Manual merge; preserve bundled loading pattern |
| Upstream changed `resource-loader.ts` extension loading | Medium | High | Preserve `additionalAgentPaths`, `extensionHost` |
| Upstream added new files to `src/` that conflict with local | Low | Medium | Compare file lists; rename if conflict |
| Local test suite breaks from upstream behavior change | Medium | Medium | Run tests; fix per-test if needed |
| `package-lock.json` conflicts after dep bump | Low | Low | `npm install` regenerates |

## Execution Order

Tasks 1-3 can be done in sequence (discovery). Task 4 is the core merge work. Task 5 (dep bump) should happen alongside or after Task 4. Tasks 6-8 are verification.

Recommended order: **1 → 2 → 3 → 4 → 5 → 6 → 7 → 8**

WORKFLOW_PLAN_STATUS: ready