# Upstream Sync Feasibility Report: selesai ← pi v0.80.3

## 1. Existing Tooling/Commands to Reuse

### `scripts/upstream.sh` (scripts/upstream.sh)
The primary sync tool. Already supports:
- `./scripts/upstream.sh sync` — clones/fetches upstream monorepo into `.upstream-cache/pi/`
- `./scripts/upstream.sh compare [--ref v0.80.3]` — recursive diff of local root vs upstream `packages/coding-agent/`
- `./scripts/upstream.sh log [--ref v0.80.3] [N]` — last N upstream commits touching the subtree
- `./scripts/upstream.sh pick <sha>` — path-rewrites and applies one upstream commit
- `./scripts/upstream.sh patch <sha>` — emits rewritten patch for review

**Key detail**: `resolve_ref()` reads the pi dep version from `package.json` → `@earendil-works/pi-ai` → extracts semver → tags as `v<ver>`. Currently pinned to `0.80.2`. Updating to `0.80.3` in `package.json` will make `--ref` auto-resolve.

### `.upstream-cache/pi/` (gitignored)
Already has the upstream monorepo cloned. Tags `v0.80.0` through `v0.80.3` are present. Only one commit between v0.80.2 and v0.80.3 touching `packages/coding-agent/`: `a23abe4 Release v0.80.3`.

### `git log --all` history
The fork history shows a clear rebrand commit: `9d22a81 rename: @earendil-works/pi-coding-agent → @selesai/code`. All subsequent selesai commits build on top. The `main` branch has diverged significantly with ~30+ selesai-specific commits.

---

## 2. Concrete Files/Functions That Centralize Fork Customizations

### `src/config.ts` (lines 488-592) — **THE central fork point**
```typescript
// Reads from package.json piConfig:
//   "piConfig": { "name": "selesai", "configDir": ".selesai" }
const piConfigName: string | undefined = pkg.piConfig?.name;
export const PACKAGE_NAME: string = pkg.name || "@earendil-works/pi-coding-agent";
export const APP_NAME: string = piConfigName || "pi";
export const APP_TITLE: string = piConfigName ? APP_NAME : "π";
export const CONFIG_DIR_NAME: string = pkg.piConfig?.configDir || ".pi";
export const VERSION: string = pkg.version || "0.0.0";
export const ENV_AGENT_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`;  // SELESAI_CODING_AGENT_DIR
export const ENV_SESSION_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_SESSION_DIR`;  // SELESAI_CODING_AGENT_SESSION_DIR
```
**Upstream v0.80.3 has NO changes to config.ts** — identical exports at same line numbers. This file is safe to keep as-is during sync.

### `package.json` (root)
Fork-specific fields:
- `"name": "@selesai/code"` (upstream: `@earendil-works/pi-coding-agent`)
- `"piConfig": { "name": "selesai", "configDir": ".selesai" }` (upstream: `{ "configDir": ".pi" }`)
- `"bin": { "selesai": "dist/cli.js" }` (upstream: `{ "pi": "dist/cli.js" }`)
- `"version": "0.3.7"` (upstream: `0.80.3`)
- Dependencies pinned to `0.80.2` (upstream bumps to `^0.80.3`)
- No `"./rpc-entry"` export (upstream v0.80.3 adds one)
- No `install-lock/` or `npm-shrinkwrap.json` (upstream v0.80.3 adds these)

### `src/main.ts` (lines 1-860)
Fork-specific changes:
- `EXTENSION_LOAD_FAILURE_HINT` references `"selesai -ne"` (line 52)
- `process.env.PI_CODING_AGENT = "true"` kept from upstream (in `cli.ts`)
- `bootstrapAgentDir(agentDir)` call (line ~200) — selesai-specific seeding
- `bundledExtensionPaths`, `bundledThemePaths`, `bundledSkillPaths` (lines ~250) — selesai-specific bundled resource loading
- `getBundledExtensionsDir()` etc. — selesai-specific path resolvers

