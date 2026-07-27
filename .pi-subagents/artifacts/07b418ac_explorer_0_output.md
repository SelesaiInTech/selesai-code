# Upstream Sync Reuse Analysis: selesai ← pi v0.80.3

## 1. Existing Upstream Sync Tooling

### `scripts/upstream.sh` — the primary sync mechanism
- **Location**: `scripts/upstream.sh` (lines 1-130)
- **Commands**: `sync`, `compare`, `log`, `pick`, `patch`
- **Cache**: `.upstream-cache/pi/` — shallow clone of `earendil-works/pi.git`, sparse-checkout to `packages/coding-agent/`
- **Ref resolution**: reads pi dep version from `package.json` (currently `0.80.2`), maps to tag `v<version>`
- **Path rewriting**: `rewrite_patch()` strips `packages/coding-agent/` prefix from diff paths so patches apply at local root
- **`compare`**: `diff -rq` between upstream subtree and local root, excluding `node_modules`, `dist`, `.git`, `.upstream-cache`
- **`pick`**: applies a single upstream commit via `git apply --index` after path rewriting
- **`patch`**: emits rewritten patch to stdout for review before applying

### `.upstream-cache/pi/` — cached upstream clone
- Already has `v0.80.3` tag fetched (verified: `v0.80.0` through `v0.80.3` present)
- Only one commit on `v0.80.2..v0.80.3` for `packages/coding-agent/`: `a23abe4 Release v0.80.3`

## 2. Best Reuse Points for Audit/Sync

### For running the diff
```bash
./scripts/upstream.sh compare --ref v0.80.3
```
This is the single command to see what changed between upstream v0.80.3 and local. Already wired.

### For cherry-picking individual upstream changes
```bash
./scripts/upstream.sh patch <sha>   # review first
./scripts/upstream.sh pick <sha>    # apply
```

### For understanding what changed upstream
```bash
cd .upstream-cache/pi && git diff v0.80.2..v0.80.3 -- packages/coding-agent/
```
Already inspected. v0.80.3 delta is 72 files, 3642 insertions, 394 deletions. Key areas below.

## 3. Local Customizations: Centralized vs Scattered

### Centralized (single file, easy to preserve)

| Customization | File | Mechanism |
|---|---|---|
| Package name/rebrand | `package.json` | `piConfig: { name: "selesai", configDir: ".selesai" }` |
| Config dir resolution | `src/config.ts:573-577` | `APP_NAME`, `CONFIG_DIR_NAME`, `APP_TITLE` derived from `pkg.piConfig` |
| Env var names | `src/config.ts:581-582` | `SELESAI_CODING_AGENT_DIR` / `SELESAI_CODING_AGENT_SESSION_DIR` |
| Pi-host extension dedup | `src/core/package-manager.ts:2395-2457` | Loads `~/.pi/agent/extensions`, dedup with `extensionHost` setting |
| Extension collision diagnostics | `src/core/diagnostics.ts:5-9` | `ResourceCollision.winner: "selesai" \| "pi"` |
| Collision warnings | `src/core/resource-loader.ts:390-397` | Maps collisions to user-facing diagnostics |
| First-time setup welcome | `src/modes/interactive/components/first-time-setup.ts:57-81` | Explains fork relationship |
| Version check | `src/utils/version-check.ts:61-83` | `getLatestPackageRelease()` for npm registry |
| Self-update for source installs | `src/config.ts:138-146` | `git pull --ff-only` + `npm install` + `npm run build` |
| Source install detection | `src/config.ts:90-91` | Checks for `.git` in package dir |
| Bundled extensions list | `src/extensions/package.json` | Selesai-specific extensions (caveman, handoff-new, workflow, etc.) |
| Bundled skills | `src/skills/` | 14 skill dirs (caveman, ponytail, etc.) — all selesai-specific |
| Bundled themes | `src/themes/powerline-footer/` | Selesai-specific theme |
| Default settings | `src/defaults/settings.json` | Token-In defaults, selesai-specific packages |
| Default models | `src/defaults/models.json` | Token-In provider config |

### Scattered (multiple files, needs careful merge)

