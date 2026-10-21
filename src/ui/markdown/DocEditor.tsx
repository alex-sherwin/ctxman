// DocEditor island (ROUND2_UI_SPEC §F.1): the toolbar (Preview | Edit, Delete on okf sub-doc pages, path, Copy,
// Save / Cancel, status) and a lazy Monaco editor for ONE markdown file, mounted next to the server-rendered
// `<article id="cx-doc-preview">`.
// The island never receives rendered HTML: it only toggles `hidden` (and `data-stale` after a save) on the SSR
// preview element. Mounted by the okf / skill detail and sub-doc pages with client:only="react".
// Kit parts and src/ui/edit helpers are imported by file (never kit/index.ts: it pulls Monaco statically); the
// editor only through LazyCodeEditor, so the ~4 MB chunk loads when Edit is first pressed.
// Unsaved text is mirrored to localStorage by the store and every way out asks first: the Preview toggle, Cancel,
// Back / Forward and link clicks show the in-app "Discard unsaved changes?" dialog (`requestLeave`, `$docLeave`), and
// whatever else unloads the page (reload, closing the tab) the browser's prompt (`useUnsavedGuard`).
// "Insert link…" (button + Mod+Alt+K in the editor) opens the shared EntryPicker. Copy (never locked) copies the
// markdown without its frontmatter: the page's `body` in preview, the editor text (frontmatter stripped) while editing;
// its arrow menu copies that same text converted (MarkdownCopyButton: "Copy as JIRA Markup").
import { useStore } from '@nanostores/react';
import { useCallback, useEffect, useRef } from 'react';
import { OKF_ENTRY_FILE } from '../../datasets/registry.ts';
import { stripFrontmatter, trimLeadingBlankLines } from '../../lib/frontmatter-patch.ts';
import { EDIT_SHORTCUT_EVENT } from '../../lib/shortcuts.ts';
import {
  $docConflict,
  $docLeave,
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
  cancelLeave,
  confirmLeave,
  discardDraft,
  enterEdit,
  initDoc,
  keepEditing,
  loadDiskVersion,
  loadDoc,
  requestLeave,
  saveDoc,
  setDocDraft,
} from '../../stores/doc-editor.ts';
import type { DocDataset } from '../../stores/doc-editor.ts';
import type { CodeEditorApi } from '../editor/CodeEditor.tsx';
import { LazyCodeEditor } from '../editor/LazyCodeEditor.tsx';
import { ConflictDialog } from '../edit/ConflictDialog.tsx';
import { DiscardDialog } from '../edit/DiscardDialog.tsx';
import { leavingHref } from '../edit/leave-link.ts';
import { DraftNotice } from '../edit/DraftNotice.tsx';
import { SaveBar } from '../edit/SaveBar.tsx';
import { statusText } from '../edit/status.ts';
import { useSaveShortcut } from '../edit/useSaveShortcut.ts';
import { useUnsavedGuard } from '../edit/useUnsavedGuard.ts';
import { useViewportFill } from '../edit/useViewportFill.ts';
import { Button } from '../kit/Button.tsx';
import { ChipToggle } from '../kit/Chip.tsx';
import { Loading } from '../kit/Loading.tsx';
import { Notice } from '../kit/Notice.tsx';
import { ErrorText, Status } from '../kit/Status.tsx';
import { Toolbar } from '../kit/Toolbar.tsx';
import { EntryPicker } from '../pickers/EntryPicker.tsx';
import { useInsertLink } from '../pickers/useInsertLink.ts';
import { DeleteDocButton } from './DeleteDocButton.tsx';
import { MarkdownCopyButton } from './MarkdownCopyButton.tsx';

export interface DocEditorProps {
  dataset: DocDataset;
  slug: string;
  /** Bundle-relative posix path: 'index.md', 'SKILL.md' or a sub-doc's `relPath`. */
  path: string;
  /** id of the SSR preview element this island shows / hides. */
  previewId: string;
  /** The server's reading of `?edit=1` (the store reads the URL itself; this only avoids a first-paint flip). */
  initialEdit: boolean;
  /** The file's markdown body as the page rendered it (frontmatter split off): what Copy copies in preview. */
  body: string;
}

export default function DocEditor({
  dataset,
  slug,
  path,
  previewId,
  initialEdit,
  body,
}: DocEditorProps) {
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
  const leave = useStore($docLeave);
  const link = useInsertLink();
  // Set by the `e` shortcut: the editor takes the focus once it has loaded, so typing can start right away.
  const focusWhenReady = useRef(false);
  // The editor box ends at the bottom of the viewport, whatever the page shows above it.
  const editorBox = useRef<HTMLDivElement>(null);
  useViewportFill(editorBox, edit, '.cx-detail__main');

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

  // `e` (the Shortcuts island, src/lib/shortcuts.ts): Preview -> Edit. Taken in edit mode too, where it does nothing.
  useEffect(() => {
    const onEditShortcut = (event: Event) => {
      event.preventDefault();
      if ($docEdit.get()) return;
      focusWhenReady.current = true;
      enterEdit();
    };
    window.addEventListener(EDIT_SHORTCUT_EVENT, onEditShortcut);
    return () => window.removeEventListener(EDIT_SHORTCUT_EVENT, onEditShortcut);
  }, []);

  function onEditorReady(api: CodeEditorApi) {
    link.onReady(api);
    if (focusWhenReady.current) {
      focusWhenReady.current = false;
      api.focus();
    }
  }

  // Unsaved text: the browser asks before anything unloads the page; a click on a link asks in-app first.
  const unsaved = edit && dirty;
  useUnsavedGuard(unsaved);
  useEffect(() => {
    if (!unsaved) return;
    const onClick = (event: MouseEvent) => {
      const href = leavingHref(event, location.href);
      if (href === null) return;
      event.preventDefault();
      requestLeave({ kind: 'link', href });
    };
    // Bubble phase on window: handlers that keep the click on the page (the search trigger) have run already.
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [unsaved]);

  function leaveEdit() {
    requestLeave({ kind: 'preview' });
  }

  // Read at press time: the editor text while it is loaded, else the file as the page rendered it.
  const copyText = () =>
    edit && load.status === 'ready' ? stripFrontmatter(draft) : trimLeadingBlankLines(body);

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
        {/* any okf bundle file but the entry index.md (the whole bundle: the ⋯ menu of the entry page) */}
        {dataset !== 'skill' && path !== OKF_ENTRY_FILE && (
          <DeleteDocButton target={{ dataset, slug, path }} locked={edit} />
        )}
        <code className="cx-doctools__path">{path}</code>
        <MarkdownCopyButton text={copyText} data-testid="doc-copy" />
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
          <div className="cx-doc__editor" ref={editorBox} data-testid="doc-editor-wrap">
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
                onReady={onEditorReady}
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
        isOpen={leave !== null}
        message={
          leave?.kind === 'link'
            ? 'Leaving this page drops the changes you have not saved.'
            : 'Leaving edit mode drops the changes you have not saved.'
        }
        onConfirm={confirmLeave}
        onCancel={cancelLeave}
        testId="doc-discard-dialog"
      />
    </>
  );
}
