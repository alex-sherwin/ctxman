import type { ReactNode } from 'react';
import {
  Dialog as AriaDialog,
  Heading,
  Modal as AriaModal,
  ModalOverlay,
  type DialogProps as AriaDialogProps,
  type ModalOverlayProps,
} from 'react-aria-components';
import { Button } from './Button.tsx';
import { cx } from './utils.ts';

export interface ModalProps extends Omit<ModalOverlayProps, 'className'> {
  /** 'fullscreen' is the global search overlay. Default 'dialog'. */
  variant?: 'dialog' | 'fullscreen';
  /** Border/title accent. Default 'accent'. */
  tone?: 'accent' | 'danger';
  /**
   * 'auto' (default) sizes to the content: small confirms and two-field forms. 'large' is a fixed
   * min(60rem, 90vw) x 80vh box for dialogs with a list, an editor or a longer form, so filtering or
   * switching content never changes its size (the body scrolls inside). Ignored by 'fullscreen'.
   */
  size?: 'auto' | 'large';
  className?: string;
  /** `data-testid` of the `.ck-modal` element. */
  testId?: string;
  /** Spread on the `.ck-modal` element (`data-*` only). */
  attrs?: Record<`data-${string}`, string | undefined>;
}

/** ModalOverlay + Modal with the kit classes. Focus trap, Esc, scroll lock and focus restore are RAC's. */
export function Modal({
  variant = 'dialog',
  tone = 'accent',
  size = 'auto',
  className,
  testId,
  attrs,
  children,
  ...rest
}: ModalProps) {
  const fullscreen = variant === 'fullscreen';
  return (
    <ModalOverlay
      {...rest}
      className={cx('ck-modal-overlay', fullscreen && 'ck-modal-overlay--fullscreen')}
    >
      <AriaModal
        className={cx(
          'ck-modal',
          fullscreen && 'ck-modal--fullscreen',
          !fullscreen && size === 'large' && 'ck-modal--large',
          tone === 'danger' && 'ck-modal--danger',
          className,
        )}
        data-testid={testId}
        {...attrs}
      >
        {children}
      </AriaModal>
    </ModalOverlay>
  );
}

export interface DialogProps extends AriaDialogProps {
  /** Renders the header (`Heading slot="title"`) only when given. */
  title?: ReactNode;
  /** Renders the footer only when given. */
  footer?: ReactNode;
  bodyClassName?: string;
}

export function Dialog({
  title,
  footer,
  bodyClassName,
  className,
  children,
  ...rest
}: DialogProps) {
  return (
    <AriaDialog {...rest} className={cx('ck-dialog', className)}>
      {(rp) => (
        <>
          {title != null && (
            <header className="ck-dialog__header">
              <Heading slot="title" className="ck-dialog__title">
                {title}
              </Heading>
            </header>
          )}
          <div className={cx('ck-dialog__body', bodyClassName)}>
            {typeof children === 'function' ? children(rp) : children}
          </div>
          {footer != null && <footer className="ck-dialog__footer">{footer}</footer>}
        </>
      )}
    </AriaDialog>
  );
}

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** Default 'Cancel'. */
  cancelLabel?: string;
  /** Default 'primary'. */
  tone?: 'danger' | 'primary';
  isPending?: boolean;
  onConfirm(): void;
  onCancel(): void;
  testId?: string;
}

/** Dismissable `alertdialog`; autofocus lands on Cancel. Esc / outside click call `onCancel`. */
export function ConfirmDialog({
  isOpen,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'primary',
  isPending,
  onConfirm,
  onCancel,
  testId,
}: ConfirmDialogProps) {
  return (
    <Modal
      isOpen={isOpen}
      isDismissable
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      tone={tone === 'danger' ? 'danger' : 'accent'}
      testId={testId}
    >
      <Dialog
        role="alertdialog"
        title={title}
        footer={
          <>
            <Button variant="secondary" autoFocus onPress={onCancel}>
              {cancelLabel}
            </Button>
            <Button variant={tone} isPending={isPending} onPress={onConfirm}>
              {confirmLabel}
            </Button>
          </>
        }
      >
        {children}
      </Dialog>
    </Modal>
  );
}

export interface FormDialogFooterProps {
  /** `id` of the `<Form>` the submit button belongs to. */
  formId: string;
  submitLabel: string;
  onCancel: () => void;
  /** Default 'Cancel'. */
  cancelLabel?: string;
  isDisabled?: boolean;
  isPending?: boolean;
  cancelTestId: string;
  submitTestId: string;
}

/** The Cancel + submit pair of a form dialog; the submit button is bound to the form by `formId`. */
export function FormDialogFooter({
  formId,
  submitLabel,
  onCancel,
  cancelLabel = 'Cancel',
  isDisabled,
  isPending,
  cancelTestId,
  submitTestId,
}: FormDialogFooterProps) {
  return (
    <>
      <Button variant="secondary" onPress={onCancel} data-testid={cancelTestId}>
        {cancelLabel}
      </Button>
      <Button
        variant="primary"
        type="submit"
        form={formId}
        isDisabled={isDisabled}
        isPending={isPending}
        data-testid={submitTestId}
      >
        {submitLabel}
      </Button>
    </>
  );
}
