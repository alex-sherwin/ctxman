// The "more actions" menu of one entry and its delete confirmation, shared by the EntryMenus island (the SSR slot of
// detail headers) and the ListTable island (its own row cells). Actions: "Clone…" (okf entries in the detail
// header only, when the caller passes `onClone`: CloneEntryDialog.tsx) and "Delete…": the dialog runs the DELETE, then
// a row reloads the list and a detail page goes back to the list of its dataset.
// Monaco-free and store-free (the caller passes the doc-editor lock); kit parts are imported by file.
import { useState } from 'react';
import { datasetDef } from '../../datasets/registry.ts';
import type { DatasetId } from '../../datasets/registry.ts';
import { canClone } from '../entry/clone-entry.ts';
import { LOCK_TITLE } from '../entry/entry-actions.ts';
import { deleteEntry, deleteSummary } from '../entry/delete-entry.ts';
import { Button } from '../kit/Button.tsx';
import { ConfirmDialog } from '../kit/Dialog.tsx';
import { Icon } from '../kit/Icon.tsx';
import { Menu, MenuItem, MenuTrigger } from '../kit/Menu.tsx';
import { Popover } from '../kit/Popover.tsx';
import { ErrorText } from '../kit/Status.tsx';

export interface MenuTarget {
  dataset: DatasetId;
  slug: string;
  title: string;
  context: 'row' | 'detail';
}

export interface EntryMenuProps {
  target: MenuTarget;
  /** "Leave the editor first": a doc editor is open, so cloning and deleting are disabled. */
  locked?: boolean;
  onDelete: (target: MenuTarget) => void;
  /** Shows "Clone…" for an okf entry in the detail header (list rows never pass it). */
  onClone?: (target: MenuTarget) => void;
}

/** The `⋯` button and its menu. */
export function EntryMenu({ target, locked = false, onDelete, onClone }: EntryMenuProps) {
  const cloneable = onClone !== undefined && canClone(target);
  return (
    <MenuTrigger>
      <Button
        iconOnly
        variant="ghost"
        size="sm"
        aria-label={`Actions for ${target.title}`}
        data-testid="entry-menu"
      >
        <Icon name="more" />
      </Button>
      <Popover placement="bottom end">
        <Menu
          aria-label={`Actions for ${target.title}`}
          onAction={(key) => {
            if (key === 'clone') onClone?.(target);
            else onDelete(target);
          }}
        >
          {cloneable && (
            <MenuItem
              id="clone"
              textValue="Clone"
              isDisabled={locked}
              data-testid="entry-menu-clone"
            >
              <span title={locked ? LOCK_TITLE : undefined}>Clone…</span>
            </MenuItem>
          )}
          <MenuItem
            id="delete"
            tone="danger"
            textValue="Delete"
            isDisabled={locked}
            data-testid="entry-menu-delete"
          >
            {/* RAC does not forward `title` to the menu item: the reason sits on the label */}
            <span title={locked ? LOCK_TITLE : undefined}>Delete…</span>
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

/** The confirmation of "Delete…"; render it while `target` is being asked about. */
export function DeleteEntryDialog({
  target,
  onClose,
}: {
  target: MenuTarget;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setPending(true);
    setError(null);
    const res = await deleteEntry(target.dataset, target.slug);
    if (!res.ok) {
      setPending(false);
      setError(res.failure);
      return;
    }
    // stay pending while the page navigates away
    if (target.context === 'detail') location.assign(`/${target.dataset}`);
    else location.reload();
  };

  return (
    <ConfirmDialog
      isOpen
      title={`Delete ${datasetDef(target.dataset).singular} “${target.title}”?`}
      confirmLabel="Delete"
      tone="danger"
      isPending={pending}
      onConfirm={() => void confirm()}
      onCancel={() => {
        if (!pending) onClose();
      }}
      testId="entry-delete-dialog"
    >
      <p>{deleteSummary(target.dataset, target.slug)}</p>
      {error !== null && <ErrorText testId="entry-delete-error">{error}</ErrorText>}
    </ConfirmDialog>
  );
}
