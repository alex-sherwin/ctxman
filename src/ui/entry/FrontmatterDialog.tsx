// "Edit details" dialog of an okf / skill entry (ROUND3_SPEC §E.5): the frontmatter keys title, description, tags,
// state, stale_after and status (a skill: description only). Loads the current frontmatter when opened
// (GET /api/entry), saves ONLY the changed keys with an explicit Save (PATCH, `ifUnmodifiedSince` = the loaded
// mtime). 400 `invalid` puts the server's issues on their fields; 409 shows "Changed on disk" with a Reload
// button that re-reads the file (my edits in the dialog are dropped). Browser-only; kit parts by file.
import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Form } from 'react-aria-components';
import { datasetDef } from '../../datasets/registry.ts';
import type { LinkableDatasetId } from '../../datasets/registry.ts';
import { SaveBar } from '../edit/SaveBar.tsx';
import type { SaveStatus } from '../edit/status.ts';
import { TagEditor } from '../edit/TagEditor.tsx';
import { Button, Spinner } from '../kit/Button.tsx';
import { ConfirmDialog, Dialog, Modal } from '../kit/Dialog.tsx';
import { TextField } from '../kit/Field.tsx';
import { ListBoxItem } from '../kit/ListBox.tsx';
import { Select } from '../kit/Select.tsx';
import { getEntry, patchEntry } from './entry-api.ts';
import {
  daysFromToday,
  draftFromFrontmatter,
  draftProblems,
  frontmatterPatch,
  issuesToFields,
  OKF_STATUS_VALUES,
} from './entry-helpers.ts';
import type { FieldErrors, FrontmatterDraft, FrontmatterField } from './entry-helpers.ts';

export interface FrontmatterDialogProps {
  dataset: LinkableDatasetId;
  slug: string;
  kind: 'okf' | 'skill';
  onClose: () => void;
  /** The PATCH answered 200; the parent closes the dialog and reloads the page. */
  onSaved: (message: string) => void;
}

type Ready = {
  status: 'ready';
  /** ISO mtime of the file when it was read: sent back as `ifUnmodifiedSince`. */
  lastModified: string;
  base: FrontmatterDraft;
  draft: FrontmatterDraft;
  save: SaveStatus;
  /** Server issues by field (cleared as the field is edited). */
  serverErrors: FieldErrors;
  /** Problems without a field, shown as a list. */
  other: string[];
  conflict: boolean;
};

type View = { status: 'loading' } | { status: 'error'; message: string } | Ready;

const NO_STATUS = 'none';
const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  stable: 'Stable',
  deprecated: 'Deprecated',
};

