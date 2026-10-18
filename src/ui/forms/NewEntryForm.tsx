// NewEntryForm island (ROUND3_SPEC §E.7): create an okf or skill entry at /new/<ds>. Fields follow the dataset
// (title and tags: okf; state: lifecycle datasets; "Part of project": every dataset) and POST /api/entry/<ds>
// through src/stores/new-entry.ts, which owns the state. Browser-only (client:only="react"); kit parts by file,
// no Monaco (nothing here is markdown).
import { useStore } from '@nanostores/react';
import { useEffect } from 'react';
import { Form } from 'react-aria-components';
import { datasetDef } from '../../datasets/registry.ts';
import { NO_PARENT } from '../../lib/forms/entry-form.ts';
import type { NewEntryDataset } from '../../lib/forms/entry-form.ts';
import { titleFromName } from '../../lib/templates.ts';
import { $entries, compareEntries } from '../../stores/entries.ts';
import {
  $newDirty,
  $newDraft,
  $newErrors,
  $newPartial,
  $newSave,
  initNewEntry,
  setNewField,
  submitNewEntry,
} from '../../stores/new-entry.ts';
import { TagEditor } from '../edit/TagEditor.tsx';
import { useUnsavedGuard } from '../edit/useUnsavedGuard.ts';
import { Button, ButtonLink } from '../kit/Button.tsx';
import { TextField } from '../kit/Field.tsx';
import { ListBoxItem } from '../kit/ListBox.tsx';
import { Loading } from '../kit/Loading.tsx';
import { Notice } from '../kit/Notice.tsx';
import { Select } from '../kit/Select.tsx';
import { ErrorText, Status } from '../kit/Status.tsx';

export interface NewEntryFormProps {
  dataset: NewEntryDataset;
  /** `?parent=` prefill: a project slug (already validated by `parseNewEntryUrl`), or null. */
  parent: string | null;
}

/** Create from a button, Enter in a field: validate, send, and put the cursor on the first problem. */
async function submit(): Promise<void> {
  const result = await submitNewEntry();
  if (result !== 'invalid') return;
  window.setTimeout(() => {
    document
      .querySelector<HTMLElement>(
        '.cx-nform [data-invalid] :is(input, textarea), .cx-nform .ck-select[data-invalid] button',
      )
      ?.focus();
  }, 50);
}

function ParentSelect({ error }: { error: string | undefined }) {
  const draft = useStore($newDraft);
  const state = useStore($entries).project;
  if (draft === null) return null;
  const projects = [...(state?.entries ?? [])].sort(compareEntries);
  const parent = draft.parent;
  // A prefilled project that is not (yet) in the list still has to show as the selection.
  const extra = parent !== null && !projects.some((p) => p.slug === parent);
  return (
    <Select
      label="Part of project"
      value={parent ?? NO_PARENT}
      onChange={(key) => {
        if (key !== null) setNewField('parent', key === NO_PARENT ? null : String(key));
      }}
      isInvalid={error !== undefined}
      errorMessage={error}
      description={
        state?.status === 'loading' && projects.length === 0
          ? 'Loading projects…'
          : 'Adds a child link to the project'
      }
      triggerTestId="new-parent"
    >
      <ListBoxItem id={NO_PARENT} textValue="None">
        None
      </ListBoxItem>
      {extra && parent !== null ? (
        <ListBoxItem id={parent} textValue={parent}>
          {parent}
        </ListBoxItem>
      ) : null}
      {projects.map((p) => (
        <ListBoxItem key={p.slug} id={p.slug} textValue={`${p.title ?? p.name} ${p.slug}`}>
          {p.title ?? p.name}
          {(p.title ?? p.name) !== p.slug && <code className="cx-subtle"> {p.slug}</code>}
        </ListBoxItem>
      ))}
    </Select>
  );
}

