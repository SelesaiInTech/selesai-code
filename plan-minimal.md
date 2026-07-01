# Implementation Plan: Minimal Interface for `question.ts` Refactor

## Goal

Collapse the two duplicated list classes (`MultiSelectList` ~190 lines, `WrappedSingleSelectList` ~210 lines) into a single `QuestionList` class, and export a small set of pure helpers — reducing ~1686 lines to a testable, cohesive module with at most 3 public entry points.

---

## 1. Interface Signature (3 public entry points)

### Entry Point 1: `QuestionList` class (the deep module)

```ts
interface QuestionListConfig {
  options: QuestionOption[];
  allowMultiple: boolean;
  allowFreeform: boolean;
  allowComment: boolean;
  theme: Theme;
  keybindings: KeybindingsManager;
  commentToggle: ResolvedShortcut;
}

interface QuestionListState {
  readonly selectedIndex: number;
  readonly checked: ReadonlySet<number>;
  readonly commentEnabled: boolean;
  readonly searchQuery: string;
}

class QuestionList implements Component {
  constructor(config: QuestionListConfig);

  // --- Input → State (testable without rendering) ---
  handleInput(data: string): void;

  // --- Observable state for tests + QuestionComponent ---
  get state(): QuestionListState;

  // --- Callbacks ---
  onCancel?: () => void;
  onSubmit?: (selections: string[]) => void;   // single: [label], multi: [label, ...]
  onEnterFreeform?: () => void;

  // --- Rendering (hides fuzzy filter + split-pane + row layout internally) ---
  invalidate(): void;
  render(width: number): string[];

  // --- Dynamic row budget (called by QuestionComponent.render) ---
  setMaxVisibleRows(rows: number): void;
}
```

**Key design decisions:**
- `allowMultiple` is a constructor flag, not a separate type. Single-select reuses the same class with fuzzy search enabled; multi-select disables fuzzy search (alphabetical/numeric browsing only). This is the natural split: fuzzy search is only useful for single-select because multi-select needs to see all items to toggle checkboxes.
- `onSubmit` always returns `string[]` — single-select passes `[label]`, multi-select passes checked labels. The caller (`QuestionComponent`) doesn't branch on list type.
- `state` is a read-only snapshot — tests assert on it without rendering.

### Entry Point 2: Pure helpers (exported as a group)

```ts
// Exported for testability — no TUI dependency needed.
export function normalizeOptions(options: RawOption[] | undefined): QuestionOption[];
export function createSelectionResponse(selections: string[], comment?: string | null): QuestionResponse | null;
export function createFreeformResponse(text: string | null | undefined): QuestionResponse | null;
export function resolveShortcuts(params: {
  overlayToggleKey?: string | null;
  commentToggleKey?: string | null;
  envOverlay?: string;
  envComment?: string;
}): ResolvedShortcuts;
export function parseDialogSelections(input: string): string[];
export function formatResponseSummary(response: QuestionResponse): string;
```

These are already pure functions in the file. Exporting them makes them testable without mocking the TUI.

### Entry Point 3: `QuestionComponent` (unchanged constructor, simplified internals)

`QuestionComponent` keeps its existing constructor signature and `handleInput`/`render` contract. Internally it replaces `singleSelectList?: WrappedSingleSelectList` + `multiSelectList?: MultiSelectList` with a single `list?: QuestionList`.

---

## 2. Usage Example

### `QuestionComponent` using `QuestionList`

