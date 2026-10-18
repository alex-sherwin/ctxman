// "New concept" dialog (ROUND3_SPEC §E.5, D.3): create a concept file in an okf bundle (`concepts/<name>.md`, or
// the fixed path of a "Create <path>" button on a missing-doc page) with a title, a type and an optional
// description. POST /api/doc/<ds>/<slug>/<path> also lists the file in the bundle's index.md and log.md. On 201
// the browser opens the new page in edit mode; 409 (exists) stays here and says so. Browser-only; kit parts by file.
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Form } from 'react-aria-components';
import type { LinkableDatasetId } from '../../datasets/registry.ts';
import { nameProblem } from '../../lib/names.ts';
import { Dialog, FormDialogFooter, Modal } from '../kit/Dialog.tsx';
import { TextField } from '../kit/Field.tsx';
import { ErrorText } from '../kit/Status.tsx';
import { createConcept } from './entry-api.ts';
import {
  conceptBody,
  conceptPath,
  conceptTitleFromPath,
  DEFAULT_CONCEPT_TYPE,
} from './entry-helpers.ts';

const FORM_ID = 'new-concept-form';

export interface NewConceptDialogProps {
  dataset: LinkableDatasetId;
  slug: string;
  /** Bundle-relative path to create (`data-path` of the button); absent = the user names the file. */
  fixedPath?: string;
  onClose: () => void;
}

export function NewConceptDialog({ dataset, slug, fixedPath, onClose }: NewConceptDialogProps) {
  const [name, setName] = useState('');
  // `null` = untouched: the title follows the file name
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [type, setType] = useState(DEFAULT_CONCEPT_TYPE);
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const path = fixedPath ?? (name === '' ? '' : conceptPath(name));
  const title = titleDraft ?? (path === '' ? '' : conceptTitleFromPath(path));
  const nameError = fixedPath === undefined && name !== '' ? nameProblem(name) : null;
  const valid =
    path !== '' && nameError === null && title.trim() !== '' && type.trim().length <= 100;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    const res = await createConcept(dataset, slug, path, conceptBody({ title, type, description }));
    if (res.ok) {
      location.assign(`${res.body.url}?edit=1`);
      return; // stays pending until the navigation
    }
    setPending(false);
    setError(
      res.status === 409
        ? `${path} already exists in this bundle. Pick another name.`
        : res.issues && res.issues.length > 0
          ? res.issues.map((i) => `${i.path === '' ? '' : `${i.path}: `}${i.message}`).join('; ')
          : res.message,
    );
  }

  return (
    <Modal
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="large"
      testId="new-concept-dialog"
    >
      <Dialog
        title="New concept"
        footer={
          <FormDialogFooter
            formId={FORM_ID}
            submitLabel="Create concept"
            onCancel={onClose}
            isDisabled={!valid}
            isPending={pending}
            cancelTestId="new-concept-cancel"
            submitTestId="new-concept-submit"
          />
        }
      >
        <Form
          id={FORM_ID}
          className="cx-entrydlg__form"
          validationBehavior="aria"
          onSubmit={(e) => void onSubmit(e)}
        >
          {fixedPath === undefined && (
            <TextField
              label="File name"
              mono
              autoFocus
              isRequired
              value={name}
              onChange={(v) => {
                setName(v);
                setError(null);
              }}
              isInvalid={nameError !== null}
              errorMessage={nameError ?? undefined}
              description="Kebab-case, without .md."
              inputTestId="new-concept-name"
            />
          )}
          <p className="cx-nc__path">
            File: <code data-testid="new-concept-path">{path === '' ? 'concepts/…' : path}</code>
          </p>
          <TextField
            label="Title"
            isRequired
            autoFocus={fixedPath !== undefined}
            value={title}
            onChange={setTitleDraft}
            inputTestId="new-concept-title"
          />
          <TextField
            label="Type"
            mono
            value={type}
            onChange={setType}
            description="The OKF type of the concept, e.g. Concept, Guide, Decision."
            inputTestId="new-concept-type"
          />
          <TextField
            label="Description (optional)"
            value={description}
            onChange={setDescription}
            description="One line; also shown next to the link in index.md."
            inputTestId="new-concept-description"
          />
          {error !== null && <ErrorText testId="new-concept-error">{error}</ErrorText>}
        </Form>
      </Dialog>
    </Modal>
  );
}
