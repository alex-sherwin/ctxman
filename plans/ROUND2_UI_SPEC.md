# ROUND2_UI_SPEC — UI / kit plan for round 2

Reads with: `plans/ROUND2_BRIEF.md` (binding constraint: architecture unchanged, explicit Save, the dev reload after a
save is harmless), `plans/ROUND2_BACKEND_SPEC.md` (API shapes, JSON Schemas, monaco-yaml, arktype), `AGENTS.md`
(rules). Owns brief items 1, 2, 3, 4-UI, 5-UI, 6, 7, 8-UI, 9-UI, 10, 11, 12, 13-UI, 14-UI. Where a shape is not pinned
here, "see BACKEND_SPEC" wins. Code beats `plans/UI_SPEC.md`; this file amends UI_SPEC §B/§E/§F/§H/§I/§L and
INFLATE_SPEC §9/§11.3.

## 0. Decisions (read first)

| # | decision | why (evidence) |
|---|---|---|
| D1 | **Select v2 = RAC `Select` + `Autocomplete` + kit `SearchField` inside the `Popover`**, not `ComboBox`. | Probed in 1.22.1 (Playwright, chromium 156): opening focuses the search input; typing filters and virtual-focuses the first match; Enter selects it and closes; ArrowUp/Down move; Esc #1 clears the query, Esc #2 closes and returns focus to the trigger; the query resets on every open; sections hide when empty; disabled items are skipped and unclickable; type-ahead on the closed trigger still works; `getByRole('option', {name})` and `toContainText` on the trigger (all current e2e patterns) keep working. ComboBox would move `triggerTestId` to an `<input>` (breaks `toContainText`), cannot render rich values, and needs `allowsCustomValue` hygiene. Select keeps the exact `SelectProps` surface. |
| D2 | **Ordered lists = new kit `OrderedList`** on RAC `GridList` + `useDragAndDrop` with `keyboardNavigationBehavior="tab"`, `disallowTypeAhead`, `escapeKeyBehavior="none"`, no selection, **plus a pointer guard** so mouse drags start only in the grip column. | Probed: with `tab` navigation, typing (letters, Space, Home/End, Left/Right/Up/Down) in a `TextField` inside a row and in a Monaco editor inside a row works; Enter in Monaco inserts a newline; a kit `Select` (Autocomplete) inside a row behaves exactly like a standalone one; kit `Toolbar` arrows work inside a row; Tab walks handle → input → buttons → toolbar → editor → out. With the default `arrow` navigation, ArrowLeft in a row input moves focus out of the input (typing breaks) — so `tab` is mandatory. Keyboard DnD works out of the box (focus handle, Enter, ArrowUp/Down over "Insert between …" targets, Enter drops, Esc cancels). **But** RAC makes the whole row `draggable="true"` and sets `pointer-events:none` on `Button slot="drag"`: a mouse drag-select inside a row `<input>` started a row drag (selection lost). The guard (§B.4.3) restores input text selection (probed: selection 0..8 with guard, 0..0 without) and blocks drags from titles/inputs. Monaco is unaffected either way (it preventDefaults mousedown). |
| D3 | **Doc editing enhances the SSR preview**: the `DocEditor` island renders only the toolbar + (lazy) Monaco and toggles `hidden` on the SSR `<article id="cx-doc-preview">`; it never receives rendered HTML. | Preview stays SSR (Shiki, links, no-JS, no hydration of large HTML in props). After Save the page reloads anyway (dev) and shows the new SSR HTML; the island only dims the stale preview until then. |
| D4 | Monaco is **lazy** (`React.lazy`) in every new island (DocEditor, MarkdownTargets, DataForm). | Detail pages must not download the ~4 MB editor chunk until Edit is pressed. Forge/Inflate keep the static import. |
| D5 | "Open in IDE" is **vanilla** (`src/scripts/shell.ts` delegation on `[data-ide-open]`), SSR button in the left column. | No island needed; works on every okf/skill detail and sub-doc page. |
| D6 | Create pages live at **`/new/<ds>`** (`src/pages/new/[dataset].astro`), not `/<ds>/new`. | `/<ds>/new` would shadow a legal entry named `new`; `/new/<ds>` cannot collide (static segment beats `[dataset]/[slug]`; no dataset is named `new`). Only reference/context/recipe; others 302 to `/tools?add=<ds>#add-entry`. |
| D7 | Edit of yaml datasets = **`/<ds>/<slug>?edit=1`** (same detail route; the SSR page swaps its main column for the `DataForm` island). `view=form\|yaml` selects the tab. | Brief params; no new route. |
| D8 | **Islands: 4 → 7.** New: `DocEditor`, `MarkdownTargets`, `DataForm`. All `client:only="react"`. | §A. |
| D9 | Toasts: none. Feedback is an inline `role="status"` text (`SaveStatus`, existing Forge pattern). RAC Toast is `UNSTABLE_` in 1.22. | |
| D10 | Context detail rows: the title link + whole-row click opens the entry; **no separate "Open" link** (caller suggested one; redundant with item 7). | Deviation, density. |
| D11 | Popup editors load the **current** doc with GET when opened (not SSR props) and PUT with the GET's `lastModified` as `ifUnmodifiedSince` (see BACKEND_SPEC; if the context/recipe PUT has no such field the client re-GETs before PUT and compares `lastModified`). After 200 they `location.reload()` (context/recipe yaml is not glob-watched, so no dev reload comes). | |
| D12 | Tools: auto-navigation after create is always on (no toggle); it survives the dev reload through the existing sessionStorage run (`follow` flag). | |

Deviations from the brief: none of substance. D10 drops the "Open" link. D6 picks `/new/<ds>`. Inflate has no YAML view
today (AGENTS.md hint is wrong); the generic YAML editor is generalized from the Forge's.

## A. Islands (AGENTS.md "Tech → UI" text to replace)

> **UI**: React 19 islands (exactly 7, all `client:only="react"`): SearchWidget in `Base.astro` (every page), Forge
> (`/forge`), Inflate (`/inflate`), ToolsRunner (`/tools`), DocEditor (okf + skill detail and sub-doc pages),
> MarkdownTargets (`/context/<slug>`, `/recipe/<slug>`), DataForm (`/<ds>/<slug>?edit=1` and `/new/<ds>` for
> reference/context/recipe) + react-aria-components kit + vanilla CSS. Everything else is SSR Astro. New islands load
> Monaco lazily (`src/ui/editor/LazyCodeEditor.tsx`).

| island | file | mounted in | props |
|---|---|---|---|
| DocEditor | `src/ui/markdown/DocEditor.tsx` | `src/pages/[dataset]/[slug]/index.astro` (okf, skill), `src/pages/[dataset]/[slug]/doc/[...path].astro` | `{ dataset: OkfDatasetId \| 'skill'; slug: string; path: string; previewId: 'cx-doc-preview'; initialEdit: boolean }` |
| MarkdownTargets | `src/ui/markdown/MarkdownTargets.tsx` | `[slug]/index.astro` for context, recipe | `{ targets: MdTarget[] }` (§F.2) |
| DataForm | `src/ui/forms/DataForm.tsx` | `[slug]/index.astro` (reference, context, recipe, only when `edit=1`), `src/pages/new/[dataset].astro` | `{ dataset: YamlDatasetId; mode: 'create' \| 'edit'; slug?: string }` |

`YamlDatasetId = 'reference' | 'context' | 'recipe'` (export from `src/lib/forms/fields.ts`). Fallbacks:
`<div slot="fallback" class="cx-island-fallback">Loading editor…</div>` for DataForm; DocEditor uses
`<div slot="fallback" class="cx-doctools cx-doctools--fallback" aria-hidden="true"></div>` (same height, no shift);
MarkdownTargets has no fallback (its SSR buttons are `disabled` until it mounts).

Import rules for the new islands: kit parts **by file** (never `kit/index.ts`, it pulls Monaco statically); the editor
only through `LazyCodeEditor`.

## B. Kit (`src/ui/kit`) — U1

### B.1 Icons — `icons.ts` (PURE data), `Icon.tsx`, `src/components/Icon.astro` (twin, owned by U8)

```ts
// src/ui/kit/icons.ts — PURE; also imported by src/components/Icon.astro
export type IconName = 'chevron' | 'grip' | 'pencil';
export interface IconDef { viewBox: string; stroke: boolean; paths: string[]; circles?: [number, number, number][] }
export const ICONS: Record<IconName, IconDef> = {
  chevron: { viewBox: '0 0 16 16', stroke: true, paths: ['M4 6l4 4 4-4'] },
  grip: { viewBox: '0 0 10 16', stroke: false, paths: [], circles: [[3,4,1.2],[7,4,1.2],[3,8,1.2],[7,8,1.2],[3,12,1.2],[7,12,1.2]] },
  pencil: { viewBox: '0 0 16 16', stroke: true, paths: ['M10.5 2.5l3 3-8 8H2.5v-3z', 'M9 4l3 3'] },
};
```
`Icon({ name, size = 16, className })` → `<svg class="ck-icon {className}" width={size} height={size} viewBox aria-hidden="true" focusable="false" fill={stroke ? 'none' : 'currentColor'} stroke={stroke ? 'currentColor' : undefined} stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` + `<path d>`s + `<circle>`s. `Icon.astro` renders the identical markup from `ICONS` (props `name`, `size?`, `class?`). CSS: `.ck-icon { flex: none; display: block }`.

### B.2 Select v2 — `Select.tsx`, `Select.css` (replaces current)

Purpose: every dropdown in React islands. Same props as today plus three optional ones; call sites need no change.

