// DocEditor island (ROUND2_UI_SPEC §F.1): the toolbar (Preview | Edit, path, Save / Cancel, status) and a lazy
// Monaco editor for ONE markdown file, mounted next to the server-rendered `<article id="cx-doc-preview">`.
// The island never receives rendered HTML: it only toggles `hidden` (and `data-stale` after a save) on the SSR
// preview element. Mounted by the okf / skill detail and sub-doc pages with client:only="react".
// Kit parts and src/ui/edit helpers are imported by file (never kit/index.ts: it pulls Monaco statically); the
// editor only through LazyCodeEditor, so the ~4 MB chunk loads when Edit is first pressed.
// Unsaved text is kept in localStorage by the store, so there is no native `beforeunload` prompt (ROUND3_SPEC §G);
// the in-app discard dialog stays. "Insert link…" (button + Mod+Alt+K in the editor) opens the shared EntryPicker.
import { useStore } from '@nanostores/react';
import { useCallback, useEffect, useState } from 'react';
import {
  $docConflict,
  $docDirty,
  $docDraft,
  $docDraftAvailable,
  $docDraftStale,
  $docEdit,
  $docLoad,
  $docRestored,
  $docSave,
  $docStale,
  $docStatus,
  $docWarnings,
  discardDraft,
  discardEdit,
  enterEdit,
  initDoc,
  keepEditing,
  loadDiskVersion,
  loadDoc,
  saveDoc,
  setDocDraft,
} from '../../stores/doc-editor.ts';
import type { DocDataset } from '../../stores/doc-editor.ts';
import { LazyCodeEditor } from '../editor/LazyCodeEditor.tsx';
import { ConflictDialog } from '../edit/ConflictDialog.tsx';
import { DiscardDialog } from '../edit/DiscardDialog.tsx';
import { DraftNotice } from '../edit/DraftNotice.tsx';
import { SaveBar } from '../edit/SaveBar.tsx';
import { statusText } from '../edit/status.ts';
import { useSaveShortcut } from '../edit/useSaveShortcut.ts';
import { Button } from '../kit/Button.tsx';
import { ChipToggle } from '../kit/Chip.tsx';
import { Loading } from '../kit/Loading.tsx';
import { Notice } from '../kit/Notice.tsx';
import { ErrorText, Status } from '../kit/Status.tsx';
import { Toolbar } from '../kit/Toolbar.tsx';
import { EntryPicker } from '../pickers/EntryPicker.tsx';
import { useInsertLink } from '../pickers/useInsertLink.ts';

export interface DocEditorProps {
  dataset: DocDataset;
  slug: string;
  /** Bundle-relative posix path: 'index.md', 'SKILL.md' or a sub-doc's `relPath`. */
  path: string;
  /** id of the SSR preview element this island shows / hides. */
  previewId: string;
  /** The server's reading of `?edit=1` (the store reads the URL itself; this only avoids a first-paint flip). */
  initialEdit: boolean;
}

