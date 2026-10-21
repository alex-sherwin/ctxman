// EntryMenus island: the "more actions" menu of an entry (EntryMenu.tsx). The SSR pages render empty
// `[data-entry-menu]` slots (the detail page header; attributes `data-dataset`, `data-slug`, `data-title`,
// `data-context="row" | "detail"`); on mount this island portals the menu into each of them. Its actions: "Clone…"
// (okf entries: CloneEntryDialog, then the new entry's page) and "Delete…", behind a ConfirmDialog. A row reloads the
// list after a delete, the detail page goes back to the list of its dataset. While a doc editor is open
// (`$docEditing`) both items are disabled. List rows are not slots: the ListTable island renders the same EntryMenu in
// its own cells (Delete only).
// Mounted with client:only="react" (no fallback: the slots are empty until it mounts). Monaco-free: kit parts are
// imported by file.
import { useStore } from '@nanostores/react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { isDatasetId, isOkfDatasetId } from '../../datasets/registry.ts';
import { $docEditing } from '../../stores/doc-editor.ts';
import { CloneEntryDialog } from './CloneEntryDialog.tsx';
import { DeleteEntryDialog, EntryMenu } from './EntryMenu.tsx';
import type { MenuTarget } from './EntryMenu.tsx';

interface SlotTarget extends MenuTarget {
  host: HTMLElement;
}

function collectTargets(): SlotTarget[] {
  const out: SlotTarget[] = [];
  for (const host of document.querySelectorAll<HTMLElement>('[data-entry-menu]')) {
    const { dataset, slug, title, context } = host.dataset;
    if (!isDatasetId(dataset) || slug === undefined || slug === '') continue;
    out.push({
      host,
      dataset,
      slug,
      title: title ?? slug,
      context: context === 'detail' ? 'detail' : 'row',
    });
  }
  return out;
}

export default function EntryMenus() {
  // client:only: the island renders after the page is parsed, so the slots exist on the first render.
  const [targets] = useState(collectTargets);
  const editing = useStore($docEditing);
  const [asking, setAsking] = useState<MenuTarget | null>(null);
  const [cloning, setCloning] = useState<MenuTarget | null>(null);

  return (
    <>
      {targets.map((t) =>
        createPortal(
          <EntryMenu target={t} locked={editing} onDelete={setAsking} onClone={setCloning} />,
          t.host,
          `${t.dataset}/${t.slug}/${t.context}`,
        ),
      )}
      {asking !== null && <DeleteEntryDialog target={asking} onClose={() => setAsking(null)} />}
      {cloning !== null && isOkfDatasetId(cloning.dataset) && (
        <CloneEntryDialog
          dataset={cloning.dataset}
          slug={cloning.slug}
          title={cloning.title}
          onClose={() => setCloning(null)}
        />
      )}
    </>
  );
}
