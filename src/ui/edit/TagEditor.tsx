// Removable tags + an "add tag" input with the Forge rules (normalize, TAG_PATTERN, no duplicates),
// extracted from the Forge's ContextPane `AddTagInput` so the DataForm shares it (ROUND2_UI_SPEC §C.2).
// Controlled: the caller owns the list. Browser-only; kit parts imported by file.
import { useState } from 'react';
import { normalizeTag, tagProblem } from '../../lib/names.ts';
import { TextField } from '../kit/Field.tsx';
import { Tag, TagGroup } from '../kit/TagGroup.tsx';
import { cx } from '../kit/utils.ts';

export interface TagEditorProps {
  tags: readonly string[];
  onChange: (tags: string[]) => void;
  /** Default 'Tags'. */
  label?: string;
  /** Test ids: `${p}-tags` (the group), `${p}-add-tag` (the input). */
  testIdPrefix: string;
  className?: string;
}

export function TagEditor({
  tags,
  onChange,
  label = 'Tags',
  testIdPrefix,
  className,
}: TagEditorProps) {
  const [draft, setDraft] = useState('');
  const normalized = normalizeTag(draft);
  const problem = tagProblem(normalized);

  function add() {
    if (normalized === '' || problem !== null) return;
    if (!tags.includes(normalized)) onChange([...tags, normalized]);
    setDraft('');
  }

  return (
    <div className={cx('cx-tagedit', className)}>
      <TagGroup
        label={label}
        onRemove={(keys) => onChange(tags.filter((t) => !keys.has(t)))}
        emptyText="No tags"
        data-testid={`${testIdPrefix}-tags`}
      >
        {tags.map((t) => (
          <Tag key={t} id={t}>
            {t}
          </Tag>
        ))}
      </TagGroup>
      <TextField
        aria-label="Add tag"
        size="sm"
        mono
        placeholder="add tag, Enter"
        value={draft}
        onChange={setDraft}
        isInvalid={problem !== null}
        errorMessage={problem ?? undefined}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          add();
        }}
        inputTestId={`${testIdPrefix}-add-tag`}
      />
    </div>
  );
}
