# Implementation Plan: Maximum-Flexibility Interface for `question.ts`

## Goal

Decompose the 1686-line `question.ts` into a port-and-strategy architecture where new selection modes, row types, render strategies, and fallback protocols can be added without modifying the core — while honestly assessing which ports are justified vs speculative.

---

## Current State (from discovery)

`src/extensions/question.ts` (1686 lines) bundles ~10 conceptual modules:

| Concept | Lines | Currently |
|---|---|---|
| Types + Typebox schemas | 1–120 | Inline |
| Shortcut resolution | 120–175 | Inline helpers |
| Row layout (`wrapPlain`, `buildItemBlocks`, `renderSingleSelectRows`) | 176–480 | Inlined from `pi-ask-user` |
| Vim navigation aliases | 482–495 | Inline |
| Box borders (`BoxBorderTop`, `BoxBorderBottom`) | 497–540 | Inline classes |
| `MultiSelectList` | 560–750 | Class — checkboxes, no fuzzy |
| `WrappedSingleSelectList` | 752–960 | Class — fuzzy search + split-pane preview |
| `QuestionComponent` (Container orchestrator) | 962–1280 | Class — mode switching, editor wiring |
| RPC/dialog fallback (`askViaDialogs`) | 1282–1380 | Inline function |
| `questionExtension` (tool registration + `execute()`) | 1382–1686 | 300-line orchestrator |

**Existing codebase pattern:** `src/extensions/workflow/` already uses a pure state-machine (`state-machine.ts`) + adapter (`adapter.ts`) split. The state machine owns domain logic, returns `Effect` values, and injects `WorkflowDeps` for I/O. The adapter owns all `pi`/`fs` wiring. This is the established ports-and-adapters pattern in this codebase.

**No tests exist** for `question.ts`. Pure helpers (`normalizeOptions`, `createSelectionResponse`, `resolveShortcut`, `parseDialogSelections`, `wrapPlain`, `buildItemBlocks`, `renderSingleSelectRows`) are all module-private and untestable from outside.

---

## Proposed Interface: Maximum-Flexibility Design

### Architecture overview

```
question/
  types.ts              — shared domain types (QuestionOption, QuestionResponse, etc.)
  schema.ts             — Typebox schemas + StringEnum helper
  shortcuts.ts          — resolveShortcut, ResolvedShortcut, etc. (pure, exported)
  helpers.ts            — normalizeOptions, createResponse, formatResponseSummary, etc. (pure, exported)
  row-layout.ts         — wrapPlain, buildItemBlocks, renderSingleSelectRows (pure, exported)
  box-borders.ts        — BoxBorderTop, BoxBorderBottom (TUI components)
  question-list.ts      — the core: QuestionList (unified single/multi list)
  question-component.ts — QuestionComponent (Container-based layout, mode switching)
  dialog-adapter.ts     — askViaDialogs (the non-TUI fallback adapter)
  question-ui-port.ts   — the UIProtocol port + TUI adapter + dialog adapter
  index.ts              — questionExtension (tool registration, execute(), renderCall/renderResult)
```

### 1. Interface signature

#### Port: `UIProtocol` — the UI transport seam

```ts
// question-ui-port.ts

/** The port: how the question core asks the user and gets a response. */
export interface UIProtocol {
  /** Interactive TUI custom render — returns undefined when not available (RPC/headless). */
  custom(
    factory: (ctx: {
      tui: TUI;
      theme: Theme;
      keybindings: KeybindingsManager;
    }) => Component & { handleInput: (data: string) => void },
    options?: CustomUIOptions,
  ): Promise<QuestionResponse | null | undefined>;

  /** Dialog-based select (fallback). */
  select(prompt: string, options: string[], opts?: { timeout?: number }): Promise<string | undefined>;

  /** Dialog-based text input (fallback). */
  input(prompt: string, placeholder?: string, opts?: { timeout?: number }): Promise<string | undefined>;

  /** Terminal-level input listener (for overlay toggle). */
  onTerminalInput?(handler: (data: string) => { consume: boolean } | void): () => void;

  /** Status bar update. */
  setStatus(key: string, text: string): void;

  /** Notification. */
  notify(message: string, level: "info" | "warning" | "error"): void;

  /** Theme accessor. */
  readonly theme: Theme;

  /** Whether interactive TUI is available. */
  readonly hasUI: boolean;
}
```

**Production adapter** (wires `ctx.ui` from `ExtensionAPI`):