export default function NewEntryForm({ dataset, parent }: NewEntryFormProps) {
  const draft = useStore($newDraft);
  const errors = useStore($newErrors);
  const save = useStore($newSave);
  const dirty = useStore($newDirty);
  const partial = useStore($newPartial);

  useEffect(() => {
    initNewEntry({ dataset, parent });
    // Back / forward cache restore: the page comes back as it was left (a finished create), so start a fresh form.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) initNewEntry({ dataset, parent });
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [dataset, parent]);

  useUnsavedGuard(dirty);

  if (draft === null) {
    return <Loading testId="new-entry-loading" />;
  }

  const def = datasetDef(dataset);
  const isSkill = dataset === 'skill';
  const saving = save.kind === 'saving';
  const busy = saving || save.kind === 'saved' || partial !== null;

  return (
    <Form
      className="cx-dform cx-nform"
      validationBehavior="aria"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      data-testid="new-entry-form"
      data-dataset={dataset}
    >
      <TextField
        label="Name"
        value={draft.name}
        onChange={(v) => setNewField('name', v)}
        isInvalid={errors.name !== undefined}
        errorMessage={errors.name}
        description="Lowercase letters, digits and single hyphens; it becomes the folder name and cannot be changed later"
        mono
        autoFocus
        autoComplete="off"
        spellCheck="false"
        inputTestId="new-name"
      />
      {!isSkill && (
        <TextField
          label="Title"
          value={draft.title}
          onChange={(v) => setNewField('title', v)}
          isInvalid={errors.title !== undefined}
          errorMessage={errors.title}
          description="Optional; defaults to the name in sentence case"
          placeholder={titleFromName(draft.name) || 'Title'}
          autoComplete="off"
          inputTestId="new-title"
        />
      )}
      <TextField
        label="Description"
        value={draft.description}
        onChange={(v) => setNewField('description', v)}
        isInvalid={errors.description !== undefined}
        errorMessage={errors.description}
        description="One line; shown in lists and search"
        autoComplete="off"
        inputTestId="new-description"
      />
      <div className="cx-nform__row">
        {def.states !== undefined && (
          <Select
            label="State"
            value={draft.state}
            onChange={(key) => {
              if (key !== null) setNewField('state', String(key));
            }}
            isInvalid={errors.state !== undefined}
            errorMessage={errors.state}
            triggerTestId="new-state"
          >
            {def.states.map((s) => (
              <ListBoxItem key={s.id} id={s.id} textValue={s.label}>
                {s.label}
              </ListBoxItem>
            ))}
          </Select>
        )}
        <ParentSelect error={errors.parent} />
      </div>
      {!isSkill && (
        <div className="cx-nform__tags" data-invalid={errors.tags !== undefined ? '' : undefined}>
          <TagEditor
            tags={draft.tags}
            onChange={(tags) => setNewField('tags', tags)}
            testIdPrefix="new"
          />
          {errors.tags !== undefined && <p className="ck-field__error">{errors.tags}</p>}
        </div>
      )}
      {partial !== null && (
        <Notice
          tone="danger"
          layout="row"
          role="alert"
          testId="new-partial"
          actions={
            <ButtonLink size="sm" href={partial.url} data-testid="new-open-created">
              Open {def.singular}
            </ButtonLink>
          }
        >
          {partial.message}
        </Notice>
      )}
      <footer className="cx-dform__footer">
        <Button
          type="submit"
          variant="primary"
          isPending={saving}
          isDisabled={busy}
          data-testid="new-submit"
        >
          Create {def.singular}
        </Button>
        <ButtonLink variant="ghost" href={`/${dataset}`} data-testid="new-cancel">
          Cancel
        </ButtonLink>
        {save.kind === 'error' ? (
          <ErrorText as="div" testId="new-error">
            {save.message}
          </ErrorText>
        ) : (
          <Status kind={save.kind} testId="new-status">
            {save.kind === 'idle' ? '' : (save.message ?? '')}
          </Status>
        )}
      </footer>
    </Form>
  );
}
