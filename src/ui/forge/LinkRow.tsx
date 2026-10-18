// The body of one row of the context's links list (UI_SPEC §H.5, ROUND2_UI_SPEC §D): dataset badge, resolved
// title, up / down / remove toolbar (the non-drag reorder fallback), and a collapsed "Notes for the agent"
// disclosure whose Monaco editor mounts only while expanded. The row itself (grip, index, `data-key`, dataset
// color) is the kit OrderedList's; ContextPane derives its textValue / attributes with `link-label.ts`.
import { useStore } from '@nanostores/react';
import type { ContextLink } from '../../datasets/schemas.ts';
import { $entries } from '../../stores/entries.ts';
import { linkKey, saveIfDirty, setLinkNotes } from '../../stores/forge.ts';
import { firstLine, lineCount, plural } from '../../lib/text.ts';
import { invalidTitle } from '../pickers/picker-rows.ts';
import {
  Badge,
  Button,
  CodeEditor,
  DatasetBadge,
  Disclosure,
  Icon,
  StateBadge,
  Toolbar,
  Tooltip,
} from '../kit/index.ts';
import { isMissing, labelOf } from './link-label.ts';

export interface LinkRowProps {
  link: ContextLink;
  index: number;
  count: number;
  onMove: (key: string, dir: -1 | 1) => void;
  onRemove: (key: string) => void;
}

export function LinkRow({ link, index, count, onMove, onRemove }: LinkRowProps) {
  const key = linkKey(link);
  const entries = useStore($entries, { keys: [link.dataset] });
  const entry = entries[link.dataset]?.entries.find((e) => e.slug === link.slug);
  const missing = isMissing(entries, link);
  const label = labelOf(entries, link);
  const notes = link.notes ?? '';

  return (
    <div className="cx-link" data-missing={missing || undefined}>
      <div className="cx-link__head">
        <DatasetBadge dataset={link.dataset} />
        <a
          className="ck-entryline__title cx-truncate"
          href={entry?.url ?? `/${link.dataset}/${link.slug}`}
          target="_blank"
          rel="noreferrer"
        >
          {label}
        </a>
        <code className="ck-entryline__slug">{link.slug}</code>
        {entry?.state && <StateBadge dataset={entry.dataset} state={entry.state} />}
        {missing && (
          <Badge tone="danger" title="This entry no longer exists">
            missing
          </Badge>
        )}
        {entry?.invalid && (
          <Badge tone="danger" title={invalidTitle(entry)}>
            invalid
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
              <Icon name="arrow-up" size={13} />
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
              <Icon name="arrow-down" size={13} />
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
              <Icon name="close" size={13} />
            </Button>
          </Tooltip>
        </Toolbar>
      </div>
      <Disclosure
        className="cx-link__notes"
        title="Notes for the agent"
        meta={notes ? plural(lineCount(notes), 'line') : 'none'}
        preview={notes ? firstLine(notes, 200) : undefined}
        previewTestId="forge-link-notes-preview"
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
    </div>
  );
}