export default function DocEditor({ dataset, slug, path, previewId, initialEdit }: DocEditorProps) {
  const edit = useStore($docEdit);
  const load = useStore($docLoad);
  const draft = useStore($docDraft);
  const dirty = useStore($docDirty);
  const status = useStore($docStatus);
  const saving = useStore($docSave).kind === 'saving';
  const conflict = useStore($docConflict);
  const restored = useStore($docRestored);
  const draftStale = useStore($docDraftStale);
  const draftAvailable = useStore($docDraftAvailable);
  const stale = useStore($docStale);
  const warnings = useStore($docWarnings);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const link = useInsertLink();

  useEffect(() => {
    initDoc({ dataset, slug, path }, initialEdit);
  }, [dataset, slug, path, initialEdit]);

  // The SSR preview is an external DOM node: hide it while editing, dim it between a save and the reload.
  useEffect(() => {
    const el = document.getElementById(previewId);
    if (el) el.hidden = edit;
  }, [previewId, edit]);
  useEffect(() => {
    const el = document.getElementById(previewId);
    if (!el) return;
    if (stale) el.dataset.stale = '';
    else delete el.dataset.stale;
  }, [previewId, stale]);

  // Cmd/Ctrl+S outside Monaco (which has its own action) would otherwise open the browser's "save page" dialog.
  const saveDocStable = useCallback(() => {
    void saveDoc();
  }, []);
  useSaveShortcut(saveDocStable, edit);

  function leaveEdit() {
    if (dirty) setConfirmDiscard(true);
    else discardEdit();
  }

  return (
    <>
      <Toolbar className="cx-doctools" aria-label="Document" data-testid="doc-tools">
        <ChipToggle
          label="View"
          value={edit ? 'edit' : 'preview'}
          onChange={(key) => (key === 'edit' ? enterEdit() : leaveEdit())}
          testId="doc-view-toggle"
          options={[
            { id: 'preview', label: 'Preview', testId: 'doc-view-preview' },
            { id: 'edit', label: 'Edit', testId: 'doc-view-edit' },
          ]}
        />
        <code className="cx-doctools__path">{path}</code>
        <span className="cx-doctools__spacer" />
        {edit && (
          <Button
            variant="ghost"
            size="sm"
            onPress={link.open}
            isDisabled={load.status !== 'ready' || saving}
            data-testid="doc-insert-link"
          >
            Insert link…
          </Button>
        )}
        {edit ? (
          <SaveBar
            status={status}
            canSave={dirty && !saving}
            onSave={() => void saveDoc()}
            onCancel={leaveEdit}
            testIdPrefix="doc"
          />
        ) : (
          <Status kind={status.kind} testId="doc-status">
            {statusText(status)}
          </Status>
        )}
      </Toolbar>

      {!edit && draftAvailable && (
        <Notice
          tone="info"
          layout="row"
          className="cx-doc__notice"
          testId="doc-draft-available"
          actions={
            <Button
              variant="secondary"
              size="sm"
              onPress={enterEdit}
              data-testid="doc-draft-resume"
            >
              Resume editing
            </Button>
          }
        >
          Unsaved changes to this file
        </Notice>
      )}

      {!edit && warnings.length > 0 && (
        <Notice tone="warn" role="none" className="cx-doc__warnings">
          <ul aria-label="Validation warnings" data-testid="doc-warnings">
            {warnings.map((w, i) => (
              <li key={`${i}:${w.rule}:${w.message}`}>
                {w.rule !== '' && <code>{w.rule}</code>}
                {w.line !== undefined && <span className="cx-doc__warnline">line {w.line}</span>}
                <span>{w.message}</span>
              </li>
            ))}
          </ul>
        </Notice>
      )}

      {edit && (
        <>
          {restored && load.status === 'ready' && (
            <div className="cx-doc__notice">
              <DraftNotice testIdPrefix="doc" stale={draftStale} onDiscard={discardDraft} />
            </div>
          )}
          <div className="cx-doc__editor" data-testid="doc-editor-wrap">
            {load.status === 'error' ? (
              <ErrorText testId="doc-load-error">
                {load.message ?? 'Could not load the file'}{' '}
                <Button size="sm" onPress={() => void loadDoc()}>
                  Retry
                </Button>
              </ErrorText>
            ) : load.status === 'ready' ? (
              <LazyCodeEditor
                language="markdown"
                height={{ mode: 'fill' }}
                value={draft}
                onChange={setDocDraft}
                onSave={() => void saveDoc()}
                onReady={link.onReady}
                onInsertLink={link.open}
                readOnly={saving}
                ariaLabel={`Markdown source of ${path}`}
                testId="doc-editor"
              />
            ) : (
              <Loading testId="doc-loading" label="Loading document…" />
            )}
          </div>
        </>
      )}

      <EntryPicker title="Insert link to entry" {...link.picker} />
      <ConflictDialog
        isOpen={conflict}
        what={path}
        onKeepEditing={keepEditing}
        onLoadTheirs={loadDiskVersion}
        onOverwrite={() => void saveDoc({ force: true })}
        testIdPrefix="doc"
      />
      <DiscardDialog
        isOpen={confirmDiscard}
        message="Leaving edit mode drops the changes you have not saved."
        onConfirm={() => {
          setConfirmDiscard(false);
          discardEdit();
        }}
        onCancel={() => setConfirmDiscard(false)}
        testId="doc-discard-dialog"
      />
    </>
  );
}
