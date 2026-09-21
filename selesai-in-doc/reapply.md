# Re-apply guide (after updating upstream `pi-coding-agent`)

When you pull/merge a new upstream release, these are the deltas to re-apply. Order matters so the
code compiles at each step.

## 0. Preconditions
- This is a fork rooted at `upstream = earendil-works/pi`.
- After a merge, run `npm install` and confirm the app builds (`npm run build`).
- Confirm `tsx` is available (it's used by `npm run dev`).

## 0a. Current upstream base

This port is synced to upstream **`v0.86.1`** (released 2026-09-21; previous base `v0.85.1`,
`d981de1229ef899957bbe968bc8dcda02a21f477`). Runtime packages `@earendil-works/pi-ai`,
`pi-agent-core` and `pi-tui` are pinned to `0.86.1`, and the package declares `engines.node >= 22.19.0`.

The gate for that sync is `GATES.pi-0861-sync.md` at the repository root; the per-phase plan is
`.selesai/docs/prds/00-index.md`.

### How to sync (the method, not a merge)

There is **no shared commit with upstream** — Selesai is a *flatten* of upstream
`packages/coding-agent`, so local repo root ↔ upstream `packages/coding-agent/`. `git merge` is
unusable; every sync is a per-file three-way reconciliation. `scripts/upstream.sh` documents the
relationship. The loop that produced this sync:

1. Fetch both upstream tags; diff them to get the changed `src/` paths.
2. Classify each changed file: *never-touched* (take upstream verbatim), *clean-merge* (fork didn't
touch the changed region), or *conflict*.
3. Resolve each conflict deliberately:
   `git merge-file -p --diff3 <local> <upstream-old> <upstream-new>`, then resolve every hunk by hand.
4. **Typecheck after every clean-merge file too.** A clean merge means two edits did not overlap
   *textually*, not that they are semantically compatible — upstream's merged code may reference
   types from a later phase.
5. Run `bash scripts/verify-deltas.sh` and `node scripts/verify-agent-dir.mjs` (below) before claiming
the sync is done.

### The delta inventory — run this, do not re-derive it

The fork's behaviour is re-plantable **mechanically** now. Run:

```bash
bash scripts/verify-deltas.sh        # 37 checks: one token per fork-owned behaviour
node scripts/verify-agent-dir.mjs    # no upstream path/env prefix may leak
```

`scripts/verify-deltas.sh` is the source of truth for *what the fork owns*. It covers prompt content
(fork identity, docs pointers, delegation routing, skill/agent sections, shell-aware guidance),
session runtime (auto handoff, bounded length continuation, vision caption relay and its context
tail, compaction-failure event, skill-block parsing, thinking-tag normalization), settings
(auto-handoff, caption model and budget, capability overrides, TUI default), the extension surface
(capability gateway, `getResolvedSkills`, tool `discovery` metadata, `multiselect`, extension host
precedence), module resolution (`@selesai/code` in both the extracted virtual-module map and jiti
aliases), provider/model (TokenIn, llama.cpp, bundled catalogue), terminal (startup box, fork
banner, captioning indicator, skill toggle) and rpc/sdk additions.

`scripts/verify-agent-dir.mjs` is the config-directory audit, promoted out of the untracked
`.unlazy/` workspace so it survives the next sync. It carries its 13 intentional candidates in
`intentional()`. It already earned its place: the 0.86.1 sync adopted an upstream doc comment naming
`~/.pi/agent/sessions`.

### Decisions that must not be re-litigated

- **Provider boundary.** The platform lifts an ordinary `Context` into its branded
  `TranscriptContext` internally, so local code calls `normalizeContext` from
  `@earendil-works/pi-ai/utils/transcript` at the forwarding sites. No casts, no type weakening.
- **Mermaid is deliberately not adopted.** Ported settings/selector code must not reference
  `MermaidRenderingMode`.
- **Clipboard is replaced, not merged.** `utils/clipboard.ts` and `clipboard-image.ts` are upstream
  wholesale; `clipboard-native.ts` is deleted and `@mariozechner/clipboard` is gone from
  `optionalDependencies`. Native path is `getNativeClipboard` from `@earendil-works/pi-tui`. Do not
  touch vendored extensions that declare their own clipboard dependency.
- **Module resolution** is upstream's extracted `core/extensions/virtual-modules.ts`, with exactly
  one added `@selesai/code` entry. The loader's duplicate map was deleted, not merged.
- **Length continuation is fork-owned** and overrides upstream's stop-at-limit behaviour. Where an
  upstream assertion conflicts, adapt the assertion and record it — do not delete the feature.
- **`.pi` references are intentional** in `src/core/package-manager.ts` (cross-host extension
  loading) and `src/migrations.ts` (legacy session migration). Do not "fix" them.

### Vendored extensions: already current at this base, no version work pending

pi-zentui `0.23.0`, pi-subagents `v0.66.0`, pi-intercom `v0.13.0`, pi-hermes-memory `v0.9.8` — the
immutable refs recorded by the v0.85.1 sync are still the newest upstream tags. Exercise, do not bump.

**pi-zentui is red at baseline and stays red.** Its source tree is byte-identical across this sync
(same git tree hash). Run against a 0.85.1 host it fails 197 tests; against this fork's 0.86.1 host,
155 — zero files worse. The 37 `thinking-experimental` + 7 `working-line` failures are identical on
both hosts. Do not chase these; they are host skew caused by the extension's own gitignored
`node_modules`, and the suite is deliberately not wired into `npm test`.

### Open questions deferred by this sync

Recorded rather than dropped, so the next sync resolves them instead of rediscovering them:

1. Whether the fork adopts Mermaid rendering and its optional dependency.
2. Whether the newly added usage entries are surfaced anywhere in the terminal.
3. Whether the platform's prompt-section model should be exposed to skill and prompt-template
authors as a documented extension point.

### Vision-feature deltas that must survive any future upstream release

Preserve these already-applied deltas in the overlapping files:
- `src/core/agent-session.ts`: custom-message ordering (`_pendingCustomMessages`), `_compactBeforeNextAssistantResponse` + `_installAgentNextTurnRefresh`, `_addPersistedDefaultToNonEmptyScope`.
- `src/core/settings-manager.ts`: `TerminalSettings.hyperlinks/images/trueColor`, `getTerminalCapabilityOverrides()`, `fullscreenCopyOnSelect` getter/setter.
- `src/modes/interactive/interactive-mode.ts`: `setCapabilityOverrides`, `copyOnSelect`, `handleCopyCommand(preferSelection)`, `updateThinkingBlockVisibility`, working-indicator restructure, theme order.
- `src/modes/interactive/components/settings-selector.ts`: `fullscreen-copy-on-select` item + callback.
The vision caption relay itself (`_captionImagesForCurrentModel`, `image_captioning_*` events, 60s per-attempt timeout with backoff) is
re-planted unchanged onto the 0.86.1 session runtime.

## 1. Copy/keep the two new files (should survive merge, but verify)
- `src/core/vision-caption.ts`
- `src/core/tools/read-vision.test.ts`

If a merge conflict removes them, re-create from backup / git history.

## 2. Settings plumbing
`src/core/settings-manager.ts`:
- Add to `ImageSettings`:
  ```ts
  // default: unset. When set to a vision model (e.g. "tokenin/gemma-4"), images read while the
  // active model cannot accept images are described by that model and the caption text is used instead.
  imageCaptionModel?: string;
  ```
- Add getter:
  ```ts
  getImageCaptionModel(): string | undefined {
    return this.settings.images?.imageCaptionModel;
  }
  ```

## 3. Read-tool relay
`src/core/tools/read.ts`:
- Import: `import { captionImageWithModel } from "../vision-caption.ts";`
  (keep `getExperimentalToolSampling` import; add neither more nor less).
- Add exported `captionImage(image, captionModelId, ctx, signal)` — resolves the caption model via
  `ctx.modelRegistry` + `getApiKeyAndHeaders`, delegates to `captionImageWithModel`.
- Add `imageCaptionModel?: string` to `ReadToolOptions`.
- In `createReadToolDefinition` capture `options?.imageCaptionModel`.
- In the image branch, when `nonVisionImageNote` is set, attempt `captionImage(...)` and, if a
  caption is returned, emit it as the text content instead of the image block.

## 4. Chat paste relay
`src/core/agent-session.ts`:
- Import: `import { captionImageWithModel } from "./vision-caption.ts";`
- Add private `_captionImagesForCurrentModel(images)`:
  ```ts
  private async _captionImagesForCurrentModel(images: ImageContent[]): Promise<string | null> {
    const mainModel = this.model;
    if (!mainModel || mainModel.input.includes("image")) return null;
    const captionModelId = this.settingsManager.getImageCaptionModel();
    if (!captionModelId) return null;
    const slash = captionModelId.indexOf("/");
    if (slash <= 0 || slash === captionModelId.length - 1) return null;
    const captionModel = this._modelRuntime.getModel(
      captionModelId.slice(0, slash), captionModelId.slice(slash + 1));
    if (!captionModel || !captionModel.input.includes("image")) return null;
    let auth: AuthResult | undefined;
    try { auth = await this._modelRuntime.getAuth(captionModel); } catch { return null; }
    if (!auth) return null;
    const descriptions: string[] = [];
    for (const image of images) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);
      try {
        const caption = await captionImageWithModel(captionModel, image, {
          apiKey: auth.auth.apiKey, headers: auth.auth.headers, signal: controller.signal,
        });
        if (caption) descriptions.push(caption);
      } catch { /* best-effort */ } finally { clearTimeout(timeout); }
    }
    if (descriptions.length === 0) return null;
    if (descriptions.length === 1) {
      return `[Image description provided by the ${captionModel.name} vision model:]\n${descriptions[0]}`;
    }
    return descriptions
      .map((d, i) => `[Image ${i + 1} of ${descriptions.length} description:]\n${d}`)
      .join("\n\n");
  }
  ```
- In `prompt()`, after skill/template expansion and before the streaming-queue branch:
  ```ts
  if (currentImages && currentImages.length > 0) {
    const caption = await this._captionImagesForCurrentModel(currentImages);
    if (caption) { expandedText += `\n\n${caption}`; }
  }
  ```
- Ensure `ImageContent`, `AuthResult` are imported (they are, from `@earendil-works/pi-ai/compat`).

## 5. Bundled model
`src/defaults/models.json` → add to `tokenin.models`:
```json
{
  "id": "gemma-4",
  "name": "Gemma 4 31B (Vision)",
  "reasoning": false,
  "input": ["text", "image"],
  "contextWindow": 256000,
  "maxTokens": 8192,
  "compat": { "supportsDeveloperRole": false, "supportsReasoningEffort": false }
}
```

## 6. Tests & docs
- `src/__tests__/model-registry-defaults.test.ts`: assert `tokenin/gemma-4` resolves and is vision.
- `docs/settings.md`: document `images.imageCaptionModel` and `images.imageCaptionContextTokens`.
- `package.json` scripts: `dev` / `dev:print`.

## 6c. Context-aware captioning
- `src/core/vision-caption.ts`: `captionImageWithModel` gains optional `userPrompt` + `contextText`
  (built via `buildUserPrompt`). Options interface gains the two fields.
- `src/core/settings-manager.ts`: add `ImageSettings.imageCaptionContextTokens` (default 16384) +
  `getImageCaptionContextTokens()`; add `setImageCaptionModel()` and `setImageCaptionContextTokens()`.
- `src/core/agent-session.ts`:
  - `_captionImagesForCurrentModel(images, userPrompt?)` — pass the user's current prompt.
  - Add `_recentConversationTail(maxTokens)` — walks previous messages backward, keeps whole user/
    assistant text only, cuts at message boundaries (never mid-message), stops when the next full
    message would exceed the budget or the first message is reached.

## 6d. Vision settings in `/settings`
- `src/modes/interactive/components/settings-selector.ts`
  - `SettingsConfig` gains `imageCaptionModel`, `imageCaptionContextTokens`, `visionModels`.
  - `SettingsCallbacks` gains `onImageCaptionModelChange`, `onImageCaptionContextTokensChange`.
  - Add two items after `block-images`: `image-caption-model` (values = `off` + available vision
    models) and `image-caption-context-tokens` (values 0/4096/16384/32768/65536).
  - Wire the two item ids to the callbacks in the value-apply switch.
- `src/modes/interactive/interactive-mode.ts`
  - Pass `imageCaptionModel`, `imageCaptionContextTokens`, and `visionModels` (from new
    `getVisionModels()` helper = available `input.includes("image")` models) into the selector config.
  - Add the two callbacks (call `setImageCaptionModel`/`setImageCaptionContextTokens` + `showStatus`).
  - Pass `userPrompt` + `contextText` to `captionImageWithModel`.

## 6b. Anti-freeze status indicator
Without this, captioning (a blocking `await` before the agent starts) leaves a blank screen.

`src/core/agent-session.ts`:
- Add to the `AgentSessionEvent` union:
  ```ts
  | { type: "image_captioning_start" }
  | { type: "image_captioning_end"; ok: boolean }
  ```
- In `_captionImagesForCurrentModel`, wrap the caption loop with
  `this._emit({ type: "image_captioning_start" })` before and
  `this._emit({ type: "image_captioning_end", ok })` after (in both the success and failure paths),
  and use a **60s** per-attempt `AbortController` timeout with 4 attempts and backoff.

`src/modes/interactive/components/status-indicator.ts`:
- Add `"imageCaptioning"` to `StatusIndicatorKind`.
- Add an `ImageCaptioningStatusIndicator` class ("Reading image with vision model...") mirroring
  `CompactionStatusIndicator`.

`src/modes/interactive/interactive-mode.ts`:
- Import `ImageCaptioningStatusIndicator`.
- Handle `image_captioning_start` (show the indicator) and `image_captioning_end` (clear it, and
  `showStatus("Image captioning failed; image omitted")` when `!event.ok`).

## 7. Verify
```bash
npx tsgo --noEmit -p tsconfig.build.json          # typecheck (expect clean)
npx vitest run src/core/tools/read-vision.test.ts src/__tests__/model-registry-defaults.test.ts
# smoke test captioning from source:
npm run dev   # then paste an image + prompt; expect "[Image description ...]" prefix
```

## Configuration to enable (user, not committed)
`~/.selesai/agent/settings.json`:
```json
"images": { "autoResize": true, "imageCaptionModel": "tokenin/gemma-4" }
```