| Customization | Files | Risk |
|---|---|---|
| `~/.pi/agent` path literals in comments/docs | `src/core/package-manager.ts:2397-2402`, `src/core/session-manager.ts:437,1394,1421,1501`, `src/modes/interactive/components/first-time-setup.ts:74`, `src/migrations.ts:76-80`, `src/core/sdk.ts:37` | Low — mostly comments, but `package-manager.ts:2400` hardcodes `.pi` for pi-host extension dir |
| Extension files (pi-subagents, pi-intercom, etc.) | `src/extensions/pi-*/` | 7 extension dirs with selesai-specific patches |
| Workflow extension | `src/extensions/workflow/` | Selesai-specific workflow modes |
| `main.ts` hint text | `src/main.ts:52` | `"selesai -ne"` in error hint |
| `package-manager-cli.ts` | `src/package-manager-cli.ts:397-413` | Source install update plan, `APP_NAME` references |
| `test/pi-host-extension-dedup.test.ts` | `test/pi-host-extension-dedup.test.ts` | Tests for the dedup feature |

## 4. Existing Tests That Validate Safe Sync

| Test File | What It Validates |
|---|---|
| `test/pi-host-extension-dedup.test.ts` | `extensionEntryName()` path resolution, collision detection between `.selesai` and `.pi` roots |
| `src/__tests__/adapter.test.ts` | Workflow adapter behavior |
| `src/__tests__/state-machine.test.ts` | Workflow state machine |
| `src/__tests__/workflow-race.test.ts` | Workflow race conditions |
| `src/__tests__/version-check.test.ts` | Version comparison logic |
| `src/__tests__/tokenin-onboarding.test.ts` | Token-In onboarding |
| `src/__tests__/thinking-tags.test.ts` | Thinking tag parsing |
| `src/__tests__/tool-error-autofix.test.ts` | Tool error autofix |
| `test/git-command.test.ts` | Git command parsing |

**Gap**: No integration test that runs `upstream.sh compare` and asserts no unexpected diffs in critical files. No test that the build succeeds after a `pick`.

## 5. Traps Where Upstream Changes Could Silently Break the Fork

### Trap 1: `src/config.ts` — rebrand constants
Upstream v0.80.3 has **zero changes** to `config.ts` (verified: diff is empty). But any future upstream change that adds a new path function using hardcoded `.pi` would silently break selesai. **Watch**: new functions in `config.ts` that don't use `CONFIG_DIR_NAME` or `APP_NAME`.

### Trap 2: `src/core/package-manager.ts` — pi-host extension dir
Line 2400 hardcodes `join(getHomeDir(), ".pi", "agent")`. If upstream changes how extensions are loaded (e.g., new resource type, new scan pattern), the pi-host dedup logic at lines 2395-2457 could conflict. **Watch**: changes to `addAutoDiscoveredResources()` or `collectAutoExtensionEntries()`.

### Trap 3: `src/core/agent-session.ts` — system prompt override
Upstream v0.80.3 added `_systemPromptOverride` and `_installAgentNextTurnRefresh()` (lines 465-489, 978, 1102-1112, 1150-1155). Selesai has **not** applied these changes (verified: no diff in this file). If selesai's `agent-session.ts` is behind, the `prepareNextTurnWithContext` flow won't work — but this is a missing feature, not a silent break.

### Trap 4: `src/core/http-dispatcher.ts` — undici error handling
Upstream v0.80.3 added `withUndiciErrorListener()` and `createUndiciClient()` to prevent crashes from undici internal errors. Selesai hasn't applied this. **Risk**: undici errors crash the process.

### Trap 5: `src/core/session-manager.ts` — empty file handling
Upstream v0.80.3 changed session file validation: empty files get initialized, non-empty invalid files throw. Selesai hasn't applied this. **Risk**: corrupted session files silently append without headers.

### Trap 6: `src/core/timings.ts` — namespaced timings
Upstream v0.80.3 added timing namespaces (`"main"` | `"extensions"`). Selesai hasn't applied. **Risk**: extension timing calls (`time(..., "extensions")`) would fail at runtime if selesai's `timings.ts` is used — but selesai has its own copy, so this only matters if upstream code is cherry-picked without the timings change.

### Trap 7: `src/core/extensions/` — new event types
Upstream v0.80.3 added `SessionInfoChangedEvent` and `session_info_changed` event emission. Selesai hasn't applied. **Risk**: extensions that listen for this event won't get it.

