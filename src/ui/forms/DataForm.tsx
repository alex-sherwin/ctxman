// DataForm island (ROUND2_UI_SPEC §H.3): create / edit a reference, context or recipe. Form tab (fields from
// src/lib/forms/fields.ts) and YAML tab (monaco-yaml with the dataset's JSON Schema) edit the same working
// document, two-way. Save / Create / Delete go through the CRUD APIs; the store (src/stores/data-form.ts) owns
// the state. Browser-only (client:only="react"); kit parts by file, Monaco only through LazyCodeEditor.
import { useStore } from '@nanostores/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Form } from 'react-aria-components';
import { visibleFields, readonlySummary, LINKED_EDITOR } from '../../lib/forms/fields.ts';
import type { YamlDatasetId } from '../../lib/forms/fields.ts';
import {
  $formConflict,
  $formDirty,
  $formErrors,
  $formLoad,
  $formSave,
  $formView,
  $formWorking,
  $formYamlCheck,
  $formYamlDraft,
  $formYamlInvalid,
  $formYamlMarkers,
  cancelHref,
  deleteDoc,
  initForm,
  keepEditing,
  loadTheirs,
  overwrite,
  retryLoad,
  setField,
  setFormView,
  setFormYaml,
  submitForm,
} from '../../stores/data-form.ts';
import { ConflictDialog } from '../edit/ConflictDialog.tsx';
import { DiscardDialog } from '../edit/DiscardDialog.tsx';
import { SaveBar } from '../edit/SaveBar.tsx';
import type { SaveStatus } from '../edit/status.ts';
import { useSaveShortcut } from '../edit/useSaveShortcut.ts';
import { useUnsavedGuard } from '../edit/useUnsavedGuard.ts';
import { YamlIssues } from '../edit/YamlIssues.tsx';
import { LazyCodeEditor } from '../editor/LazyCodeEditor.tsx';
import type { CodeEditorApi } from '../editor/LazyCodeEditor.tsx';
import { Button, ButtonLink } from '../kit/Button.tsx';
import { ChipToggle } from '../kit/Chip.tsx';
import { ConfirmDialog } from '../kit/Dialog.tsx';
import { Loading } from '../kit/Loading.tsx';
import { ErrorText } from '../kit/Status.tsx';
import { isMac } from '../../stores/platform.ts';
import { FieldControl } from './FieldControl.tsx';

export interface DataFormProps {
  dataset: YamlDatasetId;
  mode: 'create' | 'edit';
  /** Edit mode: the entry to edit. */
  slug?: string;
}

/** Save from a button, Enter in a field or Cmd/Ctrl+S: validate, send, and put the cursor on the first problem. */
async function submit(): Promise<void> {
  const result = await submitForm();
  if (result !== 'invalid') return;
  window.setTimeout(() => {
    document
      .querySelector<HTMLElement>(
        '.cx-dform__form [data-invalid] :is(input, textarea, button), .cx-dform__form [data-invalid] .monaco-editor textarea',
      )
      ?.focus();
  }, 50);
}

function ViewToggle() {
  const view = useStore($formView);
  const yamlInvalid = useStore($formYamlInvalid);
  return (
    <>
      <ChipToggle
        label="Editor view"
        value={view}
        onChange={setFormView}
        testId="dform-view-toggle"
        options={[
          {
            id: 'form',
            label: 'Form',
            testId: 'dform-view-form',
            isDisabled: view === 'yaml' && yamlInvalid,
          },
          { id: 'yaml', label: 'YAML', testId: 'dform-view-yaml' },
        ]}
      />
      {view === 'yaml' && yamlInvalid && (
        <span className="cx-subtle">Fix the YAML problems to return to the form</span>
      )}
    </>
  );
}

function FormFields({ dataset, mode }: Pick<DataFormProps, 'dataset' | 'mode'>) {
  const working = useStore($formWorking);
  const errors = useStore($formErrors);
  if (working === null) return null;
  const fields = visibleFields(dataset, working);
  const shown = new Set(fields.map((f) => f.id));
  // Problems of data the form cannot edit (links, composition) or of the document as a whole.
  const unplaced = Object.entries(errors).filter(([id]) => !shown.has(id));
  const summary = readonlySummary(dataset, working);
  return (
    <Form
      className="cx-dform__form"
      validationBehavior="aria"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {fields.map((def) => (
        <FieldControl
          key={def.id}
          def={def}
          doc={working}
          mode={mode}
          error={errors[def.id]}
          onChange={setField}
          onSave={() => void submit()}
        />
      ))}
      {summary !== null && (
        <p className="cx-subtle cx-dform__summary" data-testid="dform-summary">
          {mode === 'create'
            ? dataset === 'context'
              ? 'Links are added in the Forge once the context exists'
              : 'The composition is built in Inflate once the recipe exists'
            : summary}
        </p>
      )}
      {unplaced.length > 0 && (
        <ErrorText as="ul" testId="dform-problems">
          {unplaced.map(([id, message]) => (
            <li key={id}>{id === '_' ? message : `${id}: ${message}`}</li>
          ))}
        </ErrorText>
      )}
      {/* Enter in a text field submits (RAC Form); a hidden submit button makes that explicit for every browser. */}
      <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
    </Form>
  );
}

