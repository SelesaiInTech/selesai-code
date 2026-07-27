Now I have full context. Let me produce the plan.

The key findings:

1. `src/utils/version-check.ts` — `checkForNewPiVersion` is stubbed to always return `undefined` (disabled for selesai fork). The working function for this private package is `getLatestPackageRelease` which queries the npm registry for the `dist-tags.latest` version. `isNewerPackageVersion` compares versions using `semver`.

2. `src/modes/interactive/interactive-mode.ts` — In `run()`, calls `checkForNewPiVersion(this.version)` and shows a notification via `showNewVersionNotification`. Currently does nothing since `checkForNewPiVersion` always returns `undefined`.

3. `src/package-manager-cli.ts` — `getSelfUpdatePlan` uses `getLatestPackageRelease` for non-pi packages to determine latest version and uses `getSelfUpdateCommand` to run the actual npm install. This is for the `selesai update --self` command.

4. `src/config.ts` — `getSelfUpdateCommand` builds the actual npm install command. `getUpdateInstruction` returns a human-readable instruction string. `detectInstallMethod` detects npm/pnpm/yarn/bun/source/bun-binary/unknown.

5. `getSelfUpdateUnavailableInstruction` provides instructions when auto-update isn't available.

6. `src/modes/print-mode.ts` — No version check at all currently.

7. `src/main.ts` — Sets `PI_SKIP_VERSION_CHECK` and `PI_OFFLINE` when `--offline` is passed.

The plan: Reactivate `checkForNewPiVersion` for the selesai fork by making it query the npm registry (using `getLatestPackageRelease`) instead of pi.dev. Then update `showNewVersionNotification` to show the correct manual `npm install` command instead of the pi.dev changelog link. Also add a lightweight stderr notice in print/rpc mode.

Here is the complete plan:

---

# Implementation Plan: Auto-Update Awareness for Private NPM-Distributed CLI

## Context

The package `@selesai/code` (bin: `selesai`) is distributed via a **private npm registry** (not public GitHub releases). The existing `checkForNewPiVersion` function in `src/utils/version-check.ts` is stubbed to always return `undefined` because it was designed to call `pi.dev/api/latest-version`, which doesn't exist for the selesai fork. However, `getLatestPackageRelease` already queries the **npm registry** (`registry.npmjs.org`) for `dist-tags.latest` and works for private packages (as long as the registry is accessible — for truly private scoped packages, the user's `.npmrc` authentication applies, but the registry URL used is the public one; see residual risks).

The goal: at startup, detect if a newer version exists on the npm registry, and notify the user with the **correct manual `npm install` command**. No automatic installs.

## 1. Discovery

### What was found

- **`src/utils/version-check.ts`**: `getLatestPackageRelease(packageName, currentVersion)` queries `https://registry.npmjs.org/{packageName}` and returns `{ version, packageName }` from `dist-tags.latest`. `isNewerPackageVersion(candidate, current)` uses `semver.compare`. `checkForNewPiVersion` is stubbed to `return undefined` with a ponytail comment explaining the selesai fork has no pi.dev equivalent.
- **`src/modes/interactive/interactive-mode.ts`**: `run()` calls `checkForNewPiVersion(this.version)` asynchronously, and if a result is returned, calls `showNewVersionNotification(release)`. `showNewVersionNotification` displays a TUI notification with a hardcoded `https://pi.dev/changelog` link.
- **`src/config.ts`**: `getUpdateInstruction(packageName)` returns the correct manual command (e.g., `npm install -g @selesai/code`). `getSelfUpdateCommand` returns the full command object. `detectInstallMethod()` detects install method. `PACKAGE_NAME` = `@selesai/code`, `APP_NAME` = `selesai`.
- **`src/package-manager-cli.ts`**: `getSelfUpdatePlan` already uses `getLatestPackageRelease` for non-pi packages. This is the `selesai update --self` codepath.
- **`src/main.ts`**: Sets `PI_SKIP_VERSION_CHECK=1` and `PI_OFFLINE=1` when `--offline` is passed.
- **`src/modes/print-mode.ts`**: No version check exists. Print mode runs prompts and exits.
- **`src/__tests__/version-check.test.ts`**: Tests `getLatestPackageRelease` with a mocked fetch.

### What to search for (for executor verification)