```tsx
import type { ReactNode } from 'react';
import {
  Autocomplete, Button as AriaButton, FieldError, Label, Select as AriaSelect, SelectValue, Text, useFilter,
  type AutocompleteProps, type Key, type SelectProps as AriaSelectProps, type ValidationResult,
} from 'react-aria-components';
import { SearchField } from './Field.tsx';
import { Icon } from './Icon.tsx';
import { ListBox } from './ListBox.tsx';
import { Popover } from './Menu.tsx';
import { kitClass } from './utils.ts';

export interface SelectProps<T extends object> extends Omit<AriaSelectProps<T>, 'children'> {
  label?: string;
  description?: string;
  errorMessage?: string | ((v: ValidationResult) => string);
  items?: Iterable<T>;
  children: ReactNode | ((item: T) => ReactNode);
  size?: 'sm' | 'md';
  /** data-testid of the trigger; the search input gets `${triggerTestId}-search`, the popover `${triggerTestId}-popover`. */
  triggerTestId?: string;
  /** Default true: a filter input on top of the list. */
  searchable?: boolean;
  /** Default 'Filter…'. */
  searchPlaceholder?: string;
  /** Item keys that never get filtered out (e.g. "+ New context…"). */
  pinnedKeys?: Iterable<Key>;
  /** Default 'No matches'. */
  emptyText?: string;
}

export function Select<T extends object>({ label, description, errorMessage, items, children, size = 'md',
  triggerTestId, searchable = true, searchPlaceholder = 'Filter…', pinnedKeys, emptyText = 'No matches',
  className, ...rest }: SelectProps<T>) {
  const { contains } = useFilter({ sensitivity: 'base' });
  const pinned = new Set(pinnedKeys ?? []);
  const filter: NonNullable<AutocompleteProps['filter']> = (text, input, node) =>
    pinned.has(node.key) || contains(text, input);
  const list = (
    <ListBox items={items} renderEmptyState={() => <div className="ck-select__empty">{emptyText}</div>}>
      {children}
    </ListBox>
  );
  return (
    <AriaSelect {...rest} className={kitClass(className, 'ck-select', `ck-select--${size}`)}>
      {label && <Label className="ck-field__label">{label}</Label>}
      <AriaButton className="ck-select__trigger" data-testid={triggerTestId}>
        <SelectValue className="ck-select__value" />
        <span className="ck-select__chevron" aria-hidden="true"><Icon name="chevron" size={16} /></span>
      </AriaButton>
      {description && <Text slot="description" className="ck-field__description">{description}</Text>}
      <FieldError className="ck-field__error">{errorMessage}</FieldError>
      <Popover className="ck-select__popover" placement="bottom start"
               data-testid={triggerTestId ? `${triggerTestId}-popover` : undefined}>
        {searchable ? (
          <Autocomplete filter={filter}>
            <SearchField aria-label={`Filter ${label ?? rest['aria-label'] ?? 'options'}`} autoFocus size="sm"
                         className="ck-select__search" placeholder={searchPlaceholder}
                         inputTestId={triggerTestId ? `${triggerTestId}-search` : undefined} />
            {list}
          </Autocomplete>
        ) : list}
      </Popover>
    </AriaSelect>
  );
}
```
States (`data-*` from RAC): `.ck-select[data-open]` (chevron rotates 180°, trigger accent border), `[data-invalid]`,
`[data-disabled]`, `.ck-select__value[data-placeholder]`, trigger `[data-hovered]`, `[data-focus-visible]`.
Keyboard (verified): trigger Enter/Space/ArrowDown/ArrowUp opens; typing in the closed trigger = type-ahead selects; in
the open popover: type filters (first match virtually focused), ArrowUp/Down move (disabled skipped), Enter selects +
closes, Esc clears the query then closes, Tab stays in the popover (focus is contained), outside click closes.
Note (verified, RAC behavior): after the query matched nothing and is edited back, no item is focused until an arrow key.
Sections: kit `ListBoxSection` children work; empty sections are hidden while filtering. Description lines: kit
`ListBoxItem description` (the filter matches `textValue` only). Disabled: `isDisabled` on the item.
`ListBox.tsx`: no change. `Menu.tsx` `Popover`: no change.

`Select.css` (complete):
```css
@layer cx-kit {
  .ck-select { display: flex; flex-direction: column; gap: var(--sp-1); min-width: 0; }
  .ck-select__trigger {
    display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2);
    width: 100%; height: var(--control-h-md); padding: 0 var(--sp-1) 0 var(--sp-3);
    text-align: left; font-family: var(--font-body); font-size: var(--fs-md); color: var(--fg);
    background: var(--cyber-void-700); border: var(--border-w) solid var(--border); border-radius: var(--r-sm);
    outline: none; cursor: pointer;
    transition: border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
  }
  .ck-select--sm .ck-select__trigger { height: var(--control-h-sm); font-size: var(--fs-sm); padding-left: var(--sp-2); }
  .ck-select__trigger[data-hovered] { border-color: var(--border-strong); }
  .ck-select[data-open] .ck-select__trigger, .ck-select__trigger[data-focus-visible] { border-color: var(--accent); box-shadow: var(--glow-sm); }
  .ck-select[data-invalid] .ck-select__trigger { border-color: var(--danger); box-shadow: inset 0 0 6px color-mix(in srgb, var(--danger) 30%, transparent); }
  .ck-select__trigger[data-disabled] { opacity: 0.5; cursor: default; }
  .ck-select__value { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ck-select__value[data-placeholder] { color: var(--fg-subtle); }
  .ck-select__chevron { flex: none; display: grid; place-items: center; width: 20px; height: 20px; color: var(--accent); transition: transform var(--dur) var(--ease); }
  .ck-select--sm .ck-select__chevron { width: 18px; height: 18px; }
  .ck-select[data-open] .ck-select__chevron { transform: rotate(180deg); }
  .ck-select__trigger[data-hovered] .ck-select__chevron { color: var(--accent-hover); }
  .ck-select__popover { display: flex; flex-direction: column; overflow: hidden; min-width: max(var(--trigger-width), 200px); max-width: min(480px, 90vw); }
  .ck-select__search { flex: none; padding: var(--sp-1); border-bottom: 1px solid var(--border); }
  .ck-select__popover .ck-listbox { flex: 1; min-height: 0; max-height: none; overflow: auto; }
  .ck-select__empty { padding: var(--sp-3); text-align: center; font-size: var(--fs-sm); color: var(--fg-subtle); }
  @media (prefers-reduced-motion: reduce) { .ck-select__chevron { transition: none; } }
}
```

Call sites (all keep their props; edits only where marked):
| file | select | test id | edit |
|---|---|---|---|
| `src/ui/forge/ContextPane.tsx` `ContextSelect` | context | `forge-context-select` | add `pinnedKeys={[NEW_ITEM]}` (U3) |
| `src/ui/inflate/RecipeBar.tsx` `RecipeSelect` | recipe | `inflate-recipe-select` | add `pinnedKeys={[NEW_ITEM]}` (U4) |
| `src/ui/inflate/RecipeBar.tsx` `TargetSelect` | target | `inflate-target` | none |
| `src/ui/inflate/NewRecipeDialog.tsx` | target (in a Modal) | as today | none |
| `src/ui/inflate/OptionControls.tsx` | mode, `select-number` | `inflate-segment-mode`, `inflate-opt-<id>` | none |
| `src/ui/inflate/SourcesPane.tsx` | default mode | `inflate-default-<kind>` | add `pinnedKeys={[DEFAULT_ITEM]}` (U4) |
| `src/ui/tools/AddEntryForm.tsx` | dataset (file imports) | `tools-add-dataset` | none |
| `src/ui/forms/**` (new) | reference type/owner, recipe target/layout | `dform-field-<id>` | new (U7) |
`ConfirmDialog` and `SearchWidget` use no Select. The Tools/Search bundles stay Monaco-free (Select imports `Field.tsx`,
`Icon.tsx`, `ListBox.tsx`, `Menu.tsx` only).

### B.3 SSR native select twin — `Field.css`

`<select class="ck-native-select">` (only `FilterForm.astro` sort). Replace the current `.ck-native-select { appearance:
auto; padding-right }` rule with (keep it in the shared `.ck-input, .ck-native-select` base rule too):
```css
  .ck-native-select {
    appearance: none;
    padding: 0 calc(var(--sp-2) + 20px) 0 var(--sp-3);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 6l4 4 4-4' fill='none' stroke='%2300f0ff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right var(--sp-2) center; background-size: 16px 16px;
    cursor: pointer;
  }
  .ck-native-select:hover { border-color: var(--border-strong); }
  /* Customizable select (Chromium ≥ 135; probed in the Playwright chromium): real open-state chevron rotation. */
  @supports (appearance: base-select) {
    .ck-native-select, .ck-native-select::picker(select) { appearance: base-select; }
    .ck-native-select { display: inline-flex; align-items: center; gap: var(--sp-2); padding-right: var(--sp-2); background-image: none; }
    .ck-native-select::picker-icon {
      content: ''; width: 16px; height: 16px; background-color: var(--accent);
      mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 6l4 4 4-4' fill='none' stroke='%23000' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 16px 16px no-repeat;
      transition: rotate var(--dur) var(--ease);
    }
    .ck-native-select:open::picker-icon { rotate: 180deg; }
    .ck-native-select:open { border-color: var(--accent); box-shadow: var(--glow-sm); }
    .ck-native-select::picker(select) {
      margin-block: 2px; padding: var(--sp-1); color: var(--fg); background: var(--surface-raised);
      border: 1px solid var(--accent-line); border-radius: var(--r-sm);
      box-shadow: 0 0 16px color-mix(in srgb, var(--accent) 12%, transparent), var(--shadow-md);
    }
    .ck-native-select option { display: flex; align-items: center; gap: var(--sp-3); min-height: var(--row-h); padding: var(--sp-1) var(--sp-3); font-size: var(--fs-md); }
    .ck-native-select option:hover, .ck-native-select option:focus-visible { background: var(--accent-bg); box-shadow: inset 2px 0 0 var(--accent); outline: none; }
    .ck-native-select option:checked { color: var(--accent-text); }
    .ck-native-select option::checkmark { order: 1; margin-left: auto; color: var(--accent); }
  }
  @media (prefers-reduced-motion: reduce) { .ck-native-select::picker-icon { transition: none; } }
```
Without `base-select` support the chevron is bigger but static (no open state in CSS). `list-sort` + `selectOption`
(e2e) unchanged; verify `list-filters.spec.ts` still passes.

### B.4 OrderedList (GridList + DnD) — `OrderedList.tsx`, `OrderedList.css`; `src/lib/reorder.ts`

#### B.4.1 PURE helper `src/lib/reorder.ts` (+ `tests/unit/reorder.test.ts`)
```ts
export type DropPosition = 'before' | 'after';
/** Move `moving` (in their current relative order) before/after `target`. Unknown target or target ∈ moving → copy of keys. */
export function reorderKeys(keys: readonly string[], moving: readonly string[], target: string, position: DropPosition): string[];
```
Tests: single move up/down/first/last, multi-key keeps relative order, target in moving, unknown keys ignored, no
mutation of the input.

