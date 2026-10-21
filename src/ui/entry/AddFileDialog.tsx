// "Add file" dialog (ROUND3_SPEC §E.5, D.3): create a markdown file anywhere in an okf bundle (a typed path such as
// `references/abc.md`, `.md` added when left out; or the fixed path of a "Create <path>" button on a missing-doc page)
// with a title, an OKF type and an optional description. POST /api/doc/<ds>/<slug>/<path> creates the missing folders
// of the path, writes the file and lists it in the bundle's index.md (and log.md, when the bundle has one). On 201 the
// browser opens the new page in edit mode; 409 (exists) stays here and says so. Browser-only; kit parts by file.
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Form } from 'react-aria-components';
import type { LinkableDatasetId } from '../../datasets/registry.ts';
import { Dialog, FormDialogFooter, Modal } from '../kit/Dialog.tsx';
import { TextField } from '../kit/Field.tsx';
import { ErrorText } from '../kit/Status.tsx';
import { createConcept } from './entry-api.ts';
import {
  conceptBody,
  conceptTitleFromPath,
  DEFAULT_CONCEPT_TYPE,
  newFilePath,
  newFilePathProblem,
} from './entry-helpers.ts';

const FORM_ID = 'add-file-form';

export interface AddFileDialogProps {
  dataset: LinkableDatasetId;
  slug: string;
  /** Bundle-relative path to create (`data-path` of the button); absent = the user types the path. */
  fixedPath?: string;
  onClose: () => void;
}

export function AddFileDialog({ dataset, slug, fixedPath, onClose }: AddFileDialogProps) {
  const [typed, setTyped] = useState('');
  // `null` = untouched: the title follows the file name
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [type, setType] = useState(DEFAULT_CONCEPT_TYPE);
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const path = fixedPath ?? newFilePath(typed);
  const pathError = fixedPath === undefined ? newFilePathProblem(path) : null;
  const hasName = path !== '' && !path.endsWith('/');
  const title = titleDraft ?? (hasName ? conceptTitleFromPath(path) : '');
  const valid = hasName && pathError === null && title.trim() !== '' && type.trim().length <= 100;

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
        ? `${path} already exists in this bundle. Pick another path.`
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
      testId="add-file-dialog"
    >
      <Dialog
        title="Add file"
        footer={
          <FormDialogFooter
            formId={FORM_ID}
            submitLabel="Create file"
            onCancel={onClose}
            isDisabled={!valid}
            isPending={pending}
            cancelTestId="add-file-cancel"
            submitTestId="add-file-submit"
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
              label="Path"
              mono
              autoFocus
              isRequired
              placeholder="references/abc.md"
              value={typed}
              onChange={(v) => {
                setTyped(v);
                setError(null);
              }}
              isInvalid={pathError !== null}
              errorMessage={pathError ?? undefined}
              description="Folders and file name inside the bundle; missing folders are created and .md is added when left out."
              inputTestId="add-file-name"
            />
          )}
          <p className="cx-addfile__path">
            File:{' '}
            <code data-testid="add-file-path">
              {path === '' ? '…' : `${dataset}/${slug}/${path}`}
            </code>
          </p>
          <TextField
            label="Title"
            isRequired
            autoFocus={fixedPath !== undefined}
            value={title}
            onChange={setTitleDraft}
            inputTestId="add-file-title"
          />
          <TextField
            label="Type"
            mono
            value={type}
            onChange={setType}
            description="The OKF type of the file, e.g. article, guide, reference, decision."
            inputTestId="add-file-type"
          />
          <TextField
            label="Description (optional)"
            value={description}
            onChange={setDescription}
            description="One line; also shown next to the link in index.md."
            inputTestId="add-file-description"
          />
          {error !== null && <ErrorText testId="add-file-error">{error}</ErrorText>}
        </Form>
      </Dialog>
    </Modal>
  );
}