```ts
export function createTUIProtocol(ctx: ExtensionContext): UIProtocol {
  return {
    custom: (factory, options) => ctx.ui.custom(factory, options),
    select: (prompt, opts) => ctx.ui.select(prompt, opts?.options ?? [], opts),
    input: (prompt, placeholder, opts) => ctx.ui.input(prompt, placeholder, opts),
    onTerminalInput: ctx.ui.onTerminalInput?.bind(ctx.ui),
    setStatus: (key, text) => ctx.ui.setStatus(key, text),
    notify: (msg, level) => ctx.ui.notify(msg, level),
    theme: ctx.ui.theme,
    hasUI: ctx.hasUI,
  };
}
```

**In-memory test adapter** (no TUI, no terminal — pure fake):

```ts
export function createFakeProtocol(overrides?: Partial<UIProtocol>): {
  protocol: UIProtocol;
  inputs: string[];      // queued inputs to feed
  outputs: string[];     // captured select/input responses
  notifications: string[];
  statusUpdates: string[];
} {
  const inputs: string[] = [];
  const outputs: string[] = [];
  const notifications: string[] = [];
  const statusUpdates: string[] = [];
  return {
    protocol: {
      custom: async () => undefined,  // no TUI in tests — forces dialog path
      select: async (prompt, options) => {
        outputs.push(`select: ${prompt}`);
        return inputs.shift() ?? undefined;
      },
      input: async (prompt) => {
        outputs.push(`input: ${prompt}`);
        return inputs.shift() ?? undefined;
      },
      onTerminalInput: undefined,
      setStatus: (key, text) => statusUpdates.push(`${key}: ${text}`),
      notify: (msg) => notifications.push(msg),
      theme: createFakeTheme(),
      hasUI: false,
      ...overrides,
    },
    inputs, outputs, notifications, statusUpdates,
  };
}
```

#### Strategy: `SelectionMode` — single vs multi vs future modes

```ts
// question-list.ts

/** How items get selected and what the submit result looks like. */
export interface SelectionMode {
  /** Unique key for registry lookup. */
  readonly key: "single" | "multi" | string;
  /** Can multiple items be checked simultaneously? */
  readonly multi: boolean;
  /** Toggle the checked state of an item. Return false if this mode doesn't support toggling. */
  toggle(checked: Set<number>, index: number): boolean;
  /** Build the result array from the current state. */
  buildResult(state: QuestionListState): string[];
}
```

Built-in implementations:

```ts
export const SingleSelect: SelectionMode = {
  key: "single",
  multi: false,
  toggle: () => false,  // single-select doesn't use space-toggle
  buildResult: (state) => {
    const opt = state.filteredOptions[state.selectedIndex];
    return opt ? [opt.label] : [];
  },
};

export const MultiSelect: SelectionMode = {
  key: "multi",
  multi: true,
  toggle: (checked, index) => {
    if (checked.has(index)) checked.delete(index);
    else checked.add(index);
    return true;
  },
  buildResult: (state) =>
    Array.from(state.checked).sort((a, b) => a - b)
      .map(i => state.filteredOptions[i]?.label).filter(Boolean),
};
```

#### Strategy: `RowType` — pluggable extra rows (comment-toggle, freeform, custom action rows)

```ts
// question-list.ts

/** A pluggable row appended after the option rows. */
export interface RowType {
  /** Unique key. */
  readonly key: string;
  /** Label shown in the list. */
  getLabel(state: QuestionListState): string;
  /** Whether this row is currently "active" (e.g. comment enabled). */
  isActive(state: QuestionListState): boolean;
  /** Handle activation (space/enter on this row). Return true if consumed. */
  activate(state: QuestionListState, context: RowActivateContext): boolean;
  /** Render this row given width. */
  renderRow(state: QuestionListState, width: number, isSelected: boolean): string[];
}
```

Built-in implementations:

```ts
export const CommentToggleRow: RowType = {
  key: "comment-toggle",
  getLabel: (state) => `${state.commentEnabled ? "[✓]" : "[ ]"} ${COMMENT_TOGGLE_LABEL}`,
  isActive: (state) => state.commentEnabled,
  activate: (state, ctx) => {
    state.commentEnabled = !state.commentEnabled;
    ctx.onInvalidate();
    return true;
  },
  renderRow: (state, width, isSelected) => { /* checkbox + label, themed */ },
};

export const FreeformRow: RowType = {
  key: "freeform",
  getLabel: () => FREEFORM_LABEL,
  isActive: () => false,
  activate: (_state, ctx) => { ctx.onEnterFreeform(); return true; },
  renderRow: (state, width, isSelected) => { /* "Type custom answer" row */ },
};
```