#### B.4.2 Component
```tsx
import { useRef, type ReactNode, type Ref } from 'react';
import { Button as AriaButton, DropIndicator, GridList as AriaGridList, GridListItem as AriaGridListItem,
  useDragAndDrop } from 'react-aria-components';
import type { DropPosition } from '../../lib/reorder.ts';

export interface OrderedListProps<T extends object> {
  items: readonly T[];
  getKey: (item: T) => string;
  /** Row textValue; handle label is `Reorder ${label}`; drag preview text. */
  getLabel: (item: T) => string;
  onReorder: (moving: string[], target: string, position: DropPosition) => void;
  /** Row body (everything right of the grip column). */
  children: (item: T, index: number) => ReactNode;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  testId: string;        // grid root
  rowTestId: string;     // every row, + data-key
  handleTestId: string;  // every drag handle
  /** Static per-item attributes for the row element, e.g. { 'data-ds': 'kb', 'data-type': 'item' }. */
  rowAttrs?: (item: T) => Record<`data-${string}`, string | undefined>;
  /** Extra values that must re-render rows (RAC caches rows per item object). `items` is always included. */
  dependencies?: readonly unknown[];
  /** Disables drag and drop (rows and up/down fallbacks stay). */
  isDragDisabled?: boolean;
  ref?: Ref<HTMLDivElement>;
  className?: string;
}
```
Render:
```tsx
const armed = useRef(false);   // written only in event handlers
const { dragAndDropHooks } = useDragAndDrop<T>({
  isDisabled: isDragDisabled,
  getItems: (keys) => [...keys].map((k) => {
    const item = items.find((i) => getKey(i) === String(k));
    return { 'text/plain': item ? getLabel(item) : String(k), 'application/x-ctxman-key': String(k) };
  }),
  onReorder: (e) => {
    if (e.target.dropPosition === 'on') return;
    onReorder([...e.keys].map(String), String(e.target.key), e.target.dropPosition);
  },
  renderDropIndicator: (target) => <DropIndicator target={target} className="ck-olist__drop" />,
  renderDragPreview: (dragItems) => <div className="ck-olist__preview">{dragItems[0]?.['text/plain'] ?? ''}</div>,
});
return (
  <div className="ck-olist-wrap" onPointerDownCapture={onPointerDownCapture} onDragStartCapture={onDragStartCapture}>
    <AriaGridList aria-label={…} aria-labelledby={…} items={items} dependencies={[items, ...(dependencies ?? [])]}
      dragAndDropHooks={dragAndDropHooks} keyboardNavigationBehavior="tab" disallowTypeAhead escapeKeyBehavior="none"
      className={cx('ck-olist', className)} data-testid={testId} ref={ref}>
      {(item) => {
        const key = getKey(item); const index = items.indexOf(item); const label = getLabel(item);
        return (
          <AriaGridListItem id={key} textValue={label} className="ck-olist__row" data-testid={rowTestId} data-key={key} {...rowAttrs?.(item)}>
            <div className="ck-olist__grip" data-drag-zone="">
              <AriaButton slot="drag" className="ck-olist__handle" aria-label={`Reorder ${label}`} data-testid={handleTestId}>
                <span className="ck-olist__num">{index + 1}</span>
                <Icon name="grip" size={12} className="ck-olist__gripicon" />
              </AriaButton>
            </div>
            <div className="ck-olist__body">{children(item, index)}</div>
          </AriaGridListItem>
        );
      }}
    </AriaGridList>
  </div>
);
```
Do NOT set `selectionMode`/`onAction` (rows are not selectable; Enter/Space belong to row controls). Empty list: callers
render their own EmptyState instead of the component (keeps `forge-links` count 0 semantics).

#### B.4.3 Pointer guard (exact; required, see D2)
```ts
// Mouse/touch drags may start only inside `[data-drag-zone]` (the grip column). Elsewhere the row is made
// non-draggable for the duration of the press, so inputs keep native text selection and titles/links do not drag rows.
function onPointerDownCapture(e: React.PointerEvent<HTMLDivElement>) {
  const t = e.target instanceof Element ? e.target : null;
  armed.current = t?.closest('[data-drag-zone]') != null;
  const row = t?.closest('[role="row"]');
  if (armed.current || !(row instanceof HTMLElement) || !row.draggable) return;
  row.draggable = false;
  const restore = () => {
    row.draggable = true;
    window.removeEventListener('pointerup', restore, true);
    window.removeEventListener('pointercancel', restore, true);
  };
  window.addEventListener('pointerup', restore, true);
  window.addEventListener('pointercancel', restore, true);
}
function onDragStartCapture(e: React.DragEvent<HTMLDivElement>) {
  if (!armed.current) e.preventDefault(); // RAC's useDrag returns early on defaultPrevented
}
```
Keyboard DnD needs no guard (no pointerdown).

#### B.4.4 Keyboard (verified)
Row focused: ArrowUp/Down = previous/next row; Tab enters the row (handle, then row controls in DOM order), Tab past
the last control leaves the list. Handle focused: Enter/Space starts a drag; ArrowUp/Down move the drop target
("Insert between X and Y", "Insert after Z"); Enter drops (calls `onReorder`), Esc cancels (focus returns to the row).
Up/down/remove buttons in the row stay as the fallback and keep their test ids.

#### B.4.5 CSS `OrderedList.css`
```css
@layer cx-kit {
  .ck-olist { display: flex; flex-direction: column; border: 1px solid var(--border); outline: none; }
  .ck-olist__row {
    position: relative; display: grid; grid-template-columns: 30px minmax(0, 1fr); align-items: start;
    background: var(--surface); border-bottom: 1px solid var(--border);
    border-left: 2px solid var(--ds-c, var(--border-strong)); outline: none;
  }
  .ck-olist__row:last-child { border-bottom: 0; }
  .ck-olist__row[data-focus-visible] { box-shadow: inset 0 0 0 1px var(--accent-line); }
  .ck-olist__row[data-dragging] { opacity: 0.4; }
  .ck-olist__grip { align-self: stretch; display: flex; justify-content: center; padding-top: 5px; cursor: grab; }
  .ck-olist__grip:active { cursor: grabbing; }
  .ck-olist__handle {
    display: inline-flex; align-items: center; gap: 2px; height: 18px; padding: 0 2px;
    font-family: var(--font-mono); font-size: var(--fs-xs); font-variant-numeric: tabular-nums; color: var(--fg-subtle);
    background: none; border: 0; border-radius: var(--r-sm);
  }
  .ck-olist__handle[data-focus-visible] { outline: var(--focus-w) solid var(--focus-ring); outline-offset: 0; color: var(--accent-text); }
  .ck-olist__gripicon { color: var(--fg-subtle); opacity: 0.45; }
  .ck-olist__row:hover .ck-olist__gripicon, .ck-olist__row:focus-within .ck-olist__gripicon { opacity: 1; color: var(--accent); }
  .ck-olist__body { min-width: 0; padding-right: var(--sp-3); }
  .ck-olist__drop { position: relative; height: 0; outline: none; }
  .ck-olist__drop[data-drop-target] { z-index: 1; height: 2px; margin: -1px 0; background: var(--accent); box-shadow: var(--glow-sm); }
  .ck-olist__preview { padding: var(--sp-1) var(--sp-3); font-size: var(--fs-sm); color: var(--fg); background: var(--surface-raised); border: 1px solid var(--accent); border-radius: var(--r-sm); }
}
```
`[data-ds]` already sets `--ds-c` (global.css). Existing kit `GridList` stays for Discover/AdhocDiscover lists.

### B.5 Table — `Table.tsx`, `Table.css`
React tables (Inflate manifest now; forms later). SSR tables stay HTML twins with the same classes.
```tsx
import { Cell as AriaCell, Column as AriaColumn, Row as AriaRow, Table as AriaTable,
  TableBody as AriaTableBody, TableHeader as AriaTableHeader, type CellProps, type ColumnProps,
  type RowProps, type TableBodyProps, type TableHeaderProps, type TableProps as AriaTableProps } from 'react-aria-components';
export interface TableProps extends AriaTableProps { density?: 'normal' | 'compact' }
export function Table({ density = 'normal', className, ...rest }: TableProps)   // AriaTable className kitClass(className,'ck-table', density==='compact' && 'ck-table--compact')
export function TableHeader<T extends object>(p: TableHeaderProps<T>)            // 'ck-table__head'
export function Column({ align, ...p }: ColumnProps & { align?: 'start' | 'end' }) // 'ck-table__th', align end → 'ck-table__th--end'
export function TableBody<T extends object>(p: TableBodyProps<T>)                // 'ck-table__body'
export function Row<T extends object>(p: RowProps<T>)                            // 'ck-table__row'; with `href` the whole row is a link (RAC; modifier clicks open new tabs)
export function Cell({ align, ...p }: CellProps & { align?: 'start' | 'end' })   // 'ck-table__td'
```
Exactly one `Column isRowHeader`. Non-interactive tables: no `selectionMode`. Keyboard (RAC): Tab enters at the
focused row, arrows move rows/cells. Verify `data-testid`/`data-key` land on `<table>`/`<tr>` (RAC passes `data-*`).
HTML twin: `<table class="ck-table"> <thead class="ck-table__head"> <th class="ck-table__th"> <tbody class="ck-table__body"> <tr class="ck-table__row"> <td class="ck-table__td">`.
`Table.css` (generic look moved from `.cx-table`):
```css
@layer cx-kit {
  .ck-table { width: 100%; border-collapse: collapse; font-size: var(--fs-md); background: var(--surface); border: 1px solid var(--border); outline: none; }
  .ck-table__th { height: 24px; padding: 0 var(--sp-4); text-align: left; font-size: var(--fs-xs); font-weight: var(--fw-semibold); text-transform: uppercase; letter-spacing: var(--tracking-label); color: var(--fg-subtle); background: var(--bg-deep); border-bottom: 1px solid var(--accent-line); outline: none; }
  .ck-table__th[aria-sort] { color: var(--accent-text); }
  .ck-table__th--end, .ck-table__td--end { text-align: right; }
  .ck-table__td { height: var(--row-h); padding: var(--sp-1) var(--sp-4); vertical-align: middle; line-height: var(--lh-tight); border-bottom: 1px solid var(--border); outline: none; }
  .ck-table__row { outline: none; }
  .ck-table__row:hover > .ck-table__td, .ck-table__row[data-hovered] > .ck-table__td { background: color-mix(in srgb, var(--accent) 5%, transparent); }
  .ck-table__row:hover > .ck-table__td:first-child, .ck-table__row[data-hovered] > .ck-table__td:first-child { box-shadow: inset 2px 0 0 var(--accent); }
  .ck-table__row[data-focus-visible] > .ck-table__td { box-shadow: inset 0 1px 0 var(--accent-line), inset 0 -1px 0 var(--accent-line); }
  .ck-table__td[data-focus-visible] { outline: var(--focus-w) solid var(--focus-ring); outline-offset: -2px; }
  .ck-table--compact .ck-table__th { height: 22px; padding: 0 var(--sp-2); }
  .ck-table--compact .ck-table__td { height: 24px; padding: 2px var(--sp-2); font-size: var(--fs-sm); }
}
```

### B.6 Disclosure v2 — `Disclosure.tsx`, `Disclosure.css`
- Chevron: `<span className="ck-disclosure__chevron" aria-hidden="true"><Icon name="chevron" size={14} /></span>`;
  CSS `.ck-disclosure__chevron { display: grid; place-items: center; width: 16px; height: 16px; color: var(--accent); transform: rotate(-90deg); transition: transform var(--dur) var(--ease) }` and `.ck-disclosure[data-expanded] .ck-disclosure__chevron { transform: none }` (points right closed, down open).
- New prop `preview?: ReactNode` + `previewTestId?: string`: rendered in the trigger after `meta` as
  `<span className="ck-disclosure__preview" data-testid={previewTestId}>{preview}</span>` **only while collapsed**
  (`!isExpanded`). CSS: `.ck-disclosure__trigger { min-width: 0 } .ck-disclosure__preview { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: var(--fs-xs); font-weight: var(--fw-normal); text-transform: none; letter-spacing: 0; color: var(--fg-muted) }`.

### B.7 Tabs count loading — `Tabs.tsx`, `Tabs.css`
`TabProps.count?: number | null`: `null` renders `<span className="ck-tabs__count" data-loading="" aria-label="loading">…</span>`; `undefined` renders nothing. CSS `.ck-tabs__count[data-loading] { opacity: 0.6 }`.

### B.8 `kit/index.ts`, `kit.css`
Export `Icon`, `ICONS`/`IconName` (type), `OrderedList`/`OrderedListProps`, `Table`, `TableHeader`, `Column`, `TableBody`,
`Row`, `Cell`, `TableProps`. `kit.css` adds `@import './OrderedList.css'; @import './Table.css'; @import './Icon.css';`
(`Icon.css` = the `.ck-icon` rule).

