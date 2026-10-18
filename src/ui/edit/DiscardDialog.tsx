// The "Discard unsaved changes?" confirm shared by every island that has unsaved edits. Browser-only; kit by file.
import { ConfirmDialog } from '../kit/Dialog.tsx';

export interface DiscardDialogProps {
  isOpen: boolean;
  onConfirm(): void;
  onCancel(): void;
  testId: string;
  /** Dialog title. Default 'Discard unsaved changes?'. */
  title?: string;
  /** Body text. Default 'This drops the changes you have not saved.'. */
  message?: string;
  /** Default 'Cancel'; DataForm passes 'Keep editing'. */
  cancelLabel?: string;
}

export function DiscardDialog({
  isOpen,
  onConfirm,
  onCancel,
  testId,
  title = 'Discard unsaved changes?',
  message = 'This drops the changes you have not saved.',
  cancelLabel,
}: DiscardDialogProps) {
  return (
    <ConfirmDialog
      isOpen={isOpen}
      title={title}
      confirmLabel="Discard"
      cancelLabel={cancelLabel}
      tone="danger"
      onConfirm={onConfirm}
      onCancel={onCancel}
      testId={testId}
    >
      {message}
    </ConfirmDialog>
  );
}
