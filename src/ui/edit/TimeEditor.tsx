// The `time` list of a task, feature, bug or rca (Details dialog): one removable chip per ISO 8601 duration and an
// input where Enter adds the typed duration when it is valid (time-input.ts); an invalid one stays in the input with
// the problem shown. The total sits under the input. Controlled: the caller owns the list. Kit parts by file.
import { useState } from 'react';
import { timeTotalText } from '../../lib/iso8601.ts';
import { TextField } from '../kit/Field.tsx';
import { Tag, TagGroup } from '../kit/TagGroup.tsx';
import { addTimeInput } from './time-input.ts';

export interface TimeEditorProps {
  values: readonly string[];
  onChange: (values: string[]) => void;
  /** Test ids: `${p}-time` (the group), `${p}-add-time` (the input), `${p}-time-total`. */
  testIdPrefix: string;
  /** A server problem for the field (shown under the input). */
  errorMessage?: string | undefined;
}

export function TimeEditor({ values, onChange, testIdPrefix, errorMessage }: TimeEditorProps) {
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const shown = problem ?? errorMessage;
  const total = timeTotalText(values);

  function commit() {
    const result = addTimeInput(values, draft);
    if (result.ok) {
      onChange(result.values);
      setDraft('');
      setProblem(null);
    } else {
      setProblem(result.problem);
    }
  }

  return (
    <div className="cx-timeedit">
      <TagGroup
        label="Time"
        onRemove={(keys) => onChange(values.filter((_, i) => !keys.has(String(i))))}
        emptyText="No time logged"
        data-testid={`${testIdPrefix}-time`}
      >
        {values.map((value, i) => (
          <Tag key={`${i}:${value}`} id={String(i)} textValue={value}>
            {value}
          </Tag>
        ))}
      </TagGroup>
      <TextField
        aria-label="Add time"
        size="sm"
        mono
        className="cx-timeedit__input"
        placeholder="PT1H30M"
        value={draft}
        onChange={(text) => {
          setDraft(text);
          setProblem(null);
        }}
        isInvalid={shown !== undefined}
        errorMessage={shown}
        description="Time spent as an ISO 8601 duration (PT1H30M = 1 h 30 min, PT45M, P1D); Enter adds it."
        onKeyDown={(e) => {
          if (e.key !== 'Enter') {
            // react-aria stops every key that a custom onKeyDown does not release (Esc would not close a dialog)
            e.continuePropagation();
            return;
          }
          // Enter adds the value; it never submits the surrounding form.
          e.preventDefault();
          commit();
        }}
        inputTestId={`${testIdPrefix}-add-time`}
      />
      {total !== '' && (
        <span className="cx-timeedit__total cx-subtle" data-testid={`${testIdPrefix}-time-total`}>
          {total}
        </span>
      )}
    </div>
  );
}