## C. Shared editing layer — U2

### C.1 Editor: `src/ui/editor/LazyCodeEditor.tsx`, `CodeEditor.tsx` `schema` prop
```tsx
// LazyCodeEditor.tsx — BROWSER-ONLY; the only way new islands mount Monaco.
const CodeEditor = lazy(() => import('./CodeEditor.tsx').then((m) => ({ default: m.CodeEditor })));
export function LazyCodeEditor(props: CodeEditorProps) {
  return <Suspense fallback={<div className="ck-code ck-code__loading" data-testid={props.testId}>Loading editor…</div>}><CodeEditor {...props} /></Suspense>;
}
```
(fallback carries the same `testId` so tests can wait on `.monaco-editor` inside it.)
`CodeEditorProps.schema?: YamlDatasetId` (only with `language="yaml"`): the model path becomes
`inmemory://ctxman/schemas/<ds>/<testId>-<id>.yaml` and the editor calls the monaco-yaml setup from BACKEND_SPEC
(expected `src/ui/editor/yaml-schemas.ts` → `ensureYamlSchemas(monaco)`, `fileMatch` `**/schemas/<ds>/**`, schema URI
`/api/schemas/<ds>`). If BACKEND_SPEC assigns that file to a backend packet, U2 only adds the prop and the model path.
monaco-yaml markers (owner `yaml`) coexist with the `ctxman` zod markers; the zod check still gates Save. Forge YAML
view passes `schema="context"` (U3), DataForm passes its dataset (U7).

### C.2 `src/ui/edit/` (browser-only helpers; no Monaco)
| file | export | purpose |
|---|---|---|
| `status.ts` | `type SaveStatus = { kind: 'idle'\|'dirty'\|'saving'\|'saved'\|'error'\|'conflict'; message?: string }` | one status shape for every editor |
| `api.ts` | `getJson<T>(url)`, `sendJson<T>(method, url, body?)` → `{ ok: true; status; body: T } \| { ok: false; status; error: string; message: string; issues? }` (accept: application/json; content-type json; never throws: network error → status 0) | all island fetches |
| `SaveBar.tsx` | `SaveBar({ status, canSave, onSave, onCancel, saveLabel = 'Save', cancelLabel = 'Cancel', testIdPrefix })` | Save (primary, `isPending` while saving, tooltip "⌘S/Ctrl+S"), Cancel (ghost), status span `cx-savebar__status` `role="status"` `data-kind`; ids `${p}-save`, `${p}-cancel`, `${p}-status` |
| `ConflictDialog.tsx` | `ConflictDialog({ isOpen, what, onLoadTheirs, onOverwrite, onKeepEditing, testIdPrefix })` | kit `Modal` + `Dialog` `role="alertdialog"` tone danger; title "Changed on disk"; body "`{what}` changed since you started editing."; buttons "Keep editing" (autofocus, `${p}-conflict-cancel`), "Load disk version" (`${p}-conflict-reload`), "Overwrite" (danger, `${p}-conflict-overwrite`); dialog `${p}-conflict-dialog` |
| `useUnsavedGuard.ts` | `useUnsavedGuard(dirty: boolean)` | effect: adds `beforeunload` (preventDefault) only while `dirty`; cleanup removes |
| `draft-backup.ts` | `saveDraft(key, value)`, `loadDraft(key)`, `clearDraft(key)` (sessionStorage `ctxman:draft:<key>`, JSON `{ text, base }`, every access try/catch) | survive a dev reload caused by another file while editing |
| `last-save.ts` | `rememberSave(key, message)`, `takeSave(key)` (sessionStorage `ctxman:saved:<key>`, read-once) | show "Saved" after the post-save reload |
| `TagEditor.tsx` | `TagEditor({ tags, onChange, label = 'Tags', testIdPrefix })` | kit `TagGroup` (removable) + add `TextField` with the Forge rules (normalize, `/^[a-z0-9][a-z0-9-]*$/`, no duplicates); ids `${p}-tags`, `${p}-add-tag`. Extracted from `ContextPane.tsx` `AddTagInput` |
| `YamlIssues.tsx` | `YamlIssues({ issues, onReveal, testIdPrefix })` | the Forge issues block (`✓ Valid` / list of `Button` per issue); ids `${p}-yaml-issues`, `${p}-yaml-issue`. Extracted from `ContextPane.tsx` `YamlView` |
| `edit.css` | `@layer cx-app` | `.cx-savebar*` (below) |

```css
@layer cx-app {
  .cx-savebar { display: flex; align-items: center; gap: var(--sp-2); }
  .cx-savebar__status { font-size: var(--fs-sm); color: var(--fg-muted); }
  .cx-savebar__status[data-kind='dirty'] { color: var(--warn-fg); }
  .cx-savebar__status[data-kind='error'], .cx-savebar__status[data-kind='conflict'] { color: var(--danger-fg); }
  .cx-savebar__status[data-kind='saved'] { color: var(--success-fg); }
}
```

### C.3 Store helpers
- `src/stores/entries.ts`: `export async function waitForEntry(ds: DatasetId, slug: string, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<boolean>` — GET `/api/entries?dataset=<ds>` every `intervalMs` (250) until the slug is present or `timeoutMs` (5000) passes; on success `$entries.setKey(ds, ready)`. Unit test with a stubbed `fetch`.
- `src/lib/url-state.ts`: `parseEditUrl(params): { edit: boolean; view: 'form' | 'yaml' }` (`edit` only `'1'`; `view` default `'form'`); `withParams` used for writes. Unit tests.

## D. Forge — U3

1. **Counts bug (item 6)**: in `src/stores/forge.ts` `onMount($forgeUrl, …)` (where it calls `ensureEntries(url.dataset)`) add `for (const ds of LINKABLE_DATASETS) ensureEntries(ds);` (same as Inflate `SOURCE_DATASETS`). `DiscoverPane` Tab count: `state === undefined || (state.status === 'loading' && state.entries.length === 0) ? null : state.status === 'error' ? undefined : state.entries.length`.
2. **Links list (items 10, 11)**: `ContextPane` replaces `<ol className="cx-links">` with
   ```tsx
   <OrderedList aria-labelledby="forge-links-h" items={links} getKey={linkKey} getLabel={(l) => labelOf(l)}
     onReorder={reorderLinks} testId="forge-links" rowTestId="forge-link" handleTestId="forge-link-handle"
     rowAttrs={(l) => ({ 'data-ds': l.dataset })} dependencies={[entries]} isDragDisabled={yamlInvalid} ref={listRef}>
     {(link, i) => <LinkRow link={link} index={i} count={links.length} onMove={onMove} onRemove={onRemove} />}
   </OrderedList>
   ```
   `labelOf(l)` = cached title ?? name ?? slug (from `$entries`). `LinkRow` renders only the body
   `<div className="cx-link" data-missing>` (drop the `<li>`, the `cx-link__index` span and `data-testid`/`data-key` —
   they are on the row now). Focus lookup in `onMove`/`onRemove`: `listRef.current?.querySelector(\`[role="row"][data-key="${CSS.escape(key)}"] [data-testid="${testId}"]\`)`.
3. Store: `export function reorderLinks(moving: string[], target: string, position: DropPosition): void` — reorders
   `$working.links` with `reorderKeys` over `linkKey`s, then the same post-steps as `moveLink` (YAML re-serialize when
   `$view === 'yaml'`).
4. Notes Disclosure: `meta={notes ? plural(lineCount(notes), 'line') : 'none'}`, `preview={notes ? firstLine(notes, 200) : undefined}`, `previewTestId="forge-link-notes-preview"`.
5. `ContextSelect` `pinnedKeys={[NEW_ITEM]}`; YAML view: `schema="context"`, issues via `YamlIssues` (`testIdPrefix="forge"` keeps `forge-yaml-issues`/`forge-yaml-issue`); tags via `TagEditor` (`testIdPrefix="forge"` keeps `forge-add-tag`).
6. `forge.css`: delete `.cx-links`, `.cx-link__index`; `.cx-link` loses its border-left/padding-left (row has them); keep head/notes rules.

## E. Inflate — U4

1. **Composition (items 10, 11)**: `CompositionPane` uses `OrderedList` (`testId="inflate-segments"`, `rowTestId="inflate-segment"`, `handleTestId="inflate-segment-handle"`, `getKey=(s) => s.key`, `getLabel=labelOf` (move `labelOf` from SegmentRow to `format.ts` and export), `rowAttrs=(s) => ({ 'data-type': s.type, 'data-status': s.status, 'data-ds': s.type === 'item' ? s.dataset : undefined })`, `dependencies={[bytes, lastAdded]}`, `onReorder={reorderSegments}`). `SegmentRow` renders bodies only (`<div className="cx-seg__body">`, no `<li>`, no `cx-seg__index`). `buttonOf` uses the `[role="row"][data-key]` query (D.2).
2. Store `src/stores/inflate.ts`: `export function reorderSegments(moving: string[], target: string, position: DropPosition): void { … commit({ ...w, order: reorderKeys(planKeys(), moving, target, position) }) }`.
3. **Markdown rows (item 2)**: `<Disclosure className="cx-seg__md" title={\`Markdown ${seg.id}\`} preview={firstLine(seg.body, 200) || 'empty'} previewTestId="inflate-md-preview" triggerTestId="inflate-md-toggle" defaultExpanded={seg.id === lastAdded}>` — remove `meta`. Collapsed: chevron right + one-line ellipsis preview; expanded: chevron down, preview hidden, CodeEditor (unchanged). CSS: `.cx-seg__head--md { grid-template-columns: minmax(0, 1fr) auto }` (heading col 1, actions col 2, panel `grid-column: 1 / -1`); delete the `.cx-seg__md .ck-disclosure__meta` rule; add `.cx-seg__md .ck-disclosure__trigger { overflow: hidden; white-space: nowrap }` (keep).
4. **Manifest (item 11)**: `PreviewPane` `ManifestTable` → kit `Table density="compact" aria-label="Manifest" data-testid="inflate-manifest"`; visible `<h3 className="cx-label">Manifest</h3>` above; columns `#` (end), `Item` (`isRowHeader`), `Mode`, `Size` (end), `Status`; `Row` keeps `data-testid="inflate-manifest-row" data-key data-status`. Delete `.cx-manifest` CSS except `.cx-manifest__title`.
5. `RecipeSelect` `pinnedKeys={[NEW_ITEM]}`; `SourcesPane` default-mode `pinnedKeys={[DEFAULT_ITEM]}`; `AdhocDiscover` Tab count as D.1.

## F. Markdown editing (items 4, 5) — U5 (DocEditor), U6 (popups)

