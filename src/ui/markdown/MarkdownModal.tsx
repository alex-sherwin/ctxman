// Popup editor for ONE small markdown area of a context or recipe (ROUND2_UI_SPEC §F.2): a link's notes, the
// preamble or a markdown block. Loads the CURRENT yaml document when opened (D11), edits only the target text
// in a lazy Monaco editor and saves with a read-modify-write (targets.ts `saveTarget`). After a 200 the page
// reloads: context / recipe yaml is not watched by the dev server, so no reload would come by itself.
// Browser-only; kit parts and src/ui/edit helpers are imported by file, Monaco only through LazyCodeEditor.
import { useEffect, useState } from 'react';
import { LazyCodeEditor } from '../editor/LazyCodeEditor.tsx';
import { ConflictDialog } from '../edit/ConflictDialog.tsx';
import { SaveBar } from '../edit/SaveBar.tsx';
import type { SaveStatus } from '../edit/status.ts';
import { useUnsavedGuard } from '../edit/useUnsavedGuard.ts';
import { Button, Spinner } from '../kit/Button.tsx';
import { ConfirmDialog, Dialog, Modal } from '../kit/Dialog.tsx';
import { loadTarget, saveTarget } from './targets.ts';
import type { LoadedTarget, MdTarget } from './targets.ts';

export interface MarkdownModalProps {
  target: MdTarget;
  /** Close without saving (the parent unmounts the modal). */
  onClose: () => void;
}

type View =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      loaded: LoadedTarget;
      draft: string;
      save: SaveStatus;
      /** Non-null while the ConflictDialog is open: what is on disk now. */
      conflict: LoadedTarget | null;
    };

export function MarkdownModal({ target, onClose }: MarkdownModalProps) {
  const [view, setView] = useState<View>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Load the current document. `attempt` re-runs it (Retry, "Load disk version"); setState only in the callback.
  useEffect(() => {
    let live = true;
    void loadTarget(target).then((result) => {
      if (!live) return;
      setView(
        result.ok
          ? {
              status: 'ready',
              loaded: result.loaded,
              draft: result.loaded.text,
              save: { kind: 'idle' },
              conflict: null,
            }
          : { status: 'error', message: result.message },
      );
    });
    return () => {
      live = false;
    };
  }, [target, attempt]);

  const ready = view.status === 'ready' ? view : null;
  const dirty = ready !== null && ready.draft !== ready.loaded.text;
  const saving = ready?.save.kind === 'saving';
  const saved = ready?.save.kind === 'saved';

  // Declared before the reload effect below: when `saved` flips, the guard is removed first (React runs all
  // cleanups of a commit before any new effect), so the reload does not trigger a "leave site?" prompt.
  useUnsavedGuard(dirty && !saved);
  useEffect(() => {
    if (saved) location.reload();
  }, [saved]);

  function update(
    patch: (v: Extract<View, { status: 'ready' }>) => Extract<View, { status: 'ready' }>,
  ) {
    setView((v) => (v.status === 'ready' ? patch(v) : v));
  }

  async function save(force = false) {
    if (ready === null || ready.save.kind === 'saving') return;
    update((v) => ({ ...v, save: { kind: 'saving' }, conflict: null }));
    const result = await saveTarget(target, ready.loaded, ready.draft, { force });
    if (result.ok) {
      update((v) => ({ ...v, loaded: { ...v.loaded, text: v.draft }, save: { kind: 'saved' } }));
    } else if (result.kind === 'conflict') {
      update((v) => ({
        ...v,
        save: { kind: 'conflict', message: 'Changed on disk' },
        conflict: result.fresh,
      }));
    } else {
      update((v) => ({
        ...v,
        save: { kind: 'error', message: `Save failed: ${result.message}` },
      }));
    }
  }

  function cancel() {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }

  const status: SaveStatus =
    ready === null
      ? { kind: 'idle' }
      : ready.save.kind === 'idle' && dirty
        ? { kind: 'dirty' }
        : ready.save;

  return (
    <>
      <Modal
        isOpen
        isDismissable={!dirty}
        onOpenChange={(open) => {
          if (!open) cancel();
        }}
        className="cx-mdmodal"
        testId="md-modal"
      >
        <Dialog
          title={`Edit ${target.label}`}
          footer={
            <SaveBar
              status={status}
              canSave={dirty && !saving}
              onSave={() => void save()}
              onCancel={cancel}
              testIdPrefix="md"
            />
          }
        >
          {view.status === 'loading' && (
            <div className="cx-mdmodal__loading" data-testid="md-loading">
              <Spinner label="Loading" />
            </div>
          )}
          {view.status === 'error' && (
            <p className="cx-mdmodal__error" role="alert" data-testid="md-load-error">
              {view.message}{' '}
              <Button
                size="sm"
                onPress={() => {
                  setView({ status: 'loading' });
                  setAttempt((n) => n + 1);
                }}
              >
                Retry
              </Button>
            </p>
          )}
          {ready !== null && (
            <LazyCodeEditor
              language="markdown"
              compact={false}
              height={{ mode: 'auto', minLines: 10, maxLines: 28 }}
              value={ready.draft}
              onChange={(draft) =>
                update((v) => ({
                  ...v,
                  draft,
                  save:
                    v.save.kind === 'idle' || v.save.kind === 'saving' ? v.save : { kind: 'idle' },
                }))
              }
              onSave={() => void save()}
              onReady={(api) => api.focus()}
              readOnly={saving}
              ariaLabel={target.label}
              testId="md-editor"
            />
          )}
        </Dialog>
      </Modal>
      <ConflictDialog
        isOpen={ready?.conflict != null}
        what={target.label}
        onKeepEditing={() => update((v) => ({ ...v, conflict: null }))}
        onLoadTheirs={() => {
          setView({ status: 'loading' });
          setAttempt((n) => n + 1);
        }}
        onOverwrite={() => void save(true)}
        testIdPrefix="md"
      />
      <ConfirmDialog
        isOpen={confirmDiscard}
        title="Discard unsaved changes?"
        confirmLabel="Discard"
        tone="danger"
        onConfirm={() => {
          setConfirmDiscard(false);
          onClose();
        }}
        onCancel={() => setConfirmDiscard(false)}
        testId="md-discard-dialog"
      >
        Closing the editor drops the changes you have not saved.
      </ConfirmDialog>
    </>
  );
}