**Upstream v0.80.3 changes to main.ts** (4 hunks):
1. `validateSessionIdFlags` — removes `parsed.noSession` from conflicting flags list
2. New `openSessionOrExit()` helper function
3. `SessionManager.inMemory(cwd)` → `SessionManager.inMemory(cwd, parsed.sessionId !== undefined ? { id: parsed.sessionId } : undefined)`
4. `SessionManager.open(resolved.path, sessionDir)` → `openSessionOrExit(resolved.path, sessionDir)`
5. Startup benchmark: adds 150ms drain delay before `interactiveMode.stop()`, moves `printTimings()` after stop

### `src/core/package-manager.ts` (lines 2370-2500+)
Fork-specific pi-host extension dedup logic:
- Reads `~/.pi/agent/extensions` as a secondary extension source
- `extensionHost` setting for per-extension winner selection
- `selesaiPathsByName` vs `piHostEntries` collision resolution
- `ResourceCollision` type with `winner: "selesai" | "pi"` field

### `src/utils/version-check.ts` (lines 93-95)
Fork-specific: `checkForNewPiVersion()` always returns `undefined` — disables the pi.dev update nag since selesai has no equivalent infra.

### `src/extensions/` (entire directory)
All selesai-specific bundled extensions:
- `pi-intercom/`, `pi-subagents/`, `pi-powerline-footer/`, `pi-web-agent/`, `pi-rewind-hook/`
- `question/`, `workflow/`, `caveman/`, `ponytail/`
- `tokenin-onboarding.ts`, `web-agent-onboarding.ts`, `undo.ts`, `rtk.ts`, `copy-turn.ts`, `handoff-new.ts`

### `src/skills/`, `src/themes/`, `src/defaults/`
Bundled resources shipped with selesai. Loaded via `getBundledSkillsDir()` etc.

### `src/cli.ts` (the entry point)
Fork-specific: `process.title = APP_NAME` (resolves to "selesai"), `process.env.PI_CODING_AGENT = "true"`.

### `vitest.config.ts`
Fork-specific: self-referencing alias `@selesai/code` → `dist/index.js`.

### `tsconfig.build.json`
Fork-specific: excludes `src/extensions`, `src/themes`, `src/__tests__` from build.

---

## 3. Existing Tests/Checks to Reuse for Validation

### Existing test files:
| Test file | What it validates |
|-----------|-----------------|
| `test/pi-host-extension-dedup.test.ts` | Extension collision resolution between `~/.selesai/` and `~/.pi/` |
| `test/git-command.test.ts` | Git command execution |
| `src/__tests__/bootstrap.test.ts` | Agent dir bootstrap, config seeding |
| `src/__tests__/version-check.test.ts` | Version check against npm registry |
| `src/__tests__/tokenin-onboarding.test.ts` | Token-In model onboarding |
| `src/__tests__/tool-error-autofix.test.ts` | Tool error autofix |
| `src/__tests__/model-registry-defaults.test.ts` | Default model registry |
| `src/__tests__/adapter.test.ts` | Workflow adapter |
| `src/__tests__/state-machine.test.ts` | Workflow state machine |
| `src/__tests__/thinking-tags.test.ts` | Thinking tags |
| `src/__tests__/workflow-race.test.ts` | Workflow race conditions |

### Build validation:
- `npm run build` — uses `tsgo` compiler, outputs to `dist/`
- `npm run copy-assets` — copies themes, extensions, skills, defaults to `dist/`

### Upstream v0.80.3 added tests (not yet in selesai):
- `test/session-file-invalid.test.ts` — validates `SessionManager.open()` rejects invalid files
- `test/session-id-readonly.test.ts` — validates `--no-session --session-id`
- `test/image-process.test.ts` — validates new `processImage()` utility
- `test/block-images.test.ts` — validates image blocking setting
- `test/suite/regressions/3686-session-name-event.test.ts` — session_info_changed event
- `test/suite/regressions/6019-explicit-provider-retry-message.test.ts`
- `test/suite/regressions/6162-extension-active-tools-next-turn.test.ts`
- `test/suite/regressions/pre-prompt-compaction-no-continue.test.ts`