### F.1 DocEditor island (`src/ui/markdown/DocEditor.tsx`, store `src/stores/doc-editor.ts`)
Store (URL-synced; `edit=1` only):
```ts
export const $docEdit = atom<boolean>(false);                    // from ?edit=1 (onMount + popstate)
export const $docTarget = atom<{ dataset; slug; path } | null>(null);
export const $docLoad = atom<{ status: 'idle' | 'loading' | 'ready' | 'error'; message?: string }>({ status: 'idle' });
export const $docBaseline = atom<{ text: string; lastModified: string } | null>(null);
export const $docDraft = atom<string>('');
export const $docDirty = computed([$docBaseline, $docDraft], (b, d) => b !== null && b.text !== d);
export const $docSave = atom<SaveStatus>({ kind: 'idle' });
export const $docConflict = atom<boolean>(false);
export const $docRestored = atom<boolean>(false);                // a sessionStorage draft was restored
export function initDoc(target): void;      // sets target; takeSave(key) → $docSave saved message; if $docEdit → loadDoc()
export function enterEdit(): void;          // replaceState(edit=1); $docEdit=true; loadDoc() if not loaded
export function loadDoc(): Promise<void>;   // GET /api/doc/<ds>/<slug>/<path> → baseline+draft; then loadDraft(key): if backup.base === lastModified → $docDraft=backup.text, $docRestored=true; else clearDraft
export function setDocDraft(text): void;    // + saveDraft(key,{text, base}) while dirty, clearDraft when clean
export function discardEdit(): void;        // clearDraft; replaceState(no edit); $docEdit=false; draft=baseline
export function saveDoc(opts?: { force?: boolean }): Promise<void>;
```
`key` = `doc:<ds>/<slug>/<path>`. Save (exact): `$docSave={saving}` → `PUT /api/doc/<ds>/<slug>/<path>` body
`{ markdown: draft, ifUnmodifiedSince: force ? undefined : baseline.lastModified }`.
- 200 `{ lastModified, warnings }`: baseline = `{ text: draft, lastModified }`; `clearDraft`; `rememberSave(key, warnings.length ? \`Saved · ${n} warning(s)\` : 'Saved')`; `history.replaceState` without `edit`; `$docEdit=false`; preview `data-stale=""`; `setTimeout(() => location.reload(), 2000)` (fallback when no dev reload comes, e.g. `pnpm start`; the dev reload at ~0.7 s usually wins). Not dirty → no `beforeunload` prompt.
- 409 → `$docConflict=true`, `$docSave={conflict, 'Changed on disk'}`. ConflictDialog: Keep editing (close); Load disk version (`clearDraft`, `loadDoc()`); Overwrite (`saveDoc({ force: true })`).
- other → `$docSave={error, body.message}`; stays in edit.
Component:
```html
<div class="cx-doctools" data-testid="doc-tools" role="toolbar" aria-label="Document">
  <ChipGroup label="View" selectionMode="single" disallowEmptySelection [doc-view-toggle]> Chip preview [doc-view-preview] · Chip edit [doc-view-edit] </ChipGroup>
  <code class="cx-doctools__path">{path}</code>
  <span class="cx-inflate__spacer"/>
  edit: <SaveBar testIdPrefix="doc" canSave={dirty && !saving} onSave=saveDoc onCancel=onCancel cancelLabel="Cancel"/>
  preview: status span [doc-status] (shows the remembered "Saved" message)
</div>
edit: {restored && <p class="cx-doc__restored" [doc-draft-restored]>Restored unsaved changes from this tab. <Button [doc-draft-discard]>Discard</Button></p>}
      <div class="cx-doc__editor" [doc-editor-wrap]> loading: <Spinner [doc-loading]/> · error: <p role="alert" [doc-load-error]>{msg} <Button>Retry</Button></p>
        · ready: <LazyCodeEditor language="markdown" height={{mode:'fill'}} value={draft} onChange={setDocDraft} onSave={saveDoc} ariaLabel={`Markdown source of ${path}`} testId="doc-editor"/> </div>
<ConflictDialog testIdPrefix="doc" what={path} …/>
<ConfirmDialog [doc-discard-dialog] title="Discard unsaved changes?" confirmLabel="Discard" tone="danger"/>
```
Preview chip / Cancel while dirty → discard dialog; clean → `discardEdit()`. Edit chip → `enterEdit()`.
DOM sync (effect, external system): `document.getElementById(previewId).hidden = $docEdit`; after save set `dataset.stale`.
`useUnsavedGuard($docDirty)`. Esc inside Monaco never leaves edit (CodeEditor stops it); Cmd/Ctrl+S saves.
Files editable: okf = any `.md` the page shows (`main.md` on the entry page, `doc.relPath` on sub-doc pages); skill =
`SKILL.md` only. Frontmatter is part of the text.
CSS (`src/ui/markdown/markdown.css`, `@layer cx-app`):
```css
.cx-doctools { position: sticky; top: var(--header-h); z-index: 2; display: flex; align-items: center; gap: var(--sp-3); min-height: 36px; margin-bottom: var(--sp-3); padding: var(--sp-1) 0; background: var(--bg); border-bottom: 1px solid var(--border); }
.cx-doctools--fallback { height: 36px; }
.cx-doctools__path { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--fg-subtle); }
.cx-doc__editor { display: flex; flex-direction: column; height: calc(100dvh - var(--header-h) - 140px); min-height: 360px; }
.cx-doc__restored { margin-bottom: var(--sp-2); font-size: var(--fs-sm); color: var(--warn-fg); }
.cx-doc__preview[data-stale] { opacity: 0.5; transition: opacity var(--dur) var(--ease); }
```

### F.2 MarkdownTargets island (`src/ui/markdown/MarkdownTargets.tsx`, `MarkdownModal.tsx`, `targets.ts`)
Targets (PURE types + adapters in `targets.ts`; fetch via `ui/edit/api.ts`):
```ts
export type MdTarget =
  | { kind: 'context-notes'; id: string; slug: string; dataset: LinkableDatasetId; target: string; label: string }
  | { kind: 'recipe-preamble'; id: string; slug: string; label: string }
  | { kind: 'recipe-block'; id: string; slug: string; blockId: string; label: string };
// id === the SSR button's data-md-edit value: `notes:<dataset>:<slug>`, `preamble`, `block:<blockId>`
export function readTarget(t, doc): string;           // current text ('' when absent)
export function writeTarget(t, doc, text): doc;       // context: notes '' → delete key; recipe: preamble '' → undefined; block body as is
export const endpoint = (t) => `/api/${t.kind === 'context-notes' ? 'context' : 'recipe'}/${t.slug}`;
```
Behavior: on mount, `querySelectorAll('[data-md-edit]')` → remove `disabled`; one delegated `click` listener on
`document` (effect with cleanup) → `setOpen(targetById(el.dataset.mdEdit))` (setState in the event callback). Open →
GET endpoint → `{ <context|recipe>: doc, lastModified }`; Modal shows `MarkdownModal`:
```html
<Modal isDismissable={!dirty} testId="md-modal"> <Dialog title={`Edit ${label}`} footer={<SaveBar testIdPrefix="md" …/>}>
  loading → Spinner; error → role=alert + Retry
  <LazyCodeEditor language="markdown" compact={false} height={{mode:'auto',minLines:10,maxLines:28}} testId="md-editor" ariaLabel={label} onSave={save}/>
</Dialog></Modal>
```
`.ck-modal` width for this modal: `className="cx-mdmodal"` → `width: min(880px, 92vw)`. Save: PUT endpoint with
`writeTarget(t, doc, text)` (+ `ifUnmodifiedSince: lastModified`, D11) → 200 → `location.reload()`; 409 →
ConflictDialog (`testIdPrefix="md"`; reload theirs = re-GET; overwrite = PUT without the guard); 400 → status error with
the first issue message. Cancel while dirty → ConfirmDialog `md-discard-dialog`. Esc inside Monaco does not close the
modal (verified); Esc on footer buttons does (only when not dirty, via `isDismissable`). Lazy Monaco.

SSR buttons (pencil, HTML twin of an icon `Button`):
```html
<button type="button" class="ck-button ck-button--ghost ck-button--sm ck-button--icon cx-mdedit" data-md-edit={id}
        aria-label={`Edit ${label}`} title={`Edit ${label}`} disabled data-testid={tid}><span class="ck-button__label"><Icon name="pencil" size={14}/></span></button>
```

## G. Detail pages (items 4, 6, 7, 12, 13) — U8 (pages) + U6 (components)

### G.1 okf + skill entry page and sub-doc page (two columns, details LEFT)
```astro
<div class="cx-detail cx-detail--doc">
  <aside class="cx-detail__aside" aria-label="Entry details" data-testid="detail-aside">
    <div class="cx-detail__tools">
      <button type="button" class="ck-button ck-button--secondary ck-button--sm" data-ide-open data-dataset={ds} data-slug={slug} data-path={path} data-testid="detail-open-ide"><span class="ck-button__label">Open in IDE</span></button>
      <span class="cx-detail__idestatus" data-ide-status role="status" aria-live="polite" data-testid="detail-ide-status"></span>
    </div>
    <MetaPanel …/> <FileTree …/> <BackRefs …/>
  </aside>
  <section class="cx-detail__main cx-doc" aria-label="Content">
    <DocEditor client:only="react" dataset={ds} slug={slug} path={path} previewId="cx-doc-preview" initialEdit={edit}>
      <div slot="fallback" class="cx-doctools cx-doctools--fallback" aria-hidden="true"></div>
    </DocEditor>
    <article id="cx-doc-preview" class="cx-prose cx-doc__preview" data-testid="detail-content" hidden={edit}><Fragment set:html={html} /></article>
  </section>
</div>
```
`path` = `'main.md'` (okf entry), `'SKILL.md'` (skill), `doc.relPath` (sub-doc). `edit = parseEditUrl(Astro.url.searchParams).edit`.
CSS (`app.css`, F section):
```css
.cx-detail--doc { grid-template-columns: 320px minmax(0, 1fr); }
.cx-detail--doc .cx-detail__main { max-width: none; }
.cx-doc__preview { max-width: var(--prose-max); }
.cx-detail__tools { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
.cx-detail__idestatus { font-size: var(--fs-xs); color: var(--fg-muted); }
.cx-detail__idestatus[data-kind='error'] { color: var(--danger-fg); }
.cx-detail__idestatus[data-kind='ok'] { color: var(--success-fg); }
@media (max-width: 1099px) { .cx-detail--doc { grid-template-columns: minmax(0, 1fr); } }   /* existing rule makes the aside static; it is first in DOM */
```
The existing `.cx-detail` (main left, aside right) stays for reference/context/recipe.

`src/scripts/shell.ts` §4 (IDE): delegated click on `[data-ide-open]` → `button.disabled = true` → `fetch('/api/ide/open', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ dataset, slug, path }) })` → 200: status "Opened in VS Code" `data-kind="ok"` (cleared after 4 s); 501: "VS Code `code` command not found — install it from VS Code: Shell Command: Install 'code' command in PATH" `data-kind="error"`; other/network: body `message` or "Couldn't open the IDE" `data-kind="error"`; finally `disabled = false`. Status element = the `[data-ide-status]` sibling.

