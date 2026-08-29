# Re-apply guide (after updating upstream `pi-coding-agent`)

When you pull/merge a new upstream release, these are the deltas to re-apply. Order matters so the
code compiles at each step.

## 0. Preconditions
- This is a fork rooted at `upstream = earendil-works/pi`.
- After a merge, run `npm install` and confirm the app builds (`npm run build`).
- Confirm `tsx` is available (it's used by `npm run dev`).

## 0a. Current upstream base
This port is synced to upstream `v0.84.4` (commit `b79e4cc834970cca69daebffab7df1da7d1e52c4`, 2026-08-28).
When re-applying the vision feature after a future upstream release, preserve these already-applied 0.84.4
deltas in the overlapping files:
- `src/core/agent-session.ts`: custom-message ordering (`_pendingCustomMessages`), `_compactBeforeNextAssistantResponse` + `_installAgentNextTurnRefresh`, `_addPersistedDefaultToNonEmptyScope`.
- `src/core/settings-manager.ts`: `TerminalSettings.hyperlinks/images/trueColor`, `getTerminalCapabilityOverrides()`, `fullscreenCopyOnSelect` getter/setter.
- `src/modes/interactive/interactive-mode.ts`: `setCapabilityOverrides`, `copyOnSelect`, `handleCopyCommand(preferSelection)`, `updateThinkingBlockVisibility`, working-indicator restructure, theme order.
- `src/modes/interactive/components/settings-selector.ts`: `fullscreen-copy-on-select` item + callback.
The vision caption relay itself (`_captionImagesForCurrentModel`, `image_captioning_*` events, 15s timeout) is
unchanged by the 0.84.4 port.

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
  and use a **15s** per-image `AbortController` timeout.

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