**Example: adding a new custom action row** (e.g. "Select all" for multi-select):

```ts
const SelectAllRow: RowType = {
  key: "select-all",
  getLabel: () => "Select all options",
  isActive: (state) => state.checked.size === state.filteredOptions.length,
  activate: (state, ctx) => {
    if (state.checked.size === state.filteredOptions.length) {
      state.checked.clear();
    } else {
      state.filteredOptions.forEach((_, i) => state.checked.add(i));
    }
    ctx.onInvalidate();
    return true;
  },
  renderRow: (state, width, isSelected) => {
    const prefix = isSelected ? "→   " : "    ";
    return [truncateToWidth(`${prefix}Select all options`, width, "")];
  },
};

// Usage: just pass it in the extraRows array
const list = new QuestionList({
  options,
  selectionMode: MultiSelect,
  extraRows: [SelectAllRow, CommentToggleRow, FreeformRow],
  ...
});
```

#### Strategy: `RenderStrategy` — list rendering (plain, split-pane, future modes)

```ts
// question-list.ts

/** How the list renders its rows given a width. */
export interface RenderStrategy {
  /** Whether this strategy applies at the given width. */
  applies(width: number): boolean;
  /** Render the list lines. */
  render(
    state: QuestionListState,
    width: number,
    theme: Theme,
    keybindings: KeybindingsManager,
  ): string[];
}
```

Built-in implementations:

```ts
export const PlainRender: RenderStrategy = {
  applies: (width) => width < SPLIT_PANE_MIN_WIDTH,
  render: (state, width, theme, _kb) => {
    // Uses renderSingleSelectRows internally — no split pane
    return buildListLines(state, width, theme, false);
  },
};

export const SplitPaneRender: RenderStrategy = {
  applies: (width) => width >= SPLIT_PANE_MIN_WIDTH,
  render: (state, width, theme, _kb) => {
    const split = getSplitPaneWidths(width);
    if (!split) return PlainRender.render(state, width, theme, _kb);
    const listLines = buildListLines(state, split.left, theme, true);
    const previewLines = buildPreviewLines(state, split.right, theme);
    // merge with separator
    return mergePanes(listLines, previewLines, split, theme);
  },
};

// Example: adding a new render strategy (e.g. "compact" for very narrow terminals)
const CompactRender: RenderStrategy = {
  applies: (width) => width < 40,
  render: (state, width, theme, _kb) => {
    // One-line per option, no descriptions, no numbering
    return state.filteredOptions.map((opt, i) => {
      const prefix = i === state.selectedIndex ? "→ " : "  ";
      return truncateToWidth(`${prefix}${opt.label}`, width, "");
    });
  },
};
```

#### Strategy: `FallbackProtocol` — dialog/RPC fallback

```ts
// question-ui-port.ts

/** How to ask when TUI custom render is not available. */
export interface FallbackProtocol {
  ask(params: ResolvedQuestionParams, protocol: UIProtocol): Promise<QuestionResponse | null>;
}
```

Built-in:

```ts
export const DialogFallback: FallbackProtocol = {
  async ask(params, protocol) {
    return askViaDialogs(protocol, params.question, params.context, params.options,
      params.allowMultiple, params.allowFreeform, params.allowComment, params.timeout);
  },
};
```

**Example: adding a new fallback** (e.g. Slack/webhook-based ask):

```ts
const WebhookFallback: FallbackProtocol = {
  async ask(params, _protocol) {
    const res = await fetch("https://hooks.example.com/ask", {
      method: "POST",
      body: JSON.stringify({ question: params.question, options: params.options }),
    });
    const data = await res.json();
    return createSelectionResponse(data.selections, data.comment);
  },
};
```

#### Core: `QuestionList` — unified list with strategies

```ts
// question-list.ts

export interface QuestionListConfig {
  options: QuestionOption[];
  selectionMode: SelectionMode;
  extraRows: RowType[];
  renderStrategies?: RenderStrategy[];  // defaults to [SplitPaneRender, PlainRender]
  allowFreeform: boolean;
  allowComment: boolean;
  theme: Theme;
  keybindings: KeybindingsManager;
  commentToggle: ResolvedShortcut;
  maxVisibleRows?: number;
}

export interface QuestionListState {
  selectedIndex: number;
  checked: Set<number>;
  commentEnabled: boolean;
  searchQuery: string;
  filteredOptions: QuestionOption[];
  maxVisibleRows: number;
}

export class QuestionList implements Component {
  readonly state: QuestionListState;

  onSubmit?: (selections: string[], comment: string | null) => void;
  onEnterFreeform?: () => void;
  onCancel?: () => void;

  constructor(config: QuestionListConfig) { /* ... */ }

  isCommentEnabled(): boolean;
  setMaxVisibleRows(rows: number): void;
  handleInput(data: string): void;
  render(width: number): string[];
  invalidate(): void;
}
```

