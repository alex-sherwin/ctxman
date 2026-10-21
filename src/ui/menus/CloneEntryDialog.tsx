// The "Clone…" dialog of an okf entry's detail menu (EntryMenus island; plans/TIME_WIDTH_CLONE_SPEC.md §5): the new
// name (suggested `<slug>-copy`, `-copy-2`… against the dataset's loaded entries), title, description, state (the
// dataset's default), tags, issue key (empty) and what else to copy (relations, child links, logged time). Loads the
// original's frontmatter when opened (GET /api/entry), sends POST /api/entry/<ds>/<slug>/clone and opens the new entry
// on 201; a 409 puts "already exists" on the name and keeps the dialog open. The logic is PURE in
// src/ui/entry/clone-entry.ts. Browser-only, Monaco-free: kit parts are imported by file.
import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Form } from 'react-aria-components';
import { datasetDef, isTimeTrackedDatasetId } from '../../datasets/registry.ts';
import type { OkfDatasetId } from '../../datasets/registry.ts';
import { suggestCloneName } from '../../lib/names.ts';
import { titleFromName } from '../../lib/templates.ts';
import { $entries, ensureEntries } from '../../stores/entries.ts';
import { failureText } from '../edit/api.ts';
import { TagEditor } from '../edit/TagEditor.tsx';
import {
  cloneBody,
  cloneDraft,
  cloneIssuesToFields,
  cloneName,
  cloneProblems,
  cloneSource,
} from '../entry/clone-entry.ts';
import type { CloneDraft, CloneErrors, CloneField, CloneSource } from '../entry/clone-entry.ts';
import { cloneEntry, getEntry } from '../entry/entry-api.ts';
import { Button } from '../kit/Button.tsx';
import { Checkbox } from '../kit/Checkbox.tsx';
import { Dialog, FormDialogFooter, Modal } from '../kit/Dialog.tsx';
import { TextField } from '../kit/Field.tsx';
import { ListBoxItem } from '../kit/ListBox.tsx';
import { Loading } from '../kit/Loading.tsx';
import { Select } from '../kit/Select.tsx';
import { ErrorText } from '../kit/Status.tsx';

const FORM_ID = 'clone-entry-form';

export interface CloneEntryDialogProps {
  dataset: OkfDatasetId;
  slug: string;
  title: string;
  onClose: () => void;
}

type View =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; draft: CloneDraft; source: CloneSource };

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function CloneEntryDialog({ dataset, slug, title, onClose }: CloneEntryDialogProps) {
  const def = datasetDef(dataset);
  const entries = useStore($entries)[dataset];
  const [view, setView] = useState<View>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  // Server issues by field (dropped as the field is edited) and the problems without a field.
  const [serverErrors, setServerErrors] = useState<CloneErrors>({});
  const [other, setOther] = useState<string[]>([]);

  useEffect(() => {
    ensureEntries(dataset);
  }, [dataset]);

  // (Re)load the original's frontmatter; `attempt` re-runs it (Retry). setState only in the callback.
  useEffect(() => {
    let live = true;
    void getEntry(dataset, slug).then((res) => {
      if (!live) return;
      setView(
        res.ok
          ? {
              status: 'ready',
              draft: cloneDraft(dataset, slug, res.body.frontmatter),
              source: cloneSource(res.body.frontmatter),
            }
          : { status: 'error', message: res.message },
      );
    });
    return () => {
      live = false;
    };
  }, [dataset, slug, attempt]);

  const existing = new Set((entries?.entries ?? []).map((e) => e.slug));
  existing.add(slug);
  const suggestion = suggestCloneName(slug, existing);
  const ready = view.status === 'ready' ? view : null;
  const name = ready === null ? '' : cloneName(ready.draft, suggestion);
  const problems = ready === null ? {} : cloneProblems(dataset, name, ready.draft, existing);
  const valid = ready !== null && Object.keys(problems).length === 0;
  const shown = (field: CloneField): string | undefined => serverErrors[field] ?? problems[field];

  function edit(change: Partial<CloneDraft>, field?: CloneField) {
    setView((v) => (v.status === 'ready' ? { ...v, draft: { ...v.draft, ...change } } : v));
    if (field !== undefined && serverErrors[field] !== undefined) {
      setServerErrors((errors) => {
        const next = { ...errors };
        delete next[field];
        return next;
      });
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ready === null || !valid || pending) return;
    setPending(true);
    setServerErrors({});
    setOther([]);
    const res = await cloneEntry(dataset, slug, cloneBody(dataset, name, ready.draft));
    if (res.ok) {
      location.assign(res.body.url);
      return; // stays pending until the navigation
    }
    setPending(false);
    if (res.status === 409) {
      setServerErrors({ name: `A ${def.singular} with this name already exists` });
    } else if (res.error === 'invalid' && (res.issues?.length ?? 0) > 0) {
      const mapped = cloneIssuesToFields(res.issues ?? []);
      setServerErrors(mapped.fields);
      setOther(mapped.other);
    } else {
      setOther([failureText(res)]);
    }
  }

  const timeTracked = isTimeTrackedDatasetId(dataset);
  const showChildren = dataset === 'project' || (ready?.source.children ?? 0) > 0;

  return (
    <Modal
      isOpen
      isDismissable={!pending}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      size="form"
      testId="clone-dialog"
    >
      <Dialog
        title={`Clone ${def.singular} “${title}”`}
        footer={
          <FormDialogFooter
            formId={FORM_ID}
            submitLabel="Clone"
            onCancel={() => {
              if (!pending) onClose();
            }}
            isDisabled={!valid}
            isPending={pending}
            cancelTestId="clone-cancel"
            submitTestId="clone-submit"
          />
        }
      >
        {view.status === 'loading' && <Loading testId="clone-loading" />}
        {view.status === 'error' && (
          <ErrorText testId="clone-load-error">
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
          <Form
            id={FORM_ID}
            className="cx-entrydlg__form"
            validationBehavior="aria"
            onSubmit={(e) => void onSubmit(e)}
          >
            <p className="cx-clone__lede">
              Copies every file and folder of <code>{`${dataset}/${slug}`}</code> into a new{' '}
              {def.singular}; only the fields below change in its <code>index.md</code>.
            </p>
            <div className="cx-clone__row">
              <TextField
                label="Name"
                mono
                isRequired
                autoFocus
                autoComplete="off"
                spellCheck="false"
                value={name}
                onChange={(value) => edit({ name: value }, 'name')}
                isInvalid={shown('name') !== undefined}
                errorMessage={shown('name')}
                description="Lowercase letters, digits, single hyphens: the new folder name"
                inputTestId="clone-name"
              />
              {def.states !== undefined && (
                <Select
                  label="State"
                  searchable={false}
                  value={ready.draft.state}
                  onChange={(key) => {
                    if (key !== null) edit({ state: String(key) }, 'state');
                  }}
                  isInvalid={shown('state') !== undefined}
                  errorMessage={shown('state')}
                  description="A new entry starts in the default state"
                  triggerTestId="clone-state"
                >
                  {def.states.map((s) => (
                    <ListBoxItem key={s.id} id={s.id} textValue={s.label}>
                      {s.label}
                    </ListBoxItem>
                  ))}
                </Select>
              )}
            </div>
            <TextField
              label="Title"
              autoComplete="off"
              value={ready.draft.title}
              onChange={(value) => edit({ title: value }, 'title')}
              placeholder={titleFromName(name) || 'Title'}
              isInvalid={shown('title') !== undefined}
              errorMessage={shown('title')}
              description="Empty = the name in sentence case. A first # heading that reads the old title is renamed too."
              inputTestId="clone-title"
            />
            <TextField
              label="Description"
              isRequired
              autoComplete="off"
              value={ready.draft.description}
              onChange={(value) => edit({ description: value }, 'description')}
              isInvalid={shown('description') !== undefined}
              errorMessage={shown('description')}
              description="One line; shown in lists and search"
              inputTestId="clone-description"
            />
            <div className="cx-clone__row">
              <div className="cx-clone__tags">
                <TagEditor
                  tags={ready.draft.tags}
                  onChange={(tags) => edit({ tags }, 'tags')}
                  testIdPrefix="clone"
                />
                {shown('tags') !== undefined && (
                  <p className="ck-field__error" role="alert" data-testid="clone-tags-error">
                    {shown('tags')}
                  </p>
                )}
              </div>
              <TextField
                label="Issue key"
                mono
                autoComplete="off"
                spellCheck="false"
                placeholder="PROJ-123"
                value={ready.draft.issueKey}
                onChange={(issueKey) => edit({ issueKey }, 'issueKey')}
                isInvalid={shown('issueKey') !== undefined}
                errorMessage={shown('issueKey')}
                description="Empty: the original's issue belongs to the original"
                inputTestId="clone-issue-key"
              />
            </div>
            <fieldset className="cx-clone__copy">
              <legend className="ck-label cx-label cx-clone__legend">Also copy</legend>
              <Checkbox
                isSelected={ready.draft.links}
                onChange={(links) => edit({ links })}
                data-testid="clone-opt-links"
              >
                Relations{' '}
                <span className="cx-subtle">
                  (
                  {plural(
                    ready.source.relations,
                    'related or depends-on link',
                    'related and depends-on links',
                  )}
                  )
                </span>
              </Checkbox>
              {showChildren && (
                <Checkbox
                  isSelected={ready.draft.children}
                  onChange={(children) => edit({ children })}
                  data-testid="clone-opt-children"
                >
                  Child links{' '}
                  <span className="cx-subtle">
                    ({plural(ready.source.children, 'child', 'children')})
                  </span>
                </Checkbox>
              )}
              {timeTracked && (
                <Checkbox
                  isSelected={ready.draft.time}
                  onChange={(time) => edit({ time })}
                  data-testid="clone-opt-time"
                >
                  Logged time and resolved date{' '}
                  <span className="cx-subtle">
                    (
                    {[
                      ready.source.timeTotal === '' ? 'no time logged' : ready.source.timeTotal,
                      ready.source.resolved === '' ? '' : `resolved ${ready.source.resolved}`,
                    ]
                      .filter((part) => part !== '')
                      .join(', ')}
                    )
                  </span>
                </Checkbox>
              )}
            </fieldset>
            <p className="cx-subtle cx-clone__note" data-testid="clone-note">
              Links that point at this {def.singular} are not copied: the clone is not added to the
              projects, entries or contexts that list the original. Symbolic links in the bundle are
              left out.
            </p>
            {other.length > 0 && (
              <ErrorText as="ul" testId="clone-error">
                {other.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ErrorText>
            )}
          </Form>
        )}
      </Dialog>
    </Modal>
  );
}
