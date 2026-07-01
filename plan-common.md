# Interface Design: Optimized for the Most Common Caller

## Target file
`src/extensions/question.ts` (1686 lines, 58KB — largest extension by 5×)

## Common caller profile

The dominant path is **single-select with a few options, no comment, no freeform, overlay mode**. The callers are:

1. **`QuestionComponent`** (lines 1049–1383) — the TUI container. It currently branches on `allowMultiple` in 4 places: `showSelectMode()`, `ensureSingleSelectList()`/`ensureMultiSelectList()`, `handleInput()`, and `render()`.
2. **`execute()`** (lines 1449–1686) — the tool orchestrator. 180 lines of param parsing, shortcut resolution, overlay-toggle wiring, no-options freeform shortcut, `ctx.ui.custom()` factory, and dialog fallback.

The rare features (multi-select, comment, freeform, fuzzy split-pane preview) are all opt-in flags today, but they pollute the common path through branching in the caller rather than being absorbed by the list.

---

## 1. Interface signature — what the common caller writes

### Core: one `QuestionList` replaces both list classes

```ts
interface QuestionListConfig {
  options: QuestionOption[];
  theme: Theme;
  keybindings: KeybindingsManager;
  // All rare features are optional flags — absent = off, no branching in caller
  allowMultiple?: boolean;       // default false
  allowFreeform?: boolean;       // default false
  allowComment?: boolean;        // default false
  commentToggle?: ResolvedShortcut;  // only needed when allowComment
}

interface QuestionList extends Component {
  handleInput(data: string): void;
  render(width: number): string[];
  setMaxVisibleRows(rows: number): void;
  invalidate(): void;

  // Observable state for testing + render coordination
  readonly selectedIndex: number;
  readonly checked: ReadonlySet<number>;
  readonly commentEnabled: boolean;

  // Callbacks — caller wires these once, no branching
  onSubmit?: (selections: string[], commentEnabled: boolean) => void;
  onEnterFreeform?: () => void;
  onCancel?: () => void;
}
```

### What `QuestionComponent.showSelectMode()` becomes

**Before** (current, 5 lines + 2 ensure methods + branching):
```ts
private showSelectMode(): void {
  this.mode = "select";
  this.modeContainer.clear();
  if (this.allowMultiple) this.modeContainer.addChild(this.ensureMultiSelectList());
  else this.modeContainer.addChild(this.ensureSingleSelectList());
  // ...
}
```

**After** (common case — one line, zero branching):
```ts
private showSelectMode(): void {
  this.mode = "select";
  this.modeContainer.clear();
  this.modeContainer.addChild(this.ensureList());
  // ...
}
```

The `ensureList()` method creates **one** `QuestionList` with all flags passed through. No `if (this.allowMultiple)` anywhere in `QuestionComponent`.

### What `QuestionComponent.handleInput()` becomes

**Before:**
```ts
if (this.allowMultiple) this.ensureMultiSelectList().handleInput?.(data);
else this.ensureSingleSelectList().handleInput?.(data);
```

**After:**
```ts
this.ensureList().handleInput(data);
```

### Pure helpers — exported for direct testing

```ts
// All pure, no TUI dependency — testable with plain imports
export function normalizeOptions(options: RawOption[] | undefined): QuestionOption[];
export function createSelectionResponse(selections: string[], comment?: string | null): QuestionResponse | null;
export function createFreeformResponse(text: string | null | undefined): QuestionResponse | null;
export function formatResponseSummary(response: QuestionResponse): string;
export function parseDialogSelections(input: string): string[];
export function resolveShortcut(paramValue: string | null | undefined, envValue: string | undefined, defaultSpec: string): ResolvedShortcut;
export function isValidShortcutSpec(spec: string): boolean;
export function wrapPlain(text: string, width: number): string[];
export function buildItemBlocks(options: QuestionOption[], width: number, allowFreeform: boolean, allowComment: boolean, commentEnabled: boolean, selectedIndex: number, hideDescriptions?: boolean): ItemBlock[];
export function renderSingleSelectRows(params: RenderRowsParams): AnnotatedRow[];
```

---

## 2. Usage examples

### Common case (single-select, 3 options, no comment, no freeform)

```ts
// In QuestionComponent — the common caller
const list = new QuestionListImpl({
  options,
  theme,
  keybindings,
});
list.onSubmit = (selections, _commentEnabled) => this.handleSelectionSubmit(selections, false);
list.onCancel = () => this.onDone(null);
// That's it. No allowMultiple, no allowFreeform, no allowComment, no commentToggle.
// No branching. The list knows it's single-select because allowMultiple is absent.
```

### Full-featured case (multi-select + comment + freeform + fuzzy)

```ts
const list = new QuestionListImpl({
  options,
  theme,
  keybindings,
  allowMultiple: true,
  allowFreeform: true,
  allowComment: true,
  commentToggle: shortcuts.commentToggle,
});
list.onSubmit = (selections, commentEnabled) => this.handleSelectionSubmit(selections, commentEnabled);
list.onCancel = () => this.onDone(null);
list.onEnterFreeform = () => this.showFreeformMode();
```