- `checkForNewPiVersion` — only called in `interactive-mode.ts:876`
- `showNewVersionNotification` — defined in `interactive-mode.ts:3952`, called at `:878`
- `getLatestPackageRelease` — defined in `version-check.ts:64`, used in `package-manager-cli.ts:440`
- `getUpdateInstruction` — defined in `config.ts:383`, currently unused (was likely used in the upstream pi project)
- `PI_SKIP_VERSION_CHECK` / `PI_OFFLINE` — checked in `version-check.ts:35,69` and set in `main.ts:477-478`

## 2. Identification

### Files to modify

1. **`src/utils/version-check.ts`** — Owns the version-check logic. `checkForNewPiVersion` is currently stubbed. This is the single function that gates the interactive mode notification.

2. **`src/modes/interactive/interactive-mode.ts`** — Owns the TUI notification display. `showNewVersionNotification` hardcodes `pi.dev/changelog` and doesn't show the manual npm install command. Needs to use `getUpdateInstruction` instead.

3. **`src/modes/print-mode.ts`** — Owns the print/rpc mode output. Currently has no version check. Add a lightweight stderr notice.

### Files NOT to modify

- `src/package-manager-cli.ts` — `selesai update --self` already works correctly. Do not touch.
- `src/config.ts` — `getUpdateInstruction` already returns the correct command. Do not touch.
- `src/main.ts` — Offline flag handling already sets `PI_SKIP_VERSION_CHECK`. Do not touch.
- `src/__tests__/version-check.test.ts` — Existing tests pass. Will add new test cases alongside.

## 3. Change

### Task 1: Reactivate `checkForNewPiVersion` for npm registry

**File**: `src/utils/version-check.ts`

**What to change**:

Replace the stubbed `checkForNewPiVersion` (lines 93-97) with a real implementation that queries the npm registry via `getLatestPackageRelease`:

```typescript
// ponytail: selesai uses the npm registry instead of pi.dev/api/latest-version.
// Returns the latest release if a newer version exists, undefined otherwise.
// Re-uses getLatestPackageRelease (same npm registry path as `selesai update --self`).
export async function checkForNewPiVersion(currentVersion: string): Promise<LatestPiRelease | undefined> {
	if (process.env.PI_SKIP_VERSION_CHECK || process.env.PI_OFFLINE) return undefined;
	const release = await getLatestPackageRelease(PACKAGE_NAME, currentVersion);
	if (release && isNewerPackageVersion(release.version, currentVersion)) {
		return release;
	}
	return undefined;
}
```

**Import to add**: `PACKAGE_NAME` from `../config.ts`

**Note**: The function name `checkForNewPiVersion` is kept as-is to avoid touching the call site in `interactive-mode.ts`. It already imports `checkForNewPiVersion` by that name.

**Code NOT to add**: No new functions, no new exports, no new types. Just rewire the existing stub.

### Task 2: Update `showNewVersionNotification` to show manual npm install command

**File**: `src/modes/interactive/interactive-mode.ts`

**What to change**:

In `showNewVersionNotification` (line ~3952):

1. Add import of `getUpdateInstruction` and `PACKAGE_NAME` from `../../config.ts` (PACKAGE_NAME may already be imported — check line 50-59; it is NOT currently imported, only APP_NAME, APP_TITLE, etc. are imported).

2. Replace the hardcoded changelog URL with the manual update instruction:

Replace:
```typescript
const changelogUrl = "https://pi.dev/changelog";
const changelogLink = getCapabilities().hyperlinks
    ? hyperlink(theme.fg("accent", changelogUrl), changelogUrl)
    : theme.fg("accent", changelogUrl);
const changelogLine = theme.fg("muted", "Changelog: ") + changelogLink;
```

With:
```typescript
const updateCommand = getUpdateInstruction(PACKAGE_NAME);
const updateCommandLine = theme.fg("muted", `Run: `) + theme.fg("accent", updateCommand);
```

And replace the line that renders `changelogLine`:
```typescript
this.chatContainer.addChild(new Text(changelogLine, 1, 0));
```
With:
```typescript
this.chatContainer.addChild(new Text(updateCommandLine, 1, 0));
```

Keep the rest of the method unchanged (the "Update Available" header, the version line, the note rendering).