### Trap 8: `src/utils/image-process.ts`, `src/utils/mime.ts` — new files
Upstream v0.80.3 added `image-process.ts` and updated `mime.ts` (BMP support), `image-convert.ts`, `tools/read.ts`. Selesai hasn't applied. **Risk**: `processImage()` calls in upstream-cherry-picked code would fail with import errors.

### Trap 9: `src/modes/rpc/` — new RPC commands
Upstream v0.80.3 added `get_entries` and `get_tree` RPC commands, plus `rpc-entry.ts`. Selesai hasn't applied. **Risk**: RPC clients expecting these commands get errors.

### Trap 10: `src/modes/interactive/` — output padding, status indicators, external editor
Upstream v0.80.3 added `outputPad`, `StatusIndicator` components, `externalEditor` setting, and `length` stop reason handling. Selesai hasn't applied. **Risk**: interactive mode behavior diverges.

### Trap 11: `src/core/model-resolver.ts` — default model
Upstream v0.80.3 changed `openai` default from `gpt-5.4` to `gpt-5.5`. Selesai hasn't applied. **Risk**: trivial, but could cause confusion if someone compares.

## 6. Recommended Minimal Implementation Path

### Phase 1: Audit (reuse existing tooling)
```bash
# 1. Run the existing compare to see the full diff
./scripts/upstream.sh compare --ref v0.80.3 > /tmp/upstream-diff.txt

# 2. Check which local files have diverged from upstream baseline
#    (files modified in both upstream and selesai since fork point)
```

### Phase 2: Bump dependencies (low risk, high value)
1. Update `package.json`: `@earendil-works/pi-agent-core`, `pi-ai`, `pi-tui` → `^0.80.3`
2. Run `npm install`
3. Run `npm test` — verify nothing breaks at the dependency level

### Phase 3: Cherry-pick safe upstream changes (use `upstream.sh pick`)
Apply upstream commits that don't touch selesai-customized files:
- `src/core/http-dispatcher.ts` — undici error handling (prevents crashes)
- `src/core/session-manager.ts` — session file validation (data integrity)
- `src/core/timings.ts` — namespaced timings (backward-compatible)
- `src/core/extensions/` — `SessionInfoChangedEvent` (new event, no conflict)
- `src/utils/image-process.ts`, `src/utils/mime.ts`, `src/utils/image-convert.ts` — new files
- `src/core/tools/read.ts` — uses new image-process module
- `src/cli/file-processor.ts` — uses new image-process module
- `src/modes/rpc/` — new RPC commands + `rpc-entry.ts`
- `src/modes/interactive/` — output padding, status indicators, external editor
- `src/core/model-resolver.ts` — default model bump
- `src/main.ts` — timing print order, session open error handling, `inMemory` options
- `src/core/agent-session.ts` — system prompt override, retryable error delegation

Strategy: For each file, run `upstream.sh patch <sha>` to see the rewritten diff, then manually apply if the file has no selesai-specific changes. For files with selesai changes (e.g., `main.ts`, `agent-session.ts`), merge manually.

### Phase 4: Verify
```bash
npm run build
npm test
./scripts/upstream.sh compare --ref v0.80.3  # should show only selesai-specific diffs
```

### Phase 5: Update baseline
```bash
# Update the pinned version in package.json
node -e "const p=require('./package.json'); p.dependencies['@earendil-works/pi-agent-core']='^0.80.3'; p.dependencies['@earendil-works/pi-ai']='^0.80.3'; p.dependencies['@earendil-works/pi-tui']='^0.80.3'; require('fs').writeFileSync('package.json', JSON.stringify(p, null, '\t')+'\n')"
```

### Files to NEVER touch from upstream (selesai-only):
- `src/config.ts` — rebrand constants
- `src/core/package-manager.ts` — pi-host extension dedup
- `src/core/diagnostics.ts` — `winner` field
- `src/core/resource-loader.ts` — collision diagnostics
- `src/core/settings-manager.ts` — `extensionHost` setting
- `src/extensions/package.json` — selesai extension list
- `src/skills/` — all selesai-specific
- `src/themes/` — all selesai-specific
- `src/defaults/` — all selesai-specific
- `src/modes/interactive/components/first-time-setup.ts` — fork explanation
- `src/utils/version-check.ts` — `getLatestPackageRelease`
- `src/package-manager-cli.ts` — source install support
- `test/pi-host-extension-dedup.test.ts` — selesai-specific test
- `scripts/upstream.sh` — the sync tool itself