### G.2 Context detail (item 12) — `src/components/ContextLinkList.astro` (replaces `ContextLinks.astro`, delete it)
```astro
<section class="cx-ctxlinks" aria-labelledby="h-links" data-testid="context-links">
  <h2 id="h-links">Links <span class="cx-subtle">({links.length})</span></h2>
  {links.length === 0 ? <EmptyState …Open in Forge…/> :
  <ol class="cx-ctxlinks__list">
    {links.map((l, i) => (
      <li class="cx-ctxlink cx-rowlink" data-ds={l.dataset} data-testid="context-link" data-slug={l.slug} data-key={`${l.dataset}:${l.slug}`} data-missing={l.missing ? '' : undefined}>
        <div class="cx-ctxlink__line">
          <span class="cx-ctxlink__num">{i + 1}</span>
          <DatasetBadge dataset={l.dataset} />
          {l.missing ? <span class="cx-ctxlink__title cx-ctxlink__title--missing">{l.slug}</span>
                     : <a class="cx-ctxlink__title cx-rowlink__main cx-truncate" href={l.url}>{l.title ?? l.slug}</a>}
          {l.title !== undefined && l.title !== l.slug && <code class="cx-ctxlink__slug">{l.slug}</code>}
          {l.state && <StateBadge dataset={l.dataset} state={l.state} />}
          {l.missing && <span class="ck-badge ck-badge--danger">missing</span>}
          <span class="cx-ctxlink__actions"><button … data-md-edit={`notes:${l.dataset}:${l.slug}`} data-testid="context-link-edit-notes" aria-label={`Edit notes for ${title}`}>pencil</button></span>
        </div>
        {l.notesHtml && <div class="cx-ctxlink__notes cx-prose cx-prose--compact" data-testid="context-link-notes" set:html={l.notesHtml} />}
      </li>))}
  </ol>}
</section>
```
Context order (stored order), no grouping. Page mounts `<MarkdownTargets client:only="react" targets={links.map(l => ({ kind: 'context-notes', id: \`notes:${l.dataset}:${l.slug}\`, slug, dataset: l.dataset, target: l.slug, label: \`notes for ${l.title ?? l.slug}\` }))} />`.
CSS (replace `.cx-ctxgroup*`/`.cx-ctxlink*` in `app.css`):
```css
.cx-ctxlinks__list { list-style: none; margin: var(--sp-2) 0 0; padding: 0; border: 1px solid var(--border); }
.cx-ctxlink { padding: var(--sp-1) var(--sp-3); background: var(--surface); border-bottom: 1px solid var(--border); border-left: 2px solid var(--ds-c); }
.cx-ctxlink:last-child { border-bottom: 0; }
.cx-ctxlink__line { display: flex; align-items: center; gap: var(--sp-2); min-height: var(--row-h); min-width: 0; }
.cx-ctxlink__num { width: 18px; flex: none; text-align: right; font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--fg-subtle); font-variant-numeric: tabular-nums; }
.cx-ctxlink__title { min-width: 0; font-weight: var(--fw-medium); color: var(--fg); }
.cx-ctxlink__title:hover { color: var(--accent-text); }
.cx-ctxlink__title--missing { color: var(--fg-subtle); text-decoration: line-through; }
.cx-ctxlink__slug { font-size: var(--fs-xs); color: var(--fg-subtle); }
.cx-ctxlink__actions { margin-left: auto; display: flex; gap: var(--sp-1); }
.cx-ctxlink__notes { margin: 0 0 var(--sp-1) calc(18px + var(--sp-2)); padding: var(--sp-1) var(--sp-3); background: var(--bg-subtle); border-radius: var(--r-sm); }
```

### G.3 Recipe detail — `RecipeComposition.astro` (U6)
- Preamble Panel always rendered; Panel `actions` slot: pencil `data-md-edit="preamble"` `data-testid="recipe-edit-preamble"` (label "preamble"); body = rendered preamble or `<p class="cx-recipe__none">None</p>`.
- Blocks: each block becomes `<div class="cx-recipe__block" data-testid="recipe-block" data-id={b.id}><details>…</details><button … class="cx-recipe__blockedit" data-md-edit={\`block:${b.id}\`} data-testid="recipe-block-edit">pencil</button></div>` (pencil outside `<summary>`; CSS `.cx-recipe__block { position: relative } .cx-recipe__blockedit { position: absolute; top: 2px; right: 0 }`).
- Context and item minilist rows with a link get `cx-rowlink` + `cx-rowlink__main` (G.5). Overrides/defaults tables become `ck-table ck-table--compact` twins (delete `.cx-recipe__table` CSS).
- Page mounts `<MarkdownTargets client:only="react" targets={[{ kind: 'recipe-preamble', id: 'preamble', slug, label: 'preamble' }, ...blocks.map(b => ({ kind: 'recipe-block', id: \`block:${b.id}\`, slug, blockId: b.id, label: \`markdown block ${b.id}\` }))]} />`.

### G.4 yaml datasets (reference, context, recipe)
- PageHeader actions: `<a class="ck-button ck-button--secondary ck-button--sm" href={withParams(Astro.url.pathname, { edit: '1' })} data-testid="detail-edit">Edit</a>` (hidden when `edit`), existing Open in Forge/Inflate stay.
- `edit=1`: main column = `<DataForm client:only="react" dataset={ds} mode="edit" slug={slug}>` (+ fallback) instead of the SSR view; aside unchanged.
- `src/pages/new/[dataset].astro`: yaml datasets only (else 302 `/tools?add=<ds>#add-entry`, unknown → 404); Breadcrumbs `ctxman › <Label> › new`; PageHeader `New <singular>`; `<DataForm client:only="react" dataset={ds} mode="create" />`.
- List page New button (`pages/[dataset]/index.astro` `newHref`): reference/context/recipe → `/new/<ds>`; others unchanged. Dashboard `dashboard-recipe-new` unchanged.

### G.5 Clickable rows (item 7) — stretched link, CSS-only
Markup: row element gets `cx-rowlink`; its ONE main anchor gets `cx-rowlink__main`. Applied to: `EntryTable.astro`
(`<tr class="ck-table__row cx-table__row cx-rowlink">`, title `<a class="cx-table__title cx-rowlink__main">`),
`EntryMiniList.astro` rows, `BackRefs.astro` rows (main = context link; the "Forge" button stays clickable),
`RecipeComposition.astro` context/item rows (only when not missing), `ContextLinkList.astro` rows. Native anchor
semantics stay (middle/ctrl/cmd-click open a tab; keyboard: Tab to the link, Enter). Verified in chromium: `position:
relative` on `<tr>` scopes the overlay; a `z-index:1` button stays clickable.
```css
@layer cx-app {
  .cx-rowlink { position: relative; }
  .cx-rowlink__main::after { content: ''; position: absolute; inset: 0; z-index: 0; }
  .cx-rowlink :is(a, button, input, select, textarea, label, summary, details, [data-stop-row-click]):not(.cx-rowlink__main) { position: relative; z-index: 1; }
  .cx-rowlink:hover { cursor: pointer; }
  li.cx-rowlink:hover { background: color-mix(in srgb, var(--accent) 5%, transparent); }
  .cx-rowlink__main:focus-visible { outline: none; }
  li.cx-rowlink:has(.cx-rowlink__main:focus-visible) { box-shadow: inset 0 0 0 1px var(--accent); }
  tr.cx-rowlink:has(.cx-rowlink__main:focus-visible) > td { box-shadow: inset 0 1px 0 var(--accent), inset 0 -1px 0 var(--accent); }
  tr.cx-rowlink:has(.cx-rowlink__main:focus-visible) > td:first-child { box-shadow: inset 2px 0 0 var(--accent), inset 0 1px 0 var(--accent), inset 0 -1px 0 var(--accent); }
}
```
`EntryTable`: also switch to twins `<table class="ck-table cx-table">`, `th class="ck-table__th cx-table__th--x"`,
`td class="ck-table__td"`; remove from `app.css` the `.cx-table`, `.cx-table th`, `.cx-table td`, `.cx-table__row:hover`
rules now in kit `Table.css`, keep sticky `th` (`.cx-table .ck-table__th { position: sticky; top: var(--header-h); z-index: 2 }` — z-index 2 so the row overlay (0/1) never covers it), column widths, `.cx-table__title/__slug/__desc`. Descriptions' `title` tooltips are covered by the overlay (accepted). React lists: Discover/AdhocDiscover rows already act on the whole row (`onAction`); ordered lists are not links.

## H. Forms for yaml datasets (item 8) — U7

### H.1 PURE modules
`src/lib/forms/fields.ts`:
```ts
export const YAML_DATASETS = ['reference', 'context', 'recipe'] as const;
export type YamlDatasetId = (typeof YAML_DATASETS)[number];
export type FieldKind = 'name' | 'text' | 'tags' | 'select' | 'markdown';
export interface FieldOption { id: string; label: string; description?: string }
export interface FieldDef {
  id: string; label: string; kind: FieldKind; required?: boolean; mono?: boolean; help?: string; placeholder?: string;
  options?: readonly FieldOption[];
  /** Shown only when true for the working doc (reference type switch). */
  when?: (doc: Record<string, unknown>) => boolean;
}
export const FORM_FIELDS: Record<YamlDatasetId, readonly FieldDef[]>;
export function emptyDoc(ds: YamlDatasetId): Record<string, unknown>;          // reference: { name:'', description:'', type:'local-repo', path:'', owner:'me' }; context: { name:'', description:'', links: [] }; recipe: serializeRecipe-compatible defaults (target 'claude-code', layout 'grouped', empty arrays)
export function normalizeDoc(ds, doc): Record<string, unknown>;               // trims; drops '' optionals and empty tags; reference keeps only the active variant's keys
export function validateDoc(ds, doc, expectedName?: string): { ok: true; doc: unknown } | { ok: false; errors: Record<string, string> };  // zod DATASET_SCHEMAS[ds].safeParse(normalizeDoc) → errors by issue path[0] (first message wins); name: nameProblem() from ui/forge/validate-name.ts semantics (move to src/lib/names.ts, PURE, re-export from the old path); expectedName mismatch → name error
export const LINKED_EDITOR: Record<YamlDatasetId, { label: string; href: (slug: string) => string } | null>; // context → Forge, recipe → Inflate, reference → null
```
Fields (order = render order):
| ds | fields |
|---|---|
| reference | `name` (name), `description` (text, required), `tags` (tags), `type` (select: `REFERENCE_TYPES` × `REFERENCE_TYPE_LABELS`, required), `path` (text, mono, required, `when` type=local-repo, help "Absolute or ~/ path of the repo root"), `uri` (text, mono, required, `when` type≠local-repo, help = remote-repo: "git URI: git@host:org/repo.git, ssh://…, https://host/org/repo[.git]"; remote-skill: "+ or an https archive ending .tar.gz/.tgz/.zip"), `subpath` (text, mono), `owner` (select `OWNERS` × `OWNER_LABELS`, required) |
| context | `name`, `description` (required), `tags`; links are read-only: "N links — edit in Forge" |
| recipe | `name`, `description` (required), `tags`, `target` (select `INFLATE_TARGETS` × `TARGETS[t].label`), `layout` (select `INFLATE_LAYOUTS` × `LAYOUT_LABELS`), `preamble` (markdown); composition read-only: "N contexts · N items · N blocks — edit in Inflate" |