Also update the version line to be clearer. Currently:
```typescript
const updateInstruction = theme.fg("muted", `New version ${release.version} is available. Run `) + action;
```
The `action` variable is `theme.fg("accent", `${APP_NAME} update`)`. This is fine — it tells the user they can run `selesai update`. But since the repo is private and the user should run `npm install` manually, change the `action` to show the npm command:

Replace:
```typescript
const action = theme.fg("accent", `${APP_NAME} update`);
const updateInstruction = theme.fg("muted", `New version ${release.version} is available. Run `) + action;
```
With:
```typescript
const updateCommand = getUpdateInstruction(PACKAGE_NAME);
const updateInstruction = theme.fg("muted", `New version ${release.version} is available. Update manually:\n`) + theme.fg("accent", updateCommand);
```

Then remove the now-redundant `updateCommandLine` block and the separate `changelogLine` rendering.

The final method should look like:

```typescript
showNewVersionNotification(release: LatestPiRelease): void {
    const updateCommand = getUpdateInstruction(PACKAGE_NAME);
    const updateInstruction = theme.fg("muted", `New version ${release.version} is available. Update manually:\n`) + theme.fg("accent", updateCommand);
    const note = release.note?.trim();

    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
    this.chatContainer.addChild(
        new Text(`${theme.bold(theme.fg("warning", "Update Available"))}\n${updateInstruction}`, 1, 0),
    );
    if (note) {
        this.chatContainer.addChild(new Spacer(1));
        this.chatContainer.addChild(
            new Markdown(note, 1, 0, this.getMarkdownThemeWithSettings(), {
                color: (text) => theme.fg("muted", text),
            }),
        );
        this.chatContainer.addChild(new Spacer(1));
    }
    this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
    this.ui.requestRender();
}
```

**Imports to add** in the config import block (line ~50-59): `getUpdateInstruction`, `PACKAGE_NAME`.

**Code NOT to add**: Do not add new TUI components. Do not add a "dismiss" button. Do not add settings for disabling the notification (PI_SKIP_VERSION_CHECK already covers this).

### Task 3: Add version check notice to print mode

**File**: `src/modes/print-mode.ts`

**What to change**:

Add an async version check at the start of `runPrintMode`, after `rebindSession()` but before sending prompts. The check runs asynchronously and prints to **stderr** (so it doesn't corrupt stdout output in text/json mode). It must not block the main flow.

Add imports at top of file:
```typescript
import { APP_NAME, PACKAGE_NAME, VERSION } from "../config.ts";
import { checkForNewPiVersion } from "../utils/version-check.ts";
import chalk from "chalk";
```

After the `await rebindSession();` call (line ~97), add:

```typescript
// ponytail: fire-and-forget version check on stderr; never blocks print output
void checkForNewPiVersion(VERSION).then((release) => {
    if (release) {
        console.error(chalk.yellow(`\n⚠ ${APP_NAME} ${release.version} is available. Update with: npm install -g ${PACKAGE_NAME}\n`));
    }
});
```

**Why stderr**: Print mode uses stdout for text/json output. Any notification must go to stderr to avoid corrupting the output stream.

**Why a simple hardcoded `npm install -g`**: `getUpdateInstruction` requires `detectInstallMethod` which reads filesystem paths. In print mode this is fine, but the instruction should be simple. Use `npm install -g ${PACKAGE_NAME}` as the universal instruction. The interactive mode uses `getUpdateInstruction` for a more precise command.

**Code NOT to add**: Do not add a full TUI notification. Do not block the prompt flow. Do not add the notice to RPC mode (RPC is programmatic — stderr noise could break JSON-RPC parsers that read stderr).

### Task 4: Add tests for reactivated `checkForNewPiVersion`

**File**: `src/__tests__/version-check.test.ts`

**What to add**:

```typescript
import { checkForNewPiVersion, isNewerPackageVersion } from "../utils/version-check.ts";

describe("checkForNewPiVersion", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        delete process.env.PI_SKIP_VERSION_CHECK;
        delete process.env.PI_OFFLINE;
    });

    it("returns release when registry has newer version", async () => {
        const fetchMock = vi.fn(async () =>
            new Response(JSON.stringify({ "dist-tags": { latest: "9.9.9" } }), { status: 200 }),
        );
        vi.stubGlobal("fetch", fetchMock);

        await expect(checkForNewPiVersion("0.5.1")).resolves.toEqual({
            packageName: "@selesai/code",
            version: "9.9.9",
        });
    });

    it("returns undefined when already up to date", async () => {
        const fetchMock = vi.fn(async () =>
            new Response(JSON.stringify({ "dist-tags": { latest: "0.5.1" } }), { status: 200 }),
        );
        vi.stubGlobal("fetch", fetchMock);

        await expect(checkForNewPiVersion("0.5.1")).resolves.toBeUndefined();
    });

    it("returns undefined when offline", async () => {
        process.env.PI_OFFLINE = "1";
        await expect(checkForNewPiVersion("0.5.1")).resolves.toBeUndefined();
    });

    it("returns undefined when version check skipped", async () => {
        process.env.PI_SKIP_VERSION_CHECK = "1";
        await expect(checkForNewPiVersion("0.5.1")).resolves.toBeUndefined();
    });

    it("returns undefined on fetch failure", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
        await expect(checkForNewPiVersion("0.5.1")).resolves.toBeUndefined();
    });
});
```

## 4. Verification

### Success Cases

1. **Interactive mode, newer version available**: When `registry.npmjs.org/@selesai/code` returns `dist-tags.latest` > current version, the TUI shows "Update Available" with the manual npm install command (e.g., `npm install -g @selesai/code` or the pnpm/yarn variant depending on install method).

2. **Print mode, newer version available**: When running `selesai -p "do something"`, stderr shows `⚠ selesai X.Y.Z is available. Update with: npm install -g @selesai/code`. Stdout output is unaffected.

3. **Already up to date**: No notification appears in either mode.

4. **Offline mode** (`--offline` or `PI_OFFLINE=1`): No network call is made. No notification appears.

5. **Version check skip** (`PI_SKIP_VERSION_CHECK=1`): No network call is made. No notification appears.

### Failure Cases

1. **Network failure / timeout**: `getLatestPackageRelease` returns `undefined` (non-ok response or timeout). `checkForNewPiVersion` returns `undefined`. No notification, no error shown to user. Startup is not blocked.

2. **Registry returns 404** (package not found): Same as network failure — `undefined` returned, silent.

3. **Invalid version in dist-tags**: `getLatestPackageRelease` returns `undefined` if `dist-tags.latest` is not a valid string. Silent.

### Regression Checks

1. **`selesai update --self`** continues to work unchanged — it uses `getLatestPackageRelease` directly, not `checkForNewPiVersion`. No change to `package-manager-cli.ts`.

2. **Existing `getLatestPackageRelease` test** in `version-check.test.ts` continues to pass — the function is unchanged.

3. **Interactive mode `checkForPackageUpdates`** (extension updates) is unchanged — separate codepath.

4. **Interactive mode startup** is not delayed — `checkForNewPiVersion` is called with `.then()` (fire-and-forget). The 10-second timeout is the maximum delay, but it doesn't block the main loop.

5. **Print mode output** to stdout is not corrupted — notification goes to stderr.

6. **RPC mode** has no notification — print mode notification is only in `runPrintMode`, not `runRpcMode`.

## 5. Order of Work

1. **Task 1** — Reactivate `checkForNewPiVersion` in `version-check.ts` (add import, replace stub)
2. **Task 4** — Add tests for `checkForNewPiVersion` (verify Task 1 works)
3. **Task 2** — Update `showNewVersionNotification` in `interactive-mode.ts` (add imports, replace changelog URL with update command)
4. **Task 3** — Add stderr notice to `print-mode.ts` (add imports, add fire-and-forget check)
5. **Run tests**: `npx vitest run src/__tests__/version-check.test.ts`
6. **Build check**: `npm run build` (ensure no type errors)

## 6. Architecture / Data Flow

```
Startup
  ├── main.ts
  │     ├── --offline → PI_OFFLINE=1, PI_SKIP_VERSION_CHECK=1
  │     └── InteractiveMode.run() OR runPrintMode()
  │
  ├── InteractiveMode.run()
  │     └── checkForNewPiVersion(VERSION)         ← async, fire-and-forget
  │           └── getLatestPackageRelease("@selesai/code", VERSION)
  │                 └── fetch("https://registry.npmjs.org/@selesai%2Fcode")
  │                       └── parse dist-tags.latest
  │           └── isNewerPackageVersion(latest, VERSION)
  │           └── if newer → showNewVersionNotification(release)
  │                 └── getUpdateInstruction(PACKAGE_NAME)
  │                       └── detectInstallMethod() → getSelfUpdateCommandForMethod()
  │                       └── "npm install -g @selesai/code" (or pnpm/yarn variant)
  │
  └── runPrintMode()
        └── checkForNewPiVersion(VERSION)         ← async, fire-and-forget
              └── (same as above)
              └── if newer → console.error("⚠ selesai X.Y.Z is available...")
```

## 7. Configuration / Privacy Considerations

- **No new settings**: The existing `PI_SKIP_VERSION_CHECK=1` and `PI_OFFLINE=1` environment variables already disable the check. No new settings.json key is needed.
- **Network privacy**: The check sends a `GET` to `registry.npmjs.org/@selesai%2Fcode` with a `User-Agent` header (e.g., `pi/0.5.1 (darwin; node/v22.x; arm64)`). No auth tokens are sent. No telemetry is collected.
- **No new dependencies**: Uses existing `semver` (already in dependencies) and existing `fetch` (Node 18+ built-in, undici).

## 8. Residual Risks

1. **Private registry**: If `@selesai/code` is published to a **private** npm registry (not npmjs.org), the hardcoded `registry.npmjs.org` URL will return 404. The check will silently fail (no notification). Fix: user can set `PI_SKIP_VERSION_CHECK=1` to suppress. A future enhancement could read the registry URL from `.npmrc`, but that's out of scope (YAGNI — the user said "npm install manually", implying the package is accessible on npmjs.org or the user knows their registry).

2. **npm install -g vs npm install**: For users who installed locally (not global), `npm install -g` is wrong. The interactive mode uses `getUpdateInstruction` which calls `detectInstallMethod` to provide the correct command. The print mode uses a hardcoded `npm install -g` for simplicity. This is an acceptable simplification (ponytail: the print mode notice is a hint, not a precise command).

3. **TUI notification persistence**: The notification appears once at startup. If the user misses it, it won't reappear until next launch. This is acceptable — the user explicitly asked for "make the user know that we have updates".

---

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Plan reactivates existing stubbed checkForNewPiVersion using existing getLatestPackageRelease (npm registry), updates showNewVersionNotification to show manual npm install command via existing getUpdateInstruction, adds stderr notice to print mode, adds tests. No new abstractions, no new dependencies, no scope widening. Reuses existing config.ts utilities and version-check.ts functions."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Plan specifies 4 files to change (version-check.ts, interactive-mode.ts, print-mode.ts, version-check.test.ts), 5 new test cases, exact code for each change, build and test verification commands, and residual risks documented."
    }
  ],
  "changedFiles": [
    "src/utils/version-check.ts",
    "src/modes/interactive/interactive-mode.ts",
    "src/modes/print-mode.ts",
    "src/__tests__/version-check.test.ts"
  ],
  "testsAddedOrUpdated": [
    "src/__tests__/version-check.test.ts"
  ],
  "commandsRun": [
    {
      "command": "npx vitest run src/__tests__/version-check.test.ts",
      "result": "pending",
      "summary": "Run after implementation to verify checkForNewPiVersion tests pass"
    },
    {
      "command": "npm run build",
      "result": "pending",
      "summary": "Type check and build to ensure no compilation errors"
    }
  ],
  "validationOutput": [
    "5 new test cases: newer version detected, up-to-date returns undefined, offline returns undefined, skip returns undefined, fetch failure returns undefined",
    "Existing getLatestPackageRelease test remains unchanged and should still pass"
  ],
  "residualRisks": [
    "Private registry: if @selesai/code is on a private registry (not npmjs.org), the check silently returns undefined. User can set PI_SKIP_VERSION_CHECK=1.",
    "Print mode uses hardcoded 'npm install -g' instead of getUpdateInstruction for simplicity; may be incorrect for non-global installs."
  ],
  "noStagedFiles": true,
  "diffSummary": "Reactivates checkForNewPiVersion to query npm registry instead of returning undefined. Updates interactive notification to show manual npm install command instead of pi.dev changelog link. Adds fire-and-forget stderr notice in print mode. Adds 5 test cases for the reactivated function.",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "This is a planning artifact only. No files were modified. The plan is implementation-ready for a coding executor."
}
```

WORKFLOW_PLAN_STATUS: ready

⧉ copy assistant: /cp 46bb31