### 2. Usage example — adding a new display mode

```ts
// In index.ts, the execute() function:

const result = await askQuestion({
  protocol: createTUIProtocol(ctx),
  fallback: DialogFallback,
  params: resolvedParams,
  shortcuts,
  signal,
  overlayToggleHandler: effectiveDisplayMode === "overlay"
    ? createOverlayToggleHandler(shortcuts.overlayToggle)
    : undefined,
});

// To add a new display mode (e.g. "fullscreen"):
// 1. Add it to the DisplayMode type and schema
// 2. Pass a different CustomUIOptions in the TUI adapter:

const FullScreenTUIProtocol: UIProtocol = {
  ...createTUIProtocol(ctx),
  custom: (factory, _opts) => ctx.ui.custom(factory, {
    overlay: false,
    fullscreen: true,
  }),
};
```

### 3. Hidden complexity — what each port absorbs

| Port/Strategy | What it absorbs | What callers no longer see |
|---|---|---|
| `UIProtocol` | TUI custom-render vs dialog select/input, terminal input listeners, status bar, notifications, theme access | `ctx.ui.*` branching, `ctx.hasUI` checks, `OverlayHandle` management |
| `SelectionMode` | Single vs multi toggle logic, result building from checked set / selected index | The `if (allowMultiple)` branching in `QuestionComponent` and `execute()` |
| `RowType` | Comment-toggle checkbox state, freeform row activation, custom row rendering, index arithmetic for extra rows | `getCommentToggleIndex()`, `getFreeformIndex()`, `isCommentToggleRow()`, `isFreeformRow()` duplicated across two classes |
| `RenderStrategy` | Split-pane width calculation, fuzzy filter integration, row layout (`wrapPlain`/`buildItemBlocks`/`renderSingleSelectRows`), preview pane Markdown rendering | `getSplitPaneWidths()`, `buildListLines()`, `buildPreviewLines()`, `styleListLine()` |
| `FallbackProtocol` | Dialog sequencing (select → comment → freeform), prompt formatting, timeout threading | `askViaDialogs()` 100-line function with 7 params |
| `QuestionList` | Input routing (navigate, toggle, confirm, search, comment toggle, freeform entry), state caching/invalidation, fuzzy filter state | `MultiSelectList` + `WrappedSingleSelectList` ~400 combined lines, `cachedWidth`/`cachedLines` duplication |

### 4. Dependency strategy

**In-process core:** `types.ts`, `schema.ts`, `shortcuts.ts`, `helpers.ts`, `row-layout.ts` are pure computation — no I/O, no TUI. Deepened directly, testable with plain vitest.

**Ports & adapters for UI protocol:**
- **Port:** `UIProtocol` (defined in `question-ui-port.ts`)
- **Production adapter:** `createTUIProtocol(ctx)` — wraps `ExtensionContext.ui`
- **Test adapter:** `createFakeProtocol()` — in-memory fake, queues inputs, captures outputs
- **Fallback port:** `FallbackProtocol` with `DialogFallback` as default

**True external (mock):** None — the question tool has no third-party service dependencies.

**TUI components** (`BoxBorderTop`, `BoxBorderBottom`, `QuestionComponent`): These depend on `@earendil-works/pi-tui` types (`Component`, `Container`, `Text`, etc.). They stay in a separate file but are NOT ported — they're thin presentation layers over `QuestionList`. Testing them requires the TUI runtime; instead, `QuestionList` is tested through `handleInput` → state assertions without rendering.

### 5. Trade-offs — opinionated assessment

#### Justified ports (real variation exists in the file today)

| Port | Justification |
|---|---|
| **`UIProtocol`** | **Justified.** The file already has two execution paths: `ctx.ui.custom()` for TUI and `askViaDialogs()` for RPC/headless. The `ctx.hasUI` branch at line 1490 is a real seam. This is the existing workflow pattern (`WorkflowDeps` + adapter). |
| **`FallbackProtocol`** | **Justified.** `askViaDialogs()` is already a separate function with a distinct interface from the TUI path. Promoting it to a port makes the seam explicit and testable. |
| **`SelectionMode`** | **Justified.** `MultiSelectList` and `WrappedSingleSelectList` share ~60% of their code and differ only in toggle/result logic. The `allowMultiple` flag already creates a real bifurcation in `QuestionComponent.ensureSingleSelectList()` vs `ensureMultiSelectList()`. |