`src/lib/yaml-doc.ts` (PURE): move the generic parse/position machinery from `context-yaml.ts` (`YamlIssue`, spans,
`spanAtPath`, `spanOfKey`, unknown-key handling, MAX_ISSUES) to
`export function parseYamlDoc<T>(text: string, schema: ZodType<T>, opts?: { expectedName?: string; nameMessage?: (n) => string }): { ok: true; doc: T } | { ok: false; issues: YamlIssue[] }`.
`context-yaml.ts` keeps its public API (`YamlIssue` re-export, `serializeContext`, `sameContext`, `parseContextYaml` as a
wrapper) so existing tests/imports pass unchanged.
`src/lib/forms/codecs.ts` (PURE): `YAML_CODECS: Record<YamlDatasetId, { schema; serialize(doc): string; same(a, b): boolean; toDoc(apiBody): doc }>` — context: `serializeContext`/`sameContext`; recipe: `serializeRecipe`/`sameRecipe`; reference: `serializeReference`/`sameReference` from BACKEND_SPEC's PURE module (if it ships only a NODE serializer, U7 creates `src/lib/reference-yaml.ts` PURE with the same key order and the backend io imports it). Serializers emit the `# yaml-language-server` first line if BACKEND_SPEC says so; the form does not care.
Unit tests: `tests/unit/forms-fields.test.ts` (emptyDoc/normalize/validate per ds, reference type switch drops keys), `tests/unit/yaml-doc.test.ts` (positions for each ds; existing `context-yaml` tests unchanged).

### H.2 Store `src/stores/data-form.ts`
```ts
export const $formView = atom<'form' | 'yaml'>('form');            // ?view= (replaceState; popstate re-reads)
export const $formMeta = atom<{ dataset: YamlDatasetId; mode: 'create' | 'edit'; slug?: string } | null>(null);
export const $formLoad = atom<{ status: 'loading' | 'ready' | 'error' | 'not-found'; message?: string }>({ status: 'loading' });
export const $formBaseline = atom<Record<string, unknown> | null>(null);
export const $formWorking = atom<Record<string, unknown> | null>(null);
export const $formLastModified = atom<string | null>(null);
export const $formAttempted = atom(false);
export const $formErrors = computed([$formWorking, $formMeta, $formAttempted], …);   // validateDoc errors, shown only after an attempt (name errors live)
export const $formYamlDraft = atom<string | null>(null);
export const $formYamlCheck = computed(…parseYamlDoc(draft, codec.schema, { expectedName: edit ? slug : undefined }));
export const $formDirty = computed(… mode === 'create' ? anything typed : !codec.same(working, baseline));
export const $formSave = atom<SaveStatus>({ kind: 'idle' });
export function initForm(meta): Promise<void>;     // edit: GET /api/<ds>/<slug> → body[<ds>] + lastModified; create: emptyDoc
export function setField(id: string, value: unknown): void;  // also re-serializes the YAML draft when $formView === 'yaml'
export function setFormView(v): void;              // as Forge setView (blocked to 'form' while YAML invalid)
export function setFormYaml(text): void;           // valid → $formWorking = doc (two-way sync)
export function submitForm(): Promise<void>;
export function deleteDoc(): Promise<void>;
```
Submit: `$formAttempted=true`; invalid → focus the first invalid field (DOM query `[data-invalid] input`, in the
component). Create: `POST /api/<ds>` body `normalizeDoc(doc)` → 201 → reference: `await waitForEntry('reference', name)`
then `location.assign('/reference/<name>')`; context/recipe: `location.assign('/<ds>/<name>')` immediately. 409 →
`errors.name = 'An entry with this name already exists'`. Edit: `PUT /api/<ds>/<slug>` (+ `ifUnmodifiedSince:
$formLastModified` if BACKEND_SPEC supports it) → 200 → `location.assign('/<ds>/<slug>')` (drops `edit=1`; a reference
save also triggers a dev reload, harmless); 409 conflict → ConflictDialog `dform-` (reload theirs = `initForm` again,
overwrite = PUT without guard); 400 → map `issues` to field errors (path[0]) and the status. Delete: ConfirmDialog →
`DELETE /api/<ds>/<slug>` → 204 → `location.assign('/<ds>')`.

### H.3 Component `src/ui/forms/DataForm.tsx` (+ `FieldControl.tsx`, `forms.css`)
```html
<section class="cx-dform" data-testid="dform" data-dataset={ds} data-mode={mode}>
  <header class="cx-dform__bar">
    <ChipGroup label="Editor view" selectionMode="single" disallowEmptySelection [dform-view-toggle]> Chip form [dform-view-form] (disabled while YAML invalid) · Chip yaml [dform-view-yaml] </ChipGroup>
    {edit && LINKED_EDITOR[ds] && <ButtonLink size="sm" href=… [dform-open-linked]>Edit links in Forge | Edit composition in Inflate</ButtonLink>}
  </header>
  <div class="cx-dform__body" data-view={view}>
    form: <Form class="cx-dform__form" validationBehavior="aria" onSubmit=submit> {visible FieldDefs → FieldControl} {summary line [dform-summary]} </Form>
    yaml: <div class="cx-yaml"> <LazyCodeEditor language="yaml" schema={ds} height={{mode:'fill'}} testId="dform-yaml-editor" markers onSave=submit/> <YamlIssues testIdPrefix="dform"/> </div>
  </div>
  <footer class="cx-dform__footer">
    <SaveBar testIdPrefix="dform" saveLabel={create ? 'Create' : 'Save'} canSave={!yamlInvalid && (create || dirty)} onSave=submit onCancel={() => location.assign(create ? `/${ds}` : `/${ds}/${slug}`)}/>
    {edit && <Button variant="danger" size="sm" [dform-delete]>Delete</Button>}
  </footer>
  <ConfirmDialog [dform-delete-dialog] tone="danger" title={`Delete ${slug}?`} confirmLabel="Delete">…</ConfirmDialog>
  <ConflictDialog testIdPrefix="dform"/> <ConfirmDialog [dform-discard-dialog] (Cancel while dirty)/>
</section>
```
`FieldControl` by kind: `name` → `TextField mono` (create: editable, `nameProblem`; edit: `isReadOnly`, description
"Names can't be changed"); `text` → `TextField` (`mono` per def); `tags` → `TagEditor testIdPrefix={\`dform-field-tags\`}`;
`select` → kit Select v2 `triggerTestId={\`dform-field-${id}\`}`; `markdown` → `LazyCodeEditor language="markdown" compact
height auto 6–20` `testId={\`dform-field-${id}\`}`. Inputs: `inputTestId={\`dform-field-${id}\`}`. Errors via
`isInvalid`+`errorMessage`. Cmd/Ctrl+S in any editor = submit. `useUnsavedGuard($formDirty)`.
Keyboard: standard form tab order; Enter in a TextField submits (RAC Form); chips arrow-select the view.
`forms.css` (`@layer cx-app`): `.cx-dform { display: flex; flex-direction: column; gap: var(--sp-3); max-width: 760px }`
`.cx-dform__bar, .cx-dform__footer { display: flex; align-items: center; gap: var(--sp-2) }`
`.cx-dform__form { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--sp-3) }`
`.cx-dform__body[data-view='yaml'] { height: calc(100dvh - var(--header-h) - 260px); min-height: 360px; display: flex }`
`.cx-dform__footer { padding-top: var(--sp-2); border-top: 1px solid var(--border) }` `.cx-dform__footer .ck-button--danger { margin-left: auto }`.

## I. Tools: navigate after create (item 9) — U9
`src/stores/tools.ts`: `RunState.follow?: boolean`. When an `add` run finishes with `created` → set `follow: true`
(saved with the run). `followCreated()` (called right after such a run and from `restoreRun()` when `follow`):
context/recipe → `location.assign(url)`; others → `await waitForEntry(ds, slug, { timeoutMs: 5000 })`; found → set
`follow:false` (saveRun) then `location.assign('/<ds>/<slug>')`; timeout → `follow:false`, keep the result panel and add
`<p class="cx-subtle" data-testid="tools-add-follow-timeout">Couldn't confirm the new entry yet — open it below.</p>`.
While following: the result panel shows `<Spinner label="Opening…"/> Opening…` (`data-testid="tools-add-opening"`).
The dev reload mid-poll is harmless: the restored run still has `follow:true` and resumes. The existing result panel and
"Open entry" link stay (`tools-add-result`, `tools-add-open`).

## J. Component reuse map (item 1)
| shared piece | file | used by |
|---|---|---|
| Select v2 | `kit/Select.tsx` | Forge ContextSelect; Inflate RecipeSelect, TargetSelect, NewRecipeDialog, OptionControls (mode, select-number), SourcesPane defaults; Tools dataset; DataForm selects |
| OrderedList | `kit/OrderedList.tsx` | Forge links; Inflate composition |
| Disclosure (preview) | `kit/Disclosure.tsx` | Forge link notes; Inflate md rows; Discover "More tags" |
| Table | `kit/Table.tsx` (+ `ck-table` twins) | Inflate manifest; EntryTable; RecipeComposition overrides/defaults |
| Icon / Icon.astro | `kit/icons.ts` | Select, Disclosure, OrderedList, pencil buttons (SSR) |
| CodeEditor / LazyCodeEditor | `ui/editor/` | Forge/Inflate (static); DocEditor, MarkdownModal, DataForm (lazy) |
| SaveBar, SaveStatus | `ui/edit/` | DocEditor, MarkdownModal, DataForm (Forge/Inflate footers unchanged this round) |
| ConflictDialog | `ui/edit/` | DocEditor, MarkdownModal, DataForm |
| useUnsavedGuard, draft-backup, last-save | `ui/edit/` | DocEditor (all three), DataForm/MarkdownModal (guard) |
| TagEditor | `ui/edit/` | Forge context form, DataForm |
| YamlIssues | `ui/edit/` | Forge YAML view, DataForm YAML view |
| api.ts | `ui/edit/` | DocEditor, MarkdownTargets, DataForm |
| waitForEntry | `stores/entries.ts` | Tools follow, DataForm create (reference) |
| reorderKeys | `lib/reorder.ts` | forge `reorderLinks`, inflate `reorderSegments` |
| parseYamlDoc + codecs | `lib/yaml-doc.ts`, `lib/forms/codecs.ts` | Forge (via context-yaml), DataForm |
| nameProblem | `lib/names.ts` | Forge/Inflate new dialogs, Tools, DataForm |
| cx-rowlink | `app.css` | EntryTable, EntryMiniList, BackRefs, RecipeComposition, ContextLinkList |

## K. CSS summary (layers per AGENTS.md; density unchanged)
- `cx-kit` (kit files): `Select.css` (replaced), `Field.css` (native select), `OrderedList.css` (new), `Table.css` (new), `Icon.css` (new), `Disclosure.css` (chevron/preview), `Tabs.css` (loading count).
- `cx-app`: `app.css` (U8: `.cx-detail--doc`, `.cx-detail__tools`, `.cx-ctxlinks*`/`.cx-ctxlink*` replace `.cx-ctxgroup*`, `.cx-rowlink*`, `.cx-table` reduced, `.cx-recipe__block*`, ), `src/ui/edit/edit.css`, `src/ui/markdown/markdown.css` (+ `.cx-mdmodal { width: min(880px, 92vw) }`), `src/ui/forms/forms.css`, `forge.css` (U3), `inflate.css` (U4).
- `global.css` (U8) imports, after `tools.css`: `@import '../ui/edit/edit.css'; @import '../ui/markdown/markdown.css'; @import '../ui/forms/forms.css';` (all `@layer cx-app`).
- No `<style>` blocks, no CSS imports in `.tsx`, no `cyber-*` on new elements.

