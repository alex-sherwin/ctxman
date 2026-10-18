// One row of the composition (INFLATE_SPEC §9.3): item, context intro, section intro or markdown block.
// Rows are presentational: reorder / remove callbacks come from CompositionPane (it owns the focus rules).
import { useStore } from '@nanostores/react';
import type { Segment } from '../../lib/inflate/expand.ts';
import {
  $lastAddedBlock,
  insertMarkdownAfter,
  saveIfDirty,
  setExcluded,
  setMarkdownBody,
} from '../../stores/inflate.ts';
import {
  Badge,
  Button,
  CodeEditor,
  DatasetBadge,
  Disclosure,
  Spinner,
  Toolbar,
  Tooltip,
} from '../kit/index.ts';
import { firstLine, formatBytes, plural } from './format.ts';
import { OptionControls } from './OptionControls.tsx';

export interface SegmentRowProps {
  segment: Segment;
  index: number;
  count: number;
  /** Bytes of this segment in the last server render (undefined = not rendered yet). */
  bytes: number | undefined;
  onMove: (key: string, dir: -1 | 1) => void;
  onRemove: (segment: Segment) => void;
}

/** Plain-text label of a segment, for aria-labels. */
function labelOf(segment: Segment): string {
  switch (segment.type) {
    case 'item':
      return segment.title;
    case 'context-intro':
      return `context ${segment.title}`;
    case 'section-intro':
      return segment.title;
    case 'markdown':
      return `markdown ${segment.id}`;
  }
}

