// EntryTools island (ROUND3_SPEC §E.5): the dialogs behind the server-rendered `[data-entry-action]` buttons of an
// okf / skill / reference detail page (and of the doc pages): Edit details (frontmatter), Add relation / child,
// Remove link, Add to context, Build context from this project, New concept. It renders only the status line
// (`entry-status`) and the open dialog. On mount it enables the SSR buttons (rendered `disabled`) and listens for
// clicks on the document (delegated, like MarkdownTargets); while a doc editor is open (`$docEditing`: a DocEditor
// is mounted AND in edit mode; `?edit=1` alone is not enough, the reference form uses it too) it disables every
// action button and state select again, so a PATCH can never invalidate an open draft's base.
// Mounted by the pages with client:only="react" (no fallback; the buttons are disabled until it mounts).
import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';
import type { LinkableDatasetId } from '../../datasets/registry.ts';
import { $docEditing } from '../../stores/doc-editor.ts';
import { Status } from '../kit/Status.tsx';
import { AddToContextDialog } from './AddToContextDialog.tsx';
import { afterWrite, STATUS_KEY } from './after-write.ts';
import { BuildContextDialog } from './BuildContextDialog.tsx';
import type { KeyedEntry } from './BuildContextDialog.tsx';
import { readTrigger, syncActions } from './entry-actions.ts';
import { dialogFor } from './entry-helpers.ts';
import type { EntryDialog } from './entry-helpers.ts';
import { $entryStatus, initEntryStatus, showEntryStatus } from './entry-status.ts';
import { FrontmatterDialog } from './FrontmatterDialog.tsx';
import { NewConceptDialog } from './NewConceptDialog.tsx';
import { RelationDialog, RemoveRelationDialog } from './RelationDialog.tsx';

export interface EntryToolsProps {
  dataset: LinkableDatasetId;
  slug: string;
  /** Display title of the entry. */
  title: string;
  kind: 'okf' | 'skill' | 'reference';
  /** `'ds/slug'` keys of the frontmatter `links` (okf): excluded from the relation pickers. */
  relationKeys?: readonly string[];
  /**
   * Project only: the children (`{key: 'ds/slug', title}`). Named `childEntries`, not `children`: the Astro React
   * integration renders `createElement(Component, props, slotChildren)`, which overwrites a `children` prop.
   */
  childEntries?: readonly KeyedEntry[];
  /** Related and depends-on targets (Build context offers them, unchecked). */
  related?: readonly KeyedEntry[];
  /** Contexts that already link this entry (backRefs). */
  linkedContexts?: readonly string[];
}

const NONE: readonly never[] = [];

export default function EntryTools({
  dataset,
  slug,
  title,
  kind,
  relationKeys = NONE,
  childEntries = NONE,
  related = NONE,
  linkedContexts = NONE,
}: EntryToolsProps) {
  const editing = useStore($docEditing);
  const status = useStore($entryStatus);
  const [dialog, setDialog] = useState<EntryDialog | null>(null);

  useEffect(() => {
    initEntryStatus(STATUS_KEY(dataset, slug));
  }, [dataset, slug]);

  // Enable the SSR buttons; lock them (and the state selects) while the doc editor is open.
  useEffect(() => {
    syncActions(editing);
  }, [editing]);

  useEffect(() => {
    const titles = new Map([...childEntries, ...related].map((e) => [e.key, e.title]));
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLElement>('[data-entry-action]');
      if (button === null || $docEditing.get()) return;
      const next = dialogFor(readTrigger(button, titles));
      if (next === null) return;
      event.preventDefault();
      setDialog(next);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [childEntries, related]);

  const close = () => setDialog(null);

  /** A write succeeded: close, show the message, and load the page again (it is server rendered). */
  function done(message: string) {
    setDialog(null);
    showEntryStatus(message);
    afterWrite(STATUS_KEY(dataset, slug), message);
  }

  return (
    <>
      <Status kind="saved" testId="entry-status" className="cx-entry__status">
        {status}
      </Status>
      {dialog?.type === 'frontmatter' && kind !== 'reference' && (
        <FrontmatterDialog
          dataset={dataset}
          slug={slug}
          kind={kind}
          onClose={close}
          onSaved={(message) => done(message)}
        />
      )}
      {dialog?.type === 'relation' && (
        <RelationDialog
          dataset={dataset}
          slug={slug}
          mode={dialog.mode}
          relationKeys={relationKeys}
          onClose={close}
          onDone={(message) => done(message)}
        />
      )}
      {dialog?.type === 'remove' && (
        <RemoveRelationDialog
          dataset={dataset}
          slug={slug}
          target={dialog}
          onClose={close}
          onDone={(message) => done(message)}
        />
      )}
      {dialog?.type === 'add-to-context' && (
        <AddToContextDialog
          dataset={dataset}
          slug={slug}
          title={title}
          linkedContexts={linkedContexts}
          onClose={close}
          onDone={(message) => done(message)}
        />
      )}
      {dialog?.type === 'build-context' && (
        <BuildContextDialog
          dataset={dataset}
          slug={slug}
          title={title}
          childEntries={childEntries}
          related={related}
          onClose={close}
        />
      )}
      {dialog?.type === 'new-concept' && (
        <NewConceptDialog
          dataset={dataset}
          slug={slug}
          {...(dialog.path === undefined ? {} : { fixedPath: dialog.path })}
          onClose={close}
        />
      )}
    </>
  );
}