## L. Test ids (new / changed) and e2e

| area | ids |
|---|---|
| kit Select | `<trigger>-search` (filter input), `<trigger>-popover` |
| forge | `forge-link-handle`, `forge-link-notes-preview` (existing ids unchanged; `forge-link` is now a GridList row with `data-key`) |
| inflate | `inflate-segment-handle`, `inflate-md-preview` (`inflate-segment` is now a row; `inflate-segments` the grid) |
| doc editor | `doc-tools`, `doc-view-toggle`, `doc-view-preview`, `doc-view-edit`, `doc-editor` (+ `doc-editor-wrap`), `doc-save`, `doc-cancel`, `doc-status`, `doc-loading`, `doc-load-error`, `doc-draft-restored`, `doc-draft-discard`, `doc-discard-dialog`, `doc-conflict-dialog`, `doc-conflict-reload`, `doc-conflict-overwrite`, `doc-conflict-cancel` |
| detail | `detail-open-ide`, `detail-ide-status`, `detail-edit`, `context-links`, `context-link` (+ `data-slug`, `data-key`), `context-link-notes`, `context-link-edit-notes`, `recipe-edit-preamble`, `recipe-block-edit`; removed: `context-group-<ds>` |
| md popup | `md-modal`, `md-editor`, `md-save`, `md-cancel`, `md-status`, `md-discard-dialog`, `md-conflict-*` |
| forms | `dform`, `dform-view-toggle`, `dform-view-form`, `dform-view-yaml`, `dform-field-<id>`, `dform-field-tags-tags`, `dform-field-tags-add-tag`, `dform-summary`, `dform-open-linked`, `dform-yaml-editor`, `dform-yaml-issues`, `dform-yaml-issue`, `dform-save`, `dform-cancel`, `dform-status`, `dform-delete`, `dform-delete-dialog`, `dform-discard-dialog`, `dform-conflict-*` |
| tools | `tools-add-opening`, `tools-add-follow-timeout` |

E2E (Playwright, specs own their `e2e-*` names; write to `.tmp/e2e-data` only):
- `tests/e2e/select.spec.ts` (U1): `/tools?add=task`: open `tools-add-dataset`, `tools-add-dataset-search` is focused, type `bu` → only "Bugs" option, Enter → trigger contains "Bugs" and popover gone; reopen → search empty; Esc clears then closes (focus back on trigger); chevron rotated (`.ck-select[data-open] .ck-select__chevron` has transform ≠ none while open). `/kb`: `list-sort` `selectOption('name')` still navigates (`?sort=name`).
- `forge.spec.ts` (U3): add "drag handle reorders by keyboard": focus `forge-link-handle` of row 1, Enter, ArrowDown, ArrowDown, Enter → row order via `getByTestId('forge-link')` `data-key`s changed and `forge-status` dirty; Save → API order. Add "tabs show counts on load": every `forge-tab-<ds>` shows a number without clicking. Update lines ~173–180 (context page assertions use `context-group-*`) → assert `context-link` order (`nth(0)`/`nth(1)` `data-slug`).
- `inflate.spec.ts` (U4): md row collapsed shows `inflate-md-preview` with the first line and no `inflate-md-editor`; expand → preview hidden, editor visible. Keyboard DnD of `inflate-segment-handle` moves an item and the saved `order` changes. Manifest rows still `inflate-manifest-row`. Existing up/down test unchanged.
- `tools.spec.ts` (U9): "creates an idea" → after submit `await expect(page).toHaveURL(/\/idea\/<name>$/, { timeout: 15_000 })`, then `detail-slug`/`detail-content` as today (drop the reload + `tools-add-open` click). Add: creating a context navigates to `/context/<name>`.
- `detail.spec.ts` (U8): rewrite "/context/ctxman-dev groups its links" → "lists links in context order": 10 `context-link`, `data-key`s equal `GET /api/context/ctxman-dev` link order, first row's `.ck-badge` precedes the title (`DatasetBadge` is the 2nd child of `.cx-ctxlink__line`), rca notes `code` and task notes `li` still visible, no `[data-testid^="context-group-"]`. Add row-click: clicking a `list-row`'s description cell navigates to the entry; ctrl/meta-click does not navigate the current page.
- `tests/e2e/doc-edit.spec.ts` (U8): on an `e2e-*` kb entry created via `pnpm run add:kb` in a beforeAll (CLI with `CTXMAN_DATA_DIR`): `detail-open-ide` exists; `doc-view-edit` → URL has `edit=1`, `detail-content` hidden, type a marker into `doc-editor`, `ControlOrMeta+S` → `nextPageLoad` → URL has no `edit`, `detail-content` contains the marker, `doc-status` "Saved"; conflict: enter edit, overwrite the file on disk via `writeDataText`, Save → `doc-conflict-dialog` → `doc-conflict-overwrite` → saved. Mock `/api/ide/open` with `page.route` → 501 → `detail-ide-status` shows the `code` message.
- `tests/e2e/md-popup.spec.ts` (U8): `/context/<e2e context>` (create via API in beforeAll): `context-link-edit-notes` → `md-modal` → type → `md-save` → page reloads → `context-link-notes` contains text; recipe preamble the same via `recipe-edit-preamble`.
- `tests/e2e/forms.spec.ts` (U7 create; U8 adds edit cases after wiring): `/new/reference`: type switch hides `dform-field-path` and shows `dform-field-uri`; invalid uri → error; valid create → URL `/reference/<name>`; `?edit=1` → change description → Save → detail shows it; YAML tab: invalid YAML disables Save and `dform-view-form`; Delete → list without the row. `/recipe` `list-new-entry` href is `/new/recipe`.
- `recipe.spec.ts` (U8): "the New recipe link…" → href `/new/recipe` and `dform` visible (dashboard test unchanged).
- `smoke.spec.ts`: add `/new/reference` (`dform`) (U8).

## M. Work packets (disjoint file ownership; run in this order unless noted)

Every packet finishes with `pnpm run typecheck && pnpm run lint && pnpm run fmt:check && pnpm run test` plus the
listed e2e specs (`pnpm exec playwright test tests/e2e/<spec>`), and the whole `pnpm run test:all` at the end of the
round. Backend packet ids are in BACKEND_SPEC; dependencies are named by API.

| packet | owns (only these files) | depends on | acceptance |
|---|---|---|---|
| **U1 Kit v2** | `src/ui/kit/{Select,Icon,OrderedList,Table,Disclosure,Tabs}.tsx`, `src/ui/kit/{icons.ts,index.ts}`, `src/ui/kit/{Select,Field,OrderedList,Table,Icon,Disclosure,Tabs,kit}.css`, `src/lib/reorder.ts`, `tests/unit/reorder.test.ts`, `tests/e2e/select.spec.ts` | — | select.spec, list-filters, forge, inflate, tools specs green (call sites unchanged) |
| **U2 Edit infra** | `src/ui/editor/{LazyCodeEditor.tsx,CodeEditor.tsx}` (+ `yaml-schemas.ts`, `monaco-setup.ts` if BACKEND_SPEC leaves them to UI), `src/ui/edit/**`, `src/stores/entries.ts`, `src/lib/url-state.ts`, `src/lib/names.ts` (+ `src/ui/forge/validate-name.ts` re-export), unit tests for `waitForEntry`, `parseEditUrl` | U1; backend schemas + `/api/schemas` + monaco-yaml (for `schema`) | unit tests; Forge YAML still works |
| **U3 Forge** | `src/ui/forge/**`, `src/stores/forge.ts`, `tests/e2e/forge.spec.ts` | U1, U2 | forge.spec (incl. DnD + counts) |
| **U4 Inflate** | `src/ui/inflate/**`, `src/stores/inflate.ts`, `tests/e2e/inflate.spec.ts` | U1 (U2 not needed) | inflate.spec; can run parallel to U3 |
| **U5 DocEditor** | `src/ui/markdown/{DocEditor.tsx,markdown.css}`, `src/stores/doc-editor.ts`, `tests/unit/doc-editor.test.ts` (store with stubbed fetch/history) | U2; backend `/api/doc` | unit tests (page wiring in U8) |
| **U6 Popups + SSR lists** | `src/ui/markdown/{MarkdownTargets.tsx,MarkdownModal.tsx,targets.ts}`, `src/components/ContextLinkList.astro` (new), delete `src/components/ContextLinks.astro`, `src/components/RecipeComposition.astro`, `tests/unit/md-targets.test.ts` | U2, U5 (shares `markdown.css`: U6 appends `.cx-mdmodal` there after U5) | unit tests |
| **U7 DataForm** | `src/ui/forms/**`, `src/stores/data-form.ts`, `src/lib/forms/**`, `src/lib/yaml-doc.ts`, `src/lib/context-yaml.ts` (refactor to wrapper), `src/lib/reference-yaml.ts` (only if BACKEND_SPEC lacks a PURE serializer), `src/pages/new/[dataset].astro`, `tests/unit/{forms-fields,yaml-doc}.test.ts`, `tests/e2e/forms.spec.ts` (create cases) | U1, U2; backend reference CRUD API + schemas | unit tests; forms.spec create cases; existing context-yaml tests unchanged |
| **U8 Pages + wiring** | `src/pages/[dataset]/[slug]/index.astro`, `src/pages/[dataset]/[slug]/doc/[...path].astro`, `src/pages/[dataset]/index.astro`, `src/components/{EntryTable,EntryMiniList,BackRefs,Icon}.astro`, `src/scripts/shell.ts`, `src/styles/{app,global}.css`, `tests/e2e/{detail,doc-edit,md-popup,recipe,smoke}.spec.ts`, forms.spec edit cases | U5, U6, U7; backend `/api/ide/open`, `/api/doc` | all listed specs |
| **U9 Tools follow** | `src/ui/tools/**`, `src/stores/tools.ts`, `tests/e2e/tools.spec.ts` | U2 (`waitForEntry`) | tools.spec |
| **U10 Docs** (merge with BACKEND_SPEC's docs packet; run last) | `AGENTS.md` (islands text §A; routes `/new/<ds>`, `?edit=1`, `view=`; URL-state list: detail `edit`, form `view`; repo map `src/ui/{edit,markdown,forms}`, `src/lib/forms`; kit list), `data/kb/ctxman/concepts/{routes-and-api,architecture,context-forge,context-inflate}.md` (+ a new `editing.md` concept if absent: Save model, reload tolerance, popups, forms), `data/kb/ctxman/{index,log}.md`; set the matching task/feature states | all | `pnpm run check` 0/0; `pnpm run test:all` |

Existing e2e specs needing updates: `detail.spec.ts` (context grouping), `forge.spec.ts` (~173–180 context groups),
`tools.spec.ts` (auto-navigate), `recipe.spec.ts` (New recipe href). Unchanged but must stay green: `inflate.spec.ts`
select/option clicks and up/down focus test, `list-filters.spec.ts` (`selectOption`), `smoke.spec.ts` detail testids,
`global-setup.ts` (`inflate-recipe-select`).
