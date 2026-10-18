// "Changed on disk" dialog for an optimistic-concurrency 409 (`ifUnmodifiedSince`), shared by DocEditor,
// MarkdownModal and DataForm (ROUND2_UI_SPEC §C.2). Esc / outside click = keep editing.
import { Button } from '../kit/Button.tsx';
import { Dialog, Modal } from '../kit/Dialog.tsx';

export interface ConflictDialogProps {
  isOpen: boolean;
  /** What changed, shown in code font: a file name or entry ("index.md", "context/ctxman-dev"). */
  what: string;
  /** Discard my edits and load the disk version. */
  onLoadTheirs: () => void;
  /** Save my version over the disk version (an unconditional write). */
  onOverwrite: () => void;
  onKeepEditing: () => void;
  /** Test ids: `${p}-conflict-dialog` (modal), `${p}-conflict-cancel|reload|overwrite` (buttons). */
  testIdPrefix: string;
}

export function ConflictDialog({
  isOpen,
  what,
  onLoadTheirs,
  onOverwrite,
  onKeepEditing,
  testIdPrefix,
}: ConflictDialogProps) {
  return (
    <Modal
      isOpen={isOpen}
      isDismissable
      onOpenChange={(open) => {
        if (!open) onKeepEditing();
      }}
      tone="danger"
      testId={`${testIdPrefix}-conflict-dialog`}
    >
      <Dialog
        role="alertdialog"
        title="Changed on disk"
        footer={
          <>
            <Button
              variant="secondary"
              autoFocus
              onPress={onKeepEditing}
              data-testid={`${testIdPrefix}-conflict-cancel`}
            >
              Keep editing
            </Button>
            <Button onPress={onLoadTheirs} data-testid={`${testIdPrefix}-conflict-reload`}>
              Load disk version
            </Button>
            <Button
              variant="danger"
              onPress={onOverwrite}
              data-testid={`${testIdPrefix}-conflict-overwrite`}
            >
              Overwrite
            </Button>
          </>
        }
      >
        <p>
          <code>{what}</code> changed since you started editing.
        </p>
        <p className="cx-subtle">
          Overwrite replaces the version on disk with yours. Load disk version discards your edits.
        </p>
      </Dialog>
    </Modal>
  );
}