#### Speculative ports (YAGNI risk)

| Port | Assessment |
|---|---|
| **`RowType`** | **Speculative but low-cost.** The file currently has exactly two extra row types (comment-toggle, freeform), both hardcoded. No evidence of a third row type being needed. However, the abstraction is thin (4 methods, each 1–3 lines) and it eliminates the `isCommentToggleRow`/`isFreeformRow`/`getCommentToggleIndex` duplication that is currently spread across 3 locations. **Verdict: keep, but don't build a registry — just accept an array.** A registry/factory pattern would be over-engineering. |
| **`RenderStrategy`** | **Speculative.** The file has exactly two render paths: plain (narrow terminal) and split-pane (wide terminal). The split is a width check, not a user choice. No evidence of a third render strategy. **Verdict: collapse into `QuestionList` as a private method.** Extracting a `RenderStrategy` port adds indirection for a bifurcation that is unlikely to grow. If a compact mode is needed later, it's a 10-line addition to the private method, not a new strategy class. |

#### Over-engineered for this codebase

| Concept | Why it's too much |
|---|---|
| **Row registry / factory** | There are 2 row types. An array parameter is sufficient. A `Map<string, RowTypeFactory>` would be architecture astronaut territory. |
| **`DisplayMode` as a port** | Display mode is already a schema enum with 2 values. Making it a port with pluggable strategies would mean: (a) the schema enum can't enumerate the options, (b) the `buildCustomUIOptions` function is 8 lines. Not worth a port. Keep as a simple branch. |
| **Event system for row interactions** | The `RowActivateContext` with `onEnterFreeform`/`onInvalidate` callbacks is sufficient. A full event bus (`list.emit("row:activated", ...)`) would be speculative. |

#### Net assessment

The maximum-flexibility design has **3 justified ports** (`UIProtocol`, `FallbackProtocol`, `SelectionMode`) and **1 low-cost but speculative abstraction** (`RowType`). The `RenderStrategy` port should be **dropped** — keep the width check as a private method in `QuestionList`. The result is 3 ports + 1 strategy + 1 core class, which is a reasonable expansion surface without crossing into framework territory.

---

## Tasks

### Task 1: Extract pure modules (types, helpers, shortcuts, schema)
- **Files:**
  - `src/extensions/question/types.ts` — shared types: `RawOption`, `QuestionOption`, `QuestionResponse`, `QuestionDetails`, `DisplayMode`, `QuestionParams`
  - `src/extensions/question/schema.ts` — `OptionSchema`, `StringEnum`, `QuestionParamsSchema`
  - `src/extensions/question/helpers.ts` — `normalizeOptions`, `oneLine`, `createFreeformResponse`, `createSelectionResponse`, `formatResponseSummary`, `formatOptionsForMessage`, `buildCommentPrompt`, `parseDialogSelections`, `isCancelled`
  - `src/extensions/question/shortcuts.ts` — `ResolvedShortcut`, `DISABLED_SHORTCUT`, `resolveShortcut`, `normalizeShortcutSpec`, `isValidShortcutSpec`, `buildShortcut`, `ResolvedShortcuts`, `normalizeShortcutSpec`
- **Changes:** Move existing code verbatim from `question.ts` into these files. Export all functions/types. No logic changes.
- **Acceptance:** `npx tsc --noEmit` passes. All exports match original signatures.

### Task 2: Extract row-layout pure functions
- **File:** `src/extensions/question/row-layout.ts`
- **Changes:** Move `wrapPlain`, `padLine`, `ItemBlock`, `ListItem`, `buildItemBlocks`, `flattenBlocks`, `AnnotatedRow`, `RenderRowsParams`, `renderSingleSelectRows` verbatim. Export all.
- **Acceptance:** `npx tsc --noEmit` passes. Functions are importable from outside.

### Task 3: Extract box borders and editor theme
- **File:** `src/extensions/question/box-borders.ts`
- **Changes:** Move `BoxBorderTop`, `BoxBorderBottom`, `createEditorTheme`, `safeMarkdownTheme`, `matchesUp`, `matchesDown`, `VIM_UP`, `VIM_DOWN`, `BOX_BORDER_*` constants. Export all.
- **Acceptance:** `npx tsc --noEmit` passes.