---

## 4. Obvious Traps That Could Silently Break the Fork During Sync

### Trap 1: `package.json` merge conflicts
Upstream v0.80.3 adds `"./rpc-entry"` export, `install-lock/`, `npm-shrinkwrap.json`, bumps deps to `^0.80.3`. Selesai's `package.json` has different name, piConfig, bin, version, and no shrinkwrap. **Must be manually merged — never take upstream's version wholesale.**

### Trap 2: `src/config.ts` is safe NOW but fragile
Upstream v0.80.3 has zero changes to config.ts. But if a future upstream change touches the `APP_NAME`/`CONFIG_DIR_NAME` area, the diff will conflict with selesai's rebrand. **Pin config.ts as a "local-only" file in the merge strategy.**

### Trap 3: `src/main.ts` has intertwined changes
Upstream's 4 hunks touch code that selesai has also modified (session manager creation, startup benchmark). The `openSessionOrExit()` helper and `SessionManager.inMemory()` signature change are safe to cherry-pick, but the benchmark timing changes sit near selesai-specific `bootstrapAgentDir()` and bundled path code. **Review each hunk individually with `upstream.sh patch <sha>`.**

### Trap 4: `src/core/agent-session.ts` — system prompt override refactor
Upstream v0.80.3 significantly refactors `_isRetryableError()` (delegates to `isRetryableAssistantError()` from pi-agent-core), adds `_systemPromptOverride`, and changes compaction flow. Selesai has NOT modified this file, so the upstream changes should apply cleanly. **But verify no selesai extension depends on the old retry logic.**

### Trap 5: `src/core/timings.ts` — namespace refactor
Upstream adds a `TimingNamespace` system. Selesai's `src/core/resource-loader.ts` imports `resetTimings` — the upstream change adds a `resetTimings("extensions")` call. **This is a new import; verify selesai's resource-loader.ts has the same import.**

### Trap 6: `src/core/http-dispatcher.ts` — undici error handling
Upstream adds `withUndiciErrorListener()` and `clientFactory`/`factory` options to `EnvHttpProxyAgent`. Selesai has NOT modified this file. **Should apply cleanly.**

### Trap 7: `src/core/settings-manager.ts` — new `externalEditor` and `outputPad`
Upstream adds `getExternalEditorCommand()` and `getOutputPad()`/`setOutputPad()`. Selesai has NOT modified this file. **Should apply cleanly, but verify selesai's interactive mode components pick up `outputPad`.**

### Trap 8: `src/core/session-manager.ts` — `inMemory()` signature change
Upstream changes `static inMemory(cwd)` → `static inMemory(cwd, options?)`. Selesai's `main.ts` calls `SessionManager.inMemory(cwd)` — this is type-compatible with the new signature. **Safe.**

### Trap 9: New files upstream that selesai doesn't have
- `src/rpc-entry.ts` — new entry point for RPC mode
- `src/utils/image-process.ts` — new image processing utility
- `src/modes/interactive/components/status-indicator.ts` — new status indicator component
- `src/modes/rpc/` changes (get_entries, get_tree RPC commands)
- `install-lock/package.json` + `install-lock/package-lock.json`
- `npm-shrinkwrap.json`

**These need to be created in selesai's tree. Missing them won't break the build but will lose features.**

### Trap 10: `src/core/extensions/types.ts` — new `SessionInfoChangedEvent`
Upstream adds a new event type. Selesai's `src/core/agent-session.ts` already emits `session_info_changed` (line 2712-2715 of current selesai). **The upstream change adds the type definition; selesai already has the emission. Verify the type is exported from selesai's `src/core/extensions/index.ts`.**

### Trap 11: `src/core/model-resolver.ts` — default model change
Upstream changes `openai: "gpt-5.4"` → `openai: "gpt-5.5"`. Selesai has its own model defaults. **This is a one-line change that may conflict with selesai's model config.**

### Trap 12: `src/core/tools/read.ts` — image processing refactor
Upstream replaces inline `resizeImage`/`formatDimensionNote` calls with `processImage()`. Selesai has NOT modified this file. **Should apply cleanly, but verify selesai's `src/utils/` has the new `image-process.ts` file.**

