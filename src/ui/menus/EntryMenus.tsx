// EntryMenus island: the "more actions" menu of an entry. The SSR pages render empty `[data-entry-menu]` slots (one
// per list row, one in the detail page header; attributes `data-dataset`, `data-slug`, `data-title`,
// `data-context="row" | "detail"`); on mount this island portals a MenuTrigger + Menu into each of them. The only
// action is "Delete…", behind a ConfirmDialog. A row reloads the list after a delete, the detail page goes back to
// the list of its dataset. While a doc editor is open (`$docEditing`) the item is disabled.
// Mounted with client:only="react" (no fallback: the slots are empty until it mounts). Monaco-free: kit parts are
// imported by file.
import { useStore } from '@nanostores/react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { datasetDef, isDatasetId } from '../../datasets/registry.ts';
import type { DatasetId } from '../../datasets/registry.ts';
import { $docEditing } from '../../stores/doc-editor.ts';
import { LOCK_TITLE } from '../entry/entry-actions.ts';
import { deleteEntry, deleteSummary } from '../entry/delete-entry.ts';
import { Button } from '../kit/Button.tsx';
import { ConfirmDialog } from '../kit/Dialog.tsx';
import { Icon } from '../kit/Icon.tsx';
import { Menu, MenuItem, MenuTrigger } from '../kit/Menu.tsx';
import { Popover } from '../kit/Popover.tsx';
import { ErrorText } from '../kit/Status.tsx';

interface MenuTarget {
  host: HTMLElement;
  dataset: DatasetId;
  slug: string;
  title: string;
  context: 'row' | 'detail';
}

function collectTargets(): MenuTarget[] {
  const out: MenuTarget[] = [];
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (pending) return;
    setAsking(null);
    setError(null);
  };

  const confirm = async () => {
    if (asking === null) return;
    setPending(true);
    setError(null);
    const res = await deleteEntry(asking.dataset, asking.slug);
    if (!res.ok) {
      setPending(false);
      setError(res.failure);
      return;
    }
    // stay pending while the page navigates away
    if (asking.context === 'detail') location.assign(`/${asking.dataset}`);
    else location.reload();
  };

  return (
    <>
      {targets.map((t) =>
        createPortal(
          <MenuTrigger>
            <Button
              iconOnly
              variant="ghost"
              size="sm"
              aria-label={`Actions for ${t.title}`}
              data-testid="entry-menu"
            >
              <Icon name="more" />
            </Button>
            <Popover placement="bottom end">
              <Menu aria-label={`Actions for ${t.title}`} onAction={() => setAsking(t)}>
                <MenuItem
                  id="delete"
                  tone="danger"
                  textValue="Delete"
                  isDisabled={editing}
                  data-testid="entry-menu-delete"
                >
                  {/* RAC does not forward `title` to the menu item: the reason sits on the label */}
                  <span title={editing ? LOCK_TITLE : undefined}>Delete…</span>
                </MenuItem>
              </Menu>
            </Popover>
          </MenuTrigger>,
          t.host,
          `${t.dataset}/${t.slug}/${t.context}`,
        ),
      )}
      {asking !== null && (
        <ConfirmDialog
          isOpen
          title={`Delete ${datasetDef(asking.dataset).singular} “${asking.title}”?`}
          confirmLabel="Delete"
          tone="danger"
          isPending={pending}
          onConfirm={() => void confirm()}
          onCancel={close}
          testId="entry-delete-dialog"
        >
          <p>{deleteSummary(asking.dataset, asking.slug)}</p>
          {error !== null && <ErrorText testId="entry-delete-error">{error}</ErrorText>}
        </ConfirmDialog>
      )}
    </>
  );
}
