// "Add to context" dialog (ROUND3_SPEC §E.5): link THIS entry into a context without leaving the page. Pick an
// existing context (one that already links the entry is disabled) or "New context…" (name + auto description),
// optionally with a one-line note for the agent. Writes through POST /api/context/<slug>/links (append) or
// POST /api/context (create). Contexts are yaml files the dev server does not watch, so the parent reloads the
// page at once on success. Browser-only; kit parts by file.
import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Form } from 'react-aria-components';
import type { LinkableDatasetId } from '../../datasets/registry.ts';
import { nameProblem } from '../../lib/names.ts';
import { $entries, ensureEntries } from '../../stores/entries.ts';
import { Button } from '../kit/Button.tsx';
import { Dialog, Modal } from '../kit/Dialog.tsx';
import { TextField } from '../kit/Field.tsx';
import { ListBoxItem } from '../kit/ListBox.tsx';
import { Select } from '../kit/Select.tsx';
import { appendContextLinks, createContextWithLinks } from './entry-api.ts';
import type { ContextLinkBody } from './entry-api.ts';

const FORM_ID = 'add-to-context-form';
const NEW_CONTEXT = '__new__';

export interface AddToContextDialogProps {
  dataset: LinkableDatasetId;
  slug: string;
  /** Display title of the entry (the new context's description names it). */
  title: string;
  /** Contexts that already link this entry (disabled, "already linked"). */
  linkedContexts: readonly string[];
  onClose: () => void;
  /** The write answered 200 / 201; the parent closes and reloads at once. */
  onDone: (message: string) => void;
}

export function AddToContextDialog({
  dataset,
  slug,
  title,
  linkedContexts,
  onClose,
  onDone,
}: AddToContextDialogProps) {
  const entries = useStore($entries);
  const [chosen, setChosen] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [pending, setPending] = useState(false);
  const [serverName, setServerName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureEntries('context');
  }, []);

  const state = entries.context;
  const contexts = [...(state?.entries ?? [])].sort((a, b) => a.slug.localeCompare(b.slug, 'en'));
  const existing = new Set(contexts.map((c) => c.slug));
  // With no context at all the only sensible target is a new one.
  const target =
    chosen ?? (state?.status === 'ready' && contexts.length === 0 ? NEW_CONTEXT : null);
  const creating = target === NEW_CONTEXT;
  const problem = creating ? nameProblem(name, existing, 'context') : null;
  const valid = target !== null && (!creating || problem === null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || pending || target === null) return;
    const link: ContextLinkBody = { dataset, slug };
    if (notes.trim() !== '') link.notes = notes.trim();
    setPending(true);
    setError(null);
    setServerName(null);
    if (creating) {
      const res = await createContextWithLinks({
        name,
        description: `Context for ${title}.`,
        links: [link],
      });
      if (res.ok) {
        onDone(`Added to ${name}`);
        return;
      }
      setPending(false);
      if (res.status === 409) setServerName('A context with this name already exists');
      else setError(res.issues?.map((i) => i.message).join('; ') || res.message);
      return;
    }
    const res = await appendContextLinks(target, [link]);
    if (res.ok) {
      onDone(res.body.added.length > 0 ? `Added to ${target}` : `Already in ${target}`);
      return;
    }
    setPending(false);
    setError(res.issues?.map((i) => i.message).join('; ') || res.message);
  }

  return (
    <Modal
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="cx-a2c"
      testId="add-to-context-dialog"
    >
      <Dialog
        title="Add to context"
        footer={
          <>
            <Button variant="secondary" onPress={onClose} data-testid="add-to-context-cancel">
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form={FORM_ID}
              isDisabled={!valid}
              isPending={pending}
              data-testid="add-to-context-submit"
            >
              Add
            </Button>
          </>
        }
      >
        <Form
          id={FORM_ID}
          className="cx-entrydlg__form"
          validationBehavior="aria"
          onSubmit={(e) => void onSubmit(e)}
        >
          <p className="cx-subtle">
            Link <strong>{title}</strong> into a context, so it is part of that working set.
          </p>
          <Select
            label="Context"
            placeholder={state?.status === 'loading' ? 'Loading…' : 'Select a context…'}
            value={target}
            onChange={(key) => {
              setChosen(key === null ? null : String(key));
              setError(null);
            }}
            disabledKeys={linkedContexts}
            pinnedKeys={[NEW_CONTEXT]}
            triggerTestId="add-to-context-select"
          >
            {contexts.map((c) => (
              <ListBoxItem
                key={c.slug}
                id={c.slug}
                textValue={c.slug}
                description={linkedContexts.includes(c.slug) ? 'already linked' : c.description}
              >
                {c.slug}
              </ListBoxItem>
            ))}
            <ListBoxItem id={NEW_CONTEXT} textValue="New context…">
              + New context…
            </ListBoxItem>
          </Select>
          {creating && (
            <TextField
              label="New context name"
              name="name"
              mono
              autoFocus
              isRequired
              value={name}
              onChange={(v) => {
                setName(v);
                setServerName(null);
              }}
              isInvalid={(name !== '' && problem !== null) || serverName !== null}
              errorMessage={(name !== '' ? problem : null) ?? serverName ?? undefined}
              description="Kebab-case. It becomes the file name and can't be changed later."
              inputTestId="add-to-context-name"
            />
          )}
          <TextField
            label="Notes (optional)"
            value={notes}
            onChange={setNotes}
            description="One line of guidance for the agent about this link. Longer notes: edit the context in the Forge."
            inputTestId="add-to-context-notes"
          />
          {error !== null && (
            <p className="cx-entrydlg__error" role="alert" data-testid="add-to-context-error">
              {error}
            </p>
          )}
        </Form>
      </Dialog>
    </Modal>
  );
}