---

## 5. Recommended Minimal Reuse Path

### Step 1: Update package.json deps
```bash
# Bump pi dependency versions to 0.80.3
# Keep selesai-specific name, piConfig, bin, version
# Add "./rpc-entry" export
# Do NOT add install-lock/ or npm-shrinkwrap.json (ponytail: not needed)
```

### Step 2: Cherry-pick safe upstream changes via `upstream.sh pick`
The v0.80.3 diff is a single commit `a23abe4`. Use:
```bash
./scripts/upstream.sh patch a23abe4 > /tmp/v0.80.3.patch
```
Then split the patch into categories:

**Safe to apply directly (no selesai modifications):**
- `src/core/agent-session.ts` — retry refactor, system prompt override
- `src/core/timings.ts` — namespace support
- `src/core/http-dispatcher.ts` — undici error handling
- `src/core/settings-manager.ts` — externalEditor, outputPad
- `src/core/session-manager.ts` — inMemory() signature, invalid file rejection
- `src/core/tools/read.ts` — processImage() refactor
- `src/core/extensions/types.ts` — SessionInfoChangedEvent
- `src/core/extensions/loader.ts` — extension timings
- `src/core/extensions/index.ts` — export SessionInfoChangedEvent
- `src/core/resource-loader.ts` — resetTimings("extensions") call
- `src/utils/mime.ts` — BMP detection
- `src/utils/image-convert.ts` — convertImageBytesToPng
- `src/cli/file-processor.ts` — processImage() refactor
- `src/modes/interactive/components/assistant-message.ts` — outputPad
- `src/modes/interactive/components/user-message.ts` — outputPad
- `src/modes/interactive/components/extension-editor.ts` — externalEditor
- `src/modes/interactive/components/settings-selector.ts` — outputPad toggle
- `src/modes/interactive/components/status-indicator.ts` — new file
- `src/modes/interactive/interactive-mode.ts` — status indicator refactor
- `src/modes/rpc/` — get_entries, get_tree
- `src/rpc-entry.ts` — new file
- `src/utils/image-process.ts` — new file
- `src/index.ts` — export SessionInfoChangedEvent, SessionTreeNode

**Needs manual review (selesai has modifications nearby):**
- `src/main.ts` — 4 hunks near selesai-specific code
- `package.json` — full manual merge
- `src/core/model-resolver.ts` — default model change (check if selesai overrides this)

**Local-only (keep selesai version, never take upstream):**
- `src/config.ts` — rebrand constants
- `src/cli.ts` — process.title, APP_NAME
- `src/core/package-manager.ts` — pi-host extension dedup
- `src/utils/version-check.ts` — update nag disabled
- `src/extensions/` — all selesai-specific extensions
- `src/skills/`, `src/themes/`, `src/defaults/`
- `vitest.config.ts` — self-referencing alias
- `tsconfig.build.json` — extension/theme exclusions

### Step 3: Add new upstream test files
Copy upstream test files that validate new features:
- `test/session-file-invalid.test.ts`
- `test/session-id-readonly.test.ts`
- `test/image-process.test.ts`
- `test/block-images.test.ts`
- `test/suite/regressions/*.test.ts`

### Step 4: Validate
```bash
npm run build                    # Must succeed
npm test                         # All existing tests pass
./scripts/upstream.sh compare --ref v0.80.3  # Verify only expected files differ
# Manual: check for "pi" string literals in src/ that should be "selesai"
grep -r '"pi"' src/ --include='*.ts' | grep -v 'node_modules' | grep -v '".pi"' | grep -v 'pi-'
```

### Step 5: Post-sync cleanup
- Verify `process.env.PI_CODING_AGENT = "true"` is still set in `cli.ts`
- Verify `process.title` resolves to "selesai"
- Verify `~/.selesai/agent/` is used (not `~/.pi/agent/`)
- Verify extension collision dedup still works
- Verify `checkForNewPiVersion()` still returns `undefined`