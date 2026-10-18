// DocEditor island (ROUND2_UI_SPEC §F.1): the toolbar (Preview | Edit, path, Save / Cancel, status) and a lazy
// Monaco editor for ONE markdown file, mounted next to the server-rendered `<article id="cx-doc-preview">`.
// The island never receives rendered HTML: it only toggles `hidden` (and `data-stale` after a save) on the SSR
// preview element. Mounted by the okf / skill detail and sub-doc pages with client:only="react".
// Kit parts and src/ui/edit helpers are imported by file (never kit/index.ts: it pulls Monaco statically); the
// editor only through LazyCodeEditor, so the ~4 MB chunk loads when Edit is first pressed.
import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';
import {
  $docConflict,
  $docDirty,
  $docDraft,
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
import { SaveBar } from '../edit/SaveBar.tsx';
import { statusText } from '../edit/status.ts';
import { useUnsavedGuard } from '../edit/useUnsavedGuard.ts';
import { Button, Spinner } from '../kit/Button.tsx';
import { Chip, ChipGroup } from '../kit/Chip.tsx';
import { ConfirmDialog } from '../kit/Dialog.tsx';
import { Toolbar } from '../kit/Toolbar.tsx';

export interface DocEditorProps {
  dataset: DocDataset;
  slug: string;
  /** Bundle-relative posix path: 'main.md', 'SKILL.md' or a sub-doc's `relPath`. */
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
  const stale = useStore($docStale);
  const warnings = useStore($docWarnings);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    initDoc({ dataset, slug, path }, initialEdit);
  }, [dataset, slug, path, initialEdit]);

  useUnsavedGuard(dirty);

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
  useEffect(() => {
    if (!edit) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      void saveDoc();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [edit]);

  function leaveEdit() {
    if (dirty) setConfirmDiscard(true);
    else discardEdit();
  }

  return (
    <>
      <Toolbar className="cx-doctools" aria-label="Document" data-testid="doc-tools">
        <ChipGroup
          label="View"
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[edit ? 'edit' : 'preview']}
          onSelectionChange={(keys) => {
            const key = [...keys][0];
            if (key === 'edit') enterEdit();
            else if (key === 'preview') leaveEdit();
          }}
          data-testid="doc-view-toggle"
        >
          <Chip id="preview" data-testid="doc-view-preview">
            Preview
          </Chip>
          <Chip id="edit" data-testid="doc-view-edit">
            Edit
          </Chip>
        </ChipGroup>
        <code className="cx-doctools__path">{path}</code>
        <span className="cx-doctools__spacer" />
        {edit ? (
          <SaveBar
            status={status}
            canSave={dirty && !saving}
            onSave={() => void saveDoc()}
            onCancel={leaveEdit}
            testIdPrefix="doc"
          />
        ) : (
          <span
            className="cx-savebar__status"
            role="status"
            data-kind={status.kind}
            data-testid="doc-status"
          >
            {statusText(status)}
          </span>
        )}
      </Toolbar>

      {!edit && warnings.length > 0 && (
        <ul
          className="cx-doc__warnings"
          aria-label="Validation warnings"
          data-testid="doc-warnings"
        >
          {warnings.map((w, i) => (
            <li key={`${i}:${w.rule}:${w.message}`} data-severity={w.severity}>
              {w.rule !== '' && <code>{w.rule}</code>}
              {w.line !== undefined && <span className="cx-doc__warnline">line {w.line}</span>}
              <span>{w.message}</span>
            </li>
          ))}
        </ul>
      )}

      {edit && (
        <>
          {restored && load.status === 'ready' && (
            <p className="cx-doc__restored" data-testid="doc-draft-restored">
              Restored unsaved changes from this tab.{' '}
              <Button
                variant="ghost"
                size="sm"
                onPress={discardDraft}
                data-testid="doc-draft-discard"
              >
                Discard
              </Button>
            </p>
          )}
          <div className="cx-doc__editor" data-testid="doc-editor-wrap">
            {load.status === 'error' ? (
              <p className="cx-doc__loaderror" role="alert" data-testid="doc-load-error">
                {load.message ?? 'Could not load the file'}{' '}
                <Button size="sm" onPress={() => void loadDoc()}>
                  Retry
                </Button>
              </p>
            ) : load.status === 'ready' ? (
              <LazyCodeEditor
                language="markdown"
                height={{ mode: 'fill' }}
                value={draft}
                onChange={setDocDraft}
                onSave={() => void saveDoc()}
                readOnly={saving}
                ariaLabel={`Markdown source of ${path}`}
                testId="doc-editor"
              />
            ) : (
              <div className="cx-doc__loading" data-testid="doc-loading">
                <Spinner label="Loading document" />
              </div>
            )}
          </div>
        </>
      )}

      <ConflictDialog
        isOpen={conflict}
        what={path}
        onKeepEditing={keepEditing}
        onLoadTheirs={loadDiskVersion}
        onOverwrite={() => void saveDoc({ force: true })}
        testIdPrefix="doc"
      />
      <ConfirmDialog
        isOpen={confirmDiscard}
        title="Discard unsaved changes?"
        confirmLabel="Discard"
        tone="danger"
        onConfirm={() => {
          setConfirmDiscard(false);
          discardEdit();
        }}
        onCancel={() => setConfirmDiscard(false)}
        testId="doc-discard-dialog"
      >
        Leaving edit mode drops the changes you have not saved.
      </ConfirmDialog>
    </>
  );
}
