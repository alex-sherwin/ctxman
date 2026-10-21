// React twin of src/components/StateSelect.astro (same markup, classes and test ids) for the ListTable rows. No
// React state: src/scripts/shell.ts saves a change with PATCH /api/entry/<ds>/<slug> {state} through its
// document-level `change` listener, reverts a failed save itself and shows the status. So the select is
// uncontrolled: after the first render shell.ts owns its value, `data-prev` and the wrapper's `data-state-group`.
// The row is a react-aria link (Row `href`): choosing an option fires a `click` on the select without a pointer
// press (`detail` 0), which the row's usePress takes for a virtual press and follows the link to the detail page;
// Enter / Space on the focused select would press the row too. The wrapper keeps those events inside the cell.
import type { KeyboardEvent, SyntheticEvent } from 'react';
import { getDataset, stateGroup } from '../../datasets/registry.ts';
import type { DatasetId } from '../../datasets/registry.ts';

export interface StateSelectProps {
  dataset: DatasetId;
  slug: string;
  /** For the label of the select. */
  title: string;
  /** The raw `state` of the file; may be missing or not a registry state (an invalid file). */
  state: string | undefined;
}

const keepInCell = (event: SyntheticEvent) => event.stopPropagation();
const keepKeyInCell = (event: KeyboardEvent) => {
  if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
};

export function StateSelect({ dataset, slug, title, state }: StateSelectProps) {
  const states = getDataset(dataset)?.states ?? [];
  if (states.length === 0) return null;
  const current = state ?? '';
  const known = states.some((s) => s.id === current);
  const id = `ss-${dataset}-${slug}`;
  return (
    <span
      className="cx-statesel"
      data-state-group={stateGroup(dataset, current)}
      onClick={keepInCell}
      onPointerDown={keepInCell}
      onMouseDown={keepInCell}
      onKeyDown={keepKeyInCell}
    >
      <label className="ck-sr-only" htmlFor={id}>
        State of {title}
      </label>
      <select
        id={id}
        className="ck-native-select cx-statesel__select"
        defaultValue={current}
        data-state-select=""
        data-dataset={dataset}
        data-slug={slug}
        data-prev={current}
        data-testid="state-select"
      >
        {!known && (
          <option value={current} disabled data-group="neutral">
            {current === '' ? 'no state (invalid)' : `${current} (invalid)`}
          </option>
        )}
        {states.map((s) => (
          <option key={s.id} value={s.id} data-group={s.group}>
            {s.label}
          </option>
        ))}
      </select>
      <output
        className="cx-statesel__status ck-status"
        data-state-status=""
        data-testid="state-select-status"
      />
    </span>
  );
}