### Task 4: Implement `UIProtocol` port + adapters
- **File:** `src/extensions/question/question-ui-port.ts`
- **Changes:**
  - Define `UIProtocol` interface (see design above)
  - Define `FallbackProtocol` interface
  - Implement `createTUIProtocol(ctx: ExtensionContext): UIProtocol`
  - Implement `createFakeProtocol(overrides?): { protocol, inputs, outputs, notifications, statusUpdates }`
  - Move `askViaDialogs` into `DialogFallback` implementation
  - Move `buildCustomUIOptions` here
- **Acceptance:** `createFakeProtocol()` returns a working `UIProtocol` where `hasUI === false` and `custom()` returns `undefined`. `createTUIProtocol()` wraps `ctx.ui` faithfully.

### Task 5: Implement `SelectionMode` strategy
- **File:** `src/extensions/question/selection-mode.ts`
- **Changes:**
  - Define `SelectionMode` interface
  - Implement `SingleSelect` and `MultiSelect` constants
- **Acceptance:** `SingleSelect.buildResult` returns the selected option's label. `MultiSelect.toggle` adds/removes from the checked set. `MultiSelect.buildResult` returns sorted checked labels.

### Task 6: Implement `RowType` strategy
- **File:** `src/extensions/question/row-types.ts`
- **Changes:**
  - Define `RowType` interface, `RowActivateContext` type
  - Implement `CommentToggleRow` and `FreeformRow`
- **Acceptance:** `CommentToggleRow.activate()` flips `state.commentEnabled`. `FreeformRow.activate()` calls `ctx.onEnterFreeform()`.

### Task 7: Implement unified `QuestionList` (core)
- **File:** `src/extensions/question/question-list.ts`
- **Changes:**
  - Define `QuestionListConfig`, `QuestionListState`, `QuestionList` class
  - Merge `MultiSelectList` + `WrappedSingleSelectList` into one class using `SelectionMode` + `RowType[]`
  - Keep split-pane vs plain render as a **private method** (NOT a `RenderStrategy` port — per trade-off assessment)
  - Own fuzzy filter state, search query, cached render invalidation
  - Route input: navigate (up/down/vim), toggle (space), confirm (enter), search (printable/backspace/escape), comment toggle (shortcut), freeform entry
  - Call `selectionMode.buildResult(state)` on submit
  - Call `rowType.activate(state, ctx)` when activating a non-option row
- **Acceptance:** Feed key data via `handleInput()`, assert `state.selectedIndex`, `state.checked`, `state.commentEnabled` change correctly. Submit calls `onSubmit` with correct selections.

### Task 8: Implement `QuestionComponent` (thin presentation layer)
- **File:** `src/extensions/question/question-component.ts`
- **Changes:**
  - Move `QuestionComponent` class, adapted to use `QuestionList` instead of `MultiSelectList`/`WrappedSingleSelectList`
  - Mode switching (select → freeform → comment) stays here
  - Uses `QuestionList` for the select mode
  - Uses `Editor` for freeform/comment modes
  - Box border rendering stays here (delegates to `box-borders.ts`)
- **Acceptance:** `npx tsc --noEmit` passes. `QuestionComponent` delegates to `QuestionList` without duplicating navigation/toggle logic.

### Task 9: Implement `questionExtension` entry point
- **File:** `src/extensions/question/index.ts`
- **Changes:**
  - Default export `questionExtension(pi: ExtensionAPI)` — tool registration
  - `execute()` uses `createTUIProtocol(ctx)` + `DialogFallback`
  - Resolves params, shortcuts, options via extracted modules
  - Overlay toggle listener wiring stays here (thin)
  - `renderCall` and `renderResult` stay here
  - No-options freeform shortcut path uses `protocol.input()` directly
- **Acceptance:** Tool registers with same name, label, description, parameters schema, `executionMode: "sequential"`. `execute()` returns same `QuestionDetails` shape.

### Task 10: Update `package.json` extension path
- **File:** `src/extensions/package.json`
- **Changes:** Change `"./question.ts"` to `"./question/index.ts"` in `pi.extensions` array.
- **Acceptance:** Extension loads at boot. `npx tsc --noEmit` passes.

### Task 11: Write boundary tests for pure modules
- **File:** `src/extensions/question/__tests__/helpers.test.ts`
- **Changes:** Test `normalizeOptions`, `createFreeformResponse`, `createSelectionResponse`, `formatResponseSummary`, `parseDialogSelections`, `isCancelled`, `formatOptionsForMessage`, `buildCommentPrompt`.
- **Acceptance:** All tests pass. Cover: empty options, string options, object options, whitespace filtering, null/undefined inputs, comment trimming.