function RowActions({ segment, index, count, onMove, onRemove }: SegmentRowProps) {
  const label = labelOf(segment);
  const excludable =
    segment.type === 'item' &&
    segment.via.length > 0 &&
    (segment.status === 'included' || segment.status === 'excluded');
  const removable = (segment.type === 'item' && segment.adhoc) || segment.type === 'markdown';
  return (
    <Toolbar aria-label={`Actions for ${label}`} className="cx-seg__actions">
      {excludable && (
        <Button
          variant="ghost"
          size="sm"
          onPress={() => setExcluded(segment.key, segment.status !== 'excluded')}
          data-testid="inflate-segment-exclude"
        >
          {segment.status === 'excluded' ? 'Include' : 'Exclude'}
        </Button>
      )}
      <Tooltip content="Insert a markdown block after this">
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Insert markdown after ${label}`}
          onPress={() => insertMarkdownAfter(segment.key)}
          data-testid="inflate-segment-insert-md"
        >
          + md
        </Button>
      </Tooltip>
      <Tooltip content="Move up">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={`Move ${label} up`}
          isDisabled={index === 0}
          onPress={() => onMove(segment.key, -1)}
          data-testid="inflate-segment-up"
        >
          ↑
        </Button>
      </Tooltip>
      <Tooltip content="Move down">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={`Move ${label} down`}
          isDisabled={index === count - 1}
          onPress={() => onMove(segment.key, 1)}
          data-testid="inflate-segment-down"
        >
          ↓
        </Button>
      </Tooltip>
      {removable && (
        <Tooltip content="Remove">
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={`Remove ${label}`}
            onPress={() => onRemove(segment)}
            data-testid="inflate-segment-remove"
          >
            ×
          </Button>
        </Tooltip>
      )}
    </Toolbar>
  );
}

function Warnings({ segment }: { segment: Segment }) {
  return (
    <>
      {segment.warnings.map((w) => (
        <p
          key={`${w.code}:${w.message}`}
          className="cx-seg__warn"
          data-testid="inflate-segment-warning"
        >
          {w.message}
        </p>
      ))}
    </>
  );
}

function ItemRow(props: SegmentRowProps & { segment: Extract<Segment, { type: 'item' }> }) {
  const { segment: seg, index, bytes } = props;
  const notesText = seg.notes.map((n) => `${n.context}: ${n.notes.trim()}`).join('\n\n');
  const refType = seg.meta?.refType;
  const uriKind = seg.meta?.uriKind;
  return (
    <li
      className="cx-seg"
      data-testid="inflate-segment"
      data-key={seg.key}
      data-type="item"
      data-status={seg.status}
      data-ds={seg.dataset}
    >
      <div className="cx-seg__head">
        <span className="cx-seg__index" aria-hidden="true">
          {index + 1}
        </span>
        <DatasetBadge dataset={seg.dataset} />
        <a
          className="cx-seg__title cx-truncate"
          href={`/${seg.dataset}/${seg.slug}`}
          target="_blank"
          rel="noreferrer"
        >
          {seg.title}
        </a>
        <code className="cx-seg__slug">{seg.slug}</code>
        {refType !== undefined && <Badge tone="muted">{refType}</Badge>}
        {uriKind !== undefined && <Badge tone="muted">{uriKind}</Badge>}
        {seg.via.map((slug) => (
          <Badge key={slug} tone="muted" title={`Linked from context ${slug}`}>
            {slug}
          </Badge>
        ))}
        {seg.adhoc && <Badge tone="info">ad hoc</Badge>}
        {seg.status === 'missing' && (
          <Badge tone="danger" title="This entry no longer exists">
            missing
          </Badge>
        )}
        {seg.status === 'invalid' && (
          <Badge tone="danger" title="This entry could not be read">
            invalid
          </Badge>
        )}
        {seg.status === 'excluded' && <Badge tone="muted">excluded</Badge>}
        {seg.status === 'loading' && <Spinner label={`Loading ${seg.title}`} />}
        {seg.notes.length > 0 && (
          <Badge tone="info" title={notesText}>
            {plural(seg.notes.length, 'note')}
          </Badge>
        )}
        {bytes !== undefined && seg.status === 'included' && (
          <span className="cx-seg__size cx-mono cx-subtle">{formatBytes(bytes)}</span>
        )}
        <RowActions {...props} />
      </div>
      {(seg.status === 'included' || seg.status === 'excluded') && seg.kind !== null && (
        <OptionControls seg={seg} />
      )}
      <Warnings segment={seg} />
    </li>
  );
}

function MarkdownRow(props: SegmentRowProps & { segment: Extract<Segment, { type: 'markdown' }> }) {
  const { segment: seg, index } = props;
  const lastAdded = useStore($lastAddedBlock);
  return (
    <li
      className="cx-seg"
      data-testid="inflate-segment"
      data-key={seg.key}
      data-type="markdown"
      data-status={seg.status}
    >
      <div className="cx-seg__head cx-seg__head--md">
        <span className="cx-seg__index" aria-hidden="true">
          {index + 1}
        </span>
        <Disclosure
          className="cx-seg__md"
          title={`Markdown ${seg.id}`}
          meta={firstLine(seg.body, 60) || 'empty'}
          triggerTestId="inflate-md-toggle"
          defaultExpanded={seg.id === lastAdded}
        >
          {({ isExpanded }) =>
            isExpanded && (
              <CodeEditor
                language="markdown"
                compact
                value={seg.body}
                onChange={(v) => setMarkdownBody(seg.id, v)}
                height={{ mode: 'auto', minLines: 6, maxLines: 24 }}
                ariaLabel={`Markdown block ${seg.id}`}
                placeholder="Markdown placed here in the document…"
                onSave={saveIfDirty}
                testId="inflate-md-editor"
              />
            )
          }
        </Disclosure>
        <RowActions {...props} />
      </div>
      <Warnings segment={seg} />
    </li>
  );
}

export function SegmentRow(props: SegmentRowProps) {
  const { segment: seg, index } = props;
  switch (seg.type) {
    case 'item':
      return <ItemRow {...props} segment={seg} />;
    case 'markdown':
      return <MarkdownRow {...props} segment={seg} />;
    case 'context-intro':
    case 'section-intro':
      return (
        <li
          className="cx-seg"
          data-testid="inflate-segment"
          data-key={seg.key}
          data-type={seg.type}
          data-status={seg.status}
        >
          <div className="cx-seg__head">
            <span className="cx-seg__index" aria-hidden="true">
              {index + 1}
            </span>
            {seg.type === 'context-intro' ? (
              <>
                <span className="cx-label">Context</span>
                <a
                  className="cx-seg__title cx-truncate"
                  href={`/context/${seg.slug}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {seg.title}
                </a>
                <span className="cx-subtle cx-truncate cx-seg__desc">{seg.description}</span>
                {seg.crossRefs.length > 0 && (
                  <span className="cx-subtle cx-seg__also">also: {seg.crossRefs.join(', ')}</span>
                )}
              </>
            ) : (
              <span className="cx-label">{seg.title}</span>
            )}
            <RowActions {...props} />
          </div>
          <Warnings segment={seg} />
        </li>
      );
  }
}
