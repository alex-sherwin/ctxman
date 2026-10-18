// "New entry" panel of the Tools page (UI_SPEC §I.5, ROUND3_SPEC §E.7): every dataset is created in its own form at
// /new/<ds>, so this panel only picks the dataset (URL state `?add=`) and links to that form; the CLI twin
// (`pnpm run add:<ds> <name>`) is shown as a hint. Nothing is created here.
import { useStore } from '@nanostores/react';
import { DATASETS, getDataset } from '../../datasets/registry.ts';
import type { DatasetId } from '../../datasets/registry.ts';
import { $addDataset, setAddDataset } from '../../stores/tools.ts';
import { ButtonLink } from '../kit/Button.tsx';
import { ListBoxItem } from '../kit/ListBox.tsx';
import { Select } from '../kit/Select.tsx';

export function AddEntryForm() {
  const dataset = useStore($addDataset);
  const def = dataset === null ? undefined : getDataset(dataset);

  return (
    <section id="add-entry" className="cx-panel" aria-labelledby="h-add" data-testid="tools-add">
      <h2 className="cx-panel__title ck-label" id="h-add">
        New entry
      </h2>
      <div className="cx-addform">
        <Select
          label="Dataset"
          value={dataset}
          onChange={(key) => {
            if (key !== null) setAddDataset(String(key) as DatasetId);
          }}
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
        <div className="cx-addform__actions">
          <ButtonLink
            variant="primary"
            href={dataset === null ? undefined : `/new/${dataset}`}
            isDisabled={dataset === null}
            data-testid="tools-add-open-form"
          >
            Open the New {def?.singular ?? 'entry'} form
          </ButtonLink>
        </div>
        <p className="cx-addform__note cx-subtle">
          From a terminal:{' '}
          <code data-testid="tools-add-cli">
            pnpm run add:{dataset ?? '<dataset>'} &lt;name&gt;
          </code>
        </p>
      </div>
    </section>
  );
}