The only difference between common and full-featured is **4 extra config fields**. The caller code shape is identical — no branching, no different methods, no different callback wiring.

### Test usage (no TUI required)

```ts
import { normalizeOptions, createSelectionResponse, resolveShortcut, isValidShortcutSpec, parseDialogSelections } from "../extensions/question.ts";

describe("normalizeOptions", () => {
  it("converts string options", () => {
    expect(normalizeOptions(["yes", "no"])).toEqual([
      { label: "yes" }, { label: "no" },
    ]);
  });
  it("filters empty labels", () => {
    expect(normalizeOptions(["", "  ", "ok"])).toEqual([{ label: "ok" }]);
  });
});

describe("resolveShortcut", () => {
  it("disables on 'off'", () => {
    expect(resolveShortcut("off", undefined, "alt+o").disabled).toBe(true);
  });
  it("uses param value when valid", () => {
    const s = resolveShortcut("ctrl+h", undefined, "alt+o");
    expect(s.disabled).toBe(false);
    expect(s.spec).toBe("ctrl+h");
  });
});
```

For the `QuestionList` input→state behavior (needs `Theme` + `KeybindingsManager` fakes):

```ts
const fakeTheme: Theme = { fg: (_name, s) => s, bold: (s) => s } as any;
const fakeKb: KeybindingsManager = {
  matches: (_data, _action) => false,
  getKeys: (_action) => [],
} as any;

const list = new QuestionListImpl({ options: [{ label: "A" }, { label: "B" }], theme: fakeTheme, keybindings: fakeKb });
list.handleInput(downKeyData);  // navigate down
expect(list.selectedIndex).toBe(1);
list.handleInput(confirmKeyData);
expect(list.onSubmit).toHaveBeenCalledWith(["B"], false);
```

---

## 3. Hidden complexity — what the interface absorbs

The `QuestionList` interface hides **all** of the following from the caller:

### Item-index arithmetic (currently duplicated in 3 places)
- `getItemCount()` — options + comment-toggle + freeform row
- `getCommentToggleIndex()` / `getFreeformIndex()`
- `isCommentToggleRow(index)` / `isFreeformRow(index)`
- Currently computed identically in `MultiSelectList` (lines 700–730), `WrappedSingleSelectList` (lines 820–850), and `buildItemBlocks` (lines 430–470). **One place owns it.**

### Single-vs-multi selection semantics
- `toggle(index)` for multi vs `selectedIndex` for single — the list picks based on `allowMultiple`. The caller never checks `allowMultiple`.
- `onSubmit` always returns `string[]` (selections) + `boolean` (commentEnabled). Single-select returns `[label]`, multi returns `[...checked]`. Caller handles both identically.

### Fuzzy search (single-select only)
- `searchQuery`, `getFilteredOptions()`, `fuzzyFilter()`, `popSearchChar()`, `getPrintableInput()` — all internal to the list. The caller never touches search state.
- In multi-select mode, typing does nothing (no fuzzy). The list handles this internally; caller doesn't know.

### Split-pane preview (wide terminals, single-select only)
- `getSplitPaneWidths()`, `buildPreviewLines()`, `buildListLines()` with split logic — all internal to `render(width)`. The caller calls `render(width)` and gets lines back.
- Multi-select mode renders a simple list — no split pane. Same `render(width)` call.

### Row layout (inlined from pi-ask-user)
- `wrapPlain()`, `padLine()`, `buildItemBlocks()`, `flattenBlocks()`, `renderSingleSelectRows()` — all private to the list module. These are pure functions that should be exported for testing but called internally by `render()`.

### Comment-toggle state
- `commentEnabled`, `toggleComment()`, `isCommentEnabled()` — internal. Caller only sees the boolean in `onSubmit`.

### Render caching
- `cachedWidth` / `cachedLines` invalidation cache — internal to `render()`. Caller calls `invalidate()` after state changes.

### What the caller STILL owns (not absorbed)
- Mode switching: `select` → `freeform` → `comment` (the editor lifecycle). This is `QuestionComponent`'s job because it manages the `Editor` widget and layout.
- Overlay toggle wiring. This is `execute()`'s job because it needs `ctx.ui.onTerminalInput` + `OverlayHandle`.
- Result formatting: `createSelectionResponse()` / `createFreeformResponse()` / `formatResponseSummary()` — pure helpers, caller calls them.

---

## 4. Dependency strategy: In-process

All dependencies are in-process — pure computation and in-memory TUI state. No network, no I/O, no external services.

### Testing the common path without TUI

**Pure helpers** (no imports needed beyond the functions themselves):
- `normalizeOptions`, `createSelectionResponse`, `createFreeformResponse`, `formatResponseSummary`, `parseDialogSelections`, `resolveShortcut`, `isValidShortcutSpec`, `wrapPlain`, `buildItemBlocks`, `renderSingleSelectRows`
- Test with plain `import` + assertions. No mocks, no fakes.

