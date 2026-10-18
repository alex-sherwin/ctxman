// Per-item mode Select and option controls (INFLATE_SPEC §4.2/§4.4, §9.3). The controls are generated from
// the catalog: the mode's `options` pick the OPTION_DEFS entries, whose `control` picks the widget.
// Values shown are the RESOLVED options of the segment; edits go through `setMode` / `setOption`, which
// drop overrides that equal what the plan would pick anyway.
import { useState } from 'react';
import {
  CLONE_DIR_MESSAGE,
  OPTION_DEFS,
  isModeFor,
  isSafeRelativeDir,
  modeDef,
  modesFor,
} from '../../lib/inflate/catalog.ts';
import type { OptionDef, OptionId } from '../../lib/inflate/catalog.ts';
import type { ItemSegment } from '../../lib/inflate/expand.ts';
import { setMode, setOption } from '../../stores/inflate.ts';
import { Checkbox, ListBoxItem, Select, TextField } from '../kit/index.ts';

type TextDef = Extract<OptionDef, { control: 'text' }>;

function TextOption({ seg, def }: { seg: ItemSegment; def: TextDef }) {
  const resolved = seg.options[def.id] ?? def.default;
  // The text being typed; kept while the field has focus so a `{name}` template is not rewritten under
  // the cursor. Only valid values are committed to the recipe.
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && !isSafeRelativeDir(draft);
  return (
    <span className="cx-seg__opt">
      <span className="cx-seg__optlabel" title={def.help}>
        {def.label}
      </span>
      <TextField
        size="sm"
        mono
        aria-label={`${def.label} for ${seg.title}`}
        value={draft ?? resolved}
        onChange={(v) => {
          setDraft(v);
          if (isSafeRelativeDir(v)) setOption(seg.key, def.id, v);
        }}
        onBlur={() => setDraft(null)}
        isInvalid={invalid}
        errorMessage={CLONE_DIR_MESSAGE}
        inputTestId={`inflate-opt-${def.id}`}
        className="cx-seg__textopt"
      />
    </span>
  );
}

function OptionControl({ seg, id }: { seg: ItemSegment; id: OptionId }) {
  const def = OPTION_DEFS[id];
  const value = seg.options[id];
  switch (def.control) {
    case 'checkbox':
      return (
        <span className="cx-seg__opt" title={def.help}>
          <Checkbox
            isSelected={value === true}
            onChange={(on) => setOption(seg.key, id, on)}
            data-testid={`inflate-opt-${id}`}
          >
            {def.label}
          </Checkbox>
        </span>
      );
    case 'select-number': {
      const current = typeof value === 'number' ? value : def.default;
      const choices = def.choices.includes(current)
        ? def.choices
        : [...def.choices, current].sort((a, b) => a - b);
      return (
        <span className="cx-seg__opt">
          <span className="cx-seg__optlabel" title={def.help}>
            {def.label}
          </span>
          <Select
            size="sm"
            aria-label={`${def.label} for ${seg.title}`}
            value={current}
            onChange={(key) => {
              if (key !== null) setOption(seg.key, id, Number(key));
            }}
            triggerTestId={`inflate-opt-${id}`}
          >
            {choices.map((n) => (
              <ListBoxItem key={n} id={n} textValue={String(n)}>
                {n}
              </ListBoxItem>
            ))}
          </Select>
        </span>
      );
    }
    case 'text':
      return <TextOption seg={seg} def={def} />;
  }
}

export function OptionControls({ seg }: { seg: ItemSegment }) {
  const { kind, mode } = seg;
  if (kind === null || mode === null) return null;
  const options = modeDef(kind, mode)?.options ?? [];
  return (
    <div className="cx-seg__opts">
      <Select
        size="sm"
        aria-label={`Mode for ${seg.title}`}
        value={mode}
        onChange={(key) => {
          const next = String(key);
          if (key !== null && isModeFor(kind, next)) setMode(seg.key, next);
        }}
        triggerTestId="inflate-segment-mode"
        className="cx-seg__mode"
      >
        {modesFor(kind).map((m) => (
          <ListBoxItem key={m.id} id={m.id} textValue={m.label} description={m.description}>
            {m.label}
          </ListBoxItem>
        ))}
      </Select>
      {options.map((id) => (
        <OptionControl key={id} seg={seg} id={id} />
      ))}
    </div>
  );
}
