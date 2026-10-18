// Popup editor for ONE small markdown area of a context or recipe (ROUND2_UI_SPEC §F.2): a link's notes, the
// preamble or a markdown block. Loads the CURRENT yaml document when opened (D11), edits only the target text
// in a lazy Monaco editor and saves with a read-modify-write (targets.ts `saveTarget`). After a 200 the page
// reloads: context / recipe yaml is not watched by the dev server, so no reload would come by itself.
// Unsaved text is kept in localStorage on every change (key `md:<endpoint>#<target id>`, base = the loaded
// `lastModified`) and restored, with a banner, the next time the same popup is opened: no native `beforeunload`
// prompt (ROUND3_SPEC §G), the in-app discard dialog stays. A toolbar button (and Mod+Alt+K in the editor)
// inserts a link to an entry through the shared EntryPicker.
// Browser-only; kit parts and src/ui/edit helpers are imported by file, Monaco only through LazyCodeEditor.
import { useCallback, useEffect, useRef, useState } from 'react';
import { LazyCodeEditor } from '../editor/LazyCodeEditor.tsx';
import { ConflictDialog } from '../edit/ConflictDialog.tsx';
import { clearDraft, loadDraft, saveDraft } from '../edit/draft-backup.ts';
import { DiscardDialog } from '../edit/DiscardDialog.tsx';
import { DraftNotice } from '../edit/DraftNotice.tsx';
import { SaveBar } from '../edit/SaveBar.tsx';
import type { SaveStatus } from '../edit/status.ts';
import { useSaveShortcut } from '../edit/useSaveShortcut.ts';
import { Button } from '../kit/Button.tsx';
import { Dialog, Modal } from '../kit/Dialog.tsx';
import { Loading } from '../kit/Loading.tsx';
import { ErrorText } from '../kit/Status.tsx';
import { Toolbar } from '../kit/Toolbar.tsx';
import { EntryPicker } from '../pickers/EntryPicker.tsx';
import { useInsertLink } from '../pickers/useInsertLink.ts';
import { mdDraftKey, planRestore } from './draft-restore.ts';
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
      /** The draft came back from localStorage (banner); `draftStale`: the file changed on disk since. */
      restored: boolean;
      draftStale: boolean;
      save: SaveStatus;
      /** Non-null while the ConflictDialog is open: what is on disk now. */
      conflict: LoadedTarget | null;
    };

export function MarkdownModal({ target, onClose }: MarkdownModalProps) {
  const [view, setView] = useState<View>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const link = useInsertLink();
  const draftKey = mdDraftKey(target);

  // Load the current document. `attempt` re-runs it (Retry, "Load disk version"); setState only in the callback.
  // A stored draft is restored when it differs from the loaded text (stale when the file changed since).
  useEffect(() => {
    let live = true;
    void loadTarget(target).then((result) => {
      if (!live) return;
      if (!result.ok) {
        setView({ status: 'error', message: result.message });
        return;
      }
      const { loaded } = result;
      const backup = loadDraft(draftKey);
      const plan = planRestore(backup, loaded);
      if (backup !== null && !plan.restored) clearDraft(draftKey);
      setView({
        status: 'ready',
        loaded,
        draft: plan.text,
        restored: plan.restored,
        draftStale: plan.stale,
        save: { kind: 'idle' },
        conflict: null,
      });
    });
    return () => {
      live = false;
    };
  }, [target, draftKey, attempt]);

  const ready = view.status === 'ready' ? view : null;
  const dirty = ready !== null && ready.draft !== ready.loaded.text;
  const saving = ready?.save.kind === 'saving';

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
      clearDraft(draftKey);
      update((v) => ({
        ...v,
        loaded: { ...v.loaded, text: v.draft },
        restored: false,
        draftStale: false,
        save: { kind: 'saved' },
      }));
      // context / recipe yaml is not watched by the dev server: no reload comes by itself
      location.reload();
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

  /** The editor text changed: mirror it to localStorage (or drop the backup when it is back to the saved text). */
  function edited(draft: string) {
    if (ready !== null) {
      if (draft !== ready.loaded.text) {
        saveDraft(draftKey, { text: draft, base: ready.loaded.lastModified });
      } else {
        clearDraft(draftKey);
      }
    }
    update((v) => ({
      ...v,
      draft,
      save: v.save.kind === 'idle' || v.save.kind === 'saving' ? v.save : { kind: 'idle' },
    }));
  }

  /** The restored-draft banner's Discard: back to the loaded text, backup removed. */
  function discardRestored() {
    clearDraft(draftKey);
    update((v) => ({ ...v, draft: v.loaded.text, restored: false, draftStale: false }));
  }

  // Cmd/Ctrl+S anywhere in the popup (outside Monaco it would open the browser's "save page" dialog).
  const saveRef = useRef<() => void>(() => {});
  useEffect(() => {
    saveRef.current = () => void save();
  });
  const saveStable = useCallback(() => saveRef.current(), []);
  useSaveShortcut(saveStable, ready !== null && !saving);

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
        size="large"
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
              statusFirst
            />
          }
        >
          {view.status === 'loading' && <Loading testId="md-loading" />}
          {view.status === 'error' && (
            <ErrorText testId="md-load-error">
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
            </ErrorText>
          )}
          {ready !== null && (
            <>
              {ready.restored && (
                <DraftNotice
                  testIdPrefix="md"
                  stale={ready.draftStale}
                  onDiscard={discardRestored}
                />
              )}
              <Toolbar className="cx-mdmodal__tools" aria-label="Editor tools">
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={link.open}
                  isDisabled={saving}
                  data-testid="md-insert-link"
                >
                  Insert link…
                </Button>
              </Toolbar>
              <LazyCodeEditor
                language="markdown"
                compact={false}
                height={{ mode: 'fill' }}
                value={ready.draft}
                onChange={edited}
                onSave={() => void save()}
                onReady={(api) => {
                  link.onReady(api);
                  api.focus();
                }}
                onInsertLink={link.open}
                readOnly={saving}
                ariaLabel={target.label}
                testId="md-editor"
              />
            </>
          )}
        </Dialog>
      </Modal>
      <EntryPicker title="Insert link to entry" {...link.picker} />
      <ConflictDialog
        isOpen={ready?.conflict != null}
        what={target.label}
        onKeepEditing={() => update((v) => ({ ...v, conflict: null }))}
        onLoadTheirs={() => {
          clearDraft(draftKey);
          setView({ status: 'loading' });
          setAttempt((n) => n + 1);
        }}
        onOverwrite={() => void save(true)}
        testIdPrefix="md"
      />
      <DiscardDialog
        isOpen={confirmDiscard}
        message="Closing the editor drops the changes you have not saved."
        onConfirm={() => {
          setConfirmDiscard(false);
          clearDraft(draftKey);
          onClose();
        }}
        onCancel={() => setConfirmDiscard(false)}
        testId="md-discard-dialog"
      />
    </>
  );
}