```ts
class QuestionComponent extends Container implements Component {
  private list?: QuestionList;
  private editor?: Editor;
  // ... other fields unchanged ...

  private ensureList(): QuestionList {
    if (this.list) return this.list;
    const list = new QuestionList({
      options: this.options,
      allowMultiple: this.allowMultiple,
      allowFreeform: this.allowFreeform,
      allowComment: this.allowComment,
      theme: this.theme,
      keybindings: this.keybindings,
      commentToggle: this.shortcuts.commentToggle,
    });
    list.onSubmit = (selections) => this.handleSelectionSubmit(selections, list.state.commentEnabled);
    list.onCancel = () => this.onDone(null);
    list.onEnterFreeform = () => this.showFreeformMode();
    this.list = list;
    return list;
  }

  private showSelectMode(): void {
    this.mode = "select";
    this.pendingSelections = [];
    this.modeContainer.clear();
    this.modeContainer.addChild(this.ensureList());  // ← no more if/else branch
    this.updateHelpText();
    this.invalidate();
    this.tui.requestRender();
  }

  override render(width: number): string[] {
    const innerWidth = Math.max(1, width - BOX_BORDER_OVERHEAD);
    if (this.mode === "select") {  // ← no more `!this.allowMultiple` branch
      const overlayMaxHeight = Math.max(12, Math.floor(this.tui.terminal.rows * OVERLAY_MAX_HEIGHT_RATIO));
      const staticLines = this.countStaticLines(innerWidth);
      const availableOptionRows = Math.max(4, overlayMaxHeight - staticLines);
      this.ensureList().setMaxVisibleRows(availableOptionRows);
    }
    // ... rest unchanged ...
  }

  handleInput(data: string): void {
    if (this.mode === "freeform" || this.mode === "comment") {
      // ... unchanged editor handling ...
      return;
    }
    this.ensureList().handleInput(data);  // ← no more if/else branch
    this.tui.requestRender();
  }
}
```

### `execute()` — unchanged except it already doesn't know about list classes

```ts
// execute() already only knows QuestionComponent — no change needed.
// The customFactory lambda constructs QuestionComponent with the same args.
// QuestionComponent internally uses QuestionList instead of two classes.
```

---

## 3. Hidden Complexity (absorbed internally by `QuestionList`)

| Complexity | Currently in | Absorbed into `QuestionList` |
|---|---|---|
| **Fuzzy filter** (`fuzzyFilter`, `getFilteredOptions`, `searchQuery` state, `popSearchChar`, `getPrintableInput`) | `WrappedSingleSelectList` only | `QuestionList` — enabled when `!allowMultiple`, disabled when `allowMultiple` |
| **Split-pane preview** (`getSplitPaneWidths`, `buildPreviewLines`, `buildListLines` with hideDescriptions, separator joining) | `WrappedSingleSelectList.render` | `QuestionList.render` — only activates when `!allowMultiple && width >= SPLIT_PANE_MIN_WIDTH` |
| **Row layout** (`wrapPlain`, `padLine`, `buildItemBlocks`, `flattenBlocks`, `renderSingleSelectRows`) | Free-floating helpers (~200 lines) | `QuestionList` private methods — used by both single (with fuzzy) and multi (without) render paths |
| **Item-index arithmetic** (`getItemCount`, `getCommentToggleIndex`, `getFreeformIndex`, `isCommentToggleRow`, `isFreeformRow`) | Duplicated in both classes + `buildItemBlocks` | One set of private methods on `QuestionList` |
| **Invalidation cache** (`cachedWidth`/`cachedLines` pattern) | Duplicated in both classes | One implementation in `QuestionList` |
| **Checkbox toggle state** (`checked: Set<number>`, `toggle()`) | `MultiSelectList` only | `QuestionList` — `checked` is always present but only mutated when `allowMultiple` |
| **Navigation** (up/down wrap, vim ctrl+j/k, number-key jump) | Near-identical in both classes | One `handleInput` with `allowMultiple` branching only in confirm/space handlers |
| **Comment toggle** (`toggleComment`, `commentEnabled`) | Duplicated in both | One implementation |

**What stays outside `QuestionList`:**
- `QuestionComponent` still owns: mode switching (select → freeform → comment), editor lifecycle, box borders, help text, static text (question/context), overlay toggle listener.
- `execute()` still owns: param parsing, shortcut resolution from env, display-mode resolution, no-options fast path, RPC/dialog fallback, event emission, status bar.
- `askViaDialogs` stays as-is — it's the non-TUI adapter for the same `QuestionResponse` contract.

---

## 4. Dependency Strategy

**Category: In-process** — pure computation + in-memory TUI state. No I/O boundary, no network, no external services.

- `QuestionList` depends on `Theme`, `KeybindingsManager` (from `@earendil-works/pi-coding-agent`) and `fuzzyFilter`, `matchesKey`, `truncateToWidth`, `wrapTextWithAnsi`, `Markdown` (from `@earendil-works/pi-tui`). All are in-process, injectable via constructor.
- Pure helpers (`normalizeOptions`, `createSelectionResponse`, etc.) depend on nothing but their arguments.
- **Testing:** No mocks needed. Tests construct `QuestionList` with a fake `Theme` (object with `fg()` returning input string) and fake `KeybindingsManager` (object with `matches()` returning false). Feed `handleInput()` key data strings, assert on `state`. For rendering, assert `render(width)` output strings.
- For pure helpers: direct function calls, assert return values. Zero setup.

