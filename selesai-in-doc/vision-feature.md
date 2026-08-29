# Image Captioning Relay (vision-for-text-only-models)

## Problem

The main model (e.g. DeepSeek `tokenin/deepseek-v4-*` or `tokenin/auto`) has `input: ["text"]`
— **no vision**. When an image is pasted into the chat or read via the `read` tool, the provider
transport silently **drops** the image block for non-vision models. The agent has no idea what's
in the image and falls back to asking the user / DIY OCR.

## Solution (feature)

Add a **caption relay**: when the active model can't accept images and a caption model is
configured, send the image to a vision-capable model (Gemma/Kimi), get a text description, and
feed that description to the main model **in place of the raw image**.

Applied at two ingestion points:

1. **Chat paste path** — `AgentSession.prompt()`: user pastes an image into a message.
   (This was the primary gap — pasted images never went through the `read` tool.)
2. **`read` tool path** — `src/core/tools/read.ts`: the agent reads an image file mid-task.

The caption model is always called with a **minimal fresh context** (caption prompt + the single
image), so it is completely independent of the main conversation's context usage — the main
session's 300k/400k tokens are never sent to the caption model.

### Context awareness (bounded, not the full window)
To help the caption model extract *task-relevant* info without risking its own (smaller) context
window, the caption request includes, in addition to the image:
- **The user's current prompt** verbatim (e.g. "make this UI element bigger") — always included,
  so the caption is targeted at the task.
- **A recent-conversation tail** — the previous user/assistant **text** (tool output/code excluded),
  built by walking messages backward from the end and keeping each message **whole** (cut at
  message boundaries only, never mid-message), stopping once the next full message would exceed
  the budget or when reaching the first message. Budget = `images.imageCaptionContextTokens`
  (default **16384** tokens, approximate). The current (just-submitted) message is excluded here
  because it is already passed separately as the user prompt.

The whole caption request therefore stays small (image + prompt + a few k of recent text) and is
safe for any vision model. Full history is never sent.

## New setting

`images.imageCaptionModel` — string `"provider/modelId"` of the vision model, e.g.
`"tokenin/gemma-4"`. Unset by default ⇒ **opt-in**; behavior unchanged when unset.

```json
// ~/.selesai/agent/settings.json
"images": {
  "autoResize": true,
  "imageCaptionModel": "tokenin/gemma-4"
}
```

## Files changed (feature only)

### New: `src/core/vision-caption.ts`
Shared caption core. Exports:
- `VISION_CAPTION_SYSTEM_PROMPT` — instructs the vision model to describe the image as completely
  as possible (read text/code/errors verbatim, cover layout/colors/spatial positions, include an
  ASCII sketch when it clarifies layout).
- `captionImageWithModel(captionModel, image, { apiKey, headers, signal })` — one-shot
  `complete()` to the vision model. Returns caption text or `null` on failure/abort. **No retry,
  no fallback** (single attempt; see "Known limits").

### New: `src/core/tools/read-vision.test.ts`
Unit tests for `captionImage` and `captionImageWithModel` (mocks `@earendil-works/pi-ai/compat`).

### `src/core/agent-session.ts`
- `prompt()`: after skill/template expansion, if `currentImages` exist, call
  `_captionImagesForCurrentModel()`; on success append the caption block to the prompt text
  (`expandedText += "\n\n" + caption`). Covers the paste path for both streaming
  (steer/follow-up queue) and direct prompts.
- New private `_captionImagesForCurrentModel(images)`: resolves caption model via setting +
  `_modelRuntime.getModel()`, resolves auth via `getAuth()`, captures each image with a 60s
  per-attempt `AbortController` timeout (4 attempts with backoff), joins captions as labelled text blocks. Returns `null`
  when no captioning applies (vision main model / no setting / all captions failed).
- Emits `image_captioning_start` / `image_captioning_end` around the caption loop (see
  "UI during captioning" below).

### `src/core/tools/read.ts`
- `captionImage(image, captionModelId, ctx, signal)` (exported) — resolves model via
  `ctx.modelRegistry` and delegates to `captionImageWithModel`. Used by the read-tool path.
- In the image branch: when `getNonVisionImageNote(ctx?.model)` is set (main model can't see
  images), attempt captioning and swap the image block for the caption text.

### `src/core/settings-manager.ts`
- `ImageSettings.imageCaptionModel?: string`
- `getImageCaptionModel(): string | undefined`

### `src/defaults/models.json`
- Added `gemma-4` ("Gemma 4 31B (Vision)") to the `tokenin` provider:
  `input: ["text","image"]`, `contextWindow: 256000`, `maxTokens: 8192`.
  Makes it a bundled vision-capable default usable as captioner (or as a main model).

### `src/__tests__/model-registry-defaults.test.ts`
- Assert `tokenin/gemma-4` resolves and is vision-capable (`input` contains `"image"`).

### `src/modes/interactive/components/status-indicator.ts`
- Added `ImageCaptioningStatusIndicator` (anti-freeze spinner during captioning) + `"imageCaptioning"`
  status kind.

### `src/modes/interactive/interactive-mode.ts`
- Handles `image_captioning_start` / `image_captioning_end` events (show/clear the spinner; brief
  status on failure).

### `docs/settings.md`
- Documented `images.imageCaptionModel`.

### `package.json`
- Added `dev` scripts for run-from-source testing (see `env-and-setup.md`):
  - `"dev": "tsx src/cli.ts"`
  - `"dev:print": "tsx src/cli.ts --print"`

## Behavior on caption failure

- `captionImageWithModel` returns `null` on any exception / abort / empty output.
- `_captionImagesForCurrentModel` returns `null` if `descriptions` is empty.
- `prompt()` only injects the caption when it is non-`null`; otherwise the raw image stays
  attached and is dropped by the non-vision transport (original behavior).

### Known limits
- **No retry** on the caption call (single attempt; the `settings.retry.maxRetries` applies to the
  main agent turn loop, not to this bare `complete()`).
- **No fallback chain** — only the one configured caption model is tried.
- **Partial images**: with N images, only the ones that caption successfully are kept; the rest
  are dropped.
- Caption is a *text description*, not true vision — fine for "what's on this screenshot / read
  this error / describe the UI", weaker for pixel-precise layout work.

### UI during captioning (anti-freeze)
Captioning is a blocking `await` inside `prompt()` before the agent turn starts, which would
otherwise leave the screen blank while the vision model responds. To avoid a "frozen/stuck"
feel, the session emits two events the interactive UI renders as a status spinner:
- `image_captioning_start` → shows `ImageCaptioningStatusIndicator` ("Reading image with vision
  model...").
- `image_captioning_end { ok }` → clears the spinner; if `ok === false`, shows a brief status
  "Image captioning failed; image omitted".

Each image also has a **60s** per-attempt `AbortController` timeout with up to 4 attempts and
prime-number backoff (3s, 5s, 7s, ...), so a hanging network call fails open back to the
non-vision drop behavior.

#### Diagnostics
On failure the session logs the real reason to the console (look for `[image-caption]`):
- `[image-caption] request failed: <msg>` — the underlying error from the vision `complete()` call
  (e.g. proxy error, empty response, network).
- `[image-caption] captioning failed: <msg>` — when all captions failed; `<msg>` is the last
  request error or `timed out after 60s`.