### Task 12: Write boundary tests for shortcuts
- **File:** `src/extensions/question/__tests__/shortcuts.test.ts`
- **Changes:** Test `normalizeShortcutSpec`, `isValidShortcutSpec`, `resolveShortcut` with: param override, env fallback, default, disable values ("off", "none", ""), invalid specs.
- **Acceptance:** All tests pass. `resolveShortcut("off", undefined, "alt+o")` returns `DISABLED_SHORTCUT`. `resolveShortcut(undefined, "ctrl+x", "alt+o")` returns ctrl+x.

### Task 13: Write boundary tests for row layout
- **File:** `src/extensions/question/__tests__/row-layout.test.ts`
- **Changes:** Test `wrapPlain` (wrapping, long words, empty input), `buildItemBlocks` (numbering, description indentation, freeform/comment rows), `renderSingleSelectRows` (maxRows truncation, indicator line, selected block visibility).
- **Acceptance:** All tests pass. `wrapPlain("hello world", 5)` produces `["hello", "world"]`. `renderSingleSelectRows` with `maxRows=3` truncates and includes indicator.

### Task 14: Write boundary tests for `QuestionList` input → state
- **File:** `src/extensions/question/__tests__/question-list.test.ts`
- **Changes:**
  - Create `QuestionList` with fake theme + keybindings
  - Feed key data strings (up/down/space/enter/escape/printable/backspace)
  - Assert `state.selectedIndex`, `state.checked`, `state.commentEnabled`
  - Assert `onSubmit` callback receives correct selections
  - Assert `onCancel` callback fires on cancel key
  - Test both `SingleSelect` and `MultiSelect` modes
  - Test comment-toggle and freeform row activation
- **Acceptance:** All tests pass. Navigation wraps around. Space toggles in multi mode. Enter submits current selection. Escape clears search then cancels.

### Task 15: Write boundary tests for `UIProtocol` adapters
- **File:** `src/extensions/question/__tests__/ui-port.test.ts`
- **Changes:**
  - Test `createFakeProtocol()`: queue inputs, assert `select`/`input` return them, assert `setStatus`/`notify` capture
  - Test `DialogFallback.ask()` with fake protocol: single-select, multi-select, freeform, comment flow, cancel
- **Acceptance:** All tests pass. `DialogFallback` returns `null` when `select` returns `undefined`. Returns `QuestionResponse` with correct kind/selections/comment.

### Task 16: Delete old `question.ts`
- **File:** `src/extensions/question.ts`
- **Changes:** Delete the file. All code has been moved to `src/extensions/question/` directory.
- **Acceptance:** `src/extensions/question.ts` no longer exists. `src/extensions/question/index.ts` is the new entry point.

---

## Files to Modify

- `src/extensions/package.json` — change extension path from `./question.ts` to `./question/index.ts`

## New Files

- `src/extensions/question/types.ts` — shared domain types
- `src/extensions/question/schema.ts` — Typebox schemas
- `src/extensions/question/helpers.ts` — pure helper functions
- `src/extensions/question/shortcuts.ts` — shortcut resolution logic
- `src/extensions/question/row-layout.ts` — row layout pure functions
- `src/extensions/question/box-borders.ts` — box border TUI components
- `src/extensions/question/question-ui-port.ts` — `UIProtocol` port + `FallbackProtocol` + TUI/dialog/fake adapters
- `src/extensions/question/selection-mode.ts` — `SelectionMode` strategy (single/multi)
- `src/extensions/question/row-types.ts` — `RowType` strategy (comment-toggle/freeform)
- `src/extensions/question/question-list.ts` — unified `QuestionList` core (merges two list classes)
- `src/extensions/question/question-component.ts` — `QuestionComponent` presentation layer
- `src/extensions/question/index.ts` — tool registration + `execute()` orchestration
- `src/extensions/question/__tests__/helpers.test.ts` — helper function tests
- `src/extensions/question/__tests__/shortcuts.test.ts` — shortcut resolution tests
- `src/extensions/question/__tests__/row-layout.test.ts` — row layout tests
- `src/extensions/question/__tests__/question-list.test.ts` — QuestionList input→state tests
- `src/extensions/question/__tests__/ui-port.test.ts` — UIProtocol adapter tests

## Files to Delete

- `src/extensions/question.ts` — replaced by `src/extensions/question/` directory

## Dependencies

