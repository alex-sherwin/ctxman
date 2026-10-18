// "Build context from this project" dialog (ROUND3_SPEC §E.5, A6): the project plus its children (and optionally
// its related / depends-on entries) become the links of a NEW context, or are appended to an existing one. There
// is no dedicated endpoint: POST /api/context (create with links) or POST /api/context/<slug>/links (append).
// On success the browser opens the context in the Forge. Browser-only; kit parts by file.
import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Form } from 'react-aria-components';
import type { LinkableDatasetId } from '../../datasets/registry.ts';
import { nameProblem } from '../../lib/names.ts';
import { $entries, ensureEntries } from '../../stores/entries.ts';
import { Button } from '../kit/Button.tsx';
import { Checkbox } from '../kit/Checkbox.tsx';
import { Dialog, Modal } from '../kit/Dialog.tsx';
import { TextField } from '../kit/Field.tsx';
import { ListBoxItem } from '../kit/ListBox.tsx';
import { Select } from '../kit/Select.tsx';
import { appendContextLinks, createContextWithLinks } from './entry-api.ts';
import { buildContextLinks } from './entry-helpers.ts';

const FORM_ID = 'build-context-form';
const NEW_CONTEXT = '__new__';

export interface KeyedEntry {
  key: string;
  title: string;
}

export interface BuildContextDialogProps {
  dataset: LinkableDatasetId;
  slug: string;
  title: string;
  /** The project's children (checked by default). */
  childEntries: readonly KeyedEntry[];
  /** Related and depends-on targets (unchecked by default). */
  related: readonly KeyedEntry[];
  onClose: () => void;
}

export function BuildContextDialog({
  dataset,
  slug,
  title,
  childEntries,
  related,
  onClose,
}: BuildContextDialogProps) {
  const entries = useStore($entries);
  const [checked, setChecked] = useState<string[]>(() => childEntries.map((c) => c.key));
  const [target, setTarget] = useState<string>(NEW_CONTEXT);
  // `null` = untouched: the default name is the project's slug while that is free
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [serverName, setServerName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureEntries('context');
  }, []);

  const contexts = [...(entries.context?.entries ?? [])].sort((a, b) =>
    a.slug.localeCompare(b.slug, 'en'),
  );
  const existing = new Set(contexts.map((c) => c.slug));
  const creating = target === NEW_CONTEXT;
  const name = nameDraft ?? (existing.has(slug) ? '' : slug);
  const problem = creating ? nameProblem(name, existing, 'context') : null;
  const valid = !creating || problem === null;

  const selfKey = `${dataset}/${slug}`;
  // keep the dialog's order (children, then related) whatever the order of the clicks
  const chosenKeys = [...childEntries, ...related]
    .map((e) => e.key)
    .filter((k) => checked.includes(k));
  const links = buildContextLinks({ dataset, slug }, chosenKeys);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    setServerName(null);
    const contextName = creating ? name : target;
    const res = creating
      ? await createContextWithLinks({
          name,
          description: `Working set for ${title}: the project and its children.`,
          links,
        })
      : await appendContextLinks(target, links);
    if (res.ok) {
      location.assign(`/forge?context=${encodeURIComponent(contextName)}`);
      return; // stays pending until the navigation
    }
    setPending(false);
    if (creating && res.status === 409) setServerName('A context with this name already exists');
    else setError(res.issues?.map((i) => i.message).join('; ') || res.message);
  }

  function toggle(key: string, on: boolean) {
    setChecked((cur) =>
      on ? [...cur.filter((k) => k !== key), key] : cur.filter((k) => k !== key),
    );
  }

  const rows = (heading: string, items: readonly KeyedEntry[]) =>
    items.length === 0 ? null : (
      <fieldset className="cx-bctx__group">
        <legend className="cx-bctx__legend">{heading}</legend>
        {items.map((item) => (
          <Checkbox
            key={item.key}
            isSelected={checked.includes(item.key)}
            onChange={(on) => toggle(item.key, on)}
            data-testid="build-context-item"
            data-key={item.key}
          >
            <span className="cx-bctx__title">{item.title}</span>
            <code className="cx-bctx__key">{item.key}</code>
          </Checkbox>
        ))}
      </fieldset>
    );

  return (
    <Modal
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="large"
      className="cx-bctx"
      testId="build-context-dialog"
    >
      <Dialog
        title="Build context from this project"
        footer={
          <>
            <Button variant="secondary" onPress={onClose} data-testid="build-context-cancel">
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form={FORM_ID}
              isDisabled={!valid}
              isPending={pending}
              data-testid="build-context-submit"
            >
              {creating ? 'Create context' : 'Add to context'}
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
          <fieldset className="cx-bctx__group">
            <legend className="cx-bctx__legend">The project</legend>
            <Checkbox isSelected isDisabled data-testid="build-context-item" data-key={selfKey}>
              <span className="cx-bctx__title">{title}</span>
              <code className="cx-bctx__key">{selfKey}</code>
            </Checkbox>
          </fieldset>
          {rows('Children', childEntries)}
          {rows('Related and required', related)}
          <p className="cx-subtle" data-testid="build-context-count">
            {links.length} {links.length === 1 ? 'link' : 'links'} will be added.
          </p>
          <Select
            label="Target"
            searchable={contexts.length > 6}
            value={target}
            onChange={(key) => {
              setTarget(key === null ? NEW_CONTEXT : String(key));
              setError(null);
              setServerName(null);
            }}
            triggerTestId="build-context-target"
          >
            <ListBoxItem id={NEW_CONTEXT} textValue="New context">
              New context
            </ListBoxItem>
            {contexts.map((c) => (
              <ListBoxItem key={c.slug} id={c.slug} textValue={c.slug} description={c.description}>
                {c.slug}
              </ListBoxItem>
            ))}
          </Select>
          {creating && (
            <TextField
              label="Context name"
              name="name"
              mono
              isRequired
              value={name}
              onChange={(v) => {
                setNameDraft(v);
                setServerName(null);
              }}
              isInvalid={(name !== '' && problem !== null) || serverName !== null}
              errorMessage={(name !== '' ? problem : null) ?? serverName ?? undefined}
              description="Kebab-case. It becomes the file name and can't be changed later."
              inputTestId="build-context-name"
            />
          )}
          {error !== null && (
            <p className="cx-entrydlg__error" role="alert" data-testid="build-context-error">
              {error}
            </p>
          )}
        </Form>
      </Dialog>
    </Modal>
  );
}
