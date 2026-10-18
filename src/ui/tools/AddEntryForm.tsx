// "Add entry" panel of the Tools page (UI_SPEC §I.5): scaffolds a dataset entry through the allowlisted
// `add` script. Field values are component-local drafts; the chosen dataset is URL state (`?add=`). After a
// successful add the store opens the new entry (ROUND2_UI_SPEC §I); the result panel shows "Opening…" meanwhile.
import { useStore } from '@nanostores/react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Form } from 'react-aria-components';
import { DATASETS } from '../../datasets/registry.ts';
import type { DatasetId } from '../../datasets/registry.ts';
import { nameProblem } from '../../lib/names.ts';
import { $addDataset, $run, clearRun, runScript, setAddDataset } from '../../stores/tools.ts';
import { Button, ButtonLink, Spinner } from '../kit/Button.tsx';
import { TextField } from '../kit/Field.tsx';
import { ListBoxItem } from '../kit/ListBox.tsx';
import { Select } from '../kit/Select.tsx';

export function AddEntryForm() {
  const dataset = useStore($addDataset);
  const run = useStore($run);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [attempted, setAttempted] = useState(false);

  const running = run.status === 'running';
  const created = run.status === 'done' && run.script === 'add' ? run.created : undefined;

  function resetForm() {
    setName('');
    setTitle('');
    setDescription('');
    setAttempted(false);
    clearRun();
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAttempted(true);
    if (running || dataset === null || nameProblem(name) !== null || description.trim() === '') {
      return;
    }
    const body: { dataset: DatasetId; name: string; description: string; title?: string } = {
      dataset,
      name,
      description: description.trim(),
    };
    if (title.trim() !== '') body.title = title.trim();
    await runScript('add', body);
  }

  return (
    <section id="add-entry" className="cx-panel" aria-labelledby="h-add" data-testid="tools-add">
      <h2 className="cx-panel__title" id="h-add">
        Add entry
      </h2>
      <Form
        className="cx-addform"
        validationBehavior="aria"
        onSubmit={onSubmit}
        data-testid="tools-add-form"
      >
        <Select
          label="Dataset"
          value={dataset}
          onChange={(key) => {
            if (key !== null) setAddDataset(String(key) as DatasetId);
          }}
          isRequired
          isInvalid={attempted && dataset === null}
          errorMessage="Required"
          triggerTestId="tools-add-dataset"
          placeholder="Choose a dataset…"
        >
          {DATASETS.map((d) => (
            <ListBoxItem key={d.id} id={d.id} textValue={`${d.label} ${d.id}`}>
              <span className="ck-chip__dot" data-ds={d.id} /> {d.label}{' '}
              <code className="cx-subtle">{d.id}</code>
            </ListBoxItem>
          ))}
        </Select>
        <TextField
          label="Name"
          name="name"
          mono
          isRequired
          value={name}
          onChange={setName}
          validate={(v) => (v === '' ? (attempted ? 'Required' : null) : nameProblem(v))}
          description="Kebab-case; becomes the folder/file name and slug."
          inputTestId="tools-add-name"
        />
        <TextField
          label="Title"
          name="title"
          value={title}
          onChange={setTitle}
          description="Optional human title."
          inputTestId="tools-add-title"
        />
        <TextField
          label="Description"
          name="description"
          isRequired
          value={description}
          onChange={setDescription}
          validate={(v) => (v.trim() === '' && attempted ? 'Required' : null)}
          inputTestId="tools-add-description"
        />
        <div className="cx-addform__actions">
          <Button
            type="submit"
            variant="primary"
            isPending={running && run.script === 'add'}
            isDisabled={running}
            data-testid="tools-add-submit"
          >
            Create entry
          </Button>
        </div>
      </Form>
      {created && (
        <div className="cx-addform__result" role="status" data-testid="tools-add-result">
          Created <code data-testid="tools-add-path">{created.path}</code>
          {run.follow === true && (
            <span className="cx-addform__opening" data-testid="tools-add-opening">
              <Spinner label="Opening…" /> Opening…
            </span>
          )}
          <ButtonLink size="sm" variant="secondary" href={created.url} data-testid="tools-add-open">
            Open entry
          </ButtonLink>
          {created.dataset === 'context' && (
            <ButtonLink size="sm" variant="secondary" href={`/forge?context=${created.slug}`}>
              Open in Forge
            </ButtonLink>
          )}
          {created.dataset === 'recipe' && (
            <ButtonLink size="sm" variant="secondary" href={`/inflate?recipe=${created.slug}`}>
              Open in Inflate
            </ButtonLink>
          )}
          <Button size="sm" variant="ghost" onPress={resetForm}>
            Add another
          </Button>
        </div>
      )}
      {created && run.followTimedOut === true && (
        <p className="cx-addform__note cx-subtle" data-testid="tools-add-follow-timeout">
          Couldn&apos;t confirm the new entry yet — use Open entry above. A built server lists new
          entries only after a rebuild.
        </p>
      )}
    </section>
  );
}