---

## 5. Trade-offs (what flexibility is sacrificed for minimalism)

1. **No fuzzy search in multi-select.** Currently multi-select has no fuzzy search either, so this preserves existing behavior — but if someone later wants fuzzy multi-select, `QuestionList` would need an `allowFuzzy` flag separate from `allowMultiple`. Acceptable: YAGNI, add when needed.

2. **Unified `onSubmit(selections: string[])` instead of `onSubmit(result: string)` for single.** The caller wraps single result in `[result]` internally. Slightly less type-safe (caller can't tell single from multi at the callback level) but eliminates the type split. The caller already knows `allowMultiple` from its own config.

3. **`setMaxVisibleRows` exists on all instances but only matters for single-select.** Multi-select ignores it (uses its own windowed render with `maxVisible = min(count, 10)`). Minor dead method for multi-select mode — cheaper than a separate interface.

4. **Split-pane preview and row layout helpers become private methods instead of exported functions.** This means they can't be independently unit-tested. Acceptable: they're tested through `QuestionList.render()` integration tests. If they need isolation later, extract then.

5. **`QuestionComponent` is not collapsed into `QuestionList`.** They remain separate because `QuestionComponent` owns mode-switching (select/freeform/comment) and editor lifecycle — concerns that don't belong in a list component. This is the right boundary: list = selection state + render, component = orchestration + layout.

6. **No new files.** Everything stays in `question.ts`. The file shrinks from ~1686 to ~1100-1200 lines by eliminating duplication, but doesn't split into multiple files. Splitting would add import overhead and break the single-extension loading model. If the file is still too large after refactor, a follow-up can extract `question-list.ts` — but that's a separate decision.

---

## Files to Modify

- `src/extensions/question.ts` — collapse two list classes into one `QuestionList`, export pure helpers, simplify `QuestionComponent` to use single list instance

## New Files

- None (intentionally — see trade-off #6)

## Dependencies

- Task 1 (create `QuestionList`) must complete before Task 2 (simplify `QuestionComponent`)
- Task 2 must complete before Task 3 (export helpers, verify)
- No external dependencies; all imports already present in the file

## Risks

1. **Fuzzy search behavior regression in single-select.** The fuzzy path in `WrappedSingleSelectList.handleInput` has subtle ordering: escape clears search before cancel, printable chars append to query. Merging into one `handleInput` must preserve this exact ordering for `!allowMultiple` mode. **Verification:** write a test that types chars, presses escape, then presses cancel — assert search cleared then cancelled.

2. **Multi-select confirm behavior.** `MultiSelectList` submit includes a fallback: if nothing is checked, it submits the currently highlighted option's label. This must be preserved. **Verification:** test with `allowMultiple=true`, no checkboxes toggled, press confirm — assert `onSubmit` called with `[highlightedLabel]`.

3. **`setMaxVisibleRows` timing.** Currently called during `QuestionComponent.render()` for single-select only. After merge, it should still only be called for single-select (multi ignores it). If called for multi, it must be a no-op, not a crash. **Verification:** test multi-select render with and without `setMaxVisibleRows` called.

4. **Split-pane render path.** The split-pane preview uses `Markdown` which requires `safeMarkdownTheme()`. If markdown theme probe fails, it falls back to `wrapTextWithAnsi`. This fallback path must be preserved in the merged class. **Verification:** test render with `safeMarkdownTheme()` returning `undefined` (mock `getMarkdownTheme` to throw).

5. **No existing tests.** The file has zero test coverage. Any refactor is blind without adding tests first. **Recommendation:** write tests for `QuestionList.state` transitions and pure helpers BEFORE merging, as a safety net.

6. **`QuestionComponent.render()` border re-creation.** The current `render()` creates `new BoxBorderTop(...)` and `new BoxBorderBottom(...)` on every render call to wrap lines. This is wasteful but pre-existing — not in scope to fix. The refactor must preserve this behavior exactly.