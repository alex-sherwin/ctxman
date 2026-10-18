// "New recipe" dialog (INFLATE_SPEC §9.3), the Forge New context dialog with a target Select. Open iff the
// URL says `recipe=new`. The form lives in an inner component so its local drafts reset on every open.
import { useStore } from '@nanostores/react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Form } from 'react-aria-components';
import { INFLATE_TARGETS, TARGETS, isInflateTarget } from '../../lib/inflate/catalog.ts';
import type { InflateTarget } from '../../lib/inflate/catalog.ts';
import { $entries } from '../../stores/entries.ts';
import {
  $inflateUrl,
  $newRecipePrefill,
  cancelNewRecipe,
  createRecipe,
} from '../../stores/inflate.ts';
import {
  Dialog,
  ErrorText,
  FormDialogFooter,
  ListBoxItem,
  Modal,
  Select,
  TextField,
} from '../kit/index.ts';
import { recipeNameProblem } from './format.ts';

const FORM_ID = 'inflate-new-form';

function NewRecipeForm({ onCancel }: { onCancel: () => void }) {
  const prefill = useStore($newRecipePrefill);
  const entries = useStore($entries, { keys: ['recipe'] });
  const [name, setName] = useState(prefill);
  const [description, setDescription] = useState('');
  const [target, setTarget] = useState<InflateTarget>('claude-code');
  const [pending, setPending] = useState(false);
  const [serverName, setServerName] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const existing = new Set((entries.recipe?.entries ?? []).map((e) => e.slug));
  const problem = recipeNameProblem(name, existing);
  const valid = problem === null && description.trim() !== '';

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!valid || pending) return;
    setPending(true);
    setServerError(null);
    const result = await createRecipe({ name, description: description.trim(), target });
    setPending(false);
    if (result.ok) return; // the URL changed to the new recipe: the dialog closes
    if (result.field === 'name') setServerName(result.message);
    else setServerError(result.message);
  }

  return (
    <Dialog
      title="New recipe"
      footer={
        <FormDialogFooter
          formId={FORM_ID}
          submitLabel="Create"
          onCancel={onCancel}
          isDisabled={!valid}
          isPending={pending}
          cancelTestId="inflate-new-cancel"
          submitTestId="inflate-new-create"
        />
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
          validate={(v) => (v === '' ? null : recipeNameProblem(v, existing))}
          description="Kebab-case. It becomes the file name and slug and can't be changed later."
          inputTestId="inflate-new-name"
        />
        <TextField
          label="Description"
          name="description"
          isRequired
          value={description}
          onChange={setDescription}
          description="One line: what this recipe is for."
          inputTestId="inflate-new-description"
        />
        <Select
          label="Target"
          value={target}
          onChange={(key) => {
            if (isInflateTarget(key)) setTarget(key);
          }}
          description="Which agent reads the document. Changes the install paths and default modes."
          triggerTestId="inflate-new-target"
        >
          {INFLATE_TARGETS.map((t) => (
            <ListBoxItem key={t} id={t} textValue={TARGETS[t].label}>
              {TARGETS[t].label}
            </ListBoxItem>
          ))}
        </Select>
        {serverError !== null && <ErrorText>{serverError}</ErrorText>}
      </Form>
    </Dialog>
  );
}

export function NewRecipeDialog() {
  const url = useStore($inflateUrl);
  return (
    <Modal
      isOpen={url.recipe === 'new'}
      isDismissable
      onOpenChange={(open) => {
        if (!open) cancelNewRecipe();
      }}
      testId="inflate-new-dialog"
    >
      <NewRecipeForm onCancel={cancelNewRecipe} />
    </Modal>
  );
}
