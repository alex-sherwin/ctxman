import { useRef, type DragEvent, type PointerEvent, type ReactNode, type Ref } from 'react';
import {
  Button as AriaButton,
  DropIndicator,
  GridList as AriaGridList,
  GridListItem as AriaGridListItem,
  useDragAndDrop,
} from 'react-aria-components';
import type { DropPosition } from '../../lib/reorder.ts';
import { Icon } from './Icon.tsx';
import { cx } from './utils.ts';

// react-aria collections intercept FocusScope's "restore focus" event (virtualized lists reuse DOM nodes) and focus
// the row instead of the control that opened a popover. Rows here are keyed and never reused, so the event is let
// through to the control: closing a Select/Menu inside a row puts focus back on its trigger.
function allowFocusRestore(el: HTMLDivElement | null) {
  if (!el) return;
  const stop = (e: Event) => e.stopPropagation();
  el.addEventListener('react-aria-focus-scope-restore', stop);
  return () => el.removeEventListener('react-aria-focus-scope-restore', stop);
}

export interface OrderedListProps<T extends object> {
  items: readonly T[];
  getKey: (item: T) => string;
  /** Row textValue; the handle label is `Reorder ${label}`; also the drag preview text. */
  getLabel: (item: T) => string;
  /** Called on a drop: `moving` keys go before/after `target` (feed it to `reorderKeys`). */
  onReorder: (moving: string[], target: string, position: DropPosition) => void;
  /** Row body (everything right of the grip column). Render the up/down/remove fallback buttons here. */
  children: (item: T, index: number) => ReactNode;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** `data-testid` of the grid root. */
  testId: string;
  /** `data-testid` of every row (each row also gets `data-key`). */
  rowTestId: string;
  /** `data-testid` of every drag handle. */
  handleTestId: string;
  /** Static per-item attributes for the row element, e.g. `{ 'data-ds': 'kb', 'data-type': 'item' }`. */
  rowAttrs?: (item: T) => Record<`data-${string}`, string | undefined>;
  /** Extra values that must re-render rows (RAC caches rows per item object). `items` is always included. */
  dependencies?: readonly unknown[];
  /** Disables drag and drop (rows and the callers' up/down fallbacks stay). */
  isDragDisabled?: boolean;
  ref?: Ref<HTMLDivElement>;
  className?: string;
}

/**
 * Reorderable list on react-aria GridList + drag and drop. Rows are not selectable and hold arbitrary controls
 * (`keyboardNavigationBehavior="tab"` keeps typing, Space, Home/End and arrows inside row inputs and editors).
 * Keyboard: focus a handle, Enter/Space, ArrowUp/Down, Enter drops, Esc cancels. Mouse and touch drags start only
 * in the grip column (the pointer guard below). Callers render their own up/down buttons in the row body as the
 * non-drag fallback and call `reorderKeys` from `src/lib/reorder.ts`. Empty lists: render an EmptyState instead.
 */
export function OrderedList<T extends object>({
  items,
  getKey,
  getLabel,
  onReorder,
  children,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  testId,
  rowTestId,
  handleTestId,
  rowAttrs,
  dependencies,
  isDragDisabled,
  ref,
  className,
}: OrderedListProps<T>) {
  // Whether the current press started in the grip column. Written and read only in event handlers.
  const armed = useRef(false);
  const { dragAndDropHooks } = useDragAndDrop<T>({
    isDisabled: isDragDisabled,
    getItems: (keys) =>
      [...keys].map((k) => {
        const item = items.find((i) => getKey(i) === String(k));
        return {
          'text/plain': item ? getLabel(item) : String(k),
          'application/x-ctxman-key': String(k),
        };
      }),
    onReorder: (e) => {
      if (e.target.dropPosition === 'on') return;
      onReorder([...e.keys].map(String), String(e.target.key), e.target.dropPosition);
    },
    renderDropIndicator: (target) => <DropIndicator target={target} className="ck-olist__drop" />,
    renderDragPreview: (dragItems) => (
      <div className="ck-olist__preview">{dragItems[0]?.['text/plain'] ?? ''}</div>
    ),
  });

  // Mouse/touch drags may start only inside `[data-drag-zone]` (the grip column). Elsewhere the row is made
  // non-draggable for the duration of the press, so inputs keep native text selection and titles/links do not
  // drag rows.
  function onPointerDownCapture(e: PointerEvent<HTMLDivElement>) {
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
  function onDragStartCapture(e: DragEvent<HTMLDivElement>) {
    if (!armed.current) e.preventDefault(); // RAC's useDrag returns early on defaultPrevented
  }

  return (
    <div
      className="ck-olist-wrap"
      onPointerDownCapture={onPointerDownCapture}
      onDragStartCapture={onDragStartCapture}
    >
      <AriaGridList
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        items={items}
        dependencies={[items, ...(dependencies ?? [])]}
        dragAndDropHooks={dragAndDropHooks}
        keyboardNavigationBehavior="tab"
        disallowTypeAhead
        escapeKeyBehavior="none"
        className={cx('ck-olist', className)}
        data-testid={testId}
        ref={ref}
      >
        {(item) => {
          const key = getKey(item);
          const index = items.indexOf(item);
          const label = getLabel(item);
          return (
            <AriaGridListItem
              id={key}
              textValue={label}
              className="ck-olist__row"
              data-testid={rowTestId}
              data-key={key}
              {...rowAttrs?.(item)}
            >
              <div className="ck-olist__grip" data-drag-zone="">
                <AriaButton
                  slot="drag"
                  className="ck-olist__handle"
                  aria-label={`Reorder ${label}`}
                  data-testid={handleTestId}
                >
                  <span className="ck-olist__num">{index + 1}</span>
                  <Icon name="grip" size={12} className="ck-olist__gripicon" />
                </AriaButton>
              </div>
              <div className="ck-olist__body" ref={allowFocusRestore}>
                {children(item, index)}
              </div>
            </AriaGridListItem>
          );
        }}
      </AriaGridList>
    </div>
  );
}
