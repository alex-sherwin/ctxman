// Right pane (compose view) of Inflate: the ordered segments of the document with per-item mode and option
// controls (INFLATE_SPEC §9.3). The list is `$plan`: the working recipe expanded in the browser.
import { useStore } from '@nanostores/react';
import { useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import type { Segment } from '../../lib/inflate/expand.ts';
import {
  $plan,
  $segmentBytes,
  $working,
  moveSegment,
  pruneStale,
  reloadSources,
  removeItem,
  removeMarkdown,
  reorderSegments,
  resetOrder,
} from '../../stores/inflate.ts';
import { Button, EmptyState, OrderedList } from '../kit/index.ts';
import { labelOf, plural } from './format.ts';
import { SegmentRow } from './SegmentRow.tsx';

export function CompositionPane() {
  const plan = useStore($plan);
  const working = useStore($working);
  const bytes = useStore($segmentBytes);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /** The action button of the row `key` (the DOM is the source of truth for focus targets). */
  const buttonOf = useCallback((key: string, testId: string): HTMLButtonElement | null => {
    const button = listRef.current?.querySelector(
      `[role="row"][data-key="${CSS.escape(key)}"] [data-testid="${testId}"]`,
    );
    return button instanceof HTMLButtonElement ? button : null;
  }, []);

  if (plan === null || working === null) return null;
  const segments = plan.segments;

  function onMove(key: string, dir: -1 | 1) {
    flushSync(() => moveSegment(key, dir));
    // Keep the focus on the same-direction button of the moved row; at the end of the list that
    // button is disabled, so fall back to the opposite one.
    const same = buttonOf(key, dir === -1 ? 'inflate-segment-up' : 'inflate-segment-down');
    const target =
      same !== null && !same.disabled
        ? same
        : buttonOf(key, dir === -1 ? 'inflate-segment-down' : 'inflate-segment-up');
    target?.focus();
  }

  function onRemove(segment: Segment) {
    const i = segments.findIndex((s) => s.key === segment.key);
    const neighbour = segments[i + 1] ?? segments[i - 1];
    flushSync(() => {
      if (segment.type === 'markdown') removeMarkdown(segment.id);
      else if (segment.type === 'item') removeItem(segment.key);
    });
    const target =
      neighbour === undefined ? null : buttonOf(neighbour.key, 'inflate-segment-insert-md');
    (target ?? headingRef.current)?.focus();
  }

  const keys = new Set(segments.map((s) => s.key));
  const staleOrder = working.order.some((k) => !keys.has(k));
  const canPrune = !plan.pending && (plan.staleOverrides.length > 0 || staleOrder);

  return (
    <section
      className="cx-forge__pane cx-forge__pane--composition"
      aria-labelledby="inflate-composition-h"
      data-testid="inflate-composition"
    >
      <header className="cx-forge__pane-header">
        <h2
          id="inflate-composition-h"
          className="cx-forge__pane-title"
          ref={headingRef}
          tabIndex={-1}
        >
          Composition
        </h2>
        <span className="cx-forge__count" data-testid="inflate-segment-count">
          {plural(segments.length, 'segment')}
        </span>
        <span className="cx-inflate__spacer" />
        <Button
          size="sm"
          variant="ghost"
          onPress={resetOrder}
          isDisabled={working.order.length === 0}
          data-testid="inflate-reset-order"
        >
          Reset order
        </Button>
        <Button size="sm" variant="ghost" onPress={reloadSources} data-testid="inflate-reload">
          Reload sources
        </Button>
      </header>
      <div className="cx-forge__pane-body">
        {(plan.warnings.length > 0 || canPrune) && (
          <div className="cx-comp__warnings">
            {plan.warnings.length > 0 && (
              <ul data-testid="inflate-plan-warnings">
                {plan.warnings.map((w) => (
                  <li key={`${w.code}:${w.key ?? ''}:${w.message}`}>{w.message}</li>
                ))}
              </ul>
            )}
            {canPrune && (
              <Button size="sm" onPress={pruneStale} data-testid="inflate-prune-stale">
                Prune stale
              </Button>
            )}
          </div>
        )}
        {segments.length === 0 ? (
          <EmptyState title="Nothing to include yet">
            Check a context or add items in the Sources pane.
          </EmptyState>
        ) : (
          <OrderedList
            className="cx-segs"
            aria-labelledby="inflate-composition-h"
            items={segments}
            getKey={(s) => s.key}
            getLabel={labelOf}
            onReorder={reorderSegments}
            testId="inflate-segments"
            rowTestId="inflate-segment"
            handleTestId="inflate-segment-handle"
            rowAttrs={(s) => ({
              'data-type': s.type,
              'data-status': s.status,
              'data-ds': s.type === 'item' ? s.dataset : undefined,
            })}
            dependencies={[bytes]}
            ref={listRef}
          >
            {(segment, i) => (
              <SegmentRow
                segment={segment}
                index={i}
                count={segments.length}
                bytes={bytes.get(segment.key)}
                onMove={onMove}
                onRemove={onRemove}
              />
            )}
          </OrderedList>
        )}
      </div>
    </section>
  );
}