- Task 1 (pure modules) → no dependencies, do first
- Task 2 (row-layout) → depends on Task 1 (types)
- Task 3 (box-borders) → depends on Task 1 (types)
- Task 4 (UIProtocol) → depends on Task 1 (types, helpers)
- Task 5 (SelectionMode) → depends on Task 1 (types)
- Task 6 (RowType) → depends on Task 1 (types), Task 2 (row-layout for rendering)
- Task 7 (QuestionList) → depends on Tasks 1, 2, 3, 5, 6
- Task 8 (QuestionComponent) → depends on Task 7
- Task 9 (index.ts) → depends on Tasks 4, 8
- Task 10 (package.json) → depends on Task 9
- Tasks 11–15 (tests) → depend on corresponding implementation tasks
- Task 16 (delete old file) → depends on Task 10

## Risks

1. **TUI runtime dependency in tests.** `QuestionList` imports `fuzzyFilter`, `truncateToWidth`, `wrapTextWithAnsi` from `@earendil-works/pi-tui`. These are pure functions but the import chain may pull in TUI runtime code. **Mitigation:** Mock `@earendil-works/pi-tui` in test setup if needed, or verify these functions are tree-shakeable. Check how `pi-powerline-footer/tests/` handles this.

2. **KeybindingsManager in tests.** `QuestionList.handleInput` calls `keybindings.matches(data, "tui.select.up")` etc. Tests need a fake `KeybindingsManager`. **Mitigation:** Create a minimal fake that matches on known keybinding names. Inspect the real `KeybindingsManager` interface to know which methods are called.

3. **`safeMarkdownTheme()` probing.** The function eagerly calls `md.bold("")` to detect if the theme is a throwing proxy. In tests without a real theme, this returns `undefined`. **Mitigation:** `createFakeTheme()` should return a theme where `getMarkdownTheme()` returns `undefined`, so the fallback plain-text path is exercised.

4. **Behavioral parity.** The unified `QuestionList` must produce identical input→state behavior as the original `MultiSelectList` and `WrappedSingleSelectList`. The fuzzy search path (single-select only) must not affect multi-select. **Mitigation:** Task 14 tests must cover both modes exhaustively. Run the tool manually before/after to verify visual parity.

5. **`ctx.ui.custom()` factory contract.** The current code passes a factory that receives `(tui, theme, keybindings, done)`. The `UIProtocol.custom()` wrapper must preserve this exact contract. **Mitigation:** The production adapter delegates directly to `ctx.ui.custom()` without reinterpreting the factory.

6. **`RenderStrategy` dropped — confirm this is acceptable.** The design assessment recommends NOT extracting `RenderStrategy` as a port (keep split-pane vs plain as a private method in `QuestionList`). If the reviewer requires maximum extensibility for render strategies, this decision should be revisited. **Current recommendation: drop it (YAGNI).**

7. **Schema/Google function-calling constraint.** `StringEnum` produces flat `{ type: "string", enum: [...] }` to avoid `anyOf` which Google function-calling rejects. This must be preserved exactly in `schema.ts`. **Mitigation:** Move verbatim, add a test that asserts the schema shape.

8. **`question.ts` is referenced in `src/__tests__/bootstrap.test.ts`.** Tests at lines 91, 94, 133, 134, 138, 145, 146, 149 write `question.ts` files as fixtures for extension loading tests. These tests create stub files named `question.ts` — they do NOT import the real extension. Changing the path in `package.json` to `./question/index.ts` should not break these tests since they use their own fixture directories. **Mitigation:** Run `bootstrap.test.ts` after Task 10 to verify.

---

## Opinionated Summary

**3 justified ports** (`UIProtocol`, `FallbackProtocol`, `SelectionMode`) — each maps to an existing bifurcation in the 1686-line file. These follow the codebase's own `workflow/state-machine.ts` + `workflow/adapter.ts` pattern.

**1 low-cost speculative abstraction** (`RowType`) — only 2 row types exist today, but the abstraction is 4 one-liner methods and it eliminates index arithmetic duplicated in 3 places. Keep it as an array parameter, NOT a registry.

**1 dropped port** (`RenderStrategy`) — 2 render paths gated by a width check. A port here is indirection without evidence. Keep as a private method. If a compact mode is needed, it's a 10-line addition, not a new strategy class.

**Key principle:** Maximum flexibility means the *expansion surface* is clean (add a `RowType`, add a `FallbackProtocol`, add a `SelectionMode`), not that every internal bifurcation gets its own port. The `RenderStrategy` port is the canonical example of over-extracting a bifurcation that hasn't earned its abstraction.