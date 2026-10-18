// Browser-only hook. Text being typed into a field whose committed value is derived (a number, a path, a
// list): the draft is shown while the field has focus, every valid value is committed at once, and the draft
// is dropped on blur so the field falls back to the committed (normalised) value.
import { useState } from 'react';

export interface DraftField {
  /** What the input shows: the draft while typing, else the committed value. */
  shown: string;
  /** A draft exists and `isValid` rejects it. */
  invalid: boolean;
  onChange: (next: string) => void;
  onBlur: () => void;
}

export function useDraftField(
  value: string,
  commit: (next: string) => void,
  isValid: (next: string) => boolean = () => true,
): DraftField {
  const [draft, setDraft] = useState<string | null>(null);
  return {
    shown: draft ?? value,
    invalid: draft !== null && !isValid(draft),
    onChange: (next) => {
      setDraft(next);
      if (isValid(next)) commit(next);
    },
    onBlur: () => setDraft(null),
  };
}