function YamlTab({ dataset }: { dataset: YamlDatasetId }) {
  const draft = useStore($formYamlDraft);
  const check = useStore($formYamlCheck);
  const markers = useStore($formYamlMarkers);
  const working = useStore($formWorking);
  const api = useRef<CodeEditorApi | null>(null);
  const name =
    typeof working?.name === 'string' && working.name !== '' ? working.name : 'new entry';
  return (
    <div className="cx-dform__yaml" data-testid="dform-yaml">
      <LazyCodeEditor
        language="yaml"
        value={draft ?? ''}
        onChange={setFormYaml}
        height={{ mode: 'fill' }}
        ariaLabel={`YAML for ${dataset} ${name}`}
        testId="dform-yaml-editor"
        schemaDataset={dataset}
        markers={markers}
        onSave={() => void submit()}
        onReady={(editor) => {
          api.current = editor;
        }}
        describedBy="dform-yaml-help"
      />
      <p id="dform-yaml-help" className="cx-dform__help">
        Edits sync to the form when valid. Comments and formatting are not preserved. Tab indents;
        press {isMac ? 'Ctrl+Shift+M' : 'Ctrl+M'} to make Tab move focus.
      </p>
      <YamlIssues
        issues={check.issues}
        onReveal={(line, column) => api.current?.revealPosition(line, column)}
        testIdPrefix="dform"
      />
    </div>
  );
}

export default function DataForm({ dataset, mode, slug }: DataFormProps) {
  const load = useStore($formLoad);
  const view = useStore($formView);
  const dirty = useStore($formDirty);
  const yamlInvalid = useStore($formYamlInvalid);
  const save = useStore($formSave);
  const conflict = useStore($formConflict);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  useEffect(() => {
    void initForm({ dataset, mode, ...(slug === undefined ? {} : { slug }) });
  }, [dataset, mode, slug]);

  useUnsavedGuard(dirty);

  // Cmd/Ctrl+S in any field (Monaco handles its own and prevents the key first).
  const submitStable = useCallback(() => {
    void submit();
  }, []);
  useSaveShortcut(submitStable);

  const create = mode === 'create';
  const linked = !create && slug !== undefined ? LINKED_EDITOR[dataset] : null;
  const status: SaveStatus = save.kind === 'idle' && dirty ? { kind: 'dirty' } : save;

  return (
    <section className="cx-dform" data-testid="dform" data-dataset={dataset} data-mode={mode}>
      {load.status === 'loading' && <Loading testId="dform-loading" />}
      {load.status === 'not-found' && (
        <ErrorText testId="dform-not-found">{load.message}</ErrorText>
      )}
      {load.status === 'error' && (
        <ErrorText as="div" testId="dform-load-error">
          <p>{load.message}</p>
          <Button size="sm" onPress={retryLoad}>
            Retry
          </Button>
        </ErrorText>
      )}
      {load.status === 'ready' && (
        <>
          <header className="cx-dform__bar">
            <ViewToggle />
            {linked !== null && slug !== undefined && (
              <ButtonLink size="sm" href={linked.href(slug)} data-testid="dform-open-linked">
                {linked.label}
              </ButtonLink>
            )}
          </header>
          <div className="cx-dform__body" data-view={view}>
            {view === 'form' ? (
              <FormFields dataset={dataset} mode={mode} />
            ) : (
              <YamlTab dataset={dataset} />
            )}
          </div>
          <footer className="cx-dform__footer">
            <SaveBar
              testIdPrefix="dform"
              saveLabel={create ? 'Create' : 'Save'}
              status={status}
              canSave={!yamlInvalid && (create || dirty)}
              onSave={() => void submit()}
              onCancel={() => {
                if (dirty) setDiscardOpen(true);
                else location.assign(cancelHref());
              }}
            />
            {!create && (
              <Button
                variant="ghost"
                size="sm"
                className="cx-dform__delete"
                onPress={() => setDeleteOpen(true)}
                data-testid="dform-delete"
              >
                Delete
              </Button>
            )}
          </footer>
        </>
      )}
      <ConfirmDialog
        isOpen={deleteOpen}
        tone="danger"
        title={`Delete ${slug ?? dataset}?`}
        confirmLabel="Delete"
        isPending={save.kind === 'saving'}
        onConfirm={() => {
          setDeleteOpen(false);
          void deleteDoc();
        }}
        onCancel={() => setDeleteOpen(false)}
        testId="dform-delete-dialog"
      >
        <p>
          This removes <code>{`${dataset}/${slug ?? ''}.yaml`}</code>. It can&apos;t be undone.
        </p>
      </ConfirmDialog>
      <DiscardDialog
        isOpen={discardOpen}
        message="Your unsaved changes will be lost."
        cancelLabel="Keep editing"
        onConfirm={() => {
          setDiscardOpen(false);
          location.assign(cancelHref());
        }}
        onCancel={() => setDiscardOpen(false)}
        testId="dform-discard-dialog"
      />
      <ConflictDialog
        isOpen={conflict}
        what={`${dataset}/${slug ?? ''}`}
        onLoadTheirs={loadTheirs}
        onOverwrite={() => void overwrite()}
        onKeepEditing={keepEditing}
        testIdPrefix="dform"
      />
    </section>
  );
}
