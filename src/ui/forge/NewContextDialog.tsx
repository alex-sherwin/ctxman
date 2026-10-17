// "New context" dialog (UI_SPEC §H.6). Open iff the URL says `context=new`. The form lives in an inner
// component so its local drafts (name, description) reset every time the dialog opens.
import { useStore } from '@nanostores/react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Form } from 'react-aria-components';
import { $entries } from '../../stores/entries.ts';
import {
  $forgeUrl,
  $newContextPrefill,
  cancelNewContext,
  createContext,
} from '../../stores/forge.ts';
import { Button, Dialog, Modal, TextField } from '../kit/index.ts';
import { nameProblem } from './validate-name.ts';

const FORM_ID = 'forge-new-form';

function NewContextForm({ onCancel }: { onCancel: () => void }) {
  const prefill = useStore($newContextPrefill);
  const entries = useStore($entries);
  const [name, setName] = useState(prefill);
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [serverName, setServerName] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const existing = new Set((entries.context?.entries ?? []).map((e) => e.slug));
  const problem = nameProblem(name, existing);
  const valid = problem === null && description.trim() !== '';

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!valid || pending) return;
    setPending(true);
    setServerError(null);
    const result = await createContext({ name, description: description.trim() });
    setPending(false);
    if (result.ok) return; // the URL changed to the new context: the dialog closes
    if (result.field === 'name') setServerName(result.message);
    else setServerError(result.message);
  }

  return (
    <Dialog
      title="New context"
      footer={
        <>
          <Button variant="secondary" onPress={onCancel} data-testid="forge-new-cancel">
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={FORM_ID}
            isDisabled={!valid}
            isPending={pending}
            data-testid="forge-new-create"
          >
            Create
          </Button>
        </>
      }
    >
      <Form
        id={FORM_ID}
        className="cx-newctx"
        validationBehavior="aria"
        validationErrors={serverName === null ? {} : { name: serverName }}
        onSubmit={onSubmit}
      >
        <TextField
          label="Name"
          name="name"
          mono
          autoFocus
          isRequired
          value={name}
          onChange={(v) => {
            setName(v);
            setServerName(null);
          }}
          validate={(v) => (v === '' ? null : nameProblem(v, existing))}
          description="Kebab-case. It becomes the file name and slug and can't be changed later."
          inputTestId="forge-new-name"
        />
        <TextField
          label="Description"
          name="description"
          isRequired
          value={description}
          onChange={setDescription}
          description="One line: what this context is for."
          inputTestId="forge-new-description"
        />
        {serverError !== null && (
          <p className="cx-newctx__error" role="alert">
            {serverError}
          </p>
        )}
      </Form>
    </Dialog>
  );
}

export function NewContextDialog() {
  const url = useStore($forgeUrl);
  return (
    <Modal
      isOpen={url.context === 'new'}
      isDismissable
      onOpenChange={(open) => {
        if (!open) cancelNewContext();
      }}
      testId="forge-new-dialog"
    >
      <NewContextForm onCancel={cancelNewContext} />
    </Modal>
  );
}
