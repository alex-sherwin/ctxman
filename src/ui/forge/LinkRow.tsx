// One row of the context's links list (UI_SPEC §H.5): dataset badge, resolved title, reorder / remove
// toolbar, and a collapsed "Notes for the agent" disclosure whose Monaco editor mounts only while expanded.
import { useStore } from '@nanostores/react';
import type { ContextLink } from '../../datasets/schemas.ts';
import { $entries } from '../../stores/entries.ts';
import { linkKey, saveIfDirty, setLinkNotes } from '../../stores/forge.ts';
import {
  Badge,
  Button,
  CodeEditor,
  DatasetBadge,
  Disclosure,
  StateBadge,
  Toolbar,
  Tooltip,
} from '../kit/index.ts';
import { firstLine, lineCount, plural } from './notes.ts';

export interface LinkRowProps {
  link: ContextLink;
  index: number;
  count: number;
  onMove: (key: string, dir: -1 | 1) => void;
  onRemove: (key: string) => void;
}

export function LinkRow({ link, index, count, onMove, onRemove }: LinkRowProps) {
  const key = linkKey(link);
  const cache = useStore($entries, { keys: [link.dataset] })[link.dataset];
  const entry = cache?.entries.find((e) => e.slug === link.slug);
  const missing = cache?.status === 'ready' && entry === undefined;
  const label = entry?.title ?? entry?.name ?? link.slug;
  const notes = link.notes ?? '';

  return (
    <li
      className="cx-link"
      data-ds={link.dataset}
      data-missing={missing || undefined}
      data-testid="forge-link"
      data-key={key}
    >
      <div className="cx-link__head">
        <span className="cx-link__index" aria-hidden="true">
          {index + 1}
        </span>
        <DatasetBadge dataset={link.dataset} />
        <a
          className="cx-link__title cx-truncate"
          href={entry?.url ?? `/${link.dataset}/${link.slug}`}
          target="_blank"
          rel="noreferrer"
        >
          {label}
        </a>
        <code className="cx-link__slug">{link.slug}</code>
        {entry?.state && <StateBadge dataset={entry.dataset} state={entry.state} />}
        {missing && (
          <Badge tone="danger" title="This entry no longer exists">
            missing
          </Badge>
        )}
        <Toolbar aria-label={`Actions for ${label}`} className="cx-link__actions">
          <Tooltip content="Move up">
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label={`Move ${label} up`}
              isDisabled={index === 0}
              onPress={() => onMove(key, -1)}
              data-testid="forge-link-up"
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
              onPress={() => onMove(key, 1)}
              data-testid="forge-link-down"
            >
              ↓
            </Button>
          </Tooltip>
          <Tooltip content="Remove">
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label={`Remove ${label}`}
              onPress={() => onRemove(key)}
              data-testid="forge-link-remove"
            >
              ×
            </Button>
          </Tooltip>
        </Toolbar>
      </div>
      <Disclosure
        className="cx-link__notes"
        title="Notes for the agent"
        meta={notes ? `${plural(lineCount(notes), 'line')} · ${firstLine(notes, 60)}` : 'none'}
        triggerTestId="forge-link-notes-toggle"
      >
        {({ isExpanded }) =>
          isExpanded && (
            <>
              <CodeEditor
                language="markdown"
                compact
                value={notes}
                onChange={(v) => setLinkNotes(key, v)}
                height={{ mode: 'auto', minLines: 8, maxLines: 20 }}
                ariaLabel={`Notes for the agent about ${label}`}
                placeholder="Markdown guidance for the agent: scope, focus, caveats…"
                onSave={saveIfDirty}
                testId="forge-link-notes"
                describedBy={`notes-help-${key}`}
              />
              <p id={`notes-help-${key}`} className="cx-link__notes-help">
                Markdown. Narrow the scope, point at the relevant parts, or explain how this item is
                used in this context.
              </p>
            </>
          )
        }
      </Disclosure>
    </li>
  );
}
