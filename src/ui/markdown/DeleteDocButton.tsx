// "Delete" of an okf sub-doc page (any bundle file but the entry index.md, which is the whole bundle: the `⋯` menu):
// a quiet ghost button in the DocEditor toolbar, red on hover, behind a confirmation. DELETE /api/doc removes the file,
// then the browser goes to the entry page, which shows "Deleted <path>" (and the links left pointing at it).
// Monaco-free; kit parts by file.
import { useState } from 'react';
import { docKey, docUrl } from '../../stores/doc-editor.ts';
import type { DocTarget } from '../../stores/doc-editor.ts';
import { failureText, sendJson } from '../edit/api.ts';
import { clearDraft } from '../edit/draft-backup.ts';
import { rememberSave } from '../edit/last-save.ts';
import { allowUnload } from '../edit/unload-guard.ts';
import { STATUS_KEY } from '../entry/after-write.ts';
import { LOCK_TITLE } from '../entry/entry-actions.ts';
import { Button } from '../kit/Button.tsx';
import { ConfirmDialog } from '../kit/Dialog.tsx';
import { ErrorText } from '../kit/Status.tsx';
import { deleteDocMessage, deleteDocSummary } from './delete-doc.ts';
import type { DocDeletedBody } from './delete-doc.ts';

export interface DeleteDocButtonProps {
  target: DocTarget;
  /** The editor is open: leave it first. */
  locked: boolean;
}

export function DeleteDocButton({ target, locked }: DeleteDocButtonProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setPending(true);
    setError(null);
    const res = await sendJson<DocDeletedBody>('DELETE', docUrl(target));
    if (!res.ok) {
      setPending(false);
      setError(failureText(res));
      return;
    }
    clearDraft(docKey(target));
    rememberSave(
      STATUS_KEY(target.dataset, target.slug),
      deleteDocMessage(target.dataset, target.slug, res.body),
    );
    allowUnload();
    // stays pending while the page navigates away
    location.assign(res.body.url);
  }

  return (
    <>
      <Button
        variant="ghost"
        tone="danger"
        size="sm"
        isDisabled={locked}
        onPress={() => setOpen(true)}
        data-testid="doc-delete"
      >
        {/* a disabled button shows no tooltip of its own: the reason sits on the label */}
        <span title={locked ? LOCK_TITLE : `Delete ${target.path}`}>Delete</span>
      </Button>
      <ConfirmDialog
        isOpen={open}
        title={`Delete ${target.path}?`}
        confirmLabel="Delete"
        tone="danger"
        isPending={pending}
        onConfirm={() => void confirm()}
        onCancel={() => {
          if (pending) return;
          setOpen(false);
          setError(null);
        }}
        testId="doc-delete-dialog"
      >
        <p>{deleteDocSummary(target.dataset, target.slug, target.path)}</p>
        {error !== null && <ErrorText testId="doc-delete-error">{error}</ErrorText>}
      </ConfirmDialog>
    </>
  );
}
