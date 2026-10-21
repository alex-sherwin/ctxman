// "Edit details" dialog of an okf / skill entry (ROUND3_SPEC §E.5): the frontmatter keys title, description, issueKey, tags,
// state, time + resolved (task, feature, bug, rca), stale_after and status (a skill: description only). Loads the current frontmatter when opened
// (GET /api/entry), saves ONLY the changed keys with an explicit Save (PATCH, `ifUnmodifiedSince` = the loaded
// mtime). 400 `invalid` puts the server's issues on their fields; 409 shows "Changed on disk" with a Reload
// button that re-reads the file (my edits in the dialog are dropped). Browser-only; kit parts by file.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Form } from 'react-aria-components';
import { datasetDef, isTimeTrackedDatasetId } from '../../datasets/registry.ts';
import type { LinkableDatasetId } from '../../datasets/registry.ts';
import { localIsoMinutes } from '../../lib/iso8601.ts';
import { todayYmd } from '../../lib/time.ts';
import { DiscardDialog } from '../edit/DiscardDialog.tsx';
import { SaveBar } from '../edit/SaveBar.tsx';
import type { SaveStatus } from '../edit/status.ts';
import { TagEditor } from '../edit/TagEditor.tsx';
import { TimeEditor } from '../edit/TimeEditor.tsx';
import { useSaveShortcut } from '../edit/useSaveShortcut.ts';
import { Button } from '../kit/Button.tsx';
import { Dialog, Modal } from '../kit/Dialog.tsx';
import { TextField } from '../kit/Field.tsx';
import { ListBoxItem } from '../kit/ListBox.tsx';
import { Loading } from '../kit/Loading.tsx';
import { Notice } from '../kit/Notice.tsx';
import { Select } from '../kit/Select.tsx';
import { ErrorText } from '../kit/Status.tsx';
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
  const timeTracked = kind === 'okf' && isTimeTrackedDatasetId(dataset);

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
        draft: { ...base, tags: [...base.tags], time: [...base.time] },
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

  // Cmd/Ctrl+S saves (the SaveBar tooltip promises it). `save` is a render closure: keep the latest in a ref.
  const saveRef = useRef<() => void>(() => {});
  useEffect(() => {
    saveRef.current = () => void save();
  });
  const onSaveShortcut = useCallback(() => saveRef.current(), []);
  useSaveShortcut(onSaveShortcut, ready !== null);

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
        size="form"
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
              statusFirst
            />
          }
        >
          {view.status === 'loading' && <Loading testId="fm-loading" />}
          {view.status === 'error' && (
            <ErrorText testId="fm-load-error">
              {view.message}{' '}
              <Button size="sm" onPress={reload}>
                Retry
              </Button>
            </ErrorText>
          )}
          {ready !== null && (
            <>
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
                  <TextField
                    label="Issue key"
                    mono
                    placeholder="PROJ-123"
                    value={ready.draft.issueKey}
                    onChange={(issueKey) => edit({ issueKey }, 'issueKey')}
                    isInvalid={shown('issueKey') !== undefined}
                    errorMessage={shown('issueKey')}
                    description="The matching issue in an issue tracker. Empty = none."
                    inputTestId="fm-issue-key"
                  />
                )}
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
                {timeTracked && (
                  <TimeEditor
                    values={ready.draft.time}
                    onChange={(time) => edit({ time }, 'time')}
                    errorMessage={shown('time')}
                    testIdPrefix="fm"
                  />
                )}
                {timeTracked && (
                  <div className="cx-fm__date">
                    <TextField
                      label="Resolved"
                      mono
                      className="cx-fm__date-input"
                      placeholder="2026-10-19 or 2026-10-19T14:30"
                      value={ready.draft.resolved}
                      onChange={(resolved) => edit({ resolved }, 'resolved')}
                      isInvalid={shown('resolved') !== undefined}
                      errorMessage={shown('resolved')}
                      description="When the work was resolved: an ISO 8601 date or date-time. Empty = not resolved."
                      inputTestId="fm-resolved"
                    />
                    <div className="cx-fm__date-actions">
                      <Button
                        size="sm"
                        onPress={() => edit({ resolved: localIsoMinutes(Date.now()) }, 'resolved')}
                        data-testid="fm-resolved-now"
                      >
                        Now
                      </Button>
                      <Button
                        size="sm"
                        onPress={() => edit({ resolved: todayYmd(Date.now()) }, 'resolved')}
                        data-testid="fm-resolved-today"
                      >
                        Today
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onPress={() => edit({ resolved: '' }, 'resolved')}
                        data-testid="fm-resolved-clear"
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                )}
                {kind === 'okf' && (
                  <div className="cx-fm__date">
                    <TextField
                      label="Stale after"
                      mono
                      className="cx-fm__date-input"
                      placeholder="YYYY-MM-DD"
                      value={ready.draft.staleAfter}
                      onChange={(staleAfter) => edit({ staleAfter }, 'stale_after')}
                      isInvalid={shown('stale_after') !== undefined}
                      errorMessage={shown('stale_after')}
                      description="From this day the entry counts as stale. Empty = never."
                      inputTestId="fm-stale-after"
                    />
                    <div className="cx-fm__date-actions">
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
                  <Notice
                    tone="danger"
                    layout="row"
                    role="alert"
                    testId="fm-conflict"
                    actions={
                      <Button size="sm" onPress={reload} data-testid="fm-reload">
                        Reload
                      </Button>
                    }
                  >
                    Changed on disk: this entry's file was modified after you opened the dialog.
                    Reload shows the current values and drops your edits here.
                  </Notice>
                )}
                {ready.other.length > 0 && (
                  <ErrorText as="ul" testId="fm-error">
                    {ready.other.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ErrorText>
                )}
                {/* Enter in a text field submits (RAC Form); a hidden submit button makes that explicit. */}
                <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
              </Form>
            </>
          )}
        </Dialog>
      </Modal>
      <DiscardDialog
        isOpen={confirmDiscard}
        message="Closing the dialog drops the changes you have not saved."
        onConfirm={() => {
          setConfirmDiscard(false);
          onClose();
        }}
        onCancel={() => setConfirmDiscard(false)}
        testId="fm-discard-dialog"
      />
    </>
  );
}
