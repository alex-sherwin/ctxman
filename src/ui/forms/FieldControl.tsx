// One control of the DataForm, chosen by the field's kind (src/lib/forms/fields.ts). Browser-only; kit parts
// are imported by file, the editor only through LazyCodeEditor (ROUND2_UI_SPEC §A, §H.3).
import { LazyCodeEditor } from '../editor/LazyCodeEditor.tsx';
import { TagEditor } from '../edit/TagEditor.tsx';
import { TextField } from '../kit/Field.tsx';
import { ListBoxItem } from '../kit/ListBox.tsx';
import { Select } from '../kit/Select.tsx';
import { fieldHelp, fieldPlaceholder } from '../../lib/forms/fields.ts';
import type { FieldDef, FormDoc } from '../../lib/forms/fields.ts';

export interface FieldControlProps {
  def: FieldDef;
  doc: FormDoc;
  mode: 'create' | 'edit';
  /** The message to show (already filtered by the store: before the first Save only the live name rule). */
  error: string | undefined;
  onChange: (id: string, value: unknown) => void;
  /** Cmd/Ctrl+S inside a Monaco field. */
  onSave: () => void;
}

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');

export function FieldControl({ def, doc, mode, error, onChange, onSave }: FieldControlProps) {
  const testId = `dform-field-${def.id}`;
  const invalid = error !== undefined;
  const help = fieldHelp(def, doc);

  switch (def.kind) {
    case 'name': {
      const edit = mode === 'edit';
      return (
        <TextField
          label={def.label}
          value={asText(doc[def.id])}
          onChange={(v) => onChange(def.id, v)}
          isReadOnly={edit}
          isInvalid={invalid}
          errorMessage={error}
          description={
            edit
              ? "Names can't be changed"
              : 'Lowercase letters, digits and single hyphens; it becomes the file name and cannot be changed later'
          }
          mono
          autoFocus={!edit}
          autoComplete="off"
          spellCheck="false"
          inputTestId={testId}
        />
      );
    }
    case 'text':
      return (
        <TextField
          label={def.label}
          value={asText(doc[def.id])}
          onChange={(v) => onChange(def.id, v)}
          isInvalid={invalid}
          errorMessage={error}
          description={help}
          placeholder={fieldPlaceholder(def, doc)}
          mono={def.mono}
          autoComplete="off"
          spellCheck={def.mono ? 'false' : undefined}
          inputTestId={testId}
        />
      );
    case 'tags':
      return (
        <TagEditor
          label={def.label}
          tags={Array.isArray(doc[def.id]) ? (doc[def.id] as string[]) : []}
          onChange={(tags) => onChange(def.id, tags)}
          testIdPrefix="dform-field-tags"
        />
      );
    case 'select':
      return (
        <Select
          label={def.label}
          value={asText(doc[def.id]) === '' ? null : asText(doc[def.id])}
          onChange={(key) => {
            if (key !== null) onChange(def.id, String(key));
          }}
          isInvalid={invalid}
          errorMessage={error}
          description={help}
          triggerTestId={testId}
        >
          {(def.options ?? []).map((o) => (
            <ListBoxItem key={o.id} id={o.id} textValue={o.label} description={o.description}>
              {o.label}
            </ListBoxItem>
          ))}
        </Select>
      );
    case 'markdown':
      return (
        <div className="cx-dform__editor" data-invalid={invalid ? '' : undefined}>
          <span className="ck-field__label" id={`${testId}-label`}>
            {def.label}
          </span>
          <LazyCodeEditor
            language="markdown"
            compact
            height={{ mode: 'auto', minLines: 6, maxLines: 20 }}
            value={asText(doc[def.id])}
            onChange={(v) => onChange(def.id, v)}
            ariaLabel={def.label}
            testId={testId}
            onSave={onSave}
          />
          {help !== undefined && <p className="ck-field__description">{help}</p>}
          {error !== undefined && <p className="ck-field__error">{error}</p>}
        </div>
      );
  }
}
