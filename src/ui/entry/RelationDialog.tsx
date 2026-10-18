// Relation dialogs of the detail tools (ROUND3_SPEC §E.5): `RelationDialog` picks an entry with the shared
// EntryPicker and adds it to this entry's frontmatter `links` (PATCH addLinks) as Related / Depends on / Child
// ('child' mode: the project's Children panel, rel fixed); `RemoveRelationDialog` confirms and removes one
// (PATCH removeLinks). Both stay open on an error and show it. Browser-only; kit parts by file.
import { useEffect, useRef, useState } from 'react';
import { ENTRY_REL_LABELS, isLinkableDatasetId } from '../../datasets/registry.ts';
import type { EntryRel, LinkableDatasetId } from '../../datasets/registry.ts';
import type { EntrySummary } from '../../lib/entry-summary.ts';
import { ConfirmDialog } from '../kit/Dialog.tsx';
import { ListBoxItem } from '../kit/ListBox.tsx';
import { Select } from '../kit/Select.tsx';
import { EntryPicker } from '../pickers/EntryPicker.tsx';
import { patchEntry } from './entry-api.ts';
import { splitKey } from './entry-helpers.ts';

/** The relations a user can pick; Related first (the default). */
const PICKABLE_RELS: readonly EntryRel[] = ['related', 'depends-on', 'child'];

const titleOf = (e: EntrySummary): string => e.title ?? e.name;

export interface RelationDialogProps {
  dataset: LinkableDatasetId;
  slug: string;
  /** 'relation' = any relation, chosen in the dialog; 'child' = a project's child (no Select). */
  mode: 'relation' | 'child';
  /** `'ds/slug'` keys already in the frontmatter `links` (excluded from the picker, like the entry itself). */
  relationKeys: readonly string[];
  onClose: () => void;
  /** The PATCH answered 200; the parent closes and reloads. */
  onDone: (message: string) => void;
}

/**
 * Puts `data-mode` on the picker's modal (`relation-picker`): EntryPicker does not forward attributes, so the
 * marker, which renders inside that modal through the picker's `extra` slot, sets it on its ancestor.
 */
function ModeMarker({ mode }: { mode: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.closest('[data-testid="relation-picker"]')?.setAttribute('data-mode', mode);
  }, [mode]);
  return <span ref={ref} hidden data-testid="relation-mode" data-mode={mode} />;
}

export function RelationDialog({
  dataset,
  slug,
  mode,
  relationKeys,
  onClose,
  onDone,
}: RelationDialogProps) {
  const [rel, setRel] = useState<EntryRel>('related');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exclude = new Set([`${dataset}/${slug}`, ...relationKeys]);

  async function pick(entry: EntrySummary) {
    if (busy) return;
    if (!isLinkableDatasetId(entry.dataset)) return;
    setBusy(true);
    setError(null);
    const res = await patchEntry(dataset, slug, {
      addLinks: [
        { dataset: entry.dataset, slug: entry.slug, rel: mode === 'child' ? 'child' : rel },
      ],
    });
    if (res.ok) {
      onDone(`Linked ${titleOf(entry)}`);
      return;
    }
    setBusy(false);
    setError(
      res.issues && res.issues.length > 0
        ? res.issues.map((i) => i.message).join('; ')
        : res.message,
    );
  }

  return (
    <EntryPicker
      isOpen
      title={mode === 'child' ? 'Add child' : 'Link to entry'}
      exclude={exclude}
      actionLabel={mode === 'child' ? 'Add' : 'Link'}
      testId="relation-picker"
      onPick={(entry) => void pick(entry)}
      onClose={onClose}
      extra={
        <div className="cx-relpick">
          <ModeMarker mode={mode} />
          {mode === 'relation' ? (
            <Select
              label="Relation"
              size="sm"
              searchable={false}
              value={rel}
              onChange={(key) => {
                const next = PICKABLE_RELS.find((r) => r === key);
                if (next !== undefined) setRel(next);
              }}
              triggerTestId="relation-rel"
            >
              {PICKABLE_RELS.map((r) => (
                <ListBoxItem key={r} id={r} textValue={ENTRY_REL_LABELS[r]}>
                  {ENTRY_REL_LABELS[r]}
                </ListBoxItem>
              ))}
            </Select>
          ) : (
            <p className="cx-subtle">The picked entry is added to this project as a child.</p>
          )}
          {busy && (
            <p className="cx-subtle" role="status" data-testid="relation-busy">
              Saving…
            </p>
          )}
          {error !== null && (
            <p className="cx-relpick__error" role="alert" data-testid="relation-error">
              {error}
            </p>
          )}
        </div>
      }
    />
  );
}

export interface RemoveRelationDialogProps {
  dataset: LinkableDatasetId;
  slug: string;
  /** The link to remove: `'ds/slug'`, its relation id (display only) and the target's title. */
  target: { key: string; rel: string; title: string };
  onClose: () => void;
  onDone: (message: string) => void;
}

export function RemoveRelationDialog({
  dataset,
  slug,
  target,
  onClose,
  onDone,
}: RemoveRelationDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    const link = splitKey(target.key);
    if (link === null || pending) return;
    setPending(true);
    setError(null);
    const res = await patchEntry(dataset, slug, { removeLinks: [link] });
    if (res.ok) {
      onDone('Removed link');
      return;
    }
    setPending(false);
    setError(res.message);
  }

  const relLabel = (ENTRY_REL_LABELS as Record<string, string>)[target.rel];
  return (
    <ConfirmDialog
      isOpen
      title="Remove link"
      confirmLabel="Remove"
      tone="danger"
      isPending={pending}
      onConfirm={() => void remove()}
      onCancel={onClose}
      testId="relation-remove-dialog"
    >
      <p>
        Remove the link to <strong>{target.title}</strong>?
      </p>
      <p className="cx-subtle">
        {relLabel === undefined ? '' : `${relLabel} · `}
        <code>{target.key}</code>. The entry itself is not deleted.
      </p>
      {error !== null && (
        <p className="cx-relpick__error" role="alert" data-testid="relation-remove-error">
          {error}
        </p>
      )}
    </ConfirmDialog>
  );
}