export function FrontmatterDialog({
  dataset,
  slug,
  kind,
  onClose,
  onSaved,
}: FrontmatterDialogProps) {
  const [view, setView] = useState<View>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const states = datasetDef(dataset).states;

  // (Re)load the frontmatter; `attempt` re-runs it (Retry, Reload after a conflict). setState only in the callback.
  useEffect(() => {
    let live = true;
    void getEntry(dataset, slug).then((res) => {
      if (!live) return;
      if (!res.ok) {
        setView({ status: 'error', message: res.message });
        return;
      }
      const base = draftFromFrontmatter(res.body.frontmatter);
      setView({
        status: 'ready',
        lastModified: res.body.lastModified,
        base,
        draft: { ...base, tags: [...base.tags] },
        save: { kind: 'idle' },
        serverErrors: {},
        other: [],
        conflict: false,
      });
    });
    return () => {
      live = false;
    };
  }, [dataset, slug, attempt]);

  const ready = view.status === 'ready' ? view : null;
  const patch =
    ready === null ? {} : frontmatterPatch(kind, states !== undefined, ready.base, ready.draft);
  const problems = ready === null ? {} : draftProblems(kind, ready.draft);
  const dirty = Object.keys(patch).length > 0;
  const saving = ready?.save.kind === 'saving';
  const canSave = ready !== null && dirty && Object.keys(problems).length === 0 && !saving;

  function update(change: (v: Ready) => Ready) {
    setView((v) => (v.status === 'ready' ? change(v) : v));
  }

  function edit(change: Partial<FrontmatterDraft>, field: FrontmatterField) {
    update((v) => {
      const serverErrors = { ...v.serverErrors };
      delete serverErrors[field];
      return {
        ...v,
        draft: { ...v.draft, ...change },
        serverErrors,
        save: v.save.kind === 'idle' || v.save.kind === 'saving' ? v.save : { kind: 'idle' },
      };
    });
  }

  async function save() {
    if (ready === null || !canSave) return;
    update((v) => ({
      ...v,
      save: { kind: 'saving' },
      serverErrors: {},
      other: [],
      conflict: false,
    }));
    const res = await patchEntry(dataset, slug, {
      ...patch,
      ifUnmodifiedSince: ready.lastModified,
    });
    if (res.ok) {
      onSaved('Saved details');
      return;
    }
    if (res.status === 409) {
      update((v) => ({
        ...v,
        save: { kind: 'conflict', message: 'Changed on disk' },
        conflict: true,
      }));
    } else if (res.error === 'invalid') {
      const { fields, other } = issuesToFields(res.issues ?? []);
      update((v) => ({
        ...v,
        save: { kind: 'error', message: 'Not saved: fix the marked fields' },
        serverErrors: fields,
        other: other.length === 0 && Object.keys(fields).length === 0 ? [res.message] : other,
      }));
    } else {
      update((v) => ({
        ...v,
        save: { kind: 'error', message: 'Save failed' },
        other: [res.message],
      }));
    }
  }

  function cancel() {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }

  function reload() {
    setView({ status: 'loading' });
    setAttempt((n) => n + 1);
  }

  const status: SaveStatus =
    ready === null
      ? { kind: 'idle' }
      : ready.save.kind === 'idle' && dirty
        ? { kind: 'dirty' }
        : ready.save;

  function onSaveShortcut(e: KeyboardEvent<HTMLDivElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save();
    }
  }

  const shown = (field: FrontmatterField): string | undefined =>
    problems[field] ?? ready?.serverErrors[field];

  return (
    <>
      <Modal
        isOpen
        isDismissable={!dirty}
        onOpenChange={(open) => {
          if (!open) cancel();
        }}
        size="large"
        className="cx-fm"
        testId="fm-dialog"
      >
        <Dialog
          title={kind === 'skill' ? 'Edit skill details' : 'Edit details'}
          footer={
            <SaveBar
              status={status}
              canSave={canSave}
              onSave={() => void save()}
              onCancel={cancel}
              testIdPrefix="fm"
            />
          }
        >
          {view.status === 'loading' && (
            <div className="cx-fm__loading" data-testid="fm-loading">
              <Spinner label="Loading" />
            </div>
          )}
          {view.status === 'error' && (
            <p className="cx-fm__loaderror" role="alert" data-testid="fm-load-error">
              {view.message}{' '}
              <Button size="sm" onPress={reload}>
                Retry
              </Button>
            </p>
          )}
          {ready !== null && (
            // Cmd/Ctrl+S saves (the SaveBar tooltip promises it); the wrapper only listens, it has no box
            <div className="cx-fm__keys" onKeyDown={onSaveShortcut}>
              <Form
                className="cx-fm__form"
                validationBehavior="aria"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                {kind === 'okf' && (
                  <TextField
                    label="Title"
                    value={ready.draft.title}
                    onChange={(title) => edit({ title }, 'title')}
                    isInvalid={shown('title') !== undefined}
                    errorMessage={shown('title')}
                    description="Display title. Empty = use the name."
                    inputTestId="fm-title"
                  />
                )}
                <TextField
                  label="Description"
                  isRequired
                  value={ready.draft.description}
                  onChange={(description) => edit({ description }, 'description')}
                  isInvalid={shown('description') !== undefined}
                  errorMessage={shown('description')}
                  description="One line: what this is."
                  inputTestId="fm-description"
                />
                {kind === 'okf' && (
                  <div className="cx-fm__tags">
                    <TagEditor
                      tags={ready.draft.tags}
                      onChange={(tags) => edit({ tags }, 'tags')}
                      testIdPrefix="fm"
                    />
                    {shown('tags') !== undefined && (
                      <p className="ck-field__error" role="alert" data-testid="fm-tags-error">
                        {shown('tags')}
                      </p>
                    )}
                  </div>
                )}
                {kind === 'okf' && states !== undefined && (
                  <Select
                    label="State"
                    searchable={false}
                    value={ready.draft.state === '' ? null : ready.draft.state}
                    onChange={(key) => edit({ state: key === null ? '' : String(key) }, 'state')}
                    isInvalid={shown('state') !== undefined}
                    errorMessage={shown('state')}
                    triggerTestId="fm-state"
                  >
                    {states.map((s) => (
                      <ListBoxItem key={s.id} id={s.id} textValue={s.label}>
                        {s.label}
                      </ListBoxItem>
                    ))}
                    {ready.draft.state !== '' &&
                      !states.some((s) => s.id === ready.draft.state) && (
                        <ListBoxItem id={ready.draft.state} textValue={ready.draft.state}>
                          {ready.draft.state} (invalid)
                        </ListBoxItem>
                      )}
                  </Select>
                )}
                {kind === 'okf' && (
                  <div className="cx-fm__stale">
                    <TextField
                      label="Stale after"
                      mono
                      className="cx-fm__stale-input"
                      placeholder="YYYY-MM-DD"
                      value={ready.draft.staleAfter}
                      onChange={(staleAfter) => edit({ staleAfter }, 'stale_after')}
                      isInvalid={shown('stale_after') !== undefined}
                      errorMessage={shown('stale_after')}
                      description="From this day the entry counts as stale. Empty = never."
                      inputTestId="fm-stale-after"
                    />
                    <div className="cx-fm__stale-actions">
                      <Button
                        size="sm"
                        onPress={() =>
                          edit({ staleAfter: daysFromToday(Date.now(), 30) }, 'stale_after')
                        }
                        data-testid="fm-stale-plus30"
                      >
                        +30 d
                      </Button>
                      <Button
                        size="sm"
                        onPress={() =>
                          edit({ staleAfter: daysFromToday(Date.now(), 90) }, 'stale_after')
                        }
                        data-testid="fm-stale-plus90"
                      >
                        +90 d
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onPress={() => edit({ staleAfter: '' }, 'stale_after')}
                        data-testid="fm-stale-clear"
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                )}
                {kind === 'okf' && (
                  <Select
                    label="Status"
                    searchable={false}
                    value={ready.draft.status === '' ? NO_STATUS : ready.draft.status}
                    onChange={(key) =>
                      edit(
                        { status: key === null || key === NO_STATUS ? '' : String(key) },
                        'status',
                      )
                    }
                    isInvalid={shown('status') !== undefined}
                    errorMessage={shown('status')}
                    triggerTestId="fm-okf-status"
                  >
                    <ListBoxItem id={NO_STATUS} textValue="None">
                      None
                    </ListBoxItem>
                    {OKF_STATUS_VALUES.map((s) => (
                      <ListBoxItem key={s} id={s} textValue={STATUS_LABELS[s]}>
                        {STATUS_LABELS[s]}
                      </ListBoxItem>
                    ))}
                  </Select>
                )}
                {ready.conflict && (
                  <div className="cx-fm__conflict" role="alert" data-testid="fm-conflict">
                    <span>
                      Changed on disk: this entry's file was modified after you opened the dialog.
                      Reload shows the current values and drops your edits here.
                    </span>
                    <Button size="sm" onPress={reload} data-testid="fm-reload">
                      Reload
                    </Button>
                  </div>
                )}
                {ready.other.length > 0 && (
                  <ul className="cx-fm__problems" role="alert" data-testid="fm-error">
                    {ready.other.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                )}
                {/* Enter in a text field submits (RAC Form); a hidden submit button makes that explicit. */}
                <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
              </Form>
            </div>
          )}
        </Dialog>
      </Modal>
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
        testId="fm-discard-dialog"
      >
        Closing the dialog drops the changes you have not saved.
      </ConfirmDialog>
    </>
  );
}
