// Per-item mode Select and option controls (INFLATE_SPEC §4.2/§4.4, §9.3), plus the material controls of a
// working-directory run (INFLATE_V2_SPEC §11.3). The controls are generated from the catalog: the mode's
// `options` pick the OPTION_DEFS entries, whose `control` picks the widget; the material's `options` pick
// MATERIAL_OPTION_DEFS the same way. Values shown are the RESOLVED options of the segment; edits go through
// `setMode` / `setOption` / `setMaterial` / `setMaterialOption`, which drop overrides that equal what the
// plan would pick anyway.
import { useStore } from '@nanostores/react';
import {
  CLONE_DIR_MESSAGE,
  GIT_REF_MESSAGE,
  MATERIAL_OPTION_DEFS,
  OPTION_DEFS,
  isMaterialFor,
  isModeFor,
  isPrimaryEligible,
  isSafeGitRef,
  isSafeRelativeDir,
  materialDef,
  materialsFor,
  modeDef,
  modesFor,
} from '../../lib/inflate/catalog.ts';
import type {
  MaterialOptionDef,
  MaterialOptionId,
  OptionDef,
  OptionId,
} from '../../lib/inflate/catalog.ts';
import type { ItemSegment } from '../../lib/inflate/expand.ts';
import {
  $working,
  setMaterial,
  setMaterialOption,
  setMode,
  setOption,
  setPrimary,
} from '../../stores/inflate.ts';
import { $effectiveDir } from '../../stores/inflate-run.ts';
import { useDraftField } from '../edit/useDraftField.ts';
import { Checkbox, ListBoxItem, Select, TextField } from '../kit/index.ts';

type TextDef = Extract<OptionDef, { control: 'text' }>;

function TextOption({ seg, def }: { seg: ItemSegment; def: TextDef }) {
  const resolved = seg.options[def.id] ?? def.default;
  // The text being typed; kept while the field has focus so a `{name}` template is not rewritten under
  // the cursor. Only valid values are committed to the recipe.
  const f = useDraftField(resolved, (v) => setOption(seg.key, def.id, v), isSafeRelativeDir);
  return (
    <span className="cx-seg__opt">
      <span className="cx-seg__optlabel" title={def.help}>
        {def.label}
      </span>
      <TextField
        size="sm"
        mono
        aria-label={`${def.label} for ${seg.title}`}
        value={f.shown}
        onChange={f.onChange}
        onBlur={f.onBlur}
        isInvalid={f.invalid}
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

type MaterialTextDef = Extract<MaterialOptionDef, { control: 'text' }>;

function BranchOption({ seg, def }: { seg: ItemSegment; def: MaterialTextDef }) {
  const resolved = seg.materialOptions.branch ?? def.default;
  // Like TextOption: only valid refs are committed, the draft stays while the field has focus.
  const f = useDraftField(resolved, (v) => setMaterialOption(seg.key, def.id, v), isSafeGitRef);
  return (
    <span className="cx-seg__opt">
      <span className="cx-seg__optlabel" title={def.help}>
        {def.label}
      </span>
      <TextField
        size="sm"
        mono
        aria-label={`${def.label} for ${seg.title}`}
        value={f.shown}
        onChange={f.onChange}
        onBlur={f.onBlur}
        placeholder="default branch"
        isInvalid={f.invalid}
        errorMessage={GIT_REF_MESSAGE}
        inputTestId="inflate-mopt-branch"
        className="cx-seg__branchopt"
      />
    </span>
  );
}

function MaterialOption({ seg, id }: { seg: ItemSegment; id: MaterialOptionId }) {
  const def = MATERIAL_OPTION_DEFS[id];
  switch (def.control) {
    case 'select-number': {
      const value = seg.materialOptions.cloneDepth;
      const current = typeof value === 'number' ? value : def.default;
      const known: readonly number[] = def.choices;
      const choices = known.includes(current) ? known : [...known, current];
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
              if (key !== null) setMaterialOption(seg.key, id, Number(key));
            }}
            triggerTestId="inflate-mopt-cloneDepth"
          >
            {choices.map((n) => (
              <ListBoxItem key={n} id={n} textValue={n === 0 ? 'full' : String(n)}>
                {n === 0 ? 'full' : n}
              </ListBoxItem>
            ))}
          </Select>
        </span>
      );
    }
    case 'text':
      return <BranchOption seg={seg} def={def} />;
    case 'checkbox':
      // Sparse checkout needs a subpath to check out: offered only when the reference has one (the entry
      // summary carries it; the planner ignores the flag without one).
      if (seg.meta?.subpath === undefined) return null;
      return (
        <span className="cx-seg__opt" title={def.help}>
          <Checkbox
            isSelected={seg.materialOptions.subpathOnly === true}
            onChange={(on) => setMaterialOption(seg.key, id, on)}
            data-testid="inflate-mopt-subpathOnly"
          >
            {def.label}
          </Checkbox>
        </span>
      );
  }
}

function PrimaryCheckbox({ seg }: { seg: ItemSegment }) {
  const working = useStore($working);
  return (
    <span
      className="cx-seg__opt"
      title="The repository the session works on; the document leads with it."
    >
      <Checkbox
        isSelected={working?.output?.primary === seg.key}
        onChange={(on) => setPrimary(on ? seg.key : null)}
        data-testid="inflate-segment-primary"
        aria-label={`Primary repository: ${seg.title}`}
      >
        Primary
      </Checkbox>
    </span>
  );
}

/** What a run places for this item: the material, its options and (for a repository) the Primary flag. */
function MaterialControls({ seg }: { seg: ItemSegment }) {
  const { kind, material } = seg;
  if (kind === null || material === null) return null;
  const options = materialDef(kind, material)?.options ?? [];
  return (
    <div className="cx-seg__opts cx-seg__opts--material" data-testid="inflate-segment-materials">
      <span className="cx-seg__optlabel" title="What a run places in the working directory">
        Material
      </span>
      <Select
        size="sm"
        aria-label={`Material for ${seg.title}`}
        value={material}
        onChange={(key) => {
          const next = String(key);
          if (key !== null && isMaterialFor(kind, next)) setMaterial(seg.key, next);
        }}
        triggerTestId="inflate-segment-material"
        className="cx-seg__material"
      >
        {materialsFor(kind).map((m) => (
          <ListBoxItem key={m.id} id={m.id} textValue={m.label} description={m.description}>
            {m.label}
          </ListBoxItem>
        ))}
      </Select>
      {options.map((id) => (
        <MaterialOption key={id} seg={seg} id={id} />
      ))}
      {isPrimaryEligible(kind, material) && <PrimaryCheckbox seg={seg} />}
    </div>
  );
}

export function OptionControls({ seg }: { seg: ItemSegment }) {
  const dir = useStore($effectiveDir);
  const { kind, mode } = seg;
  if (kind === null || mode === null) return null;
  const options = modeDef(kind, mode)?.options ?? [];
  return (
    <>
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
      {dir !== null && <MaterialControls seg={seg} />}
    </>
  );
}