**`QuestionList` input→state** (needs minimal fakes):
- `Theme`: fake with `fg: (_name, s) => s, bold: (s) => s` — returns input string unchanged
- `KeybindingsManager`: fake with `matches: () => false, getKeys: () => []` — and use raw `matchesKey(data, Key.enter)` / `matchesKey(data, Key.down)` for test key presses
- Feed key data strings, assert on `selectedIndex`, `checked`, `commentEnabled`, and `onSubmit`/`onCancel`/`onEnterFreeform` callback invocations
- No `TUI` needed — the list doesn't call `tui.requestRender()` (that's `QuestionComponent`'s job)

**`QuestionComponent`** (needs TUI — not the common caller's concern for unit tests):
- Remains tested through integration if at all. The list is the testable boundary.
- `QuestionComponent` shrinks to ~150 lines of layout + mode-switching glue.

**`askViaDialogs`** (RPC fallback — local-substitutable):
- Already has the right shape: takes a `{ select, input }` duck-typed interface
- Test with a fake `{ select: async () => "A", input: async () => "comment" }`

### What becomes testable that wasn't before

| Currently private | Becomes exportable | Test shape |
|---|---|---|
| `normalizeOptions` | `export` | String → `{label}`, object passthrough, empty filter |
| `resolveShortcut` + `isValidShortcutSpec` | `export` | "off" → disabled, valid spec → built, invalid → disabled |
| `createSelectionResponse` / `createFreeformResponse` | `export` | Empty → null, trim, comment attach |
| `parseDialogSelections` | `export` | CSV split, trim, filter |
| `wrapPlain` / `buildItemBlocks` / `renderSingleSelectRows` | `export` | Width constraints, wrapping, scroll window |
| `QuestionList.handleInput` → state | via class | Navigate, toggle, confirm, comment toggle, freeform entry |
| `askViaDialogs` | `export` | Fake `select`/`input`, verify flow for single/multi/freeform/comment |

---

## 5. Trade-offs — where rare-case ergonomics suffer

### Trade-off 1: Fuzzy search only in single-select mode, not multi
The unified list enables fuzzy search only when `allowMultiple` is false (matching current behavior — `MultiSelectList` has no fuzzy). If someone wants fuzzy multi-select in the future, they'd need to extend the list internally. **This is fine** — it matches current behavior and YAGNI.

### Trade-off 2: `onSubmit` always returns `string[]` even for single-select
Single-select callers get `[label]` instead of a bare `string`. This is a 1-element array unwrapping (`selections[0]`) in `handleSelectionSubmit`. **Worth it** — eliminates the type split between `onSubmit: (result: string) => void` (single) and `onSubmit: (result: string[]) => void` (multi) that forces the caller to branch.

### Trade-off 3: `QuestionList` is a larger class than either predecessor
Merging `MultiSelectList` (~190 lines) + `WrappedSingleSelectList` (~210 lines) into one class yields ~300 lines after dedup. The class is bigger. **But** the caller (`QuestionComponent`) shrinks by ~80 lines (removing `ensureSingleSelectList`, `ensureMultiSelectList`, and all branching). Net reduction: ~180 lines across the file. The complexity moves behind the interface where it belongs.

### Trade-off 4: Split-pane preview logic lives inside the unified class
`buildPreviewLines()` is single-select-specific. In the unified class, it's guarded by `if (!this.allowMultiple && split)`. Multi-select callers pay a minor readability cost — there's dead code path they never exercise. **Acceptable** — the alternative (a separate `PreviewableQuestionList` subclass) reintroduces the branching we're trying to eliminate.

### Trade-off 5: `renderSingleSelectRows` and `buildItemBlocks` are exported but only used internally
Exporting pure helpers for testing means they're part of the module's public API. If internal layout logic changes, the exports need to stay stable or tests break. **Mitigated** — these are genuinely pure functions with stable input→output contracts. Their signatures don't need to change even if the list class internals do.

### Trade-off 6: `execute()` doesn't shrink as much as `QuestionComponent`
The orchestrator's complexity is mostly in overlay-toggle wiring, signal/timeout handling, and result formatting — not in list selection. The unified list saves ~5 lines in `execute()` (the `customFactory` passes flags through without branching). The real win is in `QuestionComponent`. **Honest** — the interface optimizes for the component caller, not the execute caller. Execute could be separately simplified by extracting a `runQuestionUI()` helper, but that's a different design concern.

---

## Summary: why this is the right design for the common caller

| Metric | Before | After |
|---|---|---|
| Branches on `allowMultiple` in `QuestionComponent` | 4 | 0 |
| List classes | 2 (`MultiSelectList` + `WrappedSingleSelectList`) | 1 (`QuestionList`) |
| `ensure*List()` methods | 2 | 1 |
| Lines to add a list in common case | 8+ (ensure + branch + callbacks) | 4 (new + callbacks) |
| Pure helpers testable from outside | 0 | 10+ |
| Tests for input→state behavior | 0 (requires full TUI) | Yes (minimal fakes) |
| Estimated net line reduction | — | ~180 lines |

The common caller writes one constructor call with 3 required fields. Every rare feature is an optional field on the same config object. The caller never branches. The list absorbs all the complexity behind `handleInput` + `render` + observable